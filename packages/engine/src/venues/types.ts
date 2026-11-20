import type { PlanStep, ResolvedStep, Venue } from "@fren/core";
import type { Mode } from "../store.js";
import type { StepReceipt } from "../receipt.js";

export interface ExecContext {
  mode: Mode;
  planId: string | null;
  idx: number | null;
  /** A launch snipe: pay for speed (Jito tip / higher priority fee). */
  snipe?: boolean;
}

export interface ExecResult {
  /** One line for the chat reply: what happened, where, at what price. */
  text: string;
  /**
   * The same result as a receipt, when the venue builds one (key numbers,
   * proof links, a chart). Without it the engine builds one from `text`.
   */
  receipt?: StepReceipt;
}

export interface PositionView {
  venue: Venue;
  symbol: string;
  kind: "perp" | "spot";
  side: "long" | "short" | "hold";
  size: number;
  entryPx: number | null;
  markPx: number | null;
  valueUsd: number;
  pnlUsd: number | null;
  liquidationPx?: number | null;
}

/** Every venue implements the same shape so the engine never branches on venue. */
export interface VenueAdapter {
  readonly venue: Venue;
  /** Look the market up and price the step. Throws a user-readable Error when it can't. */
  resolve(step: PlanStep, index: number): Promise<ResolvedStep>;
  execute(resolved: ResolvedStep, ctx: ExecContext): Promise<ExecResult>;
  positions(mode: Mode): Promise<PositionView[]>;
  /** Close every perp position (kill switch). One line per close, with its receipt where the venue has one. */
  flatten(mode: Mode): Promise<string[] | ExecResult[]>;
}

/** Spot venues can also say whether a not-yet-launched token trades yet. */
export interface SpotVenueAdapter extends VenueAdapter {
  isTradable(token: string, chain: string): Promise<boolean>;
}

export class VenueError extends Error {
  override name = "VenueError";
}

/**
 * The token can't be bought this moment but likely can soon: no pool yet, or
 * pump.fun is moving it from its curve to its pool. Nothing was spent. A buy
 * that hits this waits for the token to trade instead of failing.
 */
export class NotTradableYet extends VenueError {
  override name = "NotTradableYet";
}
