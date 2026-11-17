import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, http, type Chain, type PrivateKeyAccount } from "viem";
import { arbitrum, arbitrumSepolia, base, baseSepolia, robinhood, robinhoodTestnet } from "viem/chains";
import { SignerRuleError } from "./rules.js";

/**
 * EVM transactions the master key may send besides the Hyperliquid deposit.
 * Every one goes to a contract on a fixed list, and an ERC-20 approval may only
 * name a listed spender for a bounded amount. Like Jupiter on Solana, the
 * listed contracts' own calldata is trusted; the list is what keeps an
 * arbitrary "send everything to X" transaction from being signed.
 *
 * ETH (value ≠ 0) only goes to Relay's own contracts, on Arbitrum or Base, as
 * the input of a swap (selling the wallet's native ETH), and only if the
 * wallet still holds the gas reserve afterwards, gas included at its worst
 * case (`nativeValueLeavesReserve`). Everything else carrying ETH is refused.
 */

/** Chains where Fren may sell native ETH: Arbitrum One, Base and their Sepolias. */
export const NATIVE_SELL_CHAINS = new Set([42161, 8453, 421614, 84532]);

/** ETH the wallet keeps for gas after selling ETH, unless the owner's config says otherwise: 0.0005 ETH. */
export const DEFAULT_EVM_GAS_RESERVE_WEI = 500_000_000_000_000n;

export const EVM_CHAINS: Record<number, { chain: Chain; rpc: string }> = {
  42161: { chain: arbitrum, rpc: "https://arb1.arbitrum.io/rpc" },
  8453: { chain: base, rpc: "https://mainnet.base.org" },
  4663: { chain: robinhood, rpc: "https://rpc.mainnet.chain.robinhood.com" },
  421614: { chain: arbitrumSepolia, rpc: "https://sepolia-rollup.arbitrum.io/rpc" },
  84532: { chain: baseSepolia, rpc: "https://sepolia.base.org" },
  46630: { chain: robinhoodTestnet, rpc: "https://rpc.testnet.chain.robinhood.com" },
};

/**
 * Relay's routers and approval proxies (v3 and v3.2, London and Cancun chain
 * groups; Relay moves to v3.2 on 2026-10-26 and says to allow both), plus the
 * Base depository from Relay's docs. Lower-case.
 */
export const RELAY_CONTRACTS = new Set([
  "0x9ef6d3c2f60d7b9008d74cab1fc0f899c957c819", // v3 router (London)
  "0x8754bc615047de01228a7527b712806a71a8dc9a", // v3 approval proxy (London)
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f", // v3 router (Cancun)
  "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be", // v3 approval proxy (Cancun)
  "0x6328ea02d28131e58b28e55c6258258a30d90e05", // v3.2 router (London)
  "0xe4dfbd5e6784db1058124e2c87554c0591f0fb7b", // v3.2 approval proxy (London)
  "0x0729e2a4716d9f7dd17858d5d504426d228697f7", // v3.2 router (Cancun)
  "0x5567954cd026cebfe486062cb75848e0f1c12e58", // v3.2 approval proxy (Cancun)
  "0x4cd00e387622c35bddb9b4c962c136462338bc31", // depository (Base)
]);

/**
 * Aave v3 pools Fren lends USDC through, by chain id, with the one asset each
 * may be used for. Lower-case. Calls to a pool must be supply on the owner's
 * behalf or withdraw to the owner (checked below).
 */
export const AAVE_POOLS: Record<number, { pool: string; usdc: string }> = {
  42161: { pool: "0x794a61358d6845594f94dc1db02a252b5b4814ad", usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  8453: { pool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
};

const AAVE_POOL = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_APPROVE = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const APPROVE_SELECTOR = "0x095ea7b3";

/**
 * Outer cap: approvals must be for a real amount, never "unlimited". The real
 * cap is the wallet's balance of that token, checked on-chain right before
 * sending (`approvalWithinBalance`).
 */
export const MAX_APPROVAL_RAW = 10n ** 30n;

/**
 * An approval may not exceed what the wallet holds of that token now, so a
 * leftover allowance can never reach funds that arrive later. Zero (revoking)
 * is always allowed. The engine approves exact amounts, so this never blocks it.
 */
export async function approvalWithinBalance(
  req: EvmTxRequest,
  owner: `0x${string}`,
  balanceOf: (token: `0x${string}`, owner: `0x${string}`) => Promise<bigint>,
): Promise<void> {
  if (req.data.slice(0, 10).toLowerCase() !== APPROVE_SELECTOR) return;
  const { args } = decodeFunctionData({ abi: ERC20_APPROVE, data: req.data });
  const amount = args[1];
  if (amount === 0n) return;
  const balance = await balanceOf(req.to, owner);
  if (amount > balance) throw new SignerRuleError(`Approval of ${amount} is more than the wallet's balance of ${balance} for that token.`);
}

export interface EvmTxRequest {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  /** Wei. Zero, except a Relay swap selling native ETH (see `checkEvmTransaction`). */
  value?: string;
  gas?: string;
}

export type EvmTxKind = "relay" | "approve" | "aave";

/**
 * `owner` is the wallet sending: Aave calls must name it as the beneficiary.
 * Without it, Aave calls are refused.
 */
export function checkEvmTransaction(req: EvmTxRequest, owner?: string): { kind: EvmTxKind; spender?: string; valueWei: bigint } {
  if (!EVM_CHAINS[req.chainId]) throw new SignerRuleError(`Chain ${req.chainId} is not one the signer sends on.`);
  const valueWei = weiOf(req.value);
  const to = req.to.toLowerCase();
  if (valueWei !== 0n) {
    // The one way ETH leaves the wallet: into Relay's own contracts as a swap input.
    if (!RELAY_CONTRACTS.has(to)) throw new SignerRuleError("EVM transactions from Fren never send ETH, except into a Relay swap.");
    if (!NATIVE_SELL_CHAINS.has(req.chainId)) throw new SignerRuleError(`Fren only sells ETH on Arbitrum and Base, not on chain ${req.chainId}.`);
    if (req.data.slice(0, 10).toLowerCase() === APPROVE_SELECTOR) throw new SignerRuleError("An approval never carries ETH.");
    return { kind: "relay", valueWei };
  }
  if (req.data.slice(0, 10).toLowerCase() === APPROVE_SELECTOR) {
    const { args } = decodeFunctionData({ abi: ERC20_APPROVE, data: req.data });
    const [spender, amount] = args;
    const aave = AAVE_POOLS[req.chainId];
    const toAave = aave !== undefined && spender.toLowerCase() === aave.pool;
    if (!RELAY_CONTRACTS.has(spender.toLowerCase()) && !toAave) throw new SignerRuleError(`Approval for ${spender}, which is not on the signer's allow list.`);
    if (toAave && to !== aave.usdc) throw new SignerRuleError("Aave approvals are for USDC only.");
    if (amount > MAX_APPROVAL_RAW) throw new SignerRuleError("Unlimited token approvals are not allowed.");
    return { kind: "approve", spender, valueWei };
  }
  const aave = AAVE_POOLS[req.chainId];
  if (aave && to === aave.pool) {
    if (!owner) throw new SignerRuleError("Aave calls need the sending wallet to check against.");
    const { functionName, args } = decodeFunctionData({ abi: AAVE_POOL, data: req.data });
    if (args[0].toLowerCase() !== aave.usdc) throw new SignerRuleError("Fren only lends USDC on Aave.");
    // supply(asset, amount, onBehalfOf, …) and withdraw(asset, amount, to): the third argument is who gets it.
    const beneficiary = args[2];
    if (beneficiary.toLowerCase() !== owner.toLowerCase()) {
      throw new SignerRuleError(`Aave ${functionName} must ${functionName === "supply" ? "credit" : "pay"} the wallet itself, not ${beneficiary}.`);
    }
    return { kind: "aave", valueWei };
  }
  if (!RELAY_CONTRACTS.has(to)) throw new SignerRuleError(`Contract ${req.to} is not on the signer's allow list.`);
  return { kind: "relay", valueWei };
}

/** Wei from the request; anything but a non-negative integer is refused. */
function weiOf(value: string | undefined): bigint {
  if (value === undefined) return 0n;
  let v: bigint;
  try {
    v = BigInt(value);
  } catch {
    throw new SignerRuleError(`"${value}" is not an amount of wei.`);
  }
  if (v < 0n) throw new SignerRuleError("A negative ETH amount is not allowed.");
  return v;
}

/**
 * Selling ETH must leave the gas reserve on the wallet even if the transaction
 * pays the most gas it can (gas limit × max fee per gas).
 */
export function nativeValueLeavesReserve(a: { balance: bigint; value: bigint; gas: bigint; maxFeePerGas: bigint; reserve: bigint }): void {
  if (a.value === 0n) return;
  const worstGas = a.gas * a.maxFeePerGas;
  const left = a.balance - a.value - worstGas;
  if (left < a.reserve) {
    throw new SignerRuleError(
      `Selling ${formatEth(a.value)} ETH would leave ${formatEth(left > 0n ? left : 0n)} ETH after gas; the wallet keeps at least ${formatEth(a.reserve)} ETH for gas.`,
    );
  }
}

const formatEth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

/** What sending touches on chain; injected in tests. */
export interface EvmChainIo {
  balance(address: `0x${string}`): Promise<bigint>;
  erc20Balance(token: `0x${string}`, owner: `0x${string}`): Promise<bigint>;
  estimateGas(tx: { account: `0x${string}`; to: `0x${string}`; data: `0x${string}`; value: bigint }): Promise<bigint>;
  maxFeePerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  send(tx: { to: `0x${string}`; data: `0x${string}`; value: bigint; gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }): Promise<`0x${string}`>;
}

export interface EvmSendOptions {
  /** RPC per EVM chain id, overriding the public defaults. */
  rpcOverrides?: Record<number, string>;
  /** ETH (wei) left on the wallet after selling ETH. Default `DEFAULT_EVM_GAS_RESERVE_WEI`. */
  gasReserveWei?: bigint;
  /** Replaces the chain access; tests only. */
  io?: (chainId: number) => EvmChainIo;
}

function viemIo(account: PrivateKeyAccount, chainId: number, rpcOverrides: Record<number, string>): EvmChainIo {
  const net = EVM_CHAINS[chainId]!;
  const transport = http(rpcOverrides[chainId] ?? net.rpc);
  const reader = createPublicClient({ chain: net.chain, transport });
  const client = createWalletClient({ account, chain: net.chain, transport });
  return {
    // Pending: a sale sent a moment ago already counts against the reserve.
    balance: (address) => reader.getBalance({ address, blockTag: "pending" }),
    erc20Balance: (token, who) => reader.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    estimateGas: (tx) => reader.estimateGas(tx),
    maxFeePerGas: async () => {
      const f = await reader.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    },
    send: (tx) => client.sendTransaction(tx),
  };
}

export async function sendEvmTransaction(
  account: PrivateKeyAccount,
  req: EvmTxRequest,
  options: EvmSendOptions = {},
): Promise<`0x${string}`> {
  const { valueWei } = checkEvmTransaction(req, account.address);
  const io = options.io ? options.io(req.chainId) : viemIo(account, req.chainId, options.rpcOverrides ?? {});
  await approvalWithinBalance(req, account.address, (token, who) => io.erc20Balance(token, who));
  if (valueWei === 0n) {
    return io.send({ to: req.to, data: req.data, value: 0n, ...(req.gas ? { gas: BigInt(req.gas) } : {}) });
  }
  // Selling ETH: fix the gas limit and fee cap first, so the reserve check
  // holds for the transaction exactly as it is sent.
  const gas = req.gas ? BigInt(req.gas) : await io.estimateGas({ account: account.address, to: req.to, data: req.data, value: valueWei });
  const fees = await io.maxFeePerGas();
  const balance = await io.balance(account.address);
  nativeValueLeavesReserve({ balance, value: valueWei, gas, maxFeePerGas: fees.maxFeePerGas, reserve: options.gasReserveWei ?? DEFAULT_EVM_GAS_RESERVE_WEI });
  return io.send({ to: req.to, data: req.data, value: valueWei, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
}
