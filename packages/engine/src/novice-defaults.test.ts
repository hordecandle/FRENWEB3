import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, NOVICE_LIMITS, isTightening, parsePlan, startingLimits, withDefaultStops } from "@fren/core";
import { Store } from "./store.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "fren-novice-"));
  dirs.push(d);
  return join(d, "fren.db");
};
afterEach(() => {
  delete process.env.FREN_NOVICE_DEFAULTS;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("safer limits for new installs", () => {
  it("are the default now; FREN_NOVICE_DEFAULTS=0 brings back the wide ones", () => {
    expect(startingLimits({})).toBe(NOVICE_LIMITS);
    expect(startingLimits({ FREN_NOVICE_DEFAULTS: "1" })).toBe(NOVICE_LIMITS);
    expect(startingLimits({ FREN_NOVICE_DEFAULTS: "0" })).toBe(DEFAULT_LIMITS);
    expect(NOVICE_LIMITS).toMatchObject({ mode: "paper", maxLeverage: 3, maxTradeUsd: 100, maxDailyUsd: 300, maxOpenPositions: 3, autoApproveUsd: 0, defaultStopLossPct: 30 });
    expect(NOVICE_LIMITS.allowedVenues).not.toContain("derive");
  });

  it("a brand-new database starts on them and keeps them after a restart", () => {
    const path = tmp();
    const a = new Store(path);
    expect(a.getLimits()).toEqual(NOVICE_LIMITS);
    a.db.close();
    expect(new Store(path).getLimits()).toEqual(NOVICE_LIMITS);
  });

  it("an existing install is not touched: a database without saved limits keeps the old defaults", () => {
    const path = tmp();
    process.env.FREN_NOVICE_DEFAULTS = "0"; // an install made before the change
    const old = new Store(path);
    old.db.exec("DELETE FROM kv WHERE key = 'limits'");
    old.db.close();
    delete process.env.FREN_NOVICE_DEFAULTS;
    expect(new Store(path).getLimits()).toEqual(DEFAULT_LIMITS);
  });

  it("an existing install with its own limits keeps them exactly", () => {
    const path = tmp();
    process.env.FREN_NOVICE_DEFAULTS = "0";
    const s = new Store(path);
    s.setLimits({ ...DEFAULT_LIMITS, mode: "live", maxTradeUsd: 50, autoApproveUsd: 5 });
    s.db.close();
    delete process.env.FREN_NOVICE_DEFAULTS;
    const again = new Store(path).getLimits();
    expect(again).toMatchObject({ mode: "live", maxTradeUsd: 50, autoApproveUsd: 5, maxLeverage: 20, defaultStopLossPct: 0 });
  });

  it("old saved limits (no defaultStopLossPct field) parse with the stop off", () => {
    const path = tmp();
    const s = new Store(path);
    const { defaultStopLossPct: _, ...legacy } = DEFAULT_LIMITS;
    s.setKv("limits", JSON.stringify(legacy));
    expect(s.getLimits().defaultStopLossPct).toBe(0);
  });

  it("turning the automatic stop off or widening it is loosening (needs the owner)", () => {
    expect(isTightening(NOVICE_LIMITS, { ...NOVICE_LIMITS, defaultStopLossPct: 0 })).toBe(false);
    expect(isTightening(NOVICE_LIMITS, { ...NOVICE_LIMITS, defaultStopLossPct: 60 })).toBe(false);
    expect(isTightening(NOVICE_LIMITS, { ...NOVICE_LIMITS, defaultStopLossPct: 20 })).toBe(true);
    expect(isTightening(DEFAULT_LIMITS, { ...DEFAULT_LIMITS, defaultStopLossPct: 25 })).toBe(true);
  });
});

describe("automatic stop on bets", () => {
  const plan = (leg: Record<string, unknown>) =>
    parsePlan({
      request: "long btc",
      steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "long", leverage: 3, sizing: { type: "margin", usd: 20 }, ...leg } }],
    });

  it("adds the stop when the bet has none", () => {
    const out = withDefaultStops(plan({}), NOVICE_LIMITS);
    expect(out.steps[0]!.leg).toMatchObject({ stopLossPct: 30 });
  });
  it("keeps the owner's own stop (percent, price or dollars)", () => {
    expect(withDefaultStops(plan({ stopLossPct: 10 }), NOVICE_LIMITS).steps[0]!.leg).toMatchObject({ stopLossPct: 10 });
    const byPrice = withDefaultStops(plan({ stopPrice: 50_000 }), NOVICE_LIMITS).steps[0]!.leg as { stopLossPct?: number; stopPrice?: number };
    expect(byPrice.stopPrice).toBe(50_000);
    expect(byPrice.stopLossPct).toBeUndefined();
    expect(withDefaultStops(plan({ stopLossUsd: 5 }), NOVICE_LIMITS).steps[0]!.leg).toMatchObject({ stopLossPct: 25 });
  });
  it("does nothing when the automatic stop is off", () => {
    const p = plan({});
    expect(withDefaultStops(p, DEFAULT_LIMITS)).toBe(p);
  });
});
