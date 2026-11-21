import type { ConditionStatus } from "./conditions.js";
import type { Condition, Leg, PlanStep } from "./plan.js";
import type { PolicyDecision, ResolvedStep } from "./policy.js";

/**
 * Plain-English rendering for chat. Users learn the grammar by reading their
 * own trades back, so this text is part of the product, not debug output.
 */

export function usd(n: number): string {
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "+$12.50" / "-$12.50", for PnL. */
export function signedUsd(n: number): string {
  return `${n < 0 ? "-" : "+"}${usd(Math.abs(n))}`;
}

export function price(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

/** A token amount for chat: "9,518,222", "1.2346", "0.1446". */
export function qty(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n === 0 ? "0" : String(Number(n.toPrecision(4)));
}

function pctMove(p: number): string {
  return `${p >= 1 ? Number(p.toFixed(1)) : Number(p.toPrecision(2))}%`;
}

/** "xyz:ANT" reads as ANT: the market prefix is plumbing. */
export function marketName(m: string): string {
  return m.includes(":") ? m.slice(m.indexOf(":") + 1) : m;
}

/** "$20", "$7.50": a rough dollar amount, said the way people say it. */
function about(n: number): string {
  return n >= 10 ? `$${Math.round(n).toLocaleString("en-US")}` : usd(n);
}

/**
 * A long or short in words a newcomer reads the same way: a bet that the
 * price goes up or down, a boost instead of leverage, and what the stop and
 * target mean in price and in dollars. No "margin", "position" or "ROE".
 */
export function perpParts(leg: Extract<Leg, { kind: "perp_open" }>, resolved?: Pick<ResolvedStep, "symbol">): { head: string; exits: string[] } {
  const where = venueName[leg.venue] ?? leg.venue;
  const market = marketName(resolved?.symbol ?? leg.market);
  const margin = leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
  const up = leg.side === "long";
  const head = `Bet ${usd(margin)} that ${market} goes ${up ? "up" : "down"}, ${leg.leverage}× boost on ${where}`;
  const exits: string[] = [];
  if (leg.stopLossPct !== undefined) {
    exits.push(`Stop: if ${market} ${up ? "falls" : "rises"} ~${pctMove(leg.stopLossPct / leg.leverage)}, Fren closes it and you lose about ${about((margin * leg.stopLossPct) / 100)}`);
  } else if (leg.stopLossUsd !== undefined) {
    exits.push(`Stop: Fren closes it once you're down about ${about(leg.stopLossUsd)}`);
  }
  if (leg.stopPrice !== undefined) exits.push(`Stop: if ${market} reaches ${price(leg.stopPrice)}, Fren closes it`);
  if (leg.takeProfitPct !== undefined) {
    exits.push(`Take profit: if ${market} ${up ? "rises" : "falls"} ~${pctMove(leg.takeProfitPct / leg.leverage)}, Fren closes it and you win about ${about((margin * leg.takeProfitPct) / 100)}`);
  } else if (leg.takeProfitUsd !== undefined) {
    exits.push(`Take profit: Fren closes it once you're up about ${about(leg.takeProfitUsd)}`);
  }
  if (leg.takeProfitPrice !== undefined) exits.push(`Take profit: if ${market} reaches ${price(leg.takeProfitPrice)}, Fren closes it`);
  if (exits.length === 0) exits.push("No stop: nothing closes it for you");
  return { head, exits };
}

const venueName: Record<string, string> = { hyperliquid: "Hyperliquid", jupiter: "Jupiter", relay: "Relay", derive: "Derive", polymarket: "Polymarket", yield: "yield" };

export const yieldProtocolName: Record<string, string> = {
  jupiter_lend: "Jupiter Lend (Solana)",
  kamino: "Kamino (Solana)",
  aave_arbitrum: "Aave on Arbitrum",
  aave_base: "Aave on Base",
};

export const chainName: Record<string, string> = { solana: "Solana", base: "Base", robinhood: "Robinhood Chain", arbitrum: "Arbitrum" };

/** Mints the engine swaps a ticker for, shown by name again. */
const KNOWN_MINTS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
};

/** "0x1234…abcd" for long addresses, unchanged for symbols. */
export function shortToken(t: string): string {
  const known = KNOWN_MINTS[t];
  if (known) return known;
  return t.length > 20 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t;
}

export interface OptionName {
  asset: string;
  /** Derive options expire at 08:00 UTC on the date in their name. */
  expiry: Date;
  strike: number;
  type: "call" | "put";
}

/** "ETH-20261225-4000-C" → ETH, 25 Dec 2026 08:00 UTC, 4000, call. Null when it isn't an option name. */
export function parseOptionName(name: string): OptionName | null {
  const m = /^([A-Z0-9]+)-(\d{4})(\d{2})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!m) return null;
  return {
    asset: m[1]!,
    expiry: new Date(Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]), 8)),
    strike: Number(m[5]),
    type: m[6] === "C" ? "call" : "put",
  };
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "ETH $4,000 call expiring Dec 25, 2026" */
export function describeOption(name: string): string {
  const o = parseOptionName(name);
  return o ? `${o.asset} ${price(o.strike)} ${o.type} expiring ${shortDate(o.expiry)}` : name;
}

export function describeLeg(leg: Leg, resolved?: Pick<ResolvedStep, "symbol" | "notionalUsd">): string {
  const where = venueName[leg.venue] ?? leg.venue;
  switch (leg.kind) {
    case "perp_open": {
      const p = perpParts(leg, resolved);
      return [p.head, ...p.exits].join(". ");
    }
    case "perp_close": {
      const share = leg.fraction >= 1 ? "Close" : `Close ${Math.round(leg.fraction * 100)}% of`;
      return `${share} your ${resolved?.symbol ?? leg.market} bet on ${where}`;
    }
    case "swap": {
      const token = shortToken(resolved?.symbol ?? leg.token);
      const where = leg.venue === "relay" ? chainName[leg.chain] ?? leg.chain : venueName[leg.venue];
      if (leg.side === "buy") {
        const amt =
          leg.amount.type === "usd" ? usd(leg.amount.usd) : leg.amount.type === "tokens" ? `${leg.amount.tokens}` : `${Math.round(leg.amount.fraction * 100)}% of your USDC`;
        return `Buy ${amt} of ${token} on ${where}`;
      }
      if (leg.amount.type === "tokens") return `Sell ${leg.amount.tokens} ${token} on ${where}`;
      const amt = leg.amount.type === "fraction" ? `${Math.round(leg.amount.fraction * 100)}% of your` : `${usd(leg.amount.usd)} of`;
      return `Sell ${amt} ${token} on ${where}`;
    }
    case "option": {
      const what = describeOption(leg.instrument);
      if (leg.side === "buy") {
        const amt = leg.amount.type === "usd" ? usd(leg.amount.usd) : `${Math.round(leg.amount.fraction * 100)}% of your USDC`;
        return `Buy ${amt} of the ${what} on Derive`;
      }
      const amt = leg.amount.type === "fraction" ? `${Math.round(leg.amount.fraction * 100)}% of your` : `${usd(leg.amount.usd)} of your`;
      return `Sell ${amt} ${what} on Derive`;
    }
    case "prediction": {
      const market = resolved?.symbol ?? leg.market;
      if (leg.side === "buy") {
        const amt = leg.amount.type === "usd" ? usd(leg.amount.usd) : `${Math.round(leg.amount.fraction * 100)}% of your USDC`;
        const cap = leg.limitPrice !== undefined ? ` at up to ${Math.round(leg.limitPrice * 100)}¢ a share` : "";
        return `Bet ${amt} on "${leg.outcome}" for "${market}" on Polymarket${cap}`;
      }
      const amt = leg.amount.type === "fraction" ? `${Math.round(leg.amount.fraction * 100)}% of your` : `${usd(leg.amount.usd)} of your`;
      return `Sell ${amt} "${leg.outcome}" shares in "${market}" on Polymarket`;
    }
    case "earn": {
      // The venue resolves "best" to a protocol and puts its name in symbol.
      const where = resolved?.symbol ?? (leg.protocol ? yieldProtocolName[leg.protocol] : undefined);
      if (leg.action === "deposit") {
        const amt = leg.amount.type === "usd" ? `${usd(leg.amount.usd)} of USDC` : `${Math.round(leg.amount.fraction * 100)}% of your USDC`;
        return `Lend ${amt} on ${where ?? "the best USDC rate"}`;
      }
      const amt = leg.amount.type === "usd" ? `${usd(leg.amount.usd)} of USDC` : leg.amount.fraction >= 1 ? "all your USDC" : `${Math.round(leg.amount.fraction * 100)}% of your USDC`;
      return `Withdraw ${amt} from ${where ?? "your yield"}`;
    }
  }
}

export function describeCondition(c: Condition): string {
  switch (c.type) {
    case "price":
      return `${c.market} price ${c.op} ${price(c.value)}`;
    case "funding":
      return `${c.market} funding ${c.op} ${c.value}%/h`;
    case "tradable":
      return `${shortToken(c.token)} starts trading${c.chain === "solana" ? "" : ` on ${chainName[c.chain] ?? c.chain}`}`;
    case "time":
      return `after ${new Date(c.after).toUTCString()}`;
  }
}

export function describeConditionStatus(s: ConditionStatus): string {
  const mark = s.met ? "✅" : "⏳";
  const c = s.condition;
  let now = "";
  if (s.current === null) now = " (no data yet)";
  else if (c.type === "price") now = ` (now ${price(Number(s.current))})`;
  else if (c.type === "funding") now = ` (now ${Number(s.current).toFixed(4)}%/h)`;
  else if (c.type === "tradable") now = ` (${s.current})`;
  return `${mark} ${describeCondition(c)}${now}`;
}

export function describeStep(step: PlanStep, resolved?: ResolvedStep): string {
  const when = step.when.length ? `, when ${step.when.map(describeCondition).join(" and ")}` : "";
  if (step.leg.kind === "perp_open") {
    // The condition belongs to the bet, before the stop and target sentences.
    const p = perpParts(step.leg, resolved);
    return [p.head + when, ...p.exits].join(". ");
  }
  return `${describeLeg(step.leg, resolved)}${when}`;
}

export function describeDecision(decision: PolicyDecision, resolved: ResolvedStep[]): string {
  const lines: string[] = [];
  for (const d of decision.steps) {
    const r = resolved.find((x) => x.index === d.index);
    if (!r) continue;
    const icon = d.verdict === "reject" ? "❌" : d.verdict === "confirm" ? "🟡" : "🟢";
    lines.push(`${icon} ${describeStep(r.step, r)}`);
    for (const reason of d.reasons) lines.push(`   • ${reason}`);
    for (const p of r.prepares ?? []) lines.push(`   ↪ ${p}`);
    for (const w of d.warnings) lines.push(`   ⚠️ ${w}`);
  }
  for (const reason of decision.reasons) lines.push(`❌ ${reason}`);
  return lines.join("\n");
}

/**
 * The most a plan can lose, in dollars, before the owner says yes. Every trade
 * that puts money in shows it, in words anyone reads the same way.
 */
export interface MaxLoss {
  /** Everything the plan puts in: the worst case. */
  usd: number;
  /** About where the stop cuts the loss, when every leg that puts money in has one. */
  withStopUsd: number | null;
  /** A long or short on Hyperliquid: other money kept there backs it too. */
  borrowed: boolean;
}

export function maxLoss(resolved: ResolvedStep[]): MaxLoss | null {
  let total = 0;
  let stop = 0;
  let allStopped = true;
  let borrowed = false;
  for (const r of resolved) {
    if (!(r.spendUsd > 0)) continue;
    total += r.spendUsd;
    const leg = r.step.leg;
    if (leg.kind === "perp_open") {
      borrowed = true;
      if (leg.stopLossUsd !== undefined) stop += Math.min(leg.stopLossUsd, r.spendUsd);
      else if (leg.stopLossPct !== undefined) stop += (r.spendUsd * Math.min(leg.stopLossPct, 100)) / 100;
      else allStopped = false;
    } else allStopped = false;
  }
  if (!(total > 0)) return null;
  return { usd: total, withStopUsd: allStopped ? stop : null, borrowed };
}

/** "The most you can lose: $50 ..." or null when the plan puts no money in. */
export function describeMaxLoss(resolved: ResolvedStep[]): string | null {
  const m = maxLoss(resolved);
  if (!m) return null;
  let line = `🧯 The most you can lose: ${usd(m.usd)}, the money this puts in.`;
  if (m.withStopUsd !== null) line += ` Your stop should cut it at about ${usd(m.withStopUsd)}.`;
  if (m.borrowed) line += " If the price crashes, other money you keep on Hyperliquid can be used to keep it open.";
  return line;
}
