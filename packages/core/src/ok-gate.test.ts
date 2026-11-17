import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "./limits.js";
import { parsePlan } from "./plan.js";
import { evaluatePolicy, type ResolvedStep } from "./policy.js";

/** A sale spends $0, so it used to slip under the auto-approve level and run without the owner's code. */

const state = { spentTodayUsd: 0, openPositions: 0 };
const sale = (venue: "jupiter" | "relay", token: string, amount: object, extra: Partial<ResolvedStep> = {}): ResolvedStep => {
  const chain = venue === "relay" ? { chain: "arbitrum" } : {};
  const plan = parsePlan({ request: "sell", steps: [{ leg: { kind: "swap", venue, ...chain, side: "sell", token, amount }, when: [] }] });
  return { index: 0, step: plan.steps[0]!, symbol: token, spendUsd: 0, notionalUsd: 0, ...extra };
};
const closeStep = (): ResolvedStep => {
  const plan = parsePlan({ request: "close", steps: [{ leg: { kind: "perp_close", venue: "hyperliquid", market: "BTC" }, when: [] }] });
  return { index: 0, step: plan.steps[0]!, symbol: "BTC", spendUsd: 0, notionalUsd: 0 };
};
const at = (autoApproveUsd: number) => ({ ...DEFAULT_LIMITS, mode: "live" as const, autoApproveUsd });

const cases: [string, () => ResolvedStep][] = [
  ["SOL on Jupiter, in dollars", () => sale("jupiter", "SOL", { type: "usd", usd: 12 }, { sellUsd: 12 })],
  ["SOL on Jupiter, a fraction", () => sale("jupiter", "SOL", { type: "fraction", fraction: 1 })],
  ["ETH on Relay, in dollars", () => sale("relay", "ETH", { type: "usd", usd: 28 }, { sellUsd: 28 })],
  ["ETH on Relay, a fraction", () => sale("relay", "ETH", { type: "fraction", fraction: 0.9 })],
  ["a token on Relay", () => sale("relay", "0x1111111111111111111111111111111111111111", { type: "fraction", fraction: 1 })],
  ["a token on Jupiter", () => sale("jupiter", "So11111111111111111111111111111111111111112", { type: "fraction", fraction: 0.5 })],
];

describe("auto-approve $0 means every live trade waits for the owner's code", () => {
  for (const [name, mk] of cases) {
    it(`asks for the code on a sale of ${name}`, () => {
      expect(evaluatePolicy([mk()], at(0), state).verdict).toBe("confirm");
    });
  }

  it("asks for the code on closing a position", () => {
    expect(evaluatePolicy([closeStep()], at(0), state).verdict).toBe("confirm");
  });

  it("a step the owner already approved runs", () => {
    expect(evaluatePolicy([cases[0]![1]()], at(0), state, { preApproved: true }).verdict).toBe("execute");
  });
});

describe("with auto-approve above $0 a sale is measured by what it sells", () => {
  it("lets a small sale in dollars through", () => {
    expect(evaluatePolicy([sale("jupiter", "SOL", { type: "usd", usd: 12 }, { sellUsd: 12 })], at(100), state).verdict).toBe("execute");
  });
  it("asks for the code on a sale above the level", () => {
    expect(evaluatePolicy([sale("relay", "ETH", { type: "usd", usd: 400 }, { sellUsd: 400 })], at(100), state).verdict).toBe("confirm");
  });
  it("asks for the code when the value is unknown (a fraction of a balance)", () => {
    expect(evaluatePolicy([sale("relay", "ETH", { type: "fraction", fraction: 1 })], at(100), state).verdict).toBe("confirm");
  });
  it("keeps the old behavior for a small buy", () => {
    const plan = parsePlan({ request: "buy", steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: "SOL", amount: { type: "usd", usd: 20 } }, when: [] }] });
    expect(evaluatePolicy([{ index: 0, step: plan.steps[0]!, symbol: "SOL", spendUsd: 20, notionalUsd: 20 }], at(100), state).verdict).toBe("execute");
  });
});
