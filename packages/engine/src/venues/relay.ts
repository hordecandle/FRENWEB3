import { toRaw, USDC_MINT } from "./jupiter.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createPublicClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, type Chain as ViemChain, type PublicClient } from "viem";
import { arbitrum, arbitrumSepolia, base, baseSepolia, robinhood, robinhoodTestnet } from "viem/chains";
import {
  chainName,
  price as fmtPrice,
  shortToken,
  usd as fmtUsd,
  type EvmChain,
  type PlanStep,
  type ResolvedStep,
  type SwapLeg,
} from "@fren/core";
import type { SignerApi } from "@fren/signer";
import { getJson, HttpError, postJson, type Fetch } from "../http.js";
import type { Store } from "../store.js";
import { NotTradableYet, VenueError, type ExecContext, type ExecResult, type PositionView, type SpotVenueAdapter } from "./types.js";

/**
 * Tokens on EVM chains (Base, Robinhood Chain, Arbitrum), bought and sold
 * through Relay. Relay quotes a route from USDC on Arbitrum or Base straight
 * into the token on its own chain, so one USDC balance funds every chain.
 */

interface ChainInfo {
  id: number;
  viem: ViemChain;
  rpc: string;
  /** Native USDC, when the chain has one we fund from. */
  usdc?: `0x${string}`;
  explorer: string;
}

const MAINNET: Record<EvmChain, ChainInfo> = {
  arbitrum: { id: 42161, viem: arbitrum, rpc: "https://arb1.arbitrum.io/rpc", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io/tx/" },
  base: { id: 8453, viem: base, rpc: "https://mainnet.base.org", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org/tx/" },
  robinhood: { id: 4663, viem: robinhood, rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com/tx/" },
};

const TESTNET: Record<EvmChain, ChainInfo> = {
  arbitrum: { id: 421614, viem: arbitrumSepolia, rpc: "https://sepolia-rollup.arbitrum.io/rpc", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", explorer: "https://sepolia.arbiscan.io/tx/" },
  base: { id: 84532, viem: baseSepolia, rpc: "https://sepolia.base.org", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", explorer: "https://sepolia.basescan.org/tx/" },
  robinhood: { id: 46630, viem: robinhoodTestnet, rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com/tx/" },
};

/** Chains whose USDC can pay for a buy, in order of preference after the token's own chain. */
const FUNDING_CHAINS: EvmChain[] = ["arbitrum", "base"];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Relay's chain id for Solana, for bridging USDC to the wallet's Solana address. */
export const RELAY_SOLANA_CHAIN_ID = 792703809;

/** Hyperliquid's perp account (HyperCore) as Relay names it, and USDC there. */
export const RELAY_HYPERLIQUID_CHAIN_ID = 1337;
export const RELAY_HYPERLIQUID_USDC = "0x00000000000000000000000000000000";
/** Relay's Solana depository program: a deposit there, tagged with a quote's request id, pays for that quote. */
export const RELAY_SOLANA_DEPOSITORY = "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** SOL a Relay deposit may cost: the fee, plus rent if Relay's vault account had to be made. */
export const RELAY_DEPOSIT_MAX_SOL_LAMPORTS = 5_000_000;

/** Native ETH as Relay names it. */
export const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as const;
/** What a plan may call native ETH: the ticker, Relay's zero address, or the common 0xEeee… placeholder. */
const NATIVE_ALIASES = new Set(["eth", "$eth", NATIVE_ETH, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);
export const isNativeEth = (token: string) => NATIVE_ALIASES.has(token.trim().toLowerCase());
/** Chains where Fren sells native ETH (the signer allows the same ones). */
const NATIVE_SELL_CHAINS: EvmChain[] = ["arbitrum", "base"];
/** Room left for the sale's own gas on top of the reserve: ~8× an Arbitrum swap at today's fees. */
export const NATIVE_SELL_GAS_ALLOWANCE_WEI = 100_000_000_000_000n;
const DEFAULT_GAS_RESERVE_WEI = 500_000_000_000_000n;
export const isEvmAddress = (s: string) => ADDRESS.test(s.trim());

export interface EvmToken {
  chain: EvmChain;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
}

interface RelayCurrency {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  metadata?: { verified?: boolean; isNative?: boolean };
}

interface RelayAmount {
  amount: string;
  amountFormatted?: string;
  amountUsd?: string;
  minimumAmount?: string;
  currency?: { chainId: number; address?: string; decimals: number };
}

export interface RelayQuote {
  requestId?: string;
  steps: {
    id: string;
    kind: "transaction" | "signature";
    requestId?: string;
    items: { status: "complete" | "incomplete"; data: Record<string, unknown>; check?: { endpoint: string; method: string } }[];
  }[];
  details?: {
    currencyIn?: RelayAmount;
    currencyOut?: RelayAmount;
    totalImpact?: { usd?: string; percent?: string };
  };
}

export interface RelayVenueOptions {
  fetchFn: Fetch;
  apiUrl: string;
  apiKey?: string;
  isTestnet: boolean;
  store: Store;
  signer: SignerApi | null;
  /** RPC overrides per chain name. */
  rpcUrls?: Partial<Record<EvmChain, string>>;
  /** Injected for tests; defaults to viem public clients. */
  erc20Balance?: (chain: EvmChain, token: `0x${string}`, owner: `0x${string}`) => Promise<bigint>;
  /** Injected for tests; defaults to eth_getBalance. */
  nativeBalance?: (chain: EvmChain, owner: `0x${string}`) => Promise<bigint>;
  /** ETH (wei) kept for gas when selling ETH; the signer enforces the same number. Default 0.0005 ETH. */
  gasReserveWei?: bigint;
  /** Injected for tests; defaults to waiting for the receipt on chain. */
  waitForTx?: (chain: EvmChain, hash: `0x${string}`) => Promise<void>;
  /** How long to wait for Relay to fill, in ms. */
  fillTimeoutMs?: number;
  /** Injected for tests; defaults to an eth_call through viem. */
  evmRead?: (chain: EvmChain, call: { address: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
  /** The wallet's USDC on Solana, so a buy can be paid from there when the EVM wallets are short. */
  solanaUsdc?: () => Promise<number>;
  /** Circle's bridge from the wallet's own Solana address to its own Arbitrum address. */
  solanaBridge?: { bridge(usd: number): Promise<string[]>; finishPending(): Promise<string[]> };
}

/** How a buy is paid: which chain and coin the Relay quote starts from. */
interface EvmPayment {
  origin: EvmChain;
  currency: `0x${string}`;
  amountRaw: bigint;
  /** ETH (wei) the transactions may send: the ETH paid, or nothing. */
  valueWei: bigint;
  /** What Fren did or chose to pay for it, for the owner. */
  lines: string[];
}

const roundUpCents = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

/** A paper holding key that can't collide with a Solana mint. */
const paperKey = (chain: EvmChain, address: string) => `evm:${chain}:${address.toLowerCase()}`;

export class RelayVenue implements SpotVenueAdapter {
  readonly venue = "relay" as const;
  private clients = new Map<EvmChain, PublicClient>();
  private tokenCache = new Map<string, EvmToken>();

  constructor(private readonly o: RelayVenueOptions) {}

  private chains() {
    return this.o.isTestnet ? TESTNET : MAINNET;
  }

  chain(name: EvmChain): ChainInfo {
    const c = this.chains()[name];
    return { ...c, rpc: this.o.rpcUrls?.[name] ?? c.rpc };
  }

  private headers(): Record<string, string> {
    return this.o.apiKey ? { "x-api-key": this.o.apiKey } : {};
  }

  private client(name: EvmChain): PublicClient {
    let c = this.clients.get(name);
    if (!c) {
      const info = this.chain(name);
      c = createPublicClient({ chain: info.viem, transport: http(info.rpc) }) as PublicClient;
      this.clients.set(name, c);
    }
    return c;
  }

  private async balanceOf(chain: EvmChain, token: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
    if (token.toLowerCase() === NATIVE_ETH) {
      if (this.o.nativeBalance) return this.o.nativeBalance(chain, owner);
      return this.client(chain).getBalance({ address: owner });
    }
    if (this.o.erc20Balance) return this.o.erc20Balance(chain, token, owner);
    return this.client(chain).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  }

  private async waitForTx(chain: EvmChain, hash: `0x${string}`): Promise<void> {
    if (this.o.waitForTx) return this.o.waitForTx(chain, hash);
    const r = await this.client(chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== "success") throw new VenueError(`Transaction reverted on ${chainName[chain]}: ${hash}`);
  }

  // -- plain EVM access, shared with Aave ----------------------------------

  ownerAddress(): Promise<`0x${string}`> {
    return this.owner();
  }

  tokenBalance(chain: EvmChain, token: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
    return this.balanceOf(chain, token, owner);
  }

  /** A read-only contract call; returns the raw return data. */
  async call(chain: EvmChain, address: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
    if (this.o.evmRead) return this.o.evmRead(chain, { address, data });
    const res = await this.client(chain).call({ to: address, data });
    if (!res.data) throw new VenueError(`Empty result from ${address} on ${chainName[chain]}.`);
    return res.data;
  }

  /** Sign (the signer checks it), send, and wait for one transaction. Returns an explorer link. */
  async sendTx(chain: EvmChain, to: `0x${string}`, data: `0x${string}`): Promise<string> {
    const { txHash } = await this.signer().evmSendTransaction({ chainId: this.chain(chain).id, to, data });
    await this.waitForTx(chain, txHash);
    return `${this.chain(chain).explorer}${txHash}`;
  }

  // -- tokens --------------------------------------------------------------

  async searchTokens(chain: EvmChain, query: string): Promise<EvmToken[]> {
    const q = query.trim();
    const body: Record<string, unknown> = { chainIds: [this.chain(chain).id], limit: 20 };
    if (isEvmAddress(q)) body.address = q;
    else body.term = q.replace(/^\$/, "");
    const list = await postJson<RelayCurrency[]>(this.o.fetchFn, `${this.o.apiUrl}/currencies/v2`, body, this.headers());
    return list
      .filter((c) => c.chainId === this.chain(chain).id && isEvmAddress(c.address))
      .map((c) => ({
        chain,
        address: c.address as `0x${string}`,
        symbol: c.symbol,
        name: c.name,
        decimals: c.decimals,
        verified: Boolean(c.metadata?.verified),
      }));
  }

  /**
   * Which EVM chain a 0x contract lives on, when the owner didn't say. One
   * match is the answer; several prefer the verified one, then the first
   * listed in the order given. None: null.
   */
  async findChain(address: string, chains: readonly EvmChain[]): Promise<EvmChain | null> {
    const found = (await Promise.all(chains.map((c) => this.searchTokens(c, address).catch(() => [] as EvmToken[]))))
      .flat()
      .filter((t) => t.address.toLowerCase() === address.trim().toLowerCase());
    return (found.find((t) => t.verified) ?? found[0])?.chain ?? null;
  }

  /** Same rule as Jupiter: an address resolves to that token; a ticker only to a verified one. */
  async token(chain: EvmChain, query: string): Promise<EvmToken> {
    const q = query.trim();
    // Native ETH is not a contract: no lookup, and never confused with WETH or an "ETH" lookalike.
    if (isNativeEth(q)) return { chain, address: NATIVE_ETH, symbol: "ETH", name: "Ether", decimals: 18, verified: true };
    const key = `${chain}:${q.toLowerCase()}`;
    const cached = this.tokenCache.get(key);
    if (cached) return cached;
    const results = await this.searchTokens(chain, q);
    let found: EvmToken | undefined;
    if (isEvmAddress(q)) {
      found = results.find((t) => t.address.toLowerCase() === q.toLowerCase());
      if (!found) throw new VenueError(`Relay doesn't know the token ${q} on ${chainName[chain]}. It may not be trading yet.`);
    } else {
      const sym = q.replace(/^\$/, "").toUpperCase();
      const matches = results.filter((t) => t.symbol.toUpperCase() === sym);
      found = matches.find((t) => t.verified);
      if (!found) {
        throw new VenueError(
          matches.length
            ? `${matches.length} unverified tokens on ${chainName[chain]} use the ticker ${sym}. Send me the contract address.`
            : `No ${chainName[chain]} token found for ${sym}. Send me the contract address.`,
        );
      }
    }
    this.tokenCache.set(key, found);
    return found;
  }

  /** A snipe target Relay can't look up yet. Decimals come from the chain when it trades. */
  private async tokenOrBare(chain: EvmChain, query: string, mode: "paper" | "live"): Promise<EvmToken> {
    try {
      return await this.token(chain, query);
    } catch (err) {
      const address = query.trim();
      if (!isEvmAddress(address)) throw err;
      let decimals = 18;
      if (mode === "live" && !this.o.erc20Balance) {
        decimals = await this.client(chain)
          .readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: "decimals" })
          .catch(() => 18);
      }
      return { chain, address: address as `0x${string}`, symbol: shortToken(address), name: "", decimals, verified: false };
    }
  }

  async price(t: EvmToken): Promise<number | null> {
    try {
      const res = await getJson<{ price: number }>(
        this.o.fetchFn,
        `${this.o.apiUrl}/currencies/token/price?address=${t.address}&chainId=${this.chain(t.chain).id}`,
        this.headers(),
      );
      return res.price > 0 ? res.price : null;
    } catch {
      return null;
    }
  }

  // -- quotes ----------------------------------------------------------------

  async quote(req: {
    user: string;
    from: { chain: EvmChain; currency: string };
    to: { chain: EvmChain; currency: string };
    amountRaw: bigint;
    slippageBps: number;
    topupGas?: boolean;
  }): Promise<RelayQuote> {
    return postJson<RelayQuote>(
      this.o.fetchFn,
      `${this.o.apiUrl}/quote/v2`,
      {
        user: req.user,
        recipient: req.user,
        refundTo: req.user,
        originChainId: this.chain(req.from.chain).id,
        destinationChainId: this.chain(req.to.chain).id,
        originCurrency: req.from.currency,
        destinationCurrency: req.to.currency,
        amount: req.amountRaw.toString(),
        tradeType: "EXACT_INPUT",
        slippageTolerance: String(req.slippageBps),
        ...(req.topupGas ? { topupGas: true } : {}),
      },
      this.headers(),
    );
  }

  /**
   * Bridge USDC from Arbitrum (or Base) to an address on another chain: how
   * Fren funds Derive (USDC on Ethereum) and Polymarket (pUSD on Polygon).
   */
  async bridgeUsdc(req: { toChainId: number; toCurrency: string; recipient: string; usd: number; where: string }): Promise<string> {
    const owner = await this.owner();
    const need = BigInt(Math.round(req.usd * 1e6));
    const origin = await this.fundingChain(owner, "arbitrum", need);
    const quote = await postJson<RelayQuote>(
      this.o.fetchFn,
      `${this.o.apiUrl}/quote/v2`,
      {
        user: owner,
        recipient: req.recipient,
        refundTo: owner,
        originChainId: this.chain(origin).id,
        destinationChainId: req.toChainId,
        originCurrency: this.chain(origin).usdc,
        destinationCurrency: req.toCurrency,
        amount: need.toString(),
        tradeType: "EXACT_INPUT",
        slippageTolerance: "50",
      },
      this.headers(),
    ).catch((err: unknown) => {
      throw new VenueError(`Relay can't route USDC to ${req.where} right now: ${(err as Error).message}`);
    });
    const hashes = await this.runSteps(quote, origin, owner, need);
    const got = Number(quote.details?.currencyOut?.amount ?? 0) / 1e6;
    const link = hashes.at(-1) ? ` ${this.chain(origin).explorer}${hashes.at(-1)}` : "";
    return `✅ Sent ${fmtUsd(req.usd)} USDC from ${chainName[origin]} to ${req.where}${got ? ` (about ${fmtUsd(got)} arrives after fees)` : ""}.${link}`;
  }

  /**
   * Move USDC from the wallet's Solana address straight into its own
   * Hyperliquid account: one Solana transaction into Relay's depository, paid
   * in SOL, so it needs no ETH on Arbitrum. `send` signs and sends the
   * instructions (the signer checks them). Lands on Hyperliquid's main perp dex.
   */
  async solanaToHyperliquid(usd: number, send: (ixs: TransactionInstruction[]) => Promise<string>): Promise<{ text: string; arrivesUsd: number }> {
    const { evm, solana } = await this.signer().addresses();
    const amountRaw = BigInt(Math.round(usd * 1e6));
    const quote = await postJson<RelayQuote>(
      this.o.fetchFn,
      `${this.o.apiUrl}/quote/v2`,
      {
        user: solana,
        recipient: evm,
        refundTo: solana,
        originChainId: RELAY_SOLANA_CHAIN_ID,
        destinationChainId: RELAY_HYPERLIQUID_CHAIN_ID,
        originCurrency: USDC_MINT,
        destinationCurrency: RELAY_HYPERLIQUID_USDC,
        amount: amountRaw.toString(),
        tradeType: "EXACT_INPUT",
        slippageTolerance: "100",
      },
      this.headers(),
    ).catch((err: unknown) => {
      throw new VenueError(`Relay can't move USDC from Solana to Hyperliquid right now: ${(err as Error).message}`);
    });
    const ixs = relaySolanaInstructions(quote, { solana, evm, amountRaw });
    const signature = await send(ixs);
    const requestId = quote.steps.find((st) => st.requestId)?.requestId ?? quote.requestId;
    if (requestId) await this.waitForFill(requestId);
    const out = quote.details?.currencyOut;
    const arrivesUsd = out?.amount ? Number(out.amount) / 10 ** (out.currency?.decimals ?? 6) : 0;
    return {
      text: `✅ Moved ${fmtUsd(usd)} USDC from your Solana wallet into Hyperliquid through Relay${arrivesUsd ? ` (about ${fmtUsd(arrivesUsd)} after Relay's fee)` : ""} · https://solscan.io/tx/${signature}`,
      arrivesUsd,
    };
  }

  /** True once Relay can route USDC into the token: the snipe trigger for EVM launches. */
  async isTradable(token: string, chain: string): Promise<boolean> {
    const c = chain as EvmChain;
    const from = FUNDING_CHAINS.find((f) => this.chain(f).usdc);
    if (!from || !isEvmAddress(token)) return false;
    try {
      const q = await this.quote({
        user: "0x000000000000000000000000000000000000dEaD",
        from: { chain: from, currency: this.chain(from).usdc! },
        to: { chain: c, currency: token.trim() },
        amountRaw: 1_000_000n,
        slippageBps: 5000,
      });
      return BigInt(q.details?.currencyOut?.amount ?? "0") > 0n;
    } catch {
      return false;
    }
  }

  // -- plan steps --------------------------------------------------------------

  async resolve(step: PlanStep, index: number): Promise<ResolvedStep> {
    const leg = step.leg;
    if (leg.kind !== "swap" || leg.venue !== "relay") throw new VenueError(`Relay cannot run a ${leg.kind} leg.`);
    if (leg.chain === "solana") throw new VenueError("Relay trades EVM tokens; use Jupiter for Solana.");
    const chain = leg.chain;
    const snipe = step.when.some((c) => c.type === "tradable");
    let t: EvmToken;
    try {
      t = await this.token(chain, leg.token);
    } catch (err) {
      // A snipe, or a buy seconds after launch: Relay's list may not have it yet, the address is enough.
      if (!isEvmAddress(leg.token) || (!snipe && leg.side !== "buy")) throw err;
      t = { chain, address: leg.token.trim() as `0x${string}`, symbol: shortToken(leg.token.trim()), name: "", decimals: 18, verified: false };
    }
    const usdc = this.chain(chain).usdc;
    if (usdc && t.address.toLowerCase() === usdc.toLowerCase()) throw new VenueError("That's USDC already; pick the token to buy or sell.");
    if (t.address === NATIVE_ETH && leg.side === "sell" && !NATIVE_SELL_CHAINS.includes(chain)) {
      throw new VenueError(`Fren sells ETH on Arbitrum and Base only; on ${chainName[chain]} the ETH pays gas.`);
    }
    const canonical = {
      ...step,
      leg: { ...leg, token: t.address },
      when: step.when.map((c) => (c.type === "tradable" && c.token.trim().toLowerCase() === leg.token.trim().toLowerCase() ? { ...c, token: t.address } : c)),
    } as PlanStep;
    const spend = leg.side === "buy" && leg.amount.type === "usd" ? leg.amount.usd : 0;
    const notes = leg.side === "buy" && leg.chain === "robinhood" ? ["Fren adds about $2 of ETH on Robinhood Chain to this buy so you can pay gas to sell later."] : [];
    return {
      index,
      step: canonical,
      symbol: t.symbol,
      spendUsd: spend,
      notionalUsd: spend,
      ...(leg.side === "sell" ? await this.saleValue(leg, t) : {}),
      verifiedToken: t.verified,
      ...(notes.length ? { notes } : {}),
    };
  }

  /** What a sale is worth in dollars, for the auto-approve level. Unknown leaves it out, and the sale asks. */
  private async saleValue(leg: SwapLeg, t: EvmToken): Promise<{ sellUsd?: number }> {
    if (leg.amount.type === "usd") return { sellUsd: leg.amount.usd };
    try {
      const px = await this.price(t);
      if (!px) return {};
      if (leg.amount.type === "tokens") return { sellUsd: leg.amount.tokens * px };
      let held: number;
      if (this.o.store.getLimits().mode === "paper") {
        held = this.o.store.paperHolding(paperKey(t.chain, t.address))?.amount ?? 0;
      } else {
        held = Number(await this.balanceOf(t.chain, t.address, await this.owner())) / 10 ** t.decimals;
      }
      return { sellUsd: held * leg.amount.fraction * px };
    } catch {
      return {};
    }
  }

  async execute(r: ResolvedStep, ctx: ExecContext): Promise<ExecResult> {
    const leg = r.step.leg;
    if (leg.kind !== "swap" || leg.chain === "solana") throw new VenueError(`Relay cannot run a ${leg.kind} leg.`);
    const t = await this.tokenOrBare(leg.chain, leg.token, ctx.mode);
    return ctx.mode === "paper" ? this.paperSwap(leg, t, ctx) : this.liveSwap(leg, t, ctx);
  }

  // -- paper -----------------------------------------------------------------

  private async paperPrice(t: EvmToken): Promise<number> {
    const px = await this.price(t);
    if (px) return px;
    // Too new for the price API: price a $10 quote.
    const from = FUNDING_CHAINS.find((f) => this.chain(f).usdc)!;
    const q = await this.quote({
      user: "0x000000000000000000000000000000000000dEaD",
      from: { chain: from, currency: this.chain(from).usdc! },
      to: { chain: t.chain, currency: t.address },
      amountRaw: 10_000_000n,
      slippageBps: 5000,
    }).catch(() => null);
    const out = q?.details?.currencyOut?.amount ? Number(q.details.currencyOut.amount) / 10 ** t.decimals : 0;
    if (out > 0) return 10 / out;
    throw new VenueError(`No price for ${t.symbol} on ${chainName[t.chain]} right now.`);
  }

  private async paperSwap(leg: SwapLeg, t: EvmToken, ctx: ExecContext): Promise<ExecResult> {
    const store = this.o.store;
    const px = await this.paperPrice(t).catch((err: Error) => {
      throw leg.side === "buy" ? new NotTradableYet(`${t.symbol} on ${chainName[t.chain]} has no pool to buy from yet.`) : err;
    });
    const key = paperKey(t.chain, t.address);
    const held = store.paperHolding(key) ?? { mint: key, symbol: t.symbol, amount: 0, costUsd: 0 };
    const where = chainName[t.chain];
    if (leg.side === "buy") {
      if (leg.amount.type === "tokens") throw new VenueError('Say how much USDC to spend on a buy: amount {type:"usd"}.');
      const usd = leg.amount.type === "usd" ? leg.amount.usd : store.paperUsdc() * leg.amount.fraction;
      if (usd > store.paperUsdc()) throw new VenueError(`Practice balance is ${fmtUsd(store.paperUsdc())}.`);
      const qty = usd / px;
      store.setPaperUsdc(store.paperUsdc() - usd);
      store.setPaperHolding({ ...held, amount: held.amount + qty, costUsd: held.costUsd + usd });
      store.insertFill({ planId: ctx.planId, idx: ctx.idx, venue: "relay", symbol: t.symbol, action: "buy", size: qty, price: px, usd, spendUsd: usd, mode: "paper" });
      return { text: `📝 Practice: Bought ${fmtQty(qty)} ${t.symbol} on ${where} for ${fmtUsd(usd)} at ${fmtPrice(px)}` };
    }
    if (leg.amount.type === "tokens" && leg.amount.tokens > held.amount + 1e-12) {
      throw new VenueError(`You hold ${fmtQty(held.amount)} paper ${t.symbol} on ${where}, not ${leg.amount.tokens}.`);
    }
    const qty =
      leg.amount.type === "fraction" ? held.amount * leg.amount.fraction : leg.amount.type === "tokens" ? leg.amount.tokens : Math.min(held.amount, leg.amount.usd / px);
    if (qty <= 0) throw new VenueError(`You hold no paper ${t.symbol} on ${where}.`);
    const usd = qty * px;
    store.setPaperUsdc(store.paperUsdc() + usd);
    store.setPaperHolding({ ...held, amount: held.amount - qty, costUsd: held.costUsd * (1 - qty / held.amount) });
    store.insertFill({ planId: ctx.planId, idx: ctx.idx, venue: "relay", symbol: t.symbol, action: "sell", size: qty, price: px, usd, spendUsd: 0, mode: "paper" });
    return { text: `📝 Practice: Sold ${fmtQty(qty)} ${t.symbol} on ${where} for ${fmtUsd(usd)} at ${fmtPrice(px)}` };
  }

  // -- live ------------------------------------------------------------------

  private signer(): SignerApi {
    if (!this.o.signer) throw new VenueError("Live trading needs wallets. Run `fren init` first.");
    return this.o.signer;
  }

  private async owner(): Promise<`0x${string}`> {
    return (await this.signer().addresses()).evm as `0x${string}`;
  }

  /** USDC on the token's own chain if it has enough, else Arbitrum, else Base. */
  private async fundingChain(owner: `0x${string}`, target: EvmChain, need: bigint): Promise<EvmChain> {
    const order = [target, ...FUNDING_CHAINS.filter((c) => c !== target)].filter((c) => this.chain(c).usdc);
    const balances: string[] = [];
    for (const c of order) {
      const bal = await this.balanceOf(c, this.chain(c).usdc!, owner).catch(() => 0n);
      if (bal >= need) return c;
      balances.push(`${fmtUsd(Number(bal) / 1e6)} on ${chainName[c]}`);
    }
    throw new VenueError(`Not enough USDC: this needs ${fmtUsd(Number(need) / 1e6)} on one chain and you have ${balances.join(", ")}.`);
  }

  /**
   * Pay for a buy from wherever the money is: USDC on the token's chain,
   * Arbitrum or Base; else the wallet's ETH on Arbitrum or Base (keeping the gas
   * reserve); else Circle's bridge brings the missing USDC over from Solana.
   * Every move stays between the owner's own addresses.
   */
  private async payFor(owner: `0x${string}`, target: EvmChain, buying: `0x${string}`, need: bigint): Promise<EvmPayment> {
    const usd = Number(need) / 1e6;
    const usdcChains = [target, ...FUNDING_CHAINS.filter((c) => c !== target)].filter((c) => this.chain(c).usdc);
    const usdc = new Map<EvmChain, bigint>();
    for (const c of usdcChains) {
      const bal = await this.balanceOf(c, this.chain(c).usdc!, owner).catch(() => 0n);
      usdc.set(c, bal);
      if (bal >= need) return { origin: c, currency: this.chain(c).usdc!, amountRaw: need, valueWei: 0n, lines: [] };
    }

    const keep = (this.o.gasReserveWei ?? DEFAULT_GAS_RESERVE_WEI) + NATIVE_SELL_GAS_ALLOWANCE_WEI;
    // Buying ETH itself can't be paid in ETH.
    const ethChains = buying === NATIVE_ETH ? [] : [target, ...NATIVE_SELL_CHAINS.filter((c) => c !== target)].filter((c) => NATIVE_SELL_CHAINS.includes(c));
    let ethUsd = 0;
    for (const c of ethChains) {
      const bal = await this.balanceOf(c, NATIVE_ETH, owner).catch(() => 0n);
      if (bal <= keep) continue;
      const px = await this.price({ chain: c, address: NATIVE_ETH, symbol: "ETH", name: "Ether", decimals: 18, verified: true });
      if (!px) continue;
      ethUsd += (Number(bal - keep) / 1e18) * px;
      const wei = BigInt(Math.ceil((usd / px) * 1e9)) * 1_000_000_000n;
      if (bal - keep >= wei) {
        return { origin: c, currency: NATIVE_ETH, amountRaw: wei, valueWei: wei, lines: [`↪ Paid with ${fmtEth(wei)} ETH on ${chainName[c]}, since your USDC was short.`] };
      }
    }

    const arb = usdc.get("arbitrum") ?? 0n;
    const gap = roundUpCents(Number(need - arb) / 1e6);
    const sol = this.o.solanaUsdc ? await this.o.solanaUsdc().catch(() => 0) : 0;
    if (this.o.solanaBridge && this.chain("arbitrum").usdc && sol >= gap) {
      const lines = [...(await this.o.solanaBridge.finishPending().catch(() => [] as string[]))];
      const now = await this.balanceOf("arbitrum", this.chain("arbitrum").usdc!, owner).catch(() => arb);
      if (now < need) lines.push(...(await this.o.solanaBridge.bridge(roundUpCents(Number(need - now) / 1e6))));
      const after = await this.balanceOf("arbitrum", this.chain("arbitrum").usdc!, owner).catch(() => 0n);
      if (after < need) {
        throw new VenueError(`${lines.join("\n")}\nThe USDC from Solana hasn't reached Arbitrum yet, so nothing was bought. Ask again in a minute.`);
      }
      return { origin: "arbitrum", currency: this.chain("arbitrum").usdc!, amountRaw: need, valueWei: 0n, lines };
    }

    const parts = [...usdc].map(([c, b]) => `${fmtUsd(Number(b) / 1e6)} USDC on ${chainName[c]}`);
    if (ethUsd > 0) parts.push(`about ${fmtUsd(ethUsd)} of spare ETH`);
    if (this.o.solanaUsdc) parts.push(`${fmtUsd(sol)} USDC on Solana`);
    throw new VenueError(`This buy needs ${fmtUsd(usd)}, and no wallet has enough: ${parts.join(", ")}.`);
  }

  private async liveSwap(leg: SwapLeg, t: EvmToken, ctx: ExecContext): Promise<ExecResult> {
    const owner = await this.owner();
    const where = chainName[t.chain];
    let quote: RelayQuote;
    let origin: EvmChain;
    let qty: number;
    let usd: number;
    /** Wei this trade may send: the ETH sold or paid, or nothing. */
    let nativeSale = 0n;
    let paid: string[] = [];

    if (leg.side === "buy") {
      if (leg.amount.type === "tokens") throw new VenueError('Say how much USDC to spend on a buy: amount {type:"usd"}.');
      let pay: EvmPayment;
      if (leg.amount.type === "usd") {
        pay = await this.payFor(owner, t.chain, t.address, BigInt(Math.floor(leg.amount.usd * 1e6)));
      } else {
        const need = ((await this.balanceOf("arbitrum", this.chain("arbitrum").usdc!, owner)) * BigInt(Math.floor(leg.amount.fraction * 1e6))) / 1_000_000n;
        const c = await this.fundingChain(owner, t.chain, need);
        pay = { origin: c, currency: this.chain(c).usdc!, amountRaw: need, valueWei: 0n, lines: [] };
      }
      origin = pay.origin;
      nativeSale = pay.valueWei;
      paid = pay.lines;
      quote = await this.quote({
        user: owner,
        from: { chain: origin, currency: pay.currency },
        to: { chain: t.chain, currency: t.address },
        amountRaw: pay.amountRaw,
        slippageBps: leg.maxSlippageBps,
        // No USDC on Robinhood Chain to swap for gas later, so bring some ETH along.
        topupGas: !this.chain(t.chain).usdc,
      }).catch((err: unknown) => {
        // No route into the token yet: it hasn't launched, or its pool isn't live. Nothing was sent.
        if (err instanceof HttpError && err.status === 400 && /NO_SWAP_ROUTES|No routes/i.test(err.body + err.message)) {
          throw new NotTradableYet(`${t.symbol} on ${where} has no pool Relay can reach yet.`);
        }
        throw err;
      });
      usd = leg.amount.type === "usd" ? leg.amount.usd : Number(pay.amountRaw) / 1e6;
      qty = Number(quote.details?.currencyOut?.amount ?? "0") / 10 ** t.decimals;
    } else {
      const native = t.address === NATIVE_ETH;
      const held = await this.balanceOf(t.chain, t.address, owner);
      // Selling ETH: the gas reserve and this sale's own gas stay on the wallet.
      const keep = native ? (this.o.gasReserveWei ?? DEFAULT_GAS_RESERVE_WEI) + NATIVE_SELL_GAS_ALLOWANCE_WEI : 0n;
      const raw = held - keep;
      if (raw <= 0n) {
        throw new VenueError(
          native && held > 0n
            ? `You have ${fmtEth(held)} ETH on ${where}, and Fren keeps ${fmtEth(keep)} for gas, so there's nothing to sell.`
            : `You hold no ${t.symbol} on ${where}.`,
        );
      }
      let amount: bigint;
      if (leg.amount.type === "fraction") {
        // "Sell all" of ETH means all but the reserve; a smaller share counts the whole balance but still keeps it.
        const share = ((native ? held : raw) * BigInt(Math.floor(leg.amount.fraction * 1e6))) / 1_000_000n;
        amount = share < raw ? share : raw;
      } else if (leg.amount.type === "tokens") {
        amount = toRaw(leg.amount.tokens, t.decimals);
        if (amount > raw) {
          throw new VenueError(
            native
              ? `You can sell up to ${fmtEth(raw)} ETH on ${where} (Fren keeps ${fmtEth(keep)} for gas), not ${leg.amount.tokens}.`
              : `You hold ${fmtQty(Number(raw) / 10 ** t.decimals)} ${t.symbol} on ${where}, not ${leg.amount.tokens}.`,
          );
        }
      } else {
        const px = await this.price(t);
        if (!px) throw new VenueError(`No price for ${t.symbol} right now.`);
        const want = BigInt(Math.floor((leg.amount.usd / px) * 10 ** t.decimals));
        amount = want < raw ? want : raw;
      }
      if (amount <= 0n) throw new VenueError(`That's too little ${t.symbol} to sell.`);
      if (native) nativeSale = amount;
      origin = t.chain;
      const home: EvmChain = this.chain(t.chain).usdc ? t.chain : "arbitrum";
      quote = await this.quote({
        user: owner,
        from: { chain: t.chain, currency: t.address },
        to: { chain: home, currency: this.chain(home).usdc! },
        amountRaw: amount,
        slippageBps: leg.maxSlippageBps,
      });
      qty = Number(amount) / 10 ** t.decimals;
      usd = Number(quote.details?.currencyOut?.amount ?? "0") / 1e6;
    }

    const spendRaw = leg.side === "buy" ? BigInt(Math.round(usd * 1e6)) : BigInt(Math.round(qty * 10 ** t.decimals));
    const hashes = await this.runSteps(quote, origin, owner, spendRaw, nativeSale);
    const lastHash = hashes.at(-1);
    if (t.address !== NATIVE_ETH) this.rememberToken(t);
    this.o.store.insertFill({
      planId: ctx.planId,
      idx: ctx.idx,
      venue: "relay",
      symbol: t.symbol,
      action: leg.side,
      size: qty,
      price: qty > 0 ? usd / qty : 0,
      usd,
      spendUsd: leg.side === "buy" ? usd : 0,
      mode: "live",
      ...(lastHash ? { ref: lastHash } : {}),
    });
    const verb = leg.side === "buy" ? "Bought" : "Sold";
    const link = lastHash ? ` · ${this.chain(origin).explorer}${lastHash}` : "";
    const px = qty > 0 ? ` at ${fmtPrice(usd / qty)}` : "";
    return { text: [...paid, `✅ ${verb} ${fmtQty(qty)} ${t.symbol} on ${where} for ${fmtUsd(usd)}${px}${link}`].join("\n") };
  }

  /**
   * Execute a Relay quote: send each transaction step through the signer (which
   * only signs for Relay's own contracts), wait for it, then wait for Relay to
   * report the fill. Signature steps are refused: Fren never signs messages for Relay.
   */
  private async runSteps(quote: RelayQuote, origin: EvmChain, owner: `0x${string}`, spendRaw: bigint, maxValueWei = 0n): Promise<`0x${string}`[]> {
    const hashes: `0x${string}`[] = [];
    let valueSent = 0n;
    let requestId = quote.requestId;
    for (const step of quote.steps) {
      if (step.kind !== "transaction") throw new VenueError(`Relay asked for a "${step.id}" signature, which Fren doesn't sign.`);
      requestId = step.requestId ?? requestId;
      for (const item of step.items) {
        if (item.status === "complete") continue;
        const d = item.data as { to?: string; data?: string; value?: string; chainId?: number; gas?: string; from?: string };
        if (!d.to || !d.data || !d.chainId) throw new VenueError("Relay returned a transaction without a target.");
        if (d.from && d.from.toLowerCase() !== owner.toLowerCase()) throw new VenueError("Relay returned a transaction for a different wallet.");
        if (d.chainId !== this.chain(origin).id) throw new VenueError("Relay returned a transaction for an unexpected chain.");
        // ETH only leaves when this trade sells or pays with ETH, and never more than that amount (summed over every step).
        const value = weiValue(d.value);
        valueSent += value;
        if (valueSent > maxValueWei) {
          throw new VenueError(
            maxValueWei === 0n
              ? "Relay asked to send ETH with a trade that doesn't use ETH. Nothing was sent."
              : `Relay asked to send ${fmtEth(valueSent)} ETH for a trade of ${fmtEth(maxValueWei)} ETH. Nothing more was sent.`,
          );
        }
        const { txHash } = await this.signer().evmSendTransaction({
          chainId: d.chainId,
          to: d.to as `0x${string}`,
          data: exactApproval(d.data as `0x${string}`, spendRaw),
          ...(value !== 0n ? { value: value.toString() } : {}),
          ...(d.gas !== undefined ? { gas: String(d.gas) } : {}),
        });
        hashes.push(txHash);
        await this.waitForTx(origin, txHash);
      }
    }
    if (requestId) await this.waitForFill(requestId);
    return hashes;
  }

  private async waitForFill(requestId: string): Promise<void> {
    const deadline = Date.now() + (this.o.fillTimeoutMs ?? 120_000);
    for (;;) {
      const s = await getJson<{ status: string }>(this.o.fetchFn, `${this.o.apiUrl}/intents/status/v3?requestId=${requestId}`, this.headers()).catch(
        (err: unknown) => (err instanceof HttpError && err.status === 404 ? { status: "waiting" } : { status: "unknown" }),
      );
      if (s.status === "success") return;
      if (s.status === "refund") throw new VenueError("Relay couldn't fill it and refunded the money to your wallet.");
      if (s.status === "failure") throw new VenueError(`Relay reported the swap failed (request ${requestId}).`);
      if (Date.now() > deadline) throw new VenueError(`Relay hasn't confirmed the fill yet (request ${requestId}). Check /positions in a minute.`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  /** Live EVM holdings are found by remembering what Fren bought; there's no cheap "all tokens" call. */
  private rememberToken(t: EvmToken) {
    const list = this.knownTokens();
    if (!list.some((k) => k.chain === t.chain && k.address.toLowerCase() === t.address.toLowerCase())) {
      list.push(t);
      this.o.store.setKv("relay_tokens", JSON.stringify(list));
    }
  }

  private knownTokens(): EvmToken[] {
    const raw = this.o.store.getKv("relay_tokens");
    return raw ? (JSON.parse(raw) as EvmToken[]) : [];
  }

  async positions(mode: "paper" | "live"): Promise<PositionView[]> {
    if (mode === "paper") {
      const views: PositionView[] = [];
      for (const h of this.o.store.paperHoldings()) {
        if (!h.mint.startsWith("evm:") || h.amount <= 0) continue;
        const [, chain, address] = h.mint.split(":") as [string, EvmChain, `0x${string}`];
        const mark = await this.price({ chain, address, symbol: h.symbol, name: "", decimals: 18, verified: false });
        const value = mark === null ? h.costUsd : h.amount * mark;
        views.push({ venue: "relay", symbol: `${h.symbol} (${chainName[chain]})`, kind: "spot", side: "hold", size: h.amount, entryPx: h.costUsd / h.amount, markPx: mark, valueUsd: value, pnlUsd: mark === null ? null : value - h.costUsd });
      }
      return views;
    }
    if (!this.o.signer) return [];
    const owner = await this.owner();
    const views: PositionView[] = [];
    for (const t of this.knownTokens()) {
      const raw = await this.balanceOf(t.chain, t.address, owner).catch(() => 0n);
      if (raw <= 0n) continue;
      const size = Number(raw) / 10 ** t.decimals;
      const mark = await this.price(t);
      views.push({ venue: "relay", symbol: `${t.symbol} (${chainName[t.chain]})`, kind: "spot", side: "hold", size, entryPx: null, markPx: mark, valueUsd: size * (mark ?? 0), pnlUsd: null });
    }
    return views;
  }

  /** USDC the EVM wallet holds per funding chain. */
  async usdcBalances(): Promise<Partial<Record<EvmChain, number>>> {
    if (!this.o.signer) return {};
    const owner = await this.owner();
    const out: Partial<Record<EvmChain, number>> = {};
    for (const c of FUNDING_CHAINS) {
      const bal = await this.balanceOf(c, this.chain(c).usdc!, owner).catch(() => null);
      if (bal !== null) out[c] = Number(bal) / 1e6;
    }
    return out;
  }

  /** ETH for gas on each funding chain, so the wallet shows what was sent even before it's USDC. */
  async ethBalances(): Promise<Partial<Record<EvmChain, number>>> {
    if (!this.o.signer) return {};
    const owner = await this.owner();
    const out: Partial<Record<EvmChain, number>> = {};
    for (const c of FUNDING_CHAINS) {
      const bal = await this.balanceOf(c, NATIVE_ETH, owner).catch(() => null);
      if (bal !== null) out[c] = Number(bal) / 1e18;
    }
    return out;
  }

  /** Spot tokens are left alone by the kill switch. */
  async flatten(): Promise<string[]> {
    return [];
  }
}

/** Shrink an "unlimited" approval to the amount this trade spends. Anything else passes through. */
export function exactApproval(data: `0x${string}`, spendRaw: bigint): `0x${string}` {
  if (data.slice(0, 10).toLowerCase() !== "0x095ea7b3") return data;
  const { args } = decodeFunctionData({ abi: erc20Abi, data });
  if (args[0] === undefined || (args[1] as bigint) <= spendRaw) return data;
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args[0] as `0x${string}`, spendRaw] });
}

function weiValue(v: unknown): bigint {
  if (v === undefined || v === null || v === "") return 0n;
  try {
    const n = BigInt(v as string);
    if (n >= 0n) return n;
  } catch {
    /* fall through */
  }
  throw new VenueError("Relay returned a transaction with a bad ETH amount.");
}

const fmtEth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

function fmtQty(q: number): string {
  if (q >= 1000) return q.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (q >= 1) return q.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return q.toPrecision(4);
}

/**
 * The Solana instructions of a Relay quote from the wallet's USDC to its own
 * Hyperliquid account. Refuses anything but deposits into Relay's depository
 * from this wallet, of this amount, for a quote naming the wallet as recipient.
 * Compute-budget instructions are dropped: the sender sets its own.
 */
export function relaySolanaInstructions(quote: RelayQuote, w: { solana: string; evm: string; amountRaw: bigint }): TransactionInstruction[] {
  const d = quote.details as (RelayQuote["details"] & { sender?: string; recipient?: string }) | undefined;
  if (d?.recipient && d.recipient.toLowerCase() !== w.evm.toLowerCase()) throw new VenueError("Relay quoted a transfer to a different Hyperliquid account. Nothing was sent.");
  if (d?.sender && d.sender !== w.solana) throw new VenueError("Relay quoted a transfer from a different Solana wallet. Nothing was sent.");
  if (d?.currencyOut?.currency && d.currencyOut.currency.chainId !== RELAY_HYPERLIQUID_CHAIN_ID) throw new VenueError("Relay quoted a transfer to somewhere other than Hyperliquid. Nothing was sent.");
  const ixs: TransactionInstruction[] = [];
  for (const step of quote.steps) {
    if (step.kind !== "transaction") throw new VenueError(`Relay asked for a "${step.id}" signature, which Fren doesn't sign.`);
    for (const item of step.items) {
      if (item.status === "complete") continue;
      const list = (item.data as { instructions?: { programId: string; data: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[] }[] }).instructions;
      if (!Array.isArray(list) || !list.length) throw new VenueError("Relay returned a Solana step without instructions.");
      for (const ix of list) {
        if (ix.programId === COMPUTE_BUDGET) continue;
        if (ix.programId !== RELAY_SOLANA_DEPOSITORY) throw new VenueError(`Relay asked to call Solana program ${ix.programId}, which Fren doesn't. Nothing was sent.`);
        const data = Buffer.from(ix.data, "hex");
        if (data.length < 16 || data.readBigUInt64LE(8) !== w.amountRaw) throw new VenueError("Relay's deposit isn't for the amount asked. Nothing was sent.");
        ixs.push(
          new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
            data,
          }),
        );
      }
    }
  }
  if (ixs.length !== 1) throw new VenueError("Relay's route from Solana wasn't a single deposit. Nothing was sent.");
  return ixs;
}
