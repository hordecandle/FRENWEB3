import { z } from "zod";
import { Venue, type Plan } from "./plan.js";

/**
 * The user's own rules. Set in chat, enforced in code. The agent may tighten
 * these but only the owner (via a slash command that bypasses the LLM) may
 * loosen them.
 */
export const Limits = z.object({
  /** "paper" runs every plan with fake money at real prices. */
  mode: z.enum(["paper", "live"]).default("paper"),
  /** Kill switch. When true nothing executes and the watcher fires nothing. */
  paused: z.boolean().default(false),
  /** Most USD a single leg may spend (perp margin or swap input). */
  maxTradeUsd: z.number().positive().default(500),
  /** Most USD all legs together may spend per UTC day. */
  maxDailyUsd: z.number().positive().default(2000),
  maxLeverage: z.number().int().min(1).default(20),
  maxOpenPositions: z.number().int().min(1).default(10),
  /** Plans spending at or under this run without a confirmation code. */
  autoApproveUsd: z.number().min(0).default(50),
  allowedVenues: z.array(Venue).default(["hyperliquid", "jupiter", "relay", "derive", "polymarket", "yield"]),
  /**
   * Stop put on every boosted bet (perp) that comes without one, as % of what the
   * owner puts in (ROE): 30 at 3x closes after a ~10% move the wrong way. 0 = off.
   */
  defaultStopLossPct: z.number().min(0).max(95).default(0),
});
export type Limits = z.infer<typeof Limits>;

export const DEFAULT_LIMITS: Limits = Limits.parse({});

/**
 * Safer starting limits for someone new to this (default for fresh installs since 22.11):
 * small trades, low boost, every trade confirmed with /ok, no options (Derive),
 * a stop on every bet that comes without one. The owner can loosen them with /limits.
 * An install that already has a database keeps whatever it had (see Store).
 */
export const NOVICE_LIMITS: Limits = Limits.parse({
  maxTradeUsd: 100,
  maxDailyUsd: 300,
  maxLeverage: 3,
  maxOpenPositions: 3,
  autoApproveUsd: 0,
  allowedVenues: ["hyperliquid", "jupiter", "relay", "polymarket", "yield"],
  defaultStopLossPct: 30,
});

/**
 * The limits a fresh install starts with: the safer ones, unless the installer
 * asks for the old wide ones with FREN_NOVICE_DEFAULTS=0.
 */
export function startingLimits(env: Record<string, string | undefined> = process.env): Limits {
  return env.FREN_NOVICE_DEFAULTS === "0" ? DEFAULT_LIMITS : NOVICE_LIMITS;
}

export type LimitKey = keyof Omit<Limits, "allowedVenues">;

/**
 * True when moving from `current` to `next` only makes things stricter, so the
 * agent is allowed to do it without the owner's command.
 */
export function isTightening(current: Limits, next: Limits): boolean {
  if (current.mode === "paper" && next.mode === "live") return false;
  if (current.paused && !next.paused) return false;
  if (next.maxTradeUsd > current.maxTradeUsd) return false;
  if (next.maxDailyUsd > current.maxDailyUsd) return false;
  if (next.maxLeverage > current.maxLeverage) return false;
  if (next.maxOpenPositions > current.maxOpenPositions) return false;
  if (next.autoApproveUsd > current.autoApproveUsd) return false;
  if (next.allowedVenues.some((v) => !current.allowedVenues.includes(v))) return false;
  // Dropping the automatic stop, or letting it lose more, is loosening.
  if (current.defaultStopLossPct > 0 && (next.defaultStopLossPct === 0 || next.defaultStopLossPct > current.defaultStopLossPct)) return false;
  return true;
}

/**
 * Parse "key=value" pairs from an owner command such as
 * `/limits maxTradeUsd=2500 maxLeverage=40 mode=live`.
 */
export function applyLimitArgs(current: Limits, args: string): Limits {
  const next: Record<string, unknown> = { ...current };
  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    const eq = token.indexOf("=");
    if (eq <= 0) throw new Error(`Expected key=value, got "${token}"`);
    const key = token.slice(0, eq);
    const raw = token.slice(eq + 1);
    if (!(key in DEFAULT_LIMITS)) throw new Error(`Unknown limit "${key}"`);
    if (key === "allowedVenues") {
      next[key] = raw.split(",").filter(Boolean);
    } else if (key === "mode") {
      next[key] = raw;
    } else if (key === "paused") {
      next[key] = raw === "true" || raw === "on" || raw === "yes";
    } else {
      const n = Number(raw.replace(/[$,_]/g, ""));
      if (!Number.isFinite(n)) throw new Error(`"${key}" needs a number, got "${raw}"`);
      next[key] = n;
    }
  }
  return Limits.parse(next);
}

/**
 * Put the owner's automatic stop on every boosted bet that came without one.
 * A stop the owner (or the model, from the owner's words) set is kept as is.
 */
export function withDefaultStops(plan: Plan, limits: Pick<Limits, "defaultStopLossPct">): Plan {
  const pct = limits.defaultStopLossPct;
  if (!(pct > 0)) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const leg = step.leg;
      if (leg.kind !== "perp_open" || leg.stopLossPct !== undefined || leg.stopPrice !== undefined || leg.stopLossUsd !== undefined) return step;
      return { ...step, leg: { ...leg, stopLossPct: pct } };
    }),
  };
}
