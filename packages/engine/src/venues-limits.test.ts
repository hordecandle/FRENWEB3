import { describe, expect, it } from "vitest";
import { buildTestFren } from "./testing.js";
import { SOL_MINT } from "./venues/jupiter.js";

const btcLong = (extra: Record<string, unknown> = {}) => ({
  request: "long BTC",
  steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "long", sizing: { type: "margin", usd: 50 }, leverage: 5, ...extra } }],
});

const solBuy = (usd = 30) => ({
  request: "buy SOL",
  steps: [{ leg: { kind: "swap", venue: "jupiter", chain: "solana", side: "buy", token: "SOL", amount: { type: "usd", usd } } }],
});

describe("Hyperliquid: light prices, no hammering", () => {
  it("watches prices with one light request per dex and loads the heavy list rarely", async () => {
    const t = buildTestFren({ hlMarkets: { ttlMs: 60_000 } });
    t.fake.builder.flx = [{ name: "flx:OIL", mid: 80, maxLeverage: 10, szDecimals: 2 }]; // not wanted: only xyz + main
    await t.fren.submit(btcLong({ stopLossPct: 20 }));
    for (let i = 0; i < 10; i++) {
      t.clock.t += 5_000; // 10 passes in under a minute
      await t.fren.tick();
    }
    expect(t.fake.hlCalls.perpDexs).toBe(1);
    expect(t.fake.hlCalls.metaAndAssetCtxs).toBe(2); // main + xyz, once, not flx
    expect(t.fake.hlCalls.allMids).toBeGreaterThanOrEqual(20); // main + xyz on each pass
    const search = await t.fren.searchMarkets("oil");
    expect(JSON.stringify(search)).not.toMatch(/flx:OIL/);
  });

  it("a stop fires from the light prices", async () => {
    const t = buildTestFren({ hlMarkets: { ttlMs: 60_000 } });
    await t.fren.submit(btcLong({ stopLossPct: 20 }));
    expect(t.store.paperPositions()).toHaveLength(1);
    t.fake.setMid("BTC", 90_000);
    await t.fren.tick();
    expect(t.store.paperPositions()).toHaveLength(0);
    expect(t.notifier.sent.at(-1)).toMatch(/Stop hit, closed the BTC up bet/);
  });

  it("on a 429 it backs off, warns the owner once, and says when prices are back", async () => {
    const t = buildTestFren({ hlMarkets: { ttlMs: 60_000, backoffMs: 10_000 } });
    await t.fren.submit(btcLong({ stopLossPct: 20 }));
    t.fake.hlStatus = 429;
    t.fake.setMid("BTC", 90_000); // the stop is hit, but nobody can see it
    await t.fren.tick();
    expect(t.notifier.sent.filter((m) => /can't get Hyperliquid prices/.test(m))).toHaveLength(0); // one blip is not news
    t.clock.t += 20_000;
    await t.fren.tick();
    t.clock.t += 20_000;
    await t.fren.tick();
    const warnings = t.notifier.sent.filter((m) => /can't get Hyperliquid prices/.test(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/can't watch your stops/);
    expect(t.store.paperPositions()).toHaveLength(1); // nothing fired blind

    // While we are in the pause we don't touch the API at all.
    t.clock.t += 1_000;
    const before = Object.values(t.fake.hlCalls).reduce((a, b) => a + b, 0);
    await t.fren.tick();
    await t.fren.tick();
    expect(Object.values(t.fake.hlCalls).reduce((a, b) => a + b, 0)).toBe(before);
    expect(t.notifier.sent.filter((m) => /can't get Hyperliquid prices/.test(m))).toHaveLength(1);

    // Hyperliquid recovers: the warning is withdrawn and the stop, now visible, fires.
    t.fake.hlStatus = 200;
    t.clock.t += 130_000;
    await t.fren.tick();
    expect(t.notifier.sent.some((m) => /Hyperliquid prices are back/.test(m))).toBe(true);
    expect(t.store.paperPositions()).toHaveLength(0);
  });

  it("the pause doubles on repeated 429s", async () => {
    const t = buildTestFren({ hlMarkets: { ttlMs: 60_000, backoffMs: 10_000, maxBackoffMs: 40_000 } });
    t.fake.hlStatus = 429;
    const m = t.fren["d"].hyperliquid.markets;
    await m.mids().catch(() => {});
    expect(m.retryInSec).toBe(10);
    t.clock.t += 10_000;
    await m.mids().catch(() => {});
    expect(m.retryInSec).toBe(20);
    t.clock.t += 20_000;
    await m.mids().catch(() => {});
    await (async () => { t.clock.t += 40_000; await m.mids().catch(() => {}); })();
    expect(m.retryInSec).toBe(40); // capped
  });

  it("stays quiet when nothing depends on Hyperliquid prices", async () => {
    const t = buildTestFren();
    t.fake.hlStatus = 429;
    for (let i = 0; i < 4; i++) {
      t.clock.t += 200_000;
      await t.fren.tick();
    }
    expect(t.notifier.sent).toHaveLength(0);
  });

  it("serves the last market list for a while when the list request is rate-limited", async () => {
    const t = buildTestFren({ hlMarkets: { ttlMs: 1_000 } });
    const m = t.fren["d"].hyperliquid.markets;
    const first = await m.all();
    t.clock.t += 5_000;
    t.fake.hlStatus = 429;
    expect(await m.all()).toEqual(first);
    t.clock.t += 10 * 60_000;
    t.fake.hlStatus = 200;
    t.clock.t += 130_000; // pause over
    expect((await m.all()).length).toBe(first.length);
  });
});

describe("Jupiter: a rate limit is never a price", () => {
  it("paper SOL buy refuses instead of booking a wrong price when Jupiter answers 429", async () => {
    const t = buildTestFren();
    t.fake.jupStatus = 429;
    const res = await t.fren.submit(solBuy());
    expect(t.store.paperHoldings()).toHaveLength(0);
    expect(JSON.stringify(res)).not.toMatch(/0\.078/);
    // The plan either never opens or fails with a plain reason; no fill is recorded.
    expect(t.store.recentFills(5)).toHaveLength(0);
  });

  it("429 appearing between the check and the fill still gives the right price or a refusal", async () => {
    const t = buildTestFren();
    const ok = await t.fren.submit(solBuy());
    expect(ok.text).toMatch(/Bought 0\.1500 SOL/); // $30 at $200
    t.store.paperHoldings().forEach((h) => expect(h.mint).toBe(SOL_MINT));
    t.fake.jupStatus = 429;
    const again = await t.fren.submit(solBuy());
    expect(t.store.recentFills(5)).toHaveLength(1);
    expect(again.verdict === "rejected" || /No price|Jupiter/.test(again.text)).toBe(true);
  });

  it("an unknown token by address with no answer from Jupiter or the chain is refused", async () => {
    const t = buildTestFren();
    t.fake.jupStatus = 429;
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const res = await t.fren.submit({
      request: "buy",
      steps: [{ leg: { kind: "swap", venue: "jupiter", chain: "solana", side: "buy", token: mint, amount: { type: "usd", usd: 10 } } }],
    });
    expect(res.verdict).toBe("rejected");
    expect(t.store.paperHoldings()).toHaveLength(0);
  });

  it("retries a 429 once or twice before giving up", async () => {
    const t = buildTestFren();
    let n = 0;
    const real = t.fake.fetch;
    const jup = t.fren["d"].jupiter as unknown as { o: { fetchFn: typeof fetch } };
    jup.o.fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).includes("/price/v3") && n++ < 2) return new Response("rate", { status: 429 });
      return real(input as never, init);
    }) as typeof fetch;
    const px = await t.fren["d"].jupiter.prices([SOL_MINT]);
    expect(px.get(SOL_MINT)).toBe(200);
    expect(n).toBe(3);
  });
});
