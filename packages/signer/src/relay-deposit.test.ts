import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { checkSolanaTransaction } from "./rules.js";
import { RELAY_DEPOSITORY_CONFIG, RELAY_DEPOSITORY_VAULT, RELAY_SOLANA_DEPOSITORY, USDC_MINT, ownerAtas } from "./solana-ix.js";

/**
 * Solana USDC straight into the wallet's own Hyperliquid account, through
 * Relay's depository: the real instruction from a Relay quote passes, and
 * every account that decides whose money it is or where it goes is pinned.
 */

type QuoteIx = { programId: string; data: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[] };
const fx = JSON.parse(readFileSync(new URL("./fixtures/relay-solana-to-hl.json", import.meta.url), "utf8")) as {
  quote: { steps: { items: { data: { instructions: QuoteIx[] } }[] }[]; details: { sender: string } };
};
const owner = new PublicKey(fx.quote.details.sender);
const real = fx.quote.steps[0]!.items[0]!.data.instructions[0]!;
const stranger = Keypair.generate().publicKey;

function deposit(edit: (ix: TransactionInstruction) => void = () => {}): VersionedTransaction {
  const ix = new TransactionInstruction({
    programId: new PublicKey(real.programId),
    keys: real.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(real.data, "hex"),
  });
  edit(ix);
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }), ix];
  return new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message());
}
const setKey = (i: number, key: PublicKey | string) => (ix: TransactionInstruction) => {
  ix.keys[i] = { ...ix.keys[i]!, pubkey: new PublicKey(key) };
};
const check = (tx: VersionedTransaction) => checkSolanaTransaction(tx, owner);

describe("Relay deposit from Solana", () => {
  it("passes the real quote's deposit, bounded to the amount quoted", () => {
    expect(real.programId).toBe(RELAY_SOLANA_DEPOSITORY);
    expect(real.keys[0]!.pubkey).toBe(RELAY_DEPOSITORY_CONFIG);
    expect(real.keys[3]!.pubkey).toBe(RELAY_DEPOSITORY_VAULT);
    const report = check(deposit());
    const usdc = [...ownerAtas(owner.toBase58(), USDC_MINT)];
    expect(Object.keys(report.spends)).toHaveLength(1);
    expect(usdc).toContain(Object.keys(report.spends)[0]);
    expect(Object.values(report.spends)[0]).toBe("25300000");
  });

  it("refuses someone else as sender or depositor (where a refund would go)", () => {
    expect(() => check(deposit(setKey(2, stranger)))).toThrow(/depositor: the wallet must be the signer/);
  });

  it("refuses paying from a token account that isn't the wallet's USDC", () => {
    expect(() => check(deposit(setKey(5, [...ownerAtas(stranger.toBase58(), USDC_MINT)][0]!)))).toThrow(/not the wallet's own token account/);
  });

  it("refuses another mint, another vault, a look-alike config or vault account", () => {
    expect(() => check(deposit(setKey(4, "So11111111111111111111111111111111111111112")))).toThrow(/deposit mint must be/);
    expect(() => check(deposit(setKey(3, stranger)))).toThrow(/Relay vault must be/);
    expect(() => check(deposit(setKey(6, stranger)))).toThrow(/vault token account must be/);
    expect(() => check(deposit(setKey(0, stranger)))).toThrow(/depository config must be/);
  });

  it("refuses every other depository instruction", () => {
    const other = (hex: string) => (ix: TransactionInstruction) => {
      ix.data = Buffer.concat([Buffer.from(hex, "hex"), ix.data.subarray(8)]);
    };
    // deposit_native (SOL) and an unknown one.
    expect(() => check(deposit(other("0d9e0ddf5fd51c06")))).toThrow(/only deposit_token/);
    expect(() => check(deposit(other("0000000000000000")))).toThrow(/only deposit_token/);
  });
});
