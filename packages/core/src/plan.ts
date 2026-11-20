import { z } from "zod";

/**
 * The Plan is the contract between the agent (which writes it) and everything
 * downstream (policy, signer, adapters, watcher). The agent never touches keys;
 * all it can do is propose a Plan that deterministic code then checks.
 */

export const PLAN_VERSION = 1 as const;

export const Venue = z.enum(["hyperliquid", "jupiter", "relay", "derive", "polymarket", "yield"]);
export type Venue = z.infer<typeof Venue>;

/** Chains a token can live on. Solana tokens trade through Jupiter, EVM tokens through Relay. */
export const Chain = z.enum(["solana", "base", "robinhood", "arbitrum"]);
export type Chain = z.infer<typeof Chain>;
export const EVM_CHAINS = ["base", "robinhood", "arbitrum"] as const satisfies readonly Chain[];
export type EvmChain = (typeof EVM_CHAINS)[number];

/** Spot venues: Jupiter for Solana, Relay for EVM chains. */
export const SpotVenue = z.enum(["jupiter", "relay"]);
export type SpotVenue = z.infer<typeof SpotVenue>;

export const Side = z.enum(["long", "short"]);
export type Side = z.infer<typeof Side>;

const usd = z.number().positive().finite();
const pct = z.number().positive().max(100);

/** How big a perp position is. "margin" is the collateral put up; "notional" is the full position size. */
export const PerpSizing = z.discriminatedUnion("type", [
  z.object({ type: z.literal("margin"), usd }),
  z.object({ type: z.literal("notional"), usd }),
]);
export type PerpSizing = z.infer<typeof PerpSizing>;

export const PerpOpenLeg = z.object({
  kind: z.literal("perp_open"),
  venue: z.literal("hyperliquid"),
  /** Venue symbol, e.g. "BTC", or "<dex>:<asset>" for builder-deployed markets like gold. */
  market: z.string().min(1).describe('Hyperliquid symbol from fren_markets, e.g. "BTC" or "xyz:GOLD" for builder-deployed markets.'),
  side: Side,
  sizing: PerpSizing.describe('"margin" = collateral the user puts up ("use $2000 as collateral"); "notional" = full position size.'),
  leverage: z.number().int().min(1).max(1000),
  /**
   * Stop loss as % of margin lost (ROE), the way traders say "stop at -15%".
   * The price move is stopLossPct / leverage, so -15% at 50x is a 0.3% move.
   */
  stopLossPct: pct.optional().describe("Stop loss as % of margin lost (ROE). 'Stop at -15%' means 15."),
  /** Take profit as % gained on margin (ROE). May exceed 100. */
  takeProfitPct: z.number().positive().max(10_000).optional().describe("Take profit as % gained on margin (ROE)."),
  /** The same exits in dollars of margin ("lose at most $25", "take $50 profit"). Parsing turns them into the percentages. */
  stopLossUsd: usd.optional().describe("Stop loss as dollars lost, when the owner says it in dollars: 'lose at most $25' means 25. Instead of stopLossPct."),
  takeProfitUsd: usd.optional().describe("Take profit as dollars gained, when the owner says it in dollars: 'take profit at $50 profit' means 50. Instead of takeProfitPct."),
  /** Absolute stop price. Use instead of stopLossPct when the user names a level. */
  stopPrice: z.number().positive().optional().describe("Absolute stop price, when the user names a level."),
  /** Absolute take-profit price. */
  takeProfitPrice: z.number().positive().optional().describe("Absolute take-profit price."),
  maxSlippagePct: z.number().positive().max(10).default(1),
});
export type PerpOpenLeg = z.infer<typeof PerpOpenLeg>;

export const PerpCloseLeg = z.object({
  kind: z.literal("perp_close"),
  venue: z.literal("hyperliquid"),
  market: z.string().min(1),
  /** Share of the open position to close, 0 < fraction <= 1. */
  fraction: z.number().gt(0).max(1).default(1),
  maxSlippagePct: z.number().positive().max(10).default(1),
});
export type PerpCloseLeg = z.infer<typeof PerpCloseLeg>;

export const SwapAmount = z.discriminatedUnion("type", [
  /** Spend this many USD (of USDC) on a buy. */
  z.object({ type: z.literal("usd"), usd }),
  /** Sell this share of the current token balance. */
  z.object({ type: z.literal("fraction"), fraction: z.number().gt(0).max(1) }),
]);
export type SwapAmount = z.infer<typeof SwapAmount>;

/** A swap can also sell an exact number of tokens ("sell 1.5 SOL"). */
export const SwapLegAmount = z.discriminatedUnion("type", [
  ...SwapAmount.options,
  /** Sell exactly this many tokens (in whole tokens, not dollars). */
  z.object({ type: z.literal("tokens"), tokens: z.number().positive().finite() }),
]);
export type SwapLegAmount = z.infer<typeof SwapLegAmount>;

export const SwapLeg = z.object({
  kind: z.literal("swap"),
  venue: SpotVenue.describe('"jupiter" for Solana tokens (pump.fun included), "relay" for tokens on Base, Robinhood Chain or Arbitrum.'),
  /** Where the token lives. Jupiter is always Solana; Relay needs an EVM chain. */
  chain: Chain.default("solana").describe('Chain the token lives on. "solana" with jupiter; "base", "robinhood" or "arbitrum" with relay. Leave it out for a 0x address when the owner did not name the chain: Fren finds it.'),
  side: z.enum(["buy", "sell"]),
  /** Token mint or contract address (preferred) or a well-known symbol such as "SOL" or "JUP". */
  token: z.string().min(1).describe("Token mint / contract address (CA) or a ticker. Tickers only resolve to verified tokens."),
  amount: SwapLegAmount.describe(
    'Buys: {type:"usd"} spends that much USDC. Sells: {type:"tokens", tokens} for a number of tokens ("sell 1.5 SOL" is tokens 1.5), {type:"fraction"} of the balance, or {type:"usd"} only when the user names a dollar amount ("sell $50 of SOL").',
  ),
  maxSlippageBps: z.number().int().min(1).max(5000).default(100),
});
export type SwapLeg = z.infer<typeof SwapLeg>;

/**
 * Buy an option on Derive, or sell one Fren already holds. Fren never writes
 * (sells short) options: the most a buy can lose is the premium paid.
 */
export const OptionLeg = z.object({
  kind: z.literal("option"),
  venue: z.literal("derive"),
  side: z.enum(["buy", "sell"]),
  /** Derive instrument name, e.g. "ETH-20261225-4000-C". Get it from fren_bet_quote or fren_markets. */
  instrument: z
    .string()
    .regex(/^[A-Z0-9]+-\d{8}-\d+(\.\d+)?-[CP]$/, 'Derive option name like "ETH-20261225-4000-C"')
    .describe('Derive option name "<ASSET>-<YYYYMMDD expiry>-<strike>-<C|P>", from fren_bet_quote.'),
  amount: SwapAmount.describe('Buys: {type:"usd"} is the premium to spend. Sells: {type:"fraction"} of the contracts held.'),
  /** Pay at most this much over the best ask (or take this much under the best bid), in percent. */
  maxSlippagePct: z.number().positive().max(25).default(5),
});
export type OptionLeg = z.infer<typeof OptionLeg>;

/** Buy shares of a Polymarket outcome, or sell shares Fren holds. Each share pays $1 if that outcome wins. */
export const PredictionLeg = z.object({
  kind: z.literal("prediction"),
  venue: z.literal("polymarket"),
  side: z.enum(["buy", "sell"]),
  /** Polymarket market slug (preferred) or condition id. */
  market: z.string().min(1).describe("Polymarket market slug from fren_bet_quote or fren_markets."),
  outcome: z.string().min(1).default("Yes").describe('Outcome to buy or sell: "Yes", "No", or the outcome name.'),
  amount: SwapAmount.describe('Buys: {type:"usd"} to spend. Sells: {type:"fraction"} of the shares held.'),
  /** Buys: never pay more than this per share (0 to 1). Sells: never take less. */
  limitPrice: z.number().gt(0).lt(1).optional().describe("Buys: most to pay per share (0-1). Sells: least to accept."),
});
export type PredictionLeg = z.infer<typeof PredictionLeg>;

/** Where Fren can lend USDC out for interest. */
export const YieldProtocol = z.enum(["jupiter_lend", "kamino", "aave_arbitrum", "aave_base"]);
export type YieldProtocol = z.infer<typeof YieldProtocol>;

/**
 * Lend the owner's USDC for interest, or take it back. Deposits stay the
 * owner's: they come back with a withdraw, to the same wallet.
 */
export const EarnLeg = z.object({
  kind: z.literal("earn"),
  venue: z.literal("yield"),
  action: z.enum(["deposit", "withdraw"]),
  /** Omit for the best current rate (deposits) or wherever the money is (withdrawals). */
  protocol: YieldProtocol.optional().describe(
    'Omit to use the best rate on a deposit, or to take from wherever the money is on a withdraw. Name one only if the owner did, or to follow fren_yield.',
  ),
  amount: SwapAmount.describe('{type:"usd"} for an amount, or {type:"fraction"}: of the wallet\'s USDC on a deposit, of what is lent out on a withdraw.'),
});
export type EarnLeg = z.infer<typeof EarnLeg>;

export const Leg = z.discriminatedUnion("kind", [PerpOpenLeg, PerpCloseLeg, SwapLeg, OptionLeg, PredictionLeg, EarnLeg]);
export type Leg = z.infer<typeof Leg>;

export const Comparator = z.enum([">", ">=", "<", "<="]);
export type Comparator = z.infer<typeof Comparator>;

export const Condition = z.discriminatedUnion("type", [
  /** Mark/mid price of a market crosses a level. */
  z.object({
    type: z.literal("price"),
    venue: Venue,
    market: z.string().min(1),
    op: Comparator,
    value: z.number().positive(),
  }),
  /** Hyperliquid hourly funding rate, in percent (0.01 means 0.01%/h). */
  z.object({
    type: z.literal("funding"),
    venue: z.literal("hyperliquid"),
    market: z.string().min(1),
    op: Comparator,
    value: z.number().describe("Hourly funding in percent: 0.02 means 0.02%/h."),
  }),
  /**
   * Fires once the token can actually be bought: the launch snipe. Checked
   * every couple of seconds, not every watcher tick.
   */
  z.object({
    type: z.literal("tradable"),
    venue: SpotVenue,
    chain: Chain.default("solana"),
    token: z.string().min(1).describe("Contract address that isn't trading yet."),
  }),
  /** Fire at or after a point in time. */
  z.object({
    type: z.literal("time"),
    after: z.iso.datetime({ offset: true }),
  }),
]);
export type Condition = z.infer<typeof Condition>;

export const PlanStep = z.object({
  leg: Leg,
  /** Every condition must hold before the leg fires. Empty means fire now. */
  when: z.array(Condition).max(8).default([]).describe("All must hold before the leg fires. Omit or [] to fire now."),
  /** Conditional legs that have not fired by this time are dropped. */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type PlanStep = z.infer<typeof PlanStep>;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const Plan = z.object({
  version: z.literal(PLAN_VERSION).default(PLAN_VERSION),
  /** The user's request, quoted, so the echo and logs show what was asked. */
  request: z.string().max(2000).describe("The user's message, quoted verbatim."),
  steps: z.array(PlanStep).min(1).max(10),
}).superRefine((plan, ctx) => {
  plan.steps.forEach((step, i) => {
    const leg = step.leg;
    if (leg.kind === "perp_open") {
      const margin = perpMargin(leg);
      if (leg.stopLossUsd !== undefined && leg.stopLossPct !== undefined) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "leg", "stopLossUsd"], message: "give the stop as stopLossUsd or stopLossPct, not both" });
      }
      if (leg.takeProfitUsd !== undefined && leg.takeProfitPct !== undefined) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "leg", "takeProfitUsd"], message: "give the target as takeProfitUsd or takeProfitPct, not both" });
      }
      if (leg.stopLossUsd !== undefined && leg.stopLossUsd > margin) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "leg", "stopLossUsd"], message: `a $${leg.stopLossUsd} stop is more than the $${margin} margin; liquidation comes first` });
      }
      if (leg.takeProfitUsd !== undefined && leg.takeProfitUsd > margin * 100) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "leg", "takeProfitUsd"], message: "take profit is over 100x the margin" });
      }
    }
    const pairs: { venue: SpotVenue; chain: Chain; token: string; path: (string | number)[] }[] = [];
    if (step.leg.kind === "swap") pairs.push({ venue: step.leg.venue, chain: step.leg.chain, token: step.leg.token, path: ["steps", i, "leg", "chain"] });
    step.when.forEach((c, j) => {
      if (c.type === "tradable") pairs.push({ venue: c.venue, chain: c.chain, token: c.token, path: ["steps", i, "when", j, "chain"] });
    });
    for (const p of pairs) {
      // A 0x contract with no chain given: Fren looks up which EVM chain it is on.
      if (EVM_ADDRESS.test(p.token.trim())) continue;
      if (p.venue === "jupiter" && p.chain !== "solana") {
        ctx.addIssue({ code: "custom", path: p.path, message: `jupiter only trades Solana tokens; use venue "relay" for ${p.chain}` });
      }
      if (p.venue === "relay" && p.chain === "solana") {
        ctx.addIssue({ code: "custom", path: p.path, message: 'relay needs an EVM chain: "base", "robinhood" or "arbitrum"' });
      }
    }
  });
});
export type Plan = z.infer<typeof Plan>;
export type PlanInput = z.input<typeof Plan>;

/** A perp's margin: what the owner puts up, and what dollar stops and targets are measured against. */
export function perpMargin(leg: Pick<PerpOpenLeg, "sizing" | "leverage">): number {
  return leg.sizing.type === "margin" ? leg.sizing.usd : leg.sizing.usd / leg.leverage;
}

const pctOf = (usd: number, margin: number) => Math.round((usd / margin) * 100 * 100) / 100;

/** Dollar stops and targets become the percentages the rest of Fren reads. */
function exitsAsPct(plan: Plan): Plan {
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const leg = step.leg;
      if (leg.kind !== "perp_open" || (leg.stopLossUsd === undefined && leg.takeProfitUsd === undefined)) return step;
      const { stopLossUsd, takeProfitUsd, ...rest } = leg;
      const margin = perpMargin(leg);
      return {
        ...step,
        leg: {
          ...rest,
          ...(stopLossUsd !== undefined ? { stopLossPct: pctOf(stopLossUsd, margin) } : {}),
          ...(takeProfitUsd !== undefined ? { takeProfitPct: pctOf(takeProfitUsd, margin) } : {}),
        },
      };
    }),
  };
}

export function parsePlan(input: unknown): Plan {
  return exitsAsPct(Plan.parse(input));
}

export function safeParsePlan(input: unknown) {
  const r = Plan.safeParse(input);
  return r.success ? { ...r, data: exitsAsPct(r.data) } : r;
}
