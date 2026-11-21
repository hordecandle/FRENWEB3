import { describe, expect, it } from "vitest";
import { detectLang, pauseMessage } from "./pause-text.js";
import { buildTestFren } from "./testing.js";

const goldLong = (margin: number) => ({
  request: `long gold with $${margin}`,
  steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:gold", side: "long", sizing: { type: "margin", usd: margin }, leverage: 10 } }],
});
const waitingBuy = {
  request: "long gold when it dips",
  steps: [{ when: [{ type: "price", venue: "hyperliquid", market: "xyz:gold", op: "<", value: 3000 }], leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:gold", side: "long", sizing: { type: "margin", usd: 20 }, leverage: 5 } }],
};

describe("pause (/fren_stop)", () => {
  it("keeps open positions, lists them, and names the close command (EN)", async () => {
    const t = buildTestFren({});
    await t.fren.submit(goldLong(50));
    const msg = await t.fren.stop();
    expect(t.fren.limits().paused).toBe(true);
    expect(t.store.paperPositions()).toHaveLength(1);
    expect(msg).toMatch(/Paused\. No new trades/);
    expect(msg).toMatch(/Still open:/);
    expect(msg).toMatch(/hyperliquid: xyz:GOLD long, size 0\.125, \$\d/);
    expect(msg).toMatch(/\/close_all/);
    expect(msg).toMatch(/\/resume/);
    expect(msg).not.toMatch(/Closed/);
  });

  it("cancels waiting entries but leaves the position", async () => {
    const t = buildTestFren({});
    await t.fren.submit(goldLong(50));
    const res = await t.fren.submit(waitingBuy as never);
    expect(t.store.plansWithStatus("active").length).toBeGreaterThan(0);
    const msg = await t.fren.stop();
    expect(t.store.plansWithStatus("active")).toHaveLength(0);
    expect(msg).toMatch(/Cancelled 1 waiting step/);
    expect(t.store.paperPositions()).toHaveLength(1);
    void res;
  });

  it("no positions: says so and doesn't offer /close_all", async () => {
    const t = buildTestFren({});
    const msg = await t.fren.stop();
    expect(msg).toMatch(/no open positions/);
    expect(msg).not.toMatch(/close_all/);
    expect(msg).toMatch(/\/resume/);
  });

  it("answers in Russian and Ukrainian, remembers the language, falls back to English", async () => {
    const t = buildTestFren({});
    await t.fren.submit(goldLong(50));
    const ru = await t.fren.stop("ru");
    expect(ru).toMatch(/Пауза включена/);
    expect(ru).toMatch(/Пока открыто:/);
    expect(ru).toMatch(/\/close_all/);
    expect(await t.fren.stop()).toMatch(/Пауза включена/); // no lang given: last known
    expect(await t.fren.stop("uk")).toMatch(/Пауза ввімкнена/);
    expect(await t.fren.stop("de")).toMatch(/Paused\./);
  });

  it("empty-position text exists in all languages; positions that failed to load are reported", () => {
    expect(pauseMessage("ru", 0, [])).toMatch(/Открытых позиций нет/);
    expect(pauseMessage("uk", 0, [])).toMatch(/Відкритих позицій немає/);
    expect(pauseMessage("en", 0, null)).toMatch(/couldn't load your positions/);
  });

  it("spot holdings get the sell hint, not the /close_all one", () => {
    const msg = pauseMessage("en", 0, [{ venue: "jupiter", symbol: "SOL", kind: "spot", side: "hold", size: 0.5, entryPx: null, markPx: 70, valueUsd: 35, pnlUsd: null }]);
    expect(msg).toMatch(/jupiter: SOL, size 0\.5, \$35/);
    expect(msg).toMatch(/sold only when you ask me/);
    expect(msg).not.toMatch(/close_all/);
  });

  it("detects the language of a chat message", () => {
    expect(detectLang("останови всё")).toBe("ru");
    expect(detectLang("зупини все, будь ласка, і гроші")).toBe("uk");
    expect(detectLang("stop everything")).toBe("en");
    expect(detectLang("ok")).toBeNull();
  });

  it("a bare /ok approves the one waiting code, and refuses when there are two", async () => {
    const t = buildTestFren({});
    await t.fren.changeLimits("maxTradeUsd=5000");
    expect(await t.fren.approve("")).toMatch(/Limits updated|updated|✅/);
    await t.fren.changeLimits("maxTradeUsd=6000");
    await t.fren.changeLimits("maxLeverage=40");
    expect(await t.fren.approve("")).toMatch(/Send \/ok followed by the code/);
  });
});

describe("pause: the watcher still runs exits", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const buySol = { request: "buy sol", steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: SOL, amount: { type: "usd", usd: 40 } } }] };
  const stopSell = {
    request: "sell sol if it drops",
    steps: [{ leg: { kind: "swap", venue: "jupiter", side: "sell", token: SOL, amount: { type: "fraction", fraction: 1 } }, when: [{ type: "price", venue: "jupiter", market: SOL, op: "<", value: 150 }] }],
  };
  const buyDip = {
    request: "buy sol on a dip",
    steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: SOL, amount: { type: "usd", usd: 10 } }, when: [{ type: "price", venue: "jupiter", market: SOL, op: "<", value: 150 }] }],
  };

  it("a waiting spot stop-sale fires while paused", async () => {
    const t = buildTestFren({});
    await t.fren.submit(buySol as never);
    expect(t.store.paperHoldings()).toHaveLength(1);
    await t.fren.submit(stopSell as never);
    await t.fren.stop();
    expect(t.store.plansWithStatus("active")).toHaveLength(1); // the exit was kept
    t.fake.tokens.find((x) => x.id === SOL)!.usdPrice = 140;
    await t.fren.tick();
    expect(t.store.paperHoldings()).toHaveLength(0);
    expect(t.fren.limits().paused).toBe(true);
  });

  it("a conditional buy does not fire while paused (it is cancelled by the pause)", async () => {
    const t = buildTestFren({});
    await t.fren.submit(buyDip as never);
    await t.fren.stop();
    t.fake.tokens.find((x) => x.id === SOL)!.usdPrice = 140;
    await t.fren.tick();
    expect(t.store.paperHoldings()).toHaveLength(0);
    expect(t.store.recentFills(10)).toHaveLength(0);
  });

  it("a buy that is still waiting when paused (not cancelled) never fires", async () => {
    const t = buildTestFren({});
    await t.fren.submit(buyDip as never);
    t.store.setLimits({ ...t.fren.limits(), paused: true }); // paused without stop(): nothing cancelled
    t.fake.tokens.find((x) => x.id === SOL)!.usdPrice = 140;
    await t.fren.tick();
    expect(t.store.paperHoldings()).toHaveLength(0);
    expect(t.store.recentFills(10)).toHaveLength(0);
  });

  it("a paper perp stop fires while paused", async () => {
    const t = buildTestFren({});
    await t.fren.submit({ ...goldLong(50), steps: [{ leg: { ...goldLong(50).steps[0]!.leg, leverage: 10, stopLossPct: 20 } }] } as never);
    await t.fren.stop();
    t.fake.setMid("xyz:GOLD", 3_900);
    await t.fren.tick();
    expect(t.store.paperPositions()).toHaveLength(0);
    expect(t.notifier.sent.at(-1)).toMatch(/Stop hit, closed the GOLD up bet/);
  });
});
