import { createHash } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { usd as fmtUsd } from "@fren/core";
import { encodeFunctionData } from "viem";
import type { Fetch } from "../http.js";
import { VenueError } from "./types.js";

/**
 * Move USDC from the wallet's Solana address to its own Arbitrum address with
 * Circle's CCTP V2: burn on Solana, wait for Circle's attestation, mint on
 * Arbitrum. The signer checks both ends: the burn must mint to the wallet's own
 * EVM address, and the mint call must be for that address.
 *
 * Standard transfers (finality 2000) have no Circle fee. Accounts follow
 * circlefin/solana-cctp-contracts programs/v2 (deposit_for_burn, event_cpi).
 */

const TMM = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
const MT = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SOLANA_USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const ARBITRUM_DOMAIN = 3;
const SOLANA_DOMAIN = 5;
const STANDARD_FINALITY = 2000;
export const ARB_MESSAGE_TRANSMITTER_V2 = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64";

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

/** The deposit_for_burn instruction, burning `amountRaw` USDC for `evmRecipient` on Arbitrum. */
export function depositForBurnIx(owner: PublicKey, evmRecipient: string, amountRaw: bigint, eventData: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(8 + 8 + 4 + 32 + 32 + 8 + 4);
  disc("deposit_for_burn").copy(data, 0);
  data.writeBigUInt64LE(amountRaw, 8);
  data.writeUInt32LE(ARBITRUM_DOMAIN, 16);
  Buffer.from(evmRecipient.toLowerCase().replace(/^0x/, "").padStart(64, "0"), "hex").copy(data, 20);
  // 52..84 destination caller: zero, anyone may relay. 84..92 max fee: 0.
  data.writeUInt32LE(STANDARD_FINALITY, 92);
  const burnAccount = pda([owner.toBuffer(), TOKEN.toBuffer(), SOLANA_USDC.toBuffer()], ATA);
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: pda([Buffer.from("sender_authority")], TMM), isSigner: false, isWritable: false },
    { pubkey: burnAccount, isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("denylist_account"), owner.toBuffer()], TMM), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("message_transmitter")], MT), isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("token_messenger")], TMM), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("remote_token_messenger"), Buffer.from(String(ARBITRUM_DOMAIN))], TMM), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("token_minter")], TMM), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("local_token"), SOLANA_USDC.toBuffer()], TMM), isSigner: false, isWritable: true },
    { pubkey: SOLANA_USDC, isSigner: false, isWritable: true },
    { pubkey: eventData, isSigner: true, isWritable: true },
    { pubkey: MT, isSigner: false, isWritable: false },
    { pubkey: TMM, isSigner: false, isWritable: false },
    { pubkey: TOKEN, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // #[event_cpi]
    { pubkey: pda([Buffer.from("__event_authority")], TMM), isSigner: false, isWritable: false },
    { pubkey: TMM, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: TMM, keys, data });
}

export interface CctpOptions {
  fetchFn: Fetch;
  /** Circle's attestation API. */
  irisUrl?: string;
  /** Sends a Solana transaction that needs extra signers; returns its signature. */
  sendSolana: (ixs: TransactionInstruction[], extra: Keypair[], maxSolSpendLamports: number) => Promise<string>;
  solanaOwner: () => Promise<PublicKey>;
  evmOwner: () => Promise<string>;
  /** Sends a call on Arbitrum and waits for it; returns an explorer link. */
  sendArbitrum: (to: `0x${string}`, data: `0x${string}`) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for Circle's attestation. Default 20 minutes. */
  attestationWaitMs?: number;
  /** Where unfinished transfers are kept, so a later trade can mint them. */
  kv: { getKv(key: string): string | null; setKv(key: string, value: string): void };
}

const PENDING = "cctp_pending";
type Pending = { sig: string; usd: number };

const RECEIVE_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export class SolanaToArbitrum {
  constructor(private readonly o: CctpOptions) {}

  /** Move `amountUsd` USDC to the wallet's Arbitrum address. Returns one line per leg for the owner. */
  async bridge(amountUsd: number): Promise<string[]> {
    const owner = await this.o.solanaOwner();
    const evm = await this.o.evmOwner();
    const amountRaw = BigInt(Math.round(amountUsd * 1e6));
    const eventData = Keypair.generate();
    // Rent for Circle's event account (reclaimable later) plus fees.
    const sig = await this.o.sendSolana([depositForBurnIx(owner, evm, amountRaw, eventData.publicKey)], [eventData], 10_000_000);
    this.setPending([...this.pending(), { sig, usd: amountUsd }]);
    const burned = `✅ Sent ${fmtUsd(amountUsd)} USDC from Solana toward Arbitrum with Circle · https://solscan.io/tx/${sig}`;
    return [burned, await this.mint({ sig, usd: amountUsd })];
  }

  /** Transfers that left Solana but weren't minted on Arbitrum yet (Circle was slow, or Fren restarted). */
  pending(): Pending[] {
    try {
      const v = JSON.parse(this.o.kv.getKv(PENDING) ?? "[]") as Pending[];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  private setPending(list: Pending[]): void {
    this.o.kv.setKv(PENDING, JSON.stringify(list));
  }

  /** Mint every unfinished transfer whose attestation is ready. Returns lines for the owner. */
  async finishPending(): Promise<string[]> {
    const out: string[] = [];
    for (const p of this.pending()) {
      try {
        out.push(await this.mint(p, 0));
      } catch {
        // Not attested yet: try again next time.
      }
    }
    return out;
  }

  private async mint(p: Pending, waitMs?: number): Promise<string> {
    const { message, attestation } = await this.attestation(p.sig, p.usd, waitMs);
    const data = encodeFunctionData({ abi: RECEIVE_ABI, functionName: "receiveMessage", args: [message, attestation] });
    const link = await this.o.sendArbitrum(ARB_MESSAGE_TRANSMITTER_V2, data);
    this.setPending(this.pending().filter((x) => x.sig !== p.sig));
    return `✅ ${fmtUsd(p.usd)} USDC arrived on Arbitrum · ${link}`;
  }

  private async attestation(sig: string, amountUsd: number, waitMs?: number): Promise<{ message: `0x${string}`; attestation: `0x${string}` }> {
    const url = `${this.o.irisUrl ?? "https://iris-api.circle.com"}/v2/messages/${SOLANA_DOMAIN}?transactionHash=${sig}`;
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = Date.now() + (waitMs ?? this.o.attestationWaitMs ?? 20 * 60_000);
    for (;;) {
      const res = await this.o.fetchFn(url).catch(() => null);
      if (res?.ok) {
        const body = (await res.json().catch(() => null)) as { messages?: { status?: string; message?: string; attestation?: string }[] } | null;
        const m = body?.messages?.[0];
        if (m?.status === "complete" && m.message?.startsWith("0x") && m.attestation?.startsWith("0x")) {
          return { message: m.message as `0x${string}`, attestation: m.attestation as `0x${string}` };
        }
      }
      if (Date.now() > deadline) {
        throw new VenueError(
          `The ${fmtUsd(amountUsd)} USDC left Solana (https://solscan.io/tx/${sig}) but Circle hasn't confirmed it yet, so nothing else was done. It's safe: Fren finishes the transfer on your next trade, or ask again in a few minutes.`,
        );
      }
      await sleep(5_000);
    }
  }
}
