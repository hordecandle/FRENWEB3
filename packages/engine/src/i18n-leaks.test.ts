import { describe, expect, it } from "vitest";
import { describeConditionStatus, describeStep, type Condition, type Leg, type PlanStep } from "@fren/core";
import { localize, localizeChart } from "./i18n.js";
import { hasGlyph, renderTradeChart } from "./chart.js";

/**
 * Leak scanner: every kind of step the engine writes by itself, put through Russian and
 * Ukrainian. Anything left in English that isn't a name (a venue, a coin, a command) is a
 * leak: the owner reads "Вывести all your USDC из Kamino".
 */
const NAMES = new Set(
  "USDC USDT SOL ETH BTC JUP HYPE WIF BONK Solana Hyperliquid Jupiter Lend Kamino Relay Polymarket Derive Aave Arbitrum Base Robinhood Chain Fren Yes No Trump pump fun ok fren_stop fren_dashboard paper live TRUMP x".split(" "),
);
export function leaks(text: string): string[] {
  const words = text.replace(/https?:\/\/\S+/g, "").replace(/\/\w+/g, "").replace(/`[^`]*`/g, "").replace(/"[^"]*"|«[^»]*»/g, "").match(/[A-Za-z][A-Za-z']+/g) ?? [];
  return words.filter((w) => !NAMES.has(w) && !/^[A-Z0-9]{2,6}$/.test(w));
}

const usd = (n: number) => ({ type: "usd" as const, usd: n });
const frac = (f: number) => ({ type: "fraction" as const, fraction: f });
const legs: Leg[] = [
  { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "long", sizing: { type: "margin", usd: 20 }, leverage: 5, stopLossPct: 20, takeProfitPct: 40 } as Leg,
  { kind: "perp_open", venue: "hyperliquid", market: "ETH", side: "short", sizing: { type: "margin", usd: 20 }, leverage: 3 } as Leg,
  { kind: "perp_open", venue: "hyperliquid", market: "SOL", side: "long", sizing: { type: "margin", usd: 20 }, leverage: 3, stopLossUsd: 5, takeProfitUsd: 10 } as Leg,
  { kind: "perp_open", venue: "hyperliquid", market: "SOL", side: "long", sizing: { type: "margin", usd: 20 }, leverage: 3, stopPrice: 120, takeProfitPrice: 200 } as Leg,
  { kind: "perp_close", venue: "hyperliquid", market: "BTC", fraction: 1 } as Leg,
  { kind: "perp_close", venue: "hyperliquid", market: "BTC", fraction: 0.5 } as Leg,
  { kind: "swap", venue: "jupiter", chain: "solana", token: "JUP", side: "buy", amount: usd(3) } as Leg,
  { kind: "swap", venue: "jupiter", chain: "solana", token: "JUP", side: "buy", amount: frac(0.25) } as Leg,
  { kind: "swap", venue: "jupiter", chain: "solana", token: "JUP", side: "buy", amount: { type: "tokens", tokens: 10 } } as Leg,
  { kind: "swap", venue: "jupiter", chain: "solana", token: "JUP", side: "sell", amount: frac(0.5) } as Leg,
  { kind: "swap", venue: "jupiter", chain: "solana", token: "JUP", side: "sell", amount: usd(5) } as Leg,
  { kind: "swap", venue: "jupiter", chain: "solana", token: "JUP", side: "sell", amount: { type: "tokens", tokens: 1.5 } } as Leg,
  { kind: "swap", venue: "relay", chain: "base", token: "0x1234567890abcdef1234567890abcdef12345678", side: "buy", amount: usd(4) } as Leg,
  { kind: "option", venue: "derive", instrument: "ETH-20261225-4000-C", side: "buy", amount: usd(10) } as Leg,
  { kind: "option", venue: "derive", instrument: "ETH-20261225-4000-P", side: "buy", amount: frac(0.1) } as Leg,
  { kind: "option", venue: "derive", instrument: "ETH-20261225-4000-C", side: "sell", amount: frac(1) } as Leg,
  { kind: "option", venue: "derive", instrument: "ETH-20261225-4000-C", side: "sell", amount: usd(5) } as Leg,
  { kind: "prediction", venue: "polymarket", market: "Will BTC hit $150k?", outcome: "Yes", side: "buy", amount: usd(5) } as Leg,
  { kind: "prediction", venue: "polymarket", market: "Will BTC hit $150k?", outcome: "No", side: "buy", amount: frac(0.2), limitPrice: 0.4 } as Leg,
  { kind: "prediction", venue: "polymarket", market: "Will BTC hit $150k?", outcome: "Yes", side: "sell", amount: frac(1) } as Leg,
  { kind: "prediction", venue: "polymarket", market: "Will BTC hit $150k?", outcome: "Yes", side: "sell", amount: usd(3) } as Leg,
  { kind: "earn", venue: "yield", action: "deposit", amount: usd(5) } as Leg,
  { kind: "earn", venue: "yield", action: "deposit", protocol: "kamino", amount: frac(0.5) } as Leg,
  { kind: "earn", venue: "yield", action: "withdraw", protocol: "kamino", amount: frac(1) } as Leg,
  { kind: "earn", venue: "yield", action: "withdraw", amount: frac(0.3) } as Leg,
  { kind: "earn", venue: "yield", action: "withdraw", protocol: "aave_base", amount: usd(2) } as Leg,
];
const conds: Condition[] = [
  { type: "price", market: "BTC", op: "<", value: 90000 } as Condition,
  { type: "funding", market: "ETH", op: ">", value: 0.01 } as Condition,
  { type: "tradable", venue: "jupiter", chain: "solana", token: "WIF" } as Condition,
  { type: "tradable", venue: "relay", chain: "base", token: "0x1234567890abcdef1234567890abcdef12345678" } as Condition,
  { type: "time", after: "2026-12-01T10:00:00Z" } as Condition,
];

export const samples: string[] = [];
for (const leg of legs) for (const icon of ["🟡", "🟢", "❌"]) samples.push(`${icon} ${describeStep({ leg, when: [] } as PlanStep)}`);
for (const c of conds) samples.push(`🟡 ${describeStep({ leg: legs[6]!, when: [c] } as PlanStep)}`);
for (const c of conds) for (const met of [true, false]) samples.push(describeConditionStatus({ condition: c, met, current: met ? null : c.type === "tradable" ? "not yet" : 1 } as never));
for (const leg of legs) samples.push(`• ${describeStep({ leg, when: [] } as PlanStep)}`, `2. ${describeStep({ leg, when: [] } as PlanStep)}`);

describe("nothing the engine writes about a step stays half in English", () => {
  for (const lang of ["ru", "uk"] as const)
    it(lang, () => {
      const bad = samples.map((s) => ({ s, out: localize(s, lang) })).filter((x) => leaks(x.out).length);
      expect(bad.map((b) => `${b.s}\n  → ${b.out}\n  leaks: ${leaks(b.out).join(", ")}`)).toEqual([]);
    });
});

describe("what the engine writes by itself (/status, /wallet, /limits) comes out in the owner's language", async () => {
  const { buildTestFren } = await import("./testing.js");
  const { describeLimits } = await import("./engine.js");
  for (const lang of ["ru", "uk"] as const)
    it(lang, async () => {
      const t = buildTestFren();
      t.fren.setOwnerLang(lang);
      const texts = [await t.fren.status(), (await t.fren.wallet()).text, describeLimits(t.fren.limits())].map((x) => t.fren.localize(x));
      const bad = texts.flatMap((x) => x.split("\n")).filter((l) => leaks(l).length);
      expect(bad).toEqual([]);
    });
});

describe("the chart picture speaks the owner's language", () => {
  const close = {
    source: { kind: "hyperliquid" as const, coin: "BTC" },
    title: "BTC long stop hit",
    subtitle: "Result -$4.20 · entry $97,000 · exit $95,000",
    levels: [
      { kind: "entry" as const, price: 97000, label: "ENTRY" },
      { kind: "exit" as const, price: 95000, label: "EXIT" },
    ],
    marks: [],
  };
  const open = { ...close, title: "long BTC 5x", subtitle: "$20 in · 5× boost · moves like $100 of BTC", levels: [{ kind: "stop" as const, price: 9, label: "STOP" }, { kind: "target" as const, price: 9, label: "TARGET" }, { kind: "liq" as const, price: 9, label: "LIQ" }] };
  const view = { ...close, title: "BTC $97,000", subtitle: "6h · Hyperliquid perp · your long 0.01, PnL +$1.00 (paper)", levels: [] };
  const swap = { ...close, title: "Bought WIF", subtitle: "120 WIF for $50 at $0.41", levels: [{ kind: "entry" as const, price: 0.41, label: "BUY" }] };
  for (const lang of ["ru", "uk"] as const)
    it(lang, () => {
      for (const c of [close, open, view, swap]) {
        const l = localizeChart(c, lang);
        const words = [l.title, l.subtitle ?? "", ...l.levels.map((v) => v.label)];
        expect(words.flatMap((w) => leaks(w))).toEqual([]);
        // Every letter has a glyph, so nothing drops out of the picture as a blank.
        for (const w of words) for (const ch of w.toUpperCase()) expect(hasGlyph(ch), `${ch} in ${w}`).toBe(true);
        expect(renderTradeChart({ ...l, candles: [{ t: 0, o: 1, h: 2, l: 0.5, c: 1.5 }, { t: 60_000, o: 1.5, h: 2, l: 1, c: 1.8 }] }).length).toBeGreaterThan(1000);
      }
    });
});
