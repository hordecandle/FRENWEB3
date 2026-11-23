import { canonicalize } from "@nktkas/hyperliquid/signing";
import { OrderRequest, UpdateLeverageRequest } from "@nktkas/hyperliquid/api/exchange";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { price as fmtPrice, signedUsd, usd as fmtUsd, type PerpCloseLeg, type PerpOpenLeg, type PlanStep, type ResolvedStep } from "@fren/core";
import type { SignerApi } from "@fren/signer";
import { postJson, type Fetch } from "../http.js";
import type { Store } from "../store.js";
import { HyperliquidMarkets, type HyperliquidMarketsOptions, type PerpMarket } from "./hyperliquid-markets.js";
import { VenueError, type ExecContext, type ExecResult, type PositionView, type VenueAdapter } from "./types.js";
import { rowFromText, type ChartRequest, type Link, type Row, type StepReceipt } from "../receipt.js";
import { hyperliquidLinks } from "../links.js";
import type { ChartLevel } from "../chart.js";

type OrderWire = {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: { limit: { tif: "Ioc" | "Gtc" | "Alo" } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: "tp" | "sl" } };
};

export interface PerpOrderPlan {
  isBuy: boolean;
  size: string;
  notionalUsd: number;
  orders: OrderWire[];
  grouping: "na" | "normalTpsl";
  stopPx: number | null;
  takeProfitPx: number | null;
}

/**
 * Turn a perp_open leg into Hyperliquid order wires. Market orders are IOC
 * limits at mid ± slippage, which is how Hyperliquid's own UI does it.
 * Stops and targets are reduce-only trigger orders attached to the entry.
 */
export function buildPerpOpenOrders(m: PerpMarket, leg: PerpOpenLeg, mid: number): PerpOrderPlan {
  const isBuy = leg.side === "long";
  const margin = leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
  const notional = margin * leg.leverage;
  const size = formatSize(notional / mid, m.szDecimals);
  if (Number(size) <= 0) throw new VenueError(`${fmtUsd(notional)} is below the smallest ${m.name} order.`);
  const slip = leg.maxSlippagePct / 100;
  const limitPx = formatPrice(mid * (isBuy ? 1 + slip : 1 - slip), m.szDecimals, "perp");
  const orders: OrderWire[] = [{ a: m.assetId, b: isBuy, p: limitPx, s: size, r: false, t: { limit: { tif: "Ioc" } } }];

  const dir = isBuy ? 1 : -1;
  const stopPx =
    leg.stopPrice ?? (leg.stopLossPct !== undefined ? mid * (1 - (dir * leg.stopLossPct) / 100 / leg.leverage) : null);
  const takeProfitPx =
    leg.takeProfitPrice ?? (leg.takeProfitPct !== undefined ? mid * (1 + (dir * leg.takeProfitPct) / 100 / leg.leverage) : null);

  if (stopPx !== null) {
    if ((isBuy && stopPx >= mid) || (!isBuy && stopPx <= mid)) throw new VenueError(`Stop ${fmtPrice(stopPx)} is on the wrong side of the price.`);
    orders.push(trigger(m, !isBuy, size, stopPx, "sl"));
  }
  if (takeProfitPx !== null) {
    if ((isBuy && takeProfitPx <= mid) || (!isBuy && takeProfitPx >= mid)) {
      throw new VenueError(`Take profit ${fmtPrice(takeProfitPx)} is on the wrong side of the price.`);
    }
    orders.push(trigger(m, !isBuy, size, takeProfitPx, "tp"));
  }
  return { isBuy, size, notionalUsd: Number(size) * mid, orders, grouping: orders.length > 1 ? "normalTpsl" : "na", stopPx, takeProfitPx };
}

/** Hyperliquid refuses any order worth less than this ("Order must have minimum value of $10"). */
export const HL_MIN_ORDER_USD = 10;
/** Room for the price to move between the plan and the fill, so a plan that passed here isn't refused there. */
const HL_MIN_CUSHION = 1.02;

/** The smallest order of a plan in dollars, as Hyperliquid values it: the entry at the price it may fill at, stops and targets at their trigger. */
function smallestOrderUsd(plan: PerpOrderPlan, mid: number): number {
  const size = Number(plan.size);
  const values = plan.orders.map((o) => ("trigger" in o.t ? Number(o.t.trigger.triggerPx) : Math.min(mid, Number(o.p))) * size);
  return Math.min(...values);
}

/**
 * Hyperliquid's $10 minimum, checked before the owner is asked and before any money moves.
 * The order size is rounded down to the market's step (BTC: 0.00001), so $5 at 2x can land
 * under $10. Returns null when it passes, otherwise the plain reason with the margin, or the
 * leverage, at which it would go through.
 */
export function perpMinimumProblem(m: PerpMarket, leg: PerpOpenLeg, mid: number, maxLeverage = m.maxLeverage): string | null {
  const floor = HL_MIN_ORDER_USD * HL_MIN_CUSHION;
  const passes = (l: PerpOpenLeg) => {
    try {
      return smallestOrderUsd(buildPerpOpenOrders(m, l, mid), mid) >= floor;
    } catch {
      return false;
    }
  };
  if (passes(leg)) return null;
  const margin = leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
  const withMargin = (usd: number): PerpOpenLeg => ({ ...leg, sizing: { type: "margin", usd } });
  let needMargin: number | null = null;
  for (let usd = Math.ceil(margin * 2) / 2; usd <= margin + 200; usd += 0.5) {
    if (passes(withMargin(usd))) {
      needMargin = usd;
      break;
    }
  }
  let needLeverage: number | null = null;
  for (let lev = Math.floor(leg.leverage) + 1; lev <= Math.min(maxLeverage, m.maxLeverage); lev++) {
    if (passes({ ...withMargin(margin), leverage: lev })) {
      needLeverage = lev;
      break;
    }
  }
  const asIs = (() => {
    try {
      return fmtUsd(smallestOrderUsd(buildPerpOpenOrders(m, leg, mid), mid));
    } catch {
      return null;
    }
  })();
  const fixes = [
    ...(needMargin !== null ? [`put in ${fmtUsd(needMargin)} at ${leg.leverage}x`] : []),
    ...(needLeverage !== null ? [`keep ${fmtUsd(margin)} and use ${needLeverage}x`] : []),
  ];
  return `Hyperliquid's minimum order is ${fmtUsd(HL_MIN_ORDER_USD)}${asIs ? `, and this one comes to about ${asIs}` : ""}${leg.stopPrice !== undefined || leg.stopLossPct !== undefined ? " (its stop counts too)" : ""}. Nothing was moved or opened.${fixes.length ? ` It goes through if you ${fixes.join(", or ")}.` : ""}`;
}

function trigger(m: PerpMarket, isBuy: boolean, size: string, px: number, tpsl: "tp" | "sl"): OrderWire {
  // Market trigger: the limit is only a slippage bound, so give it 10% room.
  const limit = formatPrice(px * (isBuy ? 1.1 : 0.9), m.szDecimals, "perp");
  return { a: m.assetId, b: isBuy, p: limit, s: size, r: true, t: { trigger: { isMarket: true, triggerPx: formatPrice(px, m.szDecimals, "perp"), tpsl } } };
}

interface OrderResponse {
  status: "ok" | "err";
  response:
    | string
    | { type: "order"; data: { statuses: ({ filled: { totalSz: string; avgPx: string; oid: number } } | { resting: { oid: number } } | { error: string } | string)[] } }
    | { type: string };
}

interface ClearinghouseState {
  marginSummary: { accountValue: string };
  withdrawable: string;
  assetPositions: {
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      liquidationPx: string | null;
      marginUsed: string;
    };
  }[];
}

export interface HyperliquidVenueOptions {
  fetchFn: Fetch;
  apiUrl: string;
  isTestnet: boolean;
  store: Store;
  /** Null when running paper-only without keys. */
  signer: SignerApi | null;
  /** Which builder dexes to load, cache lifetimes, 429 backoff. */
  markets?: HyperliquidMarketsOptions;
  /** USDC on the wallet's own Arbitrum address, the source for automatic deposits. */
  arbitrumUsdc?: () => Promise<number>;
  /** USDC on the wallet's Solana address, named when Hyperliquid can't be funded from Arbitrum. */
  solanaUsdc?: () => Promise<number>;
  /**
   * Sends Solana USDC straight into the Hyperliquid account through Relay
   * (mainnet only). Paid in SOL, so it needs no ETH on Arbitrum; preferred over the bridge.
   */
  solanaDirect?: { send(amountUsd: number): Promise<{ text: string; arrivesUsd: number }> };
  /** Moves Solana USDC to the Arbitrum wallet when Arbitrum is short (mainnet only). */
  solanaBridge?: { bridge(amountUsd: number): Promise<string[]>; finishPending(): Promise<string[]> };
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a deposit to show up on Hyperliquid. Default 5 minutes. */
  depositWaitMs?: number;
}

/** Hyperliquid's smallest deposit from Arbitrum; less is lost. */
export const HL_MIN_DEPOSIT = 5;

/** How a live perp's margin gets onto the right Hyperliquid dex before the order. */
export interface PerpFunding {
  /** Margin plus a little for fees. */
  needUsd: number;
  /** Already free on the market's dex. */
  freeUsd: number;
  /** Moved from the main dex to a builder dex (HIP-3 markets such as xyz:ANT). */
  fromMainUsd: number;
  /** Deposited from the Arbitrum wallet. */
  depositUsd: number;
  /** Sent from the Solana wallet straight into Hyperliquid through Relay (a few cents more than lands). */
  solanaUsd: number;
  /** Bridged from the Solana wallet to Arbitrum first, to make up the deposit. */
  bridgeUsd: number;
  /** Still missing after both; non-zero means the trade can't be paid for. */
  shortUsd: number;
}

const roundUpCents = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
/** What to send from Solana through Relay so `usd` lands: its fee is a few cents; this leaves room for it. */
export const solanaDirectAmount = (usd: number) => roundUpCents(usd * 1.005 + 0.15);

export class HyperliquidVenue implements VenueAdapter {
  readonly venue = "hyperliquid" as const;
  readonly markets: HyperliquidMarkets;

  constructor(private readonly o: HyperliquidVenueOptions) {
    this.markets = new HyperliquidMarkets(o.fetchFn, o.apiUrl, o.markets);
  }

  private async market(symbol: string): Promise<PerpMarket> {
    const m = await this.markets.get(symbol);
    if (!m) {
      const near = (await this.markets.search(symbol, 4)).map((x) => x.name);
      throw new VenueError(
        `No Hyperliquid market called ${symbol}.${near.length ? ` Closest: ${near.join(", ")}.` : " Search with fren_markets."}`,
      );
    }
    // The market list may be a minute old; a paper fill should use the current mid.
    const fresh = (await this.markets.mids().catch(() => null))?.get(m.name);
    return fresh ? { ...m, midPx: fresh } : m;
  }

  async resolve(step: PlanStep, index: number): Promise<ResolvedStep> {
    const leg = step.leg;
    if (leg.kind !== "perp_open" && leg.kind !== "perp_close") throw new VenueError(`Hyperliquid cannot run a ${leg.kind} leg.`);
    const m = await this.market(leg.market);
    // Store the canonical symbol on the leg so the watcher and signer see the same thing.
    const canonical = { ...step, leg: { ...leg, market: m.name } } as PlanStep;
    if (leg.kind === "perp_close") {
      return { index, step: canonical, symbol: m.name, spendUsd: 0, notionalUsd: 0 };
    }
    const margin = leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
    // The exchange's $10 minimum, before the owner is asked and before anything moves.
    const tooSmall = perpMinimumProblem(m, canonical.leg as PerpOpenLeg, m.midPx, this.o.store.getLimits().maxLeverage);
    if (tooSmall) throw new VenueError(tooSmall);
    const base: ResolvedStep = {
      index,
      step: canonical,
      symbol: m.name,
      spendUsd: margin,
      notionalUsd: margin * leg.leverage,
      venueMaxLeverage: m.maxLeverage,
    };
    if (this.o.store.getLimits().mode !== "live" || !this.o.signer) return base;
    // Moving the owner's own USDC into place is part of this trade, not a second spend:
    // the trade's own size decides whether the owner is asked.
    if (step.when.length) {
      return { ...base, prepares: ["When it triggers, Fren moves the USDC it needs into Hyperliquid itself."] };
    }
    const f = await this.fundingPlan(m, margin, leg.leverage);
    if (f.shortUsd > 0) throw new VenueError(await this.shortMessage(m, f));
    const prepares = this.fundingNotes(m, f);
    return prepares.length ? { ...base, prepares } : base;
  }

  /** Work out where this trade's margin comes from, without moving anything. */
  async fundingPlan(m: PerpMarket, margin: number, leverage: number): Promise<PerpFunding> {
    // Margin, the taker fee both ways and a small cushion so the order isn't refused by cents.
    const needUsd = roundUpCents(margin + margin * leverage * 0.001 + 0.25);
    // The cushion is for money Fren moves anyway. Money already sitting on Hyperliquid that
    // covers the margin and the fees is used as is: a few cents short of the cushion must not
    // send another $5 deposit (22.11: $5.26 on Hyperliquid, Fren offered to move $5 more).
    const bareUsd = roundUpCents(margin + margin * leverage * 0.001);
    const freeUsd = Number((await this.clearinghouse(m.dex)).withdrawable) || 0;
    let short = freeUsd + 1e-9 >= bareUsd ? 0 : Math.max(0, needUsd - freeUsd);
    let fromMainUsd = 0;
    if (short > 0 && m.dex) {
      const main = Number((await this.clearinghouse("")).withdrawable) || 0;
      fromMainUsd = roundUpCents(Math.min(short, Math.max(0, main)));
      short = freeUsd + fromMainUsd + 1e-9 >= bareUsd ? 0 : Math.max(0, short - fromMainUsd);
    }
    let depositUsd = 0;
    let solanaUsd = 0;
    let bridgeUsd = 0;
    if (short > 0) {
      const arb = this.o.arbitrumUsdc ? await this.o.arbitrumUsdc().catch(() => 0) : 0;
      const want = Math.max(HL_MIN_DEPOSIT, roundUpCents(short));
      let covered = want <= arb + 1e-9;
      if (covered) depositUsd = want;
      const sol = !covered && this.o.solanaUsdc && (this.o.solanaDirect || this.o.solanaBridge) ? await this.o.solanaUsdc().catch(() => 0) : 0;
      // Straight from Solana through Relay: no Arbitrum step, no ETH for gas.
      if (!covered && this.o.solanaDirect && solanaDirectAmount(short) <= sol + 1e-9) {
        solanaUsd = solanaDirectAmount(short);
        covered = true;
      }
      if (!covered && this.o.solanaBridge) {
        const gap = roundUpCents(want - Math.max(0, arb));
        if (gap <= sol + 1e-9) {
          bridgeUsd = gap;
          depositUsd = want;
          covered = true;
        }
      }
      if (covered) {
        short = 0;
        if (m.dex) fromMainUsd = roundUpCents(needUsd - freeUsd);
      }
    }
    return { needUsd, freeUsd, fromMainUsd, depositUsd, solanaUsd, bridgeUsd, shortUsd: roundUpCents(short) };
  }

  private fundingNotes(m: PerpMarket, f: PerpFunding): string[] {
    const notes: string[] = [];
    if (f.solanaUsd > 0) {
      notes.push(`To pay for it, Fren first sends ${fmtUsd(f.solanaUsd)} USDC from your Solana wallet straight into your Hyperliquid account through Relay (under a minute; Relay keeps a few cents, and the Solana fee is paid in SOL).`);
    }
    if (f.bridgeUsd > 0) {
      notes.push(`Your Arbitrum wallet is short, so Fren first moves ${fmtUsd(f.bridgeUsd)} USDC from your Solana wallet to it with Circle's bridge (usually a few minutes; it needs a little ETH on Arbitrum for gas).`);
    }
    if (f.depositUsd > 0) notes.push(`To pay for it, Fren first moves ${fmtUsd(f.depositUsd)} USDC from your Arbitrum wallet into your Hyperliquid account (it takes about a minute).`);
    if (f.fromMainUsd > 0) notes.push(`${m.name} trades on Hyperliquid's ${m.dex} market, so Fren moves ${fmtUsd(f.fromMainUsd)} USDC there inside your Hyperliquid account.`);
    // Say it out loud, so nobody wonders whether Fren sees the money already there.
    if (!notes.length && f.freeUsd > 0) notes.push(`Paid from the ${fmtUsd(f.freeUsd)} USDC already on your Hyperliquid account; nothing is moved in.`);
    return notes;
  }

  private async shortMessage(m: PerpMarket, f: PerpFunding): Promise<string> {
    const arb = this.o.arbitrumUsdc ? await this.o.arbitrumUsdc().catch(() => 0) : 0;
    const sol = this.o.solanaUsdc ? await this.o.solanaUsdc().catch(() => 0) : 0;
    const where = [`${fmtUsd(f.freeUsd)} free for ${m.name} on Hyperliquid`, `${fmtUsd(arb)} USDC on Arbitrum`, ...(sol > 0 ? [`${fmtUsd(sol)} USDC on Solana`] : [])];
    const from = this.o.solanaDirect ? " or sends it straight from Solana" : this.o.solanaBridge ? " and tops Arbitrum up from Solana" : "";
    return `This needs about ${fmtUsd(f.needUsd)} of USDC on Hyperliquid and there isn't enough to move there: you have ${where.join(", ")}. Fren deposits from Arbitrum (at least ${fmtUsd(HL_MIN_DEPOSIT)} at a time)${from}.`;
  }

  /**
   * "Deposit $X to Hyperliquid": from the Arbitrum wallet when it has the USDC,
   * otherwise straight from the Solana wallet through Relay (no Arbitrum gas).
   */
  async deposit(amountUsd: number): Promise<string> {
    if (!(Number.isFinite(amountUsd) && amountUsd > 0)) throw new VenueError("Say how much to deposit, in dollars.");
    const arb = this.o.arbitrumUsdc ? await this.o.arbitrumUsdc().catch(() => 0) : 0;
    if (arb + 1e-9 >= amountUsd || !this.o.solanaDirect) {
      if (amountUsd < HL_MIN_DEPOSIT) throw new VenueError(`Hyperliquid takes at least ${fmtUsd(HL_MIN_DEPOSIT)} from Arbitrum; less is lost.`);
      const { txHash } = await this.signer().hlDepositFromArbitrum({ amountUsd, isTestnet: this.o.isTestnet });
      const explorer = this.o.isTestnet ? "https://sepolia.arbiscan.io/tx/" : "https://arbiscan.io/tx/";
      return `✅ Sent ${fmtUsd(amountUsd)} USDC from Arbitrum to your Hyperliquid account. It usually lands in about a minute. ${explorer}${txHash}`;
    }
    const sol = this.o.solanaUsdc ? await this.o.solanaUsdc().catch(() => 0) : 0;
    if (sol + 1e-9 < amountUsd) {
      throw new VenueError(`There isn't ${fmtUsd(amountUsd)} of USDC to move: you have ${fmtUsd(arb)} on Arbitrum and ${fmtUsd(sol)} on Solana.`);
    }
    return (await this.o.solanaDirect.send(amountUsd)).text;
  }

  /** Move the margin into place, then wait until Hyperliquid shows it. */
  private async fund(m: PerpMarket, margin: number, leverage: number): Promise<string[]> {
    // A transfer from Solana that didn't finish last time lands first.
    const finished = this.o.solanaBridge ? await this.o.solanaBridge.finishPending().catch(() => [] as string[]) : [];
    const f = await this.fundingPlan(m, margin, leverage);
    if (f.shortUsd > 0) throw new VenueError(await this.shortMessage(m, f));
    const done: string[] = [...finished];
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const mainFree = async () => Number((await this.clearinghouse("").catch(() => ({ withdrawable: "0" }) as ClearinghouseState)).withdrawable) || 0;
    if (f.solanaUsd > 0) {
      const before = await mainFree();
      const sent = await this.o.solanaDirect!.send(f.solanaUsd);
      // Relay reports the fill once Hyperliquid credits it; give the balance a moment to show it
      // (a first transfer into a new Hyperliquid account can cost up to $1 more).
      const expect = (sent.arrivesUsd > 0 ? sent.arrivesUsd : (f.solanaUsd - 0.15) / 1.005) - 1.05;
      const deadline = Date.now() + (this.o.depositWaitMs ?? 5 * 60_000);
      while ((await mainFree()) < before + expect) {
        if (Date.now() > deadline) throw new VenueError(`${sent.text}\nIt hasn't shown up in your Hyperliquid account yet, so nothing was opened. Try the trade again in a minute.`);
        await sleep(3_000);
      }
      done.push(sent.text);
    }
    if (f.bridgeUsd > 0) done.push(...(await this.o.solanaBridge!.bridge(f.bridgeUsd)));
    if (f.depositUsd > 0) {
      const before = Number((await this.clearinghouse("")).withdrawable) || 0;
      const { txHash } = await this.signer().hlDepositFromArbitrum({ amountUsd: f.depositUsd, isTestnet: this.o.isTestnet });
      const link = `${this.o.isTestnet ? "https://sepolia.arbiscan.io/tx/" : "https://arbiscan.io/tx/"}${txHash}`;
      const deadline = Date.now() + (this.o.depositWaitMs ?? 5 * 60_000);
      for (;;) {
        const now = Number((await this.clearinghouse("").catch(() => ({ withdrawable: "0" }) as ClearinghouseState)).withdrawable) || 0;
        if (now >= before + f.depositUsd - 0.01) break;
        if (Date.now() > deadline) {
          throw new VenueError(`Sent ${fmtUsd(f.depositUsd)} USDC to Hyperliquid (${link}), but it hasn't arrived yet, so nothing was opened. Try the trade again in a few minutes.`);
        }
        await sleep(5_000);
      }
      done.push(`✅ Moved ${fmtUsd(f.depositUsd)} USDC from Arbitrum into Hyperliquid · ${link}`);
    }
    if (f.fromMainUsd > 0) {
      // Relay's fee can land a cent or two under the estimate: move what's there, up to the plan.
      const amountUsd = f.solanaUsd > 0 ? Math.min(f.fromMainUsd, Math.floor((await mainFree()) * 100) / 100) : f.fromMainUsd;
      const { action, signature, nonce } = await this.signer().hlMoveToDex({ dex: m.dex, amountUsd, isTestnet: this.o.isTestnet });
      const res = await postJson<OrderResponse>(this.o.fetchFn, `${this.o.apiUrl}/exchange`, { action, nonce, signature });
      if (res.status !== "ok") {
        throw new VenueError(`Hyperliquid refused to move USDC to its ${m.dex} market: ${typeof res.response === "string" ? res.response : JSON.stringify(res.response)}. Nothing was opened.`);
      }
      done.push(`✅ Moved ${fmtUsd(amountUsd)} USDC to Hyperliquid's ${m.dex} market`);
    }
    return done;
  }

  async execute(r: ResolvedStep, ctx: ExecContext): Promise<ExecResult> {
    const leg = r.step.leg;
    if (leg.kind === "perp_open") return ctx.mode === "paper" ? this.paperOpen(leg, ctx) : this.liveOpen(leg, ctx);
    if (leg.kind === "perp_close") return ctx.mode === "paper" ? this.paperClose(leg, ctx) : this.liveClose(leg, ctx);
    throw new VenueError(`Hyperliquid cannot run a ${leg.kind} leg.`);
  }

  // -- paper -----------------------------------------------------------------

  private paperOpen(leg: PerpOpenLeg, ctx: ExecContext): Promise<ExecResult> {
    return this.market(leg.market).then((m) => {
      const store = this.o.store;
      const plan = buildPerpOpenOrders(m, leg, m.midPx);
      const margin = plan.notionalUsd / leg.leverage;
      if (store.paperUsdc() < margin) throw new VenueError(`Practice balance is ${fmtUsd(store.paperUsdc())}; this needs ${fmtUsd(margin)}.`);
      const existing = store.paperPosition(m.name);
      if (existing && existing.side !== leg.side) throw new VenueError(`You have a paper ${existing.side} on ${m.name}; close it first.`);
      const size = Number(plan.size);
      const merged = existing
        ? {
            ...existing,
            size: existing.size + size,
            entry: (existing.entry * existing.size + m.midPx * size) / (existing.size + size),
            margin: existing.margin + margin,
            leverage: leg.leverage,
          }
        : { symbol: m.name, side: leg.side, size, entry: m.midPx, margin, leverage: leg.leverage, stopPrice: null, takeProfitPrice: null };
      merged.stopPrice = plan.stopPx ?? merged.stopPrice;
      merged.takeProfitPrice = plan.takeProfitPx ?? merged.takeProfitPrice;
      store.upsertPaperPosition(merged);
      store.setPaperUsdc(store.paperUsdc() - margin);
      store.insertFill({
        planId: ctx.planId,
        idx: ctx.idx,
        venue: "hyperliquid",
        symbol: m.name,
        action: `open_${leg.side}`,
        size,
        price: m.midPx,
        usd: plan.notionalUsd,
        spendUsd: margin,
        mode: "paper",
      });
      return {
        text: `📝 Practice: ${describeFill(leg.side, m.name, size, m.midPx, plan)}`,
        receipt: openReceipt({ icon: "📝", side: leg.side, coin: m.name, size, px: m.midPx, leverage: leg.leverage, plan, margin: perpMarginOf(leg), moved: [], links: [hyperliquidLinks.chart(m.name, this.o.isTestnet)] }),
      };
    });
  }

  private async paperClose(leg: PerpCloseLeg, ctx: ExecContext): Promise<ExecResult> {
    const m = await this.market(leg.market);
    const pos = this.o.store.paperPosition(m.name);
    const text = this.paperCloseAt(m.name, m.midPx, leg.fraction, ctx, "Closed");
    if (!pos) return { text };
    const size = pos.size * leg.fraction;
    const pnl = (m.midPx - pos.entry) * size * (pos.side === "long" ? 1 : -1);
    return {
      text,
      receipt: closeReceipt({ icon: "📝", verb: "closed", side: pos.side, coin: m.name, size, px: m.midPx, entry: pos.entry, pnl, partial: leg.fraction < 1, links: [hyperliquidLinks.chart(m.name, this.o.isTestnet)] }),
    };
  }

  /** Close a paper position at a price. Also used by the watcher for paper stops, targets and liquidations. */
  paperCloseAt(symbol: string, px: number, fraction: number, ctx: ExecContext, verb: string): string {
    const store = this.o.store;
    const pos = store.paperPosition(symbol);
    if (!pos) throw new VenueError(`No paper position on ${symbol}.`);
    const size = pos.size * fraction;
    const pnl = (px - pos.entry) * size * (pos.side === "long" ? 1 : -1);
    const marginBack = pos.margin * fraction;
    store.setPaperUsdc(store.paperUsdc() + Math.max(0, marginBack + pnl));
    if (fraction >= 1) store.deletePaperPosition(symbol);
    else store.upsertPaperPosition({ ...pos, size: pos.size - size, margin: pos.margin - marginBack });
    store.insertFill({ planId: ctx.planId, idx: ctx.idx, venue: "hyperliquid", symbol, action: `close_${pos.side}`, size, price: px, usd: size * px, spendUsd: 0, mode: "paper" });
    return `📝 Practice: ${verb} ${fraction >= 1 ? "" : `${Math.round(fraction * 100)}% of `}the ${coinName(symbol)} ${pos.side === "long" ? "up" : "down"} bet at ${fmtPrice(px)}, result ${signedUsd(pnl)}`;
  }

  // -- live ------------------------------------------------------------------

  private signer(): SignerApi {
    if (!this.o.signer) throw new VenueError("Live trading needs wallets. Run `fren init` first.");
    return this.o.signer;
  }

  private async send(action: Record<string, unknown>): Promise<OrderResponse> {
    const nonce = Date.now();
    const signature = await this.signer().hlSignL1({ action, nonce, isTestnet: this.o.isTestnet });
    const res = await postJson<OrderResponse>(this.o.fetchFn, `${this.o.apiUrl}/exchange`, { action, nonce, signature });
    if (res.status !== "ok") throw new VenueError(`Hyperliquid refused: ${typeof res.response === "string" ? res.response : JSON.stringify(res.response)}`);
    return res;
  }

  /** Approve our trading-only key on the account once per network. */
  async ensureAgent(): Promise<void> {
    const key = `hl_agent_approved_${this.o.isTestnet ? "testnet" : "mainnet"}`;
    if (this.o.store.getKv(key) === "1") return;
    const { action, signature, nonce } = await this.signer().hlApproveAgent({ isTestnet: this.o.isTestnet });
    const res = await postJson<OrderResponse>(this.o.fetchFn, `${this.o.apiUrl}/exchange`, { action, nonce, signature });
    if (res.status !== "ok") {
      const msg = typeof res.response === "string" ? res.response : JSON.stringify(res.response);
      throw new VenueError(`Could not enable trading on Hyperliquid: ${msg}. Deposit USDC to your Hyperliquid account first.`);
    }
    this.o.store.setKv(key, "1");
  }

  /**
   * Withdraw USDC from Hyperliquid to the wallet's own Arbitrum address. The
   * signer fixes the destination; Hyperliquid takes a 1 USDC fee and pays out
   * in a few minutes.
   */
  async withdrawToArbitrum(amountUsd: number): Promise<string> {
    const { action, signature, nonce } = await this.signer().hlWithdrawToSelf({ amountUsd, isTestnet: this.o.isTestnet });
    const res = await postJson<OrderResponse>(this.o.fetchFn, `${this.o.apiUrl}/exchange`, { action, nonce, signature });
    if (res.status !== "ok") throw new VenueError(`Hyperliquid refused the withdrawal: ${typeof res.response === "string" ? res.response : JSON.stringify(res.response)}`);
    const explorer = this.o.isTestnet ? "https://sepolia.arbiscan.io/address/" : "https://arbiscan.io/address/";
    return `✅ Withdrew ${fmtUsd(amountUsd)} USDC from Hyperliquid to your Arbitrum wallet. About ${fmtUsd(amountUsd - 1)} arrives within about 5 minutes (Hyperliquid keeps $1). ${explorer}${String(action.destination)}`;
  }

  /** USDC Hyperliquid would let this account withdraw right now (main dex). */
  async withdrawableUsd(): Promise<number | null> {
    if (!this.o.signer) return null;
    return Number((await this.clearinghouse("")).withdrawable);
  }

  private async liveOpen(leg: PerpOpenLeg, ctx: ExecContext): Promise<ExecResult> {
    const m = await this.market(leg.market);
    const margin = leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
    // Checked again at the current price: a waiting entry or a slow /ok must not move money for an order the exchange refuses.
    const tooSmall = perpMinimumProblem(m, leg, m.midPx, Number.POSITIVE_INFINITY);
    if (tooSmall) throw new VenueError(tooSmall);
    const moved = await this.fund(m, margin, leg.leverage);
    await this.ensureAgent();
    await this.send(
      canonicalize(UpdateLeverageRequest.entries.action, {
        type: "updateLeverage",
        asset: m.assetId,
        isCross: !m.isolatedOnly,
        leverage: leg.leverage,
      }),
    );
    const plan = buildPerpOpenOrders(m, leg, m.midPx);
    const res = await this.send(canonicalize(OrderRequest.entries.action, { type: "order", orders: plan.orders, grouping: plan.grouping }));
    const fill = firstFill(res);
    const size = Number(fill.totalSz);
    const px = Number(fill.avgPx);
    this.o.store.insertFill({
      planId: ctx.planId,
      idx: ctx.idx,
      venue: "hyperliquid",
      symbol: m.name,
      action: `open_${leg.side}`,
      size,
      price: px,
      usd: size * px,
      spendUsd: (size * px) / leg.leverage,
      mode: "live",
      ref: String(fill.oid),
    });
    const [hash, liq] = await Promise.all([this.fillHash(fill.oid), this.liquidationPx(m)]);
    return {
      text: [...moved, `✅ ${describeFill(leg.side, m.name, size, px, plan)}`].join("\n"),
      receipt: openReceipt({ icon: "✅", side: leg.side, coin: m.name, size, px, leverage: leg.leverage, plan, margin, moved, liq, links: await this.followLinks(m.name, hash) }),
    };
  }

  /** Links to follow a live position: the PnL tracker, the order's proof, the chart. */
  private async followLinks(coin: string, hash: string | null): Promise<Link[]> {
    const { evm } = await this.signer().addresses();
    return [
      this.o.isTestnet ? hyperliquidLinks.account(evm, true) : hyperliquidLinks.tracker(evm),
      ...(hash ? [hyperliquidLinks.tx(hash, this.o.isTestnet)] : []),
      hyperliquidLinks.chart(coin, this.o.isTestnet),
    ];
  }

  /**
   * What a chart of one market needs: its candles' source, and the owner's
   * position on it drawn in (entry and liquidation) when there is one.
   */
  async chartView(symbol: string, mode: "paper" | "live", hours: number): Promise<{ chart: ChartRequest; links: Link[]; title: string; px: number }> {
    // "ANT" for xyz:ANT: a chart is read-only, so the one market by that name is fine.
    const m = await this.market(symbol).catch(async (err: unknown) => {
      const same = (await this.markets.search(symbol, 8)).filter((x) => coinName(x.name).toUpperCase() === coinName(symbol).toUpperCase());
      if (same.length === 1) return this.market(same[0]!.name);
      throw err;
    });
    const pos = (await this.positions(mode).catch(() => [] as PositionView[])).find((p) => p.symbol.toUpperCase() === m.name.toUpperCase());
    const levels: ChartLevel[] = [];
    let subtitle = `${hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`} · Hyperliquid perp`;
    if (pos?.entryPx) {
      levels.push({ kind: "entry", price: pos.entryPx, label: "ENTRY" });
      if (pos.liquidationPx) levels.push({ kind: "liq", price: pos.liquidationPx, label: "LIQ" });
      subtitle += ` · your ${pos.side} ${qty(pos.size)}, PnL ${pos.pnlUsd === null ? "?" : signedUsd(pos.pnlUsd)}${mode === "paper" ? " (paper)" : ""}`;
    }
    const links: Link[] = [hyperliquidLinks.chart(m.name, this.o.isTestnet)];
    if (pos && this.o.signer) {
      const { evm } = await this.signer().addresses();
      links.unshift(this.o.isTestnet ? hyperliquidLinks.account(evm, true) : hyperliquidLinks.tracker(evm));
    }
    const title = `${coinName(m.name)} ${fmtPrice(m.midPx)}`;
    return { chart: { source: { kind: "hyperliquid", coin: m.name }, title, subtitle, levels, marks: [], hours }, links, title, px: m.midPx };
  }

  /**
   * The exchange's hash for an order's fill, which opens it on Hyperliquid's
   * explorer. Orders don't get one in the reply, so it is read from the fills.
   */
  async fillHash(oid: number): Promise<string | null> {
    try {
      const { evm } = await this.signer().addresses();
      const fills = await this.markets.info<{ oid: number; hash?: string }[]>({ type: "userFillsByTime", user: evm, startTime: Date.now() - 5 * 60_000 });
      const hash = fills.find((f) => f.oid === oid)?.hash;
      return hash && !/^0x0+$/.test(hash) ? hash : null;
    } catch {
      return null;
    }
  }

  private async liquidationPx(m: PerpMarket): Promise<number | null> {
    try {
      const state = await this.clearinghouse(m.dex);
      const p = state.assetPositions.find((a) => a.position.coin.toUpperCase() === m.name.toUpperCase());
      const v = p?.position.liquidationPx ? Number(p.position.liquidationPx) : NaN;
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  }

  private async clearinghouse(dex: string): Promise<ClearinghouseState> {
    const { evm } = await this.signer().addresses();
    return this.markets.info<ClearinghouseState>({ type: "clearinghouseState", user: evm, ...(dex ? { dex } : {}) });
  }

  private async liveClose(leg: PerpCloseLeg, ctx: ExecContext): Promise<ExecResult> {
    const m = await this.market(leg.market);
    const state = await this.clearinghouse(m.dex);
    const pos = state.assetPositions.find((p) => p.position.coin.toUpperCase() === m.name.toUpperCase());
    const szi = pos ? Number(pos.position.szi) : 0;
    if (!pos || szi === 0) throw new VenueError(`No open ${m.name} position on Hyperliquid.`);
    const isBuy = szi < 0;
    const size = formatSize(Math.abs(szi) * leg.fraction, m.szDecimals);
    const slip = leg.maxSlippagePct / 100;
    const limitPx = formatPrice(m.midPx * (isBuy ? 1 + slip : 1 - slip), m.szDecimals, "perp");
    const res = await this.send(
      canonicalize(OrderRequest.entries.action, {
        type: "order",
        orders: [{ a: m.assetId, b: isBuy, p: limitPx, s: size, r: true, t: { limit: { tif: "Ioc" } } }],
        grouping: "na",
      }),
    );
    const fill = firstFill(res);
    const px = Number(fill.avgPx);
    const closed = Number(fill.totalSz);
    const pnl = (px - Number(pos.position.entryPx)) * closed * (szi > 0 ? 1 : -1);
    this.o.store.insertFill({
      planId: ctx.planId,
      idx: ctx.idx,
      venue: "hyperliquid",
      symbol: m.name,
      action: szi > 0 ? "close_long" : "close_short",
      size: closed,
      price: px,
      usd: closed * px,
      spendUsd: 0,
      mode: "live",
      ref: String(fill.oid),
    });
    const hash = await this.fillHash(fill.oid);
    return {
      text: `✅ Closed ${closed} ${m.name} at ${fmtPrice(px)}, PnL about ${signedUsd(pnl)}`,
      receipt: closeReceipt({
        icon: "✅",
        verb: "closed",
        side: szi > 0 ? "long" : "short",
        coin: m.name,
        size: closed,
        px,
        entry: Number(pos.position.entryPx),
        pnl,
        partial: closed + 1e-12 < Math.abs(szi),
        links: await this.followLinks(m.name, hash),
      }),
    };
  }

  /**
   * Closes the exchange made by itself since a time: a stop or target that
   * triggered, or a liquidation. Fren's own orders (in `ours`) are left out:
   * the owner already had a receipt for those.
   */
  async exchangeExits(sinceMs: number, ours: Set<string>): Promise<{ at: number; text: string; receipt: StepReceipt }[]> {
    if (!this.o.signer) return [];
    const { evm } = await this.signer().addresses();
    type Fill = { coin: string; px: string; sz: string; time: number; dir: string; closedPnl: string; hash: string; oid: number; fee: string; liquidation?: unknown };
    const fills = await this.markets.info<Fill[]>({ type: "userFillsByTime", user: evm, startTime: sinceMs + 1 });
    const byOrder = new Map<number, Fill[]>();
    for (const f of fills) {
      if (!/^Close (Long|Short)$/.test(f.dir) && !f.liquidation) continue;
      if (ours.has(String(f.oid))) continue;
      byOrder.set(f.oid, [...(byOrder.get(f.oid) ?? []), f]);
    }
    const out: { at: number; text: string; receipt: StepReceipt }[] = [];
    for (const [oid, fs] of byOrder) {
      const size = fs.reduce((a, f) => a + Number(f.sz), 0);
      if (!(size > 0)) continue;
      const px = fs.reduce((a, f) => a + Number(f.px) * Number(f.sz), 0) / size;
      const pnl = fs.reduce((a, f) => a + Number(f.closedPnl), 0);
      const fees = fs.reduce((a, f) => a + Number(f.fee), 0);
      const at = Math.max(...fs.map((f) => f.time));
      const first = fs[0]!;
      const side = /Short/.test(first.dir) ? "short" : "long";
      const dir = side === "long" ? 1 : -1;
      const entry = px - pnl / (size * dir);
      let type = "";
      if (!fs.some((f) => f.liquidation)) {
        type = await this.markets
          .info<{ order?: { order?: { orderType?: string } } }>({ type: "orderStatus", user: evm, oid })
          .then((r) => r.order?.order?.orderType ?? "")
          .catch(() => "");
      }
      const kind = fs.some((f) => f.liquidation) ? "liquidated" : /^Stop/i.test(type) ? "stop hit" : /^Take Profit/i.test(type) ? "target hit" : "closed on Hyperliquid";
      const icon = kind === "liquidated" ? "💥" : kind === "stop hit" ? "🛑" : kind === "target hit" ? "🎯" : "✅";
      const receipt = closeReceipt({ icon, verb: kind, side, coin: first.coin, size, px, entry, pnl, fees, at, links: await this.followLinks(first.coin, first.hash || null) });
      out.push({ at, receipt, text: `${icon} ${receipt.title}: ${qty(size)} ${coinName(first.coin)} at ${fmtPrice(px)}, PnL about ${signedUsd(pnl)}` });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  async positions(mode: "paper" | "live"): Promise<PositionView[]> {
    if (mode === "paper") {
      const markets = await this.markets.all().catch(() => [] as PerpMarket[]);
      return this.o.store.paperPositions().map((p) => {
        const mark = markets.find((m) => m.name === p.symbol)?.markPx ?? null;
        const pnl = mark === null ? null : (mark - p.entry) * p.size * (p.side === "long" ? 1 : -1);
        return { venue: "hyperliquid", symbol: p.symbol, kind: "perp", side: p.side, size: p.size, entryPx: p.entry, markPx: mark, valueUsd: p.margin + (pnl ?? 0), pnlUsd: pnl };
      });
    }
    if (!this.o.signer) return [];
    const dexes = [...new Set((await this.markets.all()).map((m) => m.dex))];
    const states = await Promise.all(dexes.map((d) => this.clearinghouse(d)));
    const markets = await this.markets.all();
    return states.flatMap((s) =>
      s.assetPositions
        .filter((p) => Number(p.position.szi) !== 0)
        .map((p) => {
          const szi = Number(p.position.szi);
          return {
            venue: "hyperliquid" as const,
            symbol: p.position.coin,
            kind: "perp" as const,
            side: szi > 0 ? ("long" as const) : ("short" as const),
            size: Math.abs(szi),
            entryPx: Number(p.position.entryPx),
            markPx: markets.find((m) => m.name === p.position.coin)?.markPx ?? null,
            valueUsd: Number(p.position.marginUsed) + Number(p.position.unrealizedPnl),
            pnlUsd: Number(p.position.unrealizedPnl),
            liquidationPx: p.position.liquidationPx ? Number(p.position.liquidationPx) : null,
          };
        }),
    );
  }

  async accountValueUsd(): Promise<number | null> {
    if (!this.o.signer) return null;
    const dexes = [...new Set((await this.markets.all()).map((m) => m.dex))];
    const states = await Promise.all(dexes.map((d) => this.clearinghouse(d)));
    return states.reduce((sum, s) => sum + Number(s.marginSummary.accountValue), 0);
  }

  /** Closes every position at market. Each close comes with its receipt. */
  async flatten(mode: "paper" | "live"): Promise<ExecResult[]> {
    const ctx: ExecContext = { mode, planId: null, idx: null };
    const out: ExecResult[] = [];
    for (const p of await this.positions(mode)) {
      try {
        const leg: PerpCloseLeg = { kind: "perp_close", venue: "hyperliquid", market: p.symbol, fraction: 1, maxSlippagePct: 2 };
        out.push(mode === "paper" ? await this.paperClose(leg, ctx) : await this.liveClose(leg, ctx));
      } catch (err) {
        out.push({ text: `❌ Could not close ${p.symbol}: ${(err as Error).message}` });
      }
    }
    return out;
  }
}

function firstFill(res: OrderResponse) {
  const r = res.response;
  if (typeof r === "string" || r.type !== "order") throw new VenueError(`Unexpected Hyperliquid response: ${JSON.stringify(r)}`);
  const s = (r as Extract<OrderResponse["response"], { type: "order" }>).data.statuses[0];
  if (s && typeof s === "object" && "filled" in s) return s.filled;
  if (s && typeof s === "object" && "error" in s) throw new VenueError(`Hyperliquid: ${s.error}`);
  throw new VenueError(`Order did not fill immediately (${JSON.stringify(s)}). Nothing was opened.`);
}

function describeFill(side: string, symbol: string, size: number, px: number, plan: PerpOrderPlan): string {
  const exits: string[] = [];
  if (plan.stopPx !== null) exits.push(`stop ${fmtPrice(plan.stopPx)}`);
  if (plan.takeProfitPx !== null) exits.push(`target ${fmtPrice(plan.takeProfitPx)}`);
  const name = coinName(symbol);
  return `Bet on ${name} going ${side === "long" ? "up" : "down"}: ${size} ${name} at ${fmtPrice(px)} (moves like ${fmtUsd(size * px)} of ${name})${exits.length ? `, ${exits.join(", ")}` : ""}`;
}

/** "xyz:ANT" reads as ANT; the dex prefix is plumbing. */
export function coinName(coin: string): string {
  return coin.includes(":") ? coin.slice(coin.indexOf(":") + 1) : coin;
}

const qty = (n: number) => String(Number(n.toPrecision(6)));

/** Lines Fren printed while moving the margin into place, as receipt rows with their proof links. */
function movedRows(moved: string[]): Row[] {
  return moved.map((l) => rowFromText(`↪ ${l.replace(/^(✅|↪)\s*/, "")}`));
}

export function openReceipt(o: {
  icon: string;
  side: "long" | "short";
  coin: string;
  size: number;
  px: number;
  leverage: number;
  plan: PerpOrderPlan;
  moved: string[];
  liq?: number | null;
  links: Link[];
  /** The margin the owner asked for; the fill's own works out a few cents off. */
  margin?: number;
}): StepReceipt {
  const name = coinName(o.coin);
  const dir = o.side === "long" ? 1 : -1;
  const notional = o.size * o.px;
  const margin = o.margin ?? notional / o.leverage;
  const rows: Row[] = [
    { text: `Put in: ${fmtUsd(margin)}, ${o.leverage}× boost (moves like ${fmtUsd(notional)} of ${name}, ${qty(o.size)} ${name})` },
    { text: `Entry: ${fmtPrice(o.px)}` },
  ];
  const levels: ChartLevel[] = [{ kind: "entry", price: o.px, label: "ENTRY" }];
  if (o.plan.stopPx !== null) {
    rows.push({ text: `Stop: ${fmtPrice(o.plan.stopPx)} (about ${signedUsd((o.plan.stopPx - o.px) * o.size * dir)})` });
    levels.push({ kind: "stop", price: o.plan.stopPx, label: "STOP" });
  }
  if (o.plan.takeProfitPx !== null) {
    rows.push({ text: `Target: ${fmtPrice(o.plan.takeProfitPx)} (about ${signedUsd((o.plan.takeProfitPx - o.px) * o.size * dir)})` });
    levels.push({ kind: "target", price: o.plan.takeProfitPx, label: "TARGET" });
  }
  if (o.plan.stopPx === null && o.plan.takeProfitPx === null) rows.push({ text: "No stop or target set." });
  if (o.liq) {
    rows.push({ text: `If ${name} reaches about ${fmtPrice(o.liq)}, the exchange closes it by itself and what you put in is gone` });
    levels.push({ kind: "liq", price: o.liq, label: "LIQ" });
  }
  rows.push(...movedRows(o.moved));
  return {
    icon: o.icon,
    title: `Bet on ${name} going ${o.side === "long" ? "up" : "down"}`,
    rows,
    links: o.links,
    chart: {
      source: { kind: "hyperliquid", coin: o.coin },
      title: `${o.side} ${name} ${o.leverage}x`,
      subtitle: `${fmtUsd(margin)} in · ${o.leverage}× boost · moves like ${fmtUsd(notional)} of ${name}`,
      levels,
      marks: [{ t: Date.now(), price: o.px, side: o.side === "long" ? "buy" : "sell" }],
    },
  };
}

export function closeReceipt(o: {
  icon: string;
  /** "closed", "stop hit", "target hit", "liquidated". */
  verb: string;
  side: "long" | "short";
  coin: string;
  size: number;
  px: number;
  entry: number;
  pnl: number;
  partial?: boolean;
  fees?: number;
  links: Link[];
  at?: number;
}): StepReceipt {
  const name = coinName(o.coin);
  const rows: Row[] = [
    { text: `${o.partial ? "Closed part" : "Closed"}: ${qty(o.size)} ${name} at ${fmtPrice(o.px)}` },
    { text: `Entry was ${fmtPrice(o.entry)}` },
    { text: `Result: about ${signedUsd(o.pnl)}${o.fees ? ` (fees ${fmtUsd(o.fees)})` : ""}` },
  ];
  return {
    icon: o.icon,
    title: `${name} ${o.side === "long" ? "up" : "down"} bet ${o.verb}`,
    rows,
    links: o.links,
    chart: {
      source: { kind: "hyperliquid", coin: o.coin },
      title: `${name} ${o.side} ${o.verb}`,
      subtitle: `Result ${signedUsd(o.pnl)} · entry ${fmtPrice(o.entry)} · exit ${fmtPrice(o.px)}`,
      levels: [
        { kind: "entry", price: o.entry, label: "ENTRY" },
        { kind: "exit", price: o.px, label: "EXIT" },
      ],
      marks: [{ t: o.at ?? Date.now(), price: o.px, side: o.side === "long" ? "sell" : "buy" }],
    },
  };
}

function perpMarginOf(leg: PerpOpenLeg): number {
  return leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
}
