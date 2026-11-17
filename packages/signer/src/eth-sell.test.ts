import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import {
  AAVE_POOLS,
  checkEvmTransaction,
  DEFAULT_EVM_GAS_RESERVE_WEI,
  nativeValueLeavesReserve,
  sendEvmTransaction,
  type EvmChainIo,
} from "./evm.js";

/** Selling native ETH through Relay: the only way ETH may leave the wallet. */

const ROUTER = "0x0729e2a4716d9f7dd17858d5d504426d228697f7"; // Relay v3.2 router (Cancun), the one a live ETH→USDC quote on Arbitrum returned
const PROXY = "0x5567954cd026cebfe486062cb75848e0f1c12e58";
const STRANGER = "0x9999999999999999999999999999999999999999";
const SWAP_DATA = "0xcd6e13f7" as const;
const ETH = (n: number) => BigInt(Math.round(n * 1e9)) * 1_000_000_000n;
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("which transactions may carry ETH", () => {
  it("allows ETH into a Relay contract on Arbitrum and Base", () => {
    expect(checkEvmTransaction({ chainId: 42161, to: ROUTER, data: SWAP_DATA, value: ETH(0.016).toString() })).toMatchObject({ kind: "relay", valueWei: ETH(0.016) });
    expect(checkEvmTransaction({ chainId: 8453, to: ROUTER, data: SWAP_DATA, value: "1" }).valueWei).toBe(1n);
  });

  it("refuses ETH to any contract off the Relay list", () => {
    expect(() => checkEvmTransaction({ chainId: 42161, to: STRANGER, data: SWAP_DATA, value: "1" })).toThrow(/never send ETH, except into a Relay swap/);
    // A plain transfer to an outsider (empty calldata) is the classic drain.
    expect(() => checkEvmTransaction({ chainId: 42161, to: STRANGER, data: "0x", value: ETH(0.018).toString() })).toThrow(/never send ETH/);
  });

  it("refuses ETH to an Aave pool, even with valid calldata", () => {
    const pool = AAVE_POOLS[42161]!;
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "a", type: "address" }, { name: "b", type: "uint256" }, { name: "c", type: "address" }], outputs: [] }],
      functionName: "withdraw",
      args: [pool.usdc as `0x${string}`, 1n, account.address],
    });
    expect(() => checkEvmTransaction({ chainId: 42161, to: pool.pool as `0x${string}`, data, value: "1" }, account.address)).toThrow(/never send ETH/);
  });

  it("refuses ETH with an approval, and on chains where ETH is only gas", () => {
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [PROXY, 1n] });
    expect(() => checkEvmTransaction({ chainId: 42161, to: ROUTER, data: approve, value: "1" })).toThrow(/approval never carries ETH/);
    expect(() => checkEvmTransaction({ chainId: 4663, to: ROUTER, data: SWAP_DATA, value: "1" })).toThrow(/only sells ETH on Arbitrum and Base/);
  });

  it("refuses a value that isn't a plain amount of wei", () => {
    expect(() => checkEvmTransaction({ chainId: 42161, to: ROUTER, data: SWAP_DATA, value: "-1" })).toThrow(/negative/);
    expect(() => checkEvmTransaction({ chainId: 42161, to: ROUTER, data: SWAP_DATA, value: "1e18" })).toThrow(/not an amount of wei/);
  });

  it("still treats zero value as before", () => {
    expect(checkEvmTransaction({ chainId: 4663, to: ROUTER, data: SWAP_DATA, value: "0" })).toMatchObject({ kind: "relay", valueWei: 0n });
  });
});

describe("the gas reserve", () => {
  const base = { gas: 600_000n, maxFeePerGas: 20_000_000n, reserve: ETH(0.0005) }; // 0.000012 ETH of gas at worst

  it("passes a sale that leaves the reserve after worst-case gas", () => {
    expect(() => nativeValueLeavesReserve({ ...base, balance: ETH(0.018158), value: ETH(0.016) })).not.toThrow();
    // Exactly the reserve left is fine.
    expect(() => nativeValueLeavesReserve({ ...base, balance: ETH(0.0165) + 12_000_000_000_000n, value: ETH(0.016) })).not.toThrow();
  });

  it("refuses a sale that eats into the reserve, counting gas", () => {
    expect(() => nativeValueLeavesReserve({ ...base, balance: ETH(0.018158), value: ETH(0.018) })).toThrow(/keeps at least 0.0005 ETH for gas/);
    // One wei over once gas is counted.
    expect(() => nativeValueLeavesReserve({ ...base, balance: ETH(0.0165) + 12_000_000_000_000n - 1n, value: ETH(0.016) })).toThrow(/for gas/);
    // Everything, as a drain would ask.
    expect(() => nativeValueLeavesReserve({ ...base, balance: ETH(0.018158), value: ETH(0.018158) })).toThrow(/for gas/);
  });

  it("defaults to 0.0005 ETH", () => {
    expect(DEFAULT_EVM_GAS_RESERVE_WEI).toBe(ETH(0.0005));
  });
});

describe("sending an ETH sale", () => {
  function fakeIo(balance: bigint) {
    const sent: Parameters<EvmChainIo["send"]>[0][] = [];
    const io: EvmChainIo = {
      balance: async () => balance,
      erc20Balance: async () => 0n,
      estimateGas: async () => 600_000n,
      maxFeePerGas: async () => ({ maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 1_000_000n }),
      send: async (tx) => {
        sent.push(tx);
        return `0x${"ab".repeat(32)}`;
      },
    };
    return { io: () => io, sent };
  }

  it("sends the value with a fixed gas limit and fee cap", async () => {
    const f = fakeIo(ETH(0.018158));
    await sendEvmTransaction(account, { chainId: 42161, to: ROUTER, data: SWAP_DATA, value: ETH(0.016).toString(), gas: "592417" }, { io: f.io });
    expect(f.sent).toEqual([{ to: ROUTER, data: SWAP_DATA, value: ETH(0.016), gas: 592_417n, maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 1_000_000n }]);
  });

  it("sends nothing when the sale would dip below the reserve", async () => {
    const f = fakeIo(ETH(0.018158));
    await expect(sendEvmTransaction(account, { chainId: 42161, to: ROUTER, data: SWAP_DATA, value: ETH(0.0178).toString() }, { io: f.io })).rejects.toThrow(/for gas/);
    expect(f.sent).toHaveLength(0);
  });

  it("uses the owner's reserve from config", async () => {
    const f = fakeIo(ETH(0.018158));
    // 0.016 leaves ~0.00215: fine at the default, refused at a 0.003 reserve.
    await expect(
      sendEvmTransaction(account, { chainId: 42161, to: ROUTER, data: SWAP_DATA, value: ETH(0.016).toString() }, { io: f.io, gasReserveWei: ETH(0.003) }),
    ).rejects.toThrow(/keeps at least 0.003 ETH/);
    expect(f.sent).toHaveLength(0);
  });

  it("an attacker-chosen gas limit can't sneak past the reserve", async () => {
    const f = fakeIo(ETH(0.018158));
    // 100M gas × 0.02 gwei = 0.002 ETH of gas: with the sale it no longer fits.
    await expect(
      sendEvmTransaction(account, { chainId: 42161, to: ROUTER, data: SWAP_DATA, value: ETH(0.016).toString(), gas: "100000000" }, { io: f.io }),
    ).rejects.toThrow(/for gas/);
    expect(f.sent).toHaveLength(0);
  });

  it("refuses ETH to an outsider before touching the chain", async () => {
    const f = fakeIo(ETH(1));
    await expect(sendEvmTransaction(account, { chainId: 42161, to: STRANGER, data: "0x", value: "1" }, { io: f.io })).rejects.toThrow(/never send ETH/);
    expect(f.sent).toHaveLength(0);
  });

  it("zero-value transactions go out as before, without the reserve check", async () => {
    const f = fakeIo(0n);
    await sendEvmTransaction(account, { chainId: 42161, to: ROUTER, data: SWAP_DATA }, { io: f.io });
    expect(f.sent).toEqual([{ to: ROUTER, data: SWAP_DATA, value: 0n }]);
  });
});
