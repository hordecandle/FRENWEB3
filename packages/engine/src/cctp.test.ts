import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { checkEvmTransaction, checkSolanaTransaction } from "@fren/signer";
import { encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { ARB_MESSAGE_TRANSMITTER_V2, SolanaToArbitrum, depositForBurnIx } from "./venues/cctp.js";

const owner = Keypair.generate().publicKey;
const evm = "0x9ad1a4f679a9eafc420e50cf5e34d887a524f061";
const other = "0x000000000000000000000000000000000000dEaD";

function txOf(ix: ReturnType<typeof depositForBurnIx>) {
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: PublicKey.default.toBase58(), instructions: [ix] }).compileToV0Message();
  return new VersionedTransaction(msg);
}

describe("CCTP burn on Solana, as the signer sees it", () => {
  it("allows a burn that mints to the wallet's own Arbitrum address, capped at the amount", () => {
    const tx = txOf(depositForBurnIx(owner, evm, 30_750_000n, Keypair.generate().publicKey));
    const report = checkSolanaTransaction(tx, owner, { evmOwner: evm });
    expect(Object.values(report.spends)).toEqual(["30750000"]);
  });

  it("refuses a burn for anyone else, another chain, a named caller, or without the EVM address", () => {
    const bad = (mutate: (d: Buffer) => void) => {
      const ix = depositForBurnIx(owner, evm, 1_000_000n, Keypair.generate().publicKey);
      mutate(ix.data);
      return txOf(ix);
    };
    expect(() => checkSolanaTransaction(txOf(depositForBurnIx(owner, other, 1_000_000n, Keypair.generate().publicKey)), owner, { evmOwner: evm })).toThrow(/own Arbitrum address/);
    expect(() => checkSolanaTransaction(bad((d) => d.writeUInt32LE(0, 16)), owner, { evmOwner: evm })).toThrow(/Arbitrum only/);
    expect(() => checkSolanaTransaction(bad((d) => d.fill(1, 52, 84)), owner, { evmOwner: evm })).toThrow(/destination caller/);
    expect(() => checkSolanaTransaction(bad((d) => d.writeBigUInt64LE(500_000n, 84)), owner, { evmOwner: evm })).toThrow(/fee cap/);
    expect(() => checkSolanaTransaction(txOf(depositForBurnIx(owner, evm, 1n, Keypair.generate().publicKey)), owner)).toThrow(/EVM address/);
  });
});

/** A CCTP V2 message: 148-byte header, then the burn body with the mint recipient at 184..216. */
function message(destDomain: number, recipient: string): `0x${string}` {
  const m = Buffer.alloc(148 + 228);
  m.writeUInt32BE(1, 0);
  m.writeUInt32BE(5, 4);
  m.writeUInt32BE(destDomain, 8);
  Buffer.from(recipient.slice(2).padStart(64, "0"), "hex").copy(m, 184);
  return `0x${m.toString("hex")}`;
}
const receive = (msg: `0x${string}`) =>
  encodeFunctionData({
    abi: [{ type: "function", name: "receiveMessage", stateMutability: "nonpayable", inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }], outputs: [{ type: "bool" }] }],
    functionName: "receiveMessage",
    args: [msg, "0x1234"],
  });

describe("CCTP mint on Arbitrum, as the signer sees it", () => {
  it("relays only a mint to the wallet on Arbitrum", () => {
    expect(checkEvmTransaction({ chainId: 42161, to: ARB_MESSAGE_TRANSMITTER_V2 as `0x${string}`, data: receive(message(3, evm)) }, evm).kind).toBe("cctp");
    expect(() => checkEvmTransaction({ chainId: 42161, to: ARB_MESSAGE_TRANSMITTER_V2 as `0x${string}`, data: receive(message(3, other)) }, evm)).toThrow(/wallet itself/);
    expect(() => checkEvmTransaction({ chainId: 42161, to: ARB_MESSAGE_TRANSMITTER_V2 as `0x${string}`, data: receive(message(6, evm)) }, evm)).toThrow(/not for Arbitrum/);
  });
});

describe("SolanaToArbitrum", () => {
  function bridge(attestAfter: number) {
    const kv = new Map<string, string>();
    const sentArb: string[] = [];
    let polls = 0;
    const b = new SolanaToArbitrum({
      kv: { getKv: (k) => kv.get(k) ?? null, setKv: (k, v) => void kv.set(k, v) },
      fetchFn: (async () => {
        polls++;
        const ready = polls > attestAfter;
        return new Response(JSON.stringify({ messages: [{ status: ready ? "complete" : "pending_confirmations", message: ready ? message(3, evm) : null, attestation: ready ? "0xabcd" : null }] }));
      }) as typeof fetch,
      sendSolana: async () => "5olSig",
      solanaOwner: async () => owner,
      evmOwner: async () => evm,
      sendArbitrum: async (to, data) => (sentArb.push(`${to}:${data.slice(0, 10)}`), "https://arbiscan.io/tx/0x1"),
      sleep: async () => {},
      attestationWaitMs: 50,
    });
    return { b, kv, sentArb };
  }

  it("burns, waits for Circle and mints on Arbitrum", async () => {
    const { b, sentArb } = bridge(2);
    const out = await b.bridge(30.75);
    expect(out[0]).toMatch(/Sent \$30\.75 USDC from Solana .*solscan\.io\/tx\/5olSig/);
    expect(out[1]).toMatch(/arrived on Arbitrum/);
    expect(sentArb).toEqual([`${ARB_MESSAGE_TRANSMITTER_V2}:0x57ecfd28`]);
    expect(b.pending()).toEqual([]);
  });

  it("keeps a transfer Circle hasn't confirmed and mints it later", async () => {
    const { b, sentArb } = bridge(1_000_000);
    await expect(b.bridge(10)).rejects.toThrow(/left Solana .* hasn't confirmed it yet/);
    expect(b.pending()).toEqual([{ sig: "5olSig", usd: 10 }]);
    expect(await b.finishPending()).toEqual([]);
    expect(sentArb).toHaveLength(0);
  });
});
