import { describe, expect, it } from "vitest";
import { evaluateAll } from "./conditions.js";
import { safeParsePlan } from "./plan.js";
import { qty, shortToken } from "./render.js";

describe("Plan schema", () => {
  it("accepts the brief's two-leg example", () => {
    const r = safeParsePlan({
      request: "$300 gold 20x long, stop -4%, and short SOL $200 when funding goes above 0.02%/h",
      steps: [
        {
          leg: {
            kind: "perp_open",
            venue: "hyperliquid",
            market: "xyz:GOLD",
            side: "long",
            sizing: { type: "margin", usd: 300 },
            leverage: 20,
            stopLossPct: 4,
          },
        },
        {
          leg: {
            kind: "perp_open",
            venue: "hyperliquid",
            market: "SOL",
            side: "short",
            sizing: { type: "margin", usd: 200 },
            leverage: 5,
          },
          when: [{ type: "funding", venue: "hyperliquid", market: "SOL", op: ">", value: 0.02 }],
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data?.steps[0]?.when).toEqual([]);
    expect(r.data?.steps[0]?.leg.kind === "perp_open" && r.data.steps[0].leg.maxSlippagePct).toBe(1);
  });

  it("rejects unknown venues and negative sizes", () => {
    expect(
      safeParsePlan({
        request: "x",
        steps: [{ leg: { kind: "swap", venue: "uniswap", side: "buy", token: "X", amount: { type: "usd", usd: 5 } } }],
      }).success,
    ).toBe(false);
    expect(
      safeParsePlan({
        request: "x",
        steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: "X", amount: { type: "usd", usd: -5 } } }],
      }).success,
    ).toBe(false);
  });
});

describe("conditions", () => {
  it("needs every condition to hold and treats missing data as not met", () => {
    const snap = {
      now: new Date("2026-10-19T12:00:00Z"),
      prices: new Map([["hyperliquid:BTC", 101_000]]),
      funding: new Map<string, number>(),
    };
    const res = evaluateAll(
      [
        { type: "price", venue: "hyperliquid", market: "BTC", op: ">", value: 100_000 },
        { type: "funding", venue: "hyperliquid", market: "BTC", op: "<", value: 0 },
      ],
      snap,
    );
    expect(res.statuses[0]!.met).toBe(true);
    expect(res.statuses[1]!.met).toBe(false);
    expect(res.statuses[1]!.current).toBeNull();
    expect(res.allMet).toBe(false);
  });
});

describe("stops and targets in dollars", () => {
  const leg = (extra: Record<string, unknown>, sizing: Record<string, unknown> = { type: "margin", usd: 50 }) => ({
    request: "long ANT $50 10x, lose at most $25, take $50",
    steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:ANT", side: "long", sizing, leverage: 10, ...extra } }],
  });
  const exits = (r: ReturnType<typeof safeParsePlan>) => {
    const l = r.data?.steps[0]?.leg;
    return l?.kind === "perp_open" ? { sl: l.stopLossPct, tp: l.takeProfitPct, slUsd: l.stopLossUsd, tpUsd: l.takeProfitUsd } : null;
  };

  it("become % of margin: -$25 and +$50 on $50 margin are -50% and +100%", () => {
    const r = safeParsePlan(leg({ stopLossUsd: 25, takeProfitUsd: 50 }));
    expect(r.success).toBe(true);
    expect(exits(r)).toEqual({ sl: 50, tp: 100, slUsd: undefined, tpUsd: undefined });
  });

  it("measure against the margin when the size is given as the position", () => {
    expect(exits(safeParsePlan(leg({ stopLossUsd: 10 }, { type: "notional", usd: 1000 })))).toMatchObject({ sl: 10 });
  });

  it("refuse a stop bigger than the margin, or a stop given twice", () => {
    expect(safeParsePlan(leg({ stopLossUsd: 60 })).error?.issues[0]?.message).toMatch(/more than the \$50 margin/);
    expect(safeParsePlan(leg({ stopLossUsd: 25, stopLossPct: 50 })).error?.issues[0]?.message).toMatch(/not both/);
  });
});

describe("chat rendering of token amounts and well-known mints", () => {
  it("formats amounts the way receipts do", () => {
    expect(qty(9518221.87978339)).toBe("9,518,222");
    expect(qty(1.23456789)).toBe("1.2346");
    expect(qty(0.14458713349746333)).toBe("0.1446");
  });
  it("names SOL and USDC instead of their mints", () => {
    expect(shortToken("So11111111111111111111111111111111111111112")).toBe("SOL");
    expect(shortToken("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("USDC");
  });
});
