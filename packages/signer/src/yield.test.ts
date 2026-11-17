import { AddressLookupTableProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { encodeFunctionData, erc20Abi, maxUint256, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { approvalWithinBalance, checkEvmTransaction } from "./evm.js";
import { SOLANA_PROGRAMS, checkSolanaTransaction } from "./rules.js";

function txFor(payer: PublicKey, ixs: TransactionInstruction[]) {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message());
}

describe("Solana lending rules", () => {
  const owner = Keypair.generate().publicKey;
  const call = (program: string) => new TransactionInstruction({ programId: new PublicKey(program), keys: [{ pubkey: owner, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3]) });

  it("allows Kamino's first-deposit lookup table, but not an unknown Jupiter Lend or Kamino instruction", () => {
    // Real Jupiter Lend and Kamino deposits are checked against API fixtures in solana-h1.test.ts.
    const [create] = AddressLookupTableProgram.createLookupTable({ authority: owner, payer: owner, recentSlot: 1 });
    const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: create.keys[0]!.pubkey, authority: owner, payer: owner, addresses: [owner] });
    expect(() => checkSolanaTransaction(txFor(owner, [create, extend]), owner)).not.toThrow();
    expect(() => checkSolanaTransaction(txFor(owner, [call(SOLANA_PROGRAMS.jupiterLend)]), owner)).toThrow(/Jupiter Lend/);
    expect(() => checkSolanaTransaction(txFor(owner, [call(SOLANA_PROGRAMS.kaminoLend)]), owner)).toThrow(/Kamino/);
  });

  it("refuses lookup tables for someone else, closing tables, and Jupiter Lend's inner Liquidity program at the top level", () => {
    const stranger = Keypair.generate();
    const [theirs] = AddressLookupTableProgram.createLookupTable({ authority: stranger.publicKey, payer: owner, recentSlot: 1 });
    expect(() => checkSolanaTransaction(txFor(owner, [theirs]), owner)).toThrow(/wallet's own/);
    const close = AddressLookupTableProgram.closeLookupTable({ lookupTable: stranger.publicKey, authority: owner, recipient: stranger.publicKey });
    expect(() => checkSolanaTransaction(txFor(owner, [close]), owner)).toThrow(/Lookup-table instruction 4/);
    expect(() => checkSolanaTransaction(txFor(owner, [call("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC")]), owner)).toThrow(/not on the signer's allow list/);
  });
});

const POOL_ARB = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x9999999999999999999999999999999999999999";
const pool = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
]);

const tx = (data: `0x${string}`, to: string = POOL_ARB) => ({ chainId: 42161, to: to as `0x${string}`, data });

describe("Aave rules", () => {
  it("lets the wallet approve the pool for USDC, supply for itself and withdraw to itself", () => {
    expect(checkEvmTransaction(tx(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POOL_ARB, 100_000_000n] }), USDC_ARB), OWNER).kind).toBe("approve");
    expect(checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "supply", args: [USDC_ARB, 100_000_000n, OWNER, 0] })), OWNER).kind).toBe("aave");
    expect(checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "withdraw", args: [USDC_ARB, maxUint256, OWNER] })), OWNER).kind).toBe("aave");
  });

  it("refuses supplying for someone else, withdrawing to someone else, borrowing, and other assets", () => {
    expect(() => checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "supply", args: [USDC_ARB, 1n, STRANGER, 0] })), OWNER)).toThrow(/credit the wallet itself/);
    expect(() => checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "withdraw", args: [USDC_ARB, 1n, STRANGER] })), OWNER)).toThrow(/pay the wallet itself/);
    expect(() => checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "borrow", args: [USDC_ARB, 1n, 2n, 0, OWNER] })), OWNER)).toThrow();
    expect(() => checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "supply", args: [USDC_BASE, 1n, OWNER, 0] })), OWNER)).toThrow(/only lends USDC/);
    expect(() => checkEvmTransaction(tx(encodeFunctionData({ abi: pool, functionName: "supply", args: [USDC_ARB, 1n, OWNER, 0] })))).toThrow(/sending wallet/);
  });

  it("only approves the pool on its own chain, for USDC, for a bounded amount", () => {
    const approve = (spender: string, amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, amount] });
    expect(() => checkEvmTransaction({ chainId: 8453, to: USDC_BASE, data: approve(POOL_ARB, 1n) }, OWNER)).toThrow(/not on the signer's allow list/);
    expect(() => checkEvmTransaction(tx(approve(POOL_ARB, 1n), STRANGER), OWNER)).toThrow(/USDC only/);
    expect(() => checkEvmTransaction(tx(approve(POOL_ARB, maxUint256), USDC_ARB), OWNER)).toThrow(/Unlimited/);
  });
});

describe("approval cap (H1)", () => {
  const approve = (amount: bigint) => ({ chainId: 42161, to: USDC_ARB as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POOL_ARB, amount] }) });
  const holds = (balance: bigint) => async () => balance;

  it("allows approving up to the wallet's balance, and revoking", async () => {
    await expect(approvalWithinBalance(approve(100_000_000n), OWNER, holds(100_000_000n))).resolves.toBeUndefined();
    await expect(approvalWithinBalance(approve(0n), OWNER, holds(0n))).resolves.toBeUndefined();
  });

  it("refuses an approval above the balance, even below the old 1e30 cap", async () => {
    await expect(approvalWithinBalance(approve(100_000_001n), OWNER, holds(100_000_000n))).rejects.toThrow(/more than the wallet's balance/);
    await expect(approvalWithinBalance(approve(10n ** 29n), OWNER, holds(5n))).rejects.toThrow(/more than the wallet's balance/);
  });

  it("does not read balances for non-approvals", async () => {
    let called = false;
    await approvalWithinBalance(tx(encodeFunctionData({ abi: pool, functionName: "supply", args: [USDC_ARB, 1n, OWNER, 0] })), OWNER, async () => ((called = true), 0n));
    expect(called).toBe(false);
  });
});
