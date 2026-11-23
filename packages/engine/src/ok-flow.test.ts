import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localize } from "./i18n.js";
import { Store } from "./store.js";
import { buildTestFren } from "./testing.js";

/**
 * /ok without a code (22.11, the owner: "it asks me for /ok, I send it, then it wants a
 * code; I have no idea what code"). One waiting request: a bare /ok approves it. Several:
 * a numbered list, /ok N or /ok all. A request that ran out stops "waiting" everywhere.
 */

const goldLong = (margin: number, leverage = 10) => ({
  request: `long gold ${leverage}x with $${margin}`,
  steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:gold", side: "long", sizing: { type: "margin", usd: margin }, leverage } }],
});

function setup() {
  const t = buildTestFren({});
  t.store.setLimits({ ...t.store.getLimits(), autoApproveUsd: 0 });
  return t;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("/ok without a code", () => {
  it("nothing waiting: says so, no talk about codes", async () => {
    const t = setup();
    expect(await t.fren.approve("")).toBe("Nothing is waiting for your OK right now.");
  });

  it("one waiting: a bare /ok approves it, and the private message asks for nothing more than /ok", async () => {
    const t = setup();
    const res = await t.fren.submit(goldLong(100));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/Reply \/ok to go ahead\./);
    const priv = t.notifier.sent.at(-1)!;
    expect(priv).toMatch(/Reply \/ok within 10 min\.$/);
    expect(priv).not.toContain(t.store.livePending()[0]!.code);
    expect(await t.fren.approve("")).toMatch(/Bet on GOLD going up/);
    expect(t.store.paperPositions()).toHaveLength(1);
    expect(t.store.livePending()).toHaveLength(0);
  });

  it("the code still works when typed, and \"/ok.\" or a lower-case code too", async () => {
    const t = setup();
    await t.fren.changeLimits("maxTradeUsd=5000");
    const code = t.store.livePending()[0]!.code;
    expect(await t.fren.approve(`${code.toLowerCase()}.`)).toMatch(/Limits updated/);
  });

  it("two waiting: a numbered list with what each does and the money, then /ok 2 runs only the second", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.changeLimits("maxTradeUsd=5000");
    const menu = await t.fren.approve("");
    expect(menu).toMatch(/^2 requests are waiting for your OK:\n1\. Bet \$100 that GOLD goes up[^\n]*\n2\. Loosen your limits\nMoney they put in or move: \$100\nReply \/ok 1 for the first one, and so on, or \/ok all for all 2\.$/);
    expect(t.store.paperPositions()).toHaveLength(0);
    expect(await t.fren.approve("2")).toMatch(/Limits updated/);
    expect(t.fren.limits().maxTradeUsd).toBe(5000);
    expect(t.store.paperPositions()).toHaveLength(0);
    // The number stands for what was at that place in the list, not for what is second now.
    expect(await t.fren.approve("1")).toMatch(/Bet on GOLD going up/);
    expect(t.store.paperPositions()).toHaveLength(1);
  });

  it("a number without a list just shows the list; nothing runs", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.changeLimits("maxTradeUsd=5000");
    expect(await t.fren.approve("1")).toMatch(/^2 requests are waiting/);
    expect(t.store.paperPositions()).toHaveLength(0);
    expect(t.store.livePending()).toHaveLength(2);
  });
});

describe("/ok all", () => {
  it("first shows the list and the total, runs nothing; the second /ok all runs every one", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.submit(goldLong(150));
    const first = await t.fren.approve("all");
    expect(first).toMatch(/^Approve all 2\? They are:\n1\. Bet \$100 that GOLD[^\n]*\n2\. Bet \$150 that GOLD[^\n]*\nMoney they put in or move: \$250\nSend \/ok all again/);
    expect(t.store.paperPositions()).toHaveLength(0);
    const r = await t.fren.approveWithReceipt("all");
    expect(r.text).toMatch(/^1\. Bet \$100 that GOLD[^\n]*\n📝 Practice: Bet on GOLD going up[\s\S]*\n2\. Bet \$150 that GOLD[^\n]*\n📝 Practice: Bet on GOLD going up/);
    expect(r.receiptSent).toBeUndefined();
    expect(t.store.paperPositions()).toHaveLength(1); // one market, both bets add to the same position
    expect(t.store.paperUsdc()).toBeCloseTo(10_000 - 250);
    expect(t.store.livePending()).toHaveLength(0);
  });

  it("after a bare /ok list, /ok all runs at once", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.changeLimits("maxTradeUsd=5000");
    await t.fren.approve("");
    expect(await t.fren.approve("ВСЕ")).toMatch(/Limits updated/);
    expect(t.store.livePending()).toHaveLength(0);
    expect(t.fren.limits().maxTradeUsd).toBe(5000);
  });

  it("a request that came in after the list was shown: the list again, nothing runs blind", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.submit(goldLong(120));
    await t.fren.approve("all");
    await t.fren.submit(goldLong(130));
    expect(await t.fren.approve("all")).toMatch(/^Approve all 3\?/);
    expect(t.store.paperPositions()).toHaveLength(0);
  });

  it("each one is checked again: a day's cap reached halfway stops the rest", async () => {
    const t = setup();
    t.store.setLimits({ ...t.store.getLimits(), maxDailyUsd: 500 });
    await t.fren.submit(goldLong(300));
    await t.fren.submit(goldLong(300));
    await t.fren.approve("all");
    const out = await t.fren.approve("all");
    expect(out).toMatch(/^1\. Bet \$300 that GOLD[^\n]*\n📝 Practice: Bet on GOLD going up/);
    expect(out).toMatch(/\n2\. Bet \$300 that GOLD[^\n]*\nNot doing this after all:[\s\S]*over your daily cap of \$500/);
    expect(t.store.paperUsdc()).toBeCloseTo(10_000 - 300);
  });

  it("turning Fren back on goes first, so the plans behind it don't meet a paused Fren", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.stop(); // cancels the plan code
    await t.fren.requestResume();
    await t.fren.changeLimits("maxTradeUsd=5000");
    await t.fren.approve("all");
    const out = await t.fren.approve("all");
    expect(out).toMatch(/^1\. Turn Fren back on\n✅ Fren is back on/);
    expect(t.fren.limits().paused).toBe(false);
    expect(t.fren.limits().maxTradeUsd).toBe(5000);
  });

  it("/fren_stop cancels everything that waited, list or not", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.changeLimits("maxTradeUsd=5000");
    await t.fren.approve("all");
    await t.fren.stop();
    expect(await t.fren.approve("all")).toMatch(/^Nothing is waiting for your OK: the last request was cancelled \(\d\d:\d\d\):\n• /);
    expect(await t.fren.approve("")).toMatch(/^Nothing is waiting for your OK: the last request was cancelled/);
    expect(t.store.paperPositions()).toHaveLength(0);
    expect(t.fren.limits().maxTradeUsd).not.toBe(5000);
  });
});

describe("a request that ran out", () => {
  it("stops waiting everywhere: bare /ok and /status say so, the plan is closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    await t.fren.submit(goldLong(100));
    expect(await t.fren.status()).toMatch(/Waiting for your OK \(reply \/ok\):\n• Bet \$100 that GOLD goes up/);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await t.fren.approve("")).toMatch(/^Nothing is waiting for your OK: this request ran out at \d\d:\d\d .*\n• Bet \$100 that GOLD goes up[^\n]*\nWant it again\?/);
    expect(await t.fren.status()).not.toMatch(/Waiting for your OK|\/ok/);
    expect(t.store.plansWithStatus("pending_confirm")).toHaveLength(0);
    expect(t.store.paperPositions()).toHaveLength(0);
  });

  it("its code typed after it ran out: \"ran out\", not \"wrong\", and it doesn't count toward the lockout", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    await t.fren.changeLimits("maxTradeUsd=5000");
    const old = t.store.livePending()[0]!.code;
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await t.fren.changeLimits("maxTradeUsd=6000");
    expect(await t.fren.approve(old)).toMatch(/^That request ran out/);
    for (let i = 0; i < 4; i++) await t.fren.approve("ZZZZZZ");
    expect(await t.fren.approve("")).toMatch(/Limits updated/);
    expect(t.fren.limits().maxTradeUsd).toBe(6000);
  });

  it("a list number whose request ran out runs nothing else in its place", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    await t.fren.changeLimits("maxTradeUsd=5000");
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await t.fren.changeLimits("maxLeverage=40");
    await t.fren.approve("");
    vi.setSystemTime(Date.now() + 5 * 60_000); // the first one is gone now
    expect(await t.fren.approve("1")).toBe("That one already ran out.\nWaiting for your OK (reply /ok):\n• Loosen your limits");
    expect(t.fren.limits().maxTradeUsd).not.toBe(5000);
    expect(t.fren.limits().maxLeverage).not.toBe(40);
  });
});

describe("protection stays", () => {
  it("a wrong code with others waiting shows the list and still counts; five drop everything", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.changeLimits("maxTradeUsd=5000");
    expect(await t.fren.approve("ZZZZZZ")).toMatch(/^That code is wrong or expired\. These are waiting for your OK:\n1\./);
    expect(localize("That one already ran out.\nWaiting for your OK (reply /ok):\n• Loosen your limits", "ru")).toBe("Этот уже истёк.\nЖдёт твоего ок (ответь /ok):\n• Ослабить лимиты");
    for (let i = 0; i < 3; i++) await t.fren.approve("ZZZZZZ");
    expect(await t.fren.approve("ZZZZZZ")).toMatch(/Too many wrong codes/);
    expect(t.store.livePending()).toHaveLength(0);
    expect(await t.fren.approve("all")).toBe("Nothing is waiting for your OK right now.");
    expect(t.store.paperPositions()).toHaveLength(0);
  });

  it("text that only looks like all, or a code with junk, runs nothing", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.changeLimits("maxTradeUsd=5000");
    for (const junk of ["all; rm -rf", "ALL ALL", "1 2", "-1", "0", "99", "' OR 1=1 --"]) {
      expect(await t.fren.approve(junk), junk).not.toMatch(/✅|Limits updated|Bet on GOLD going up: /);
    }
    expect(t.store.paperPositions()).toHaveLength(0);
    expect(t.fren.limits().maxTradeUsd).not.toBe(5000);
  });

  it("the plan text is checked again at /ok: a plan already cancelled by /stop does not run", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    const code = t.store.livePending()[0]!.code;
    await t.fren.stop();
    expect(await t.fren.approve(code)).toMatch(/wrong or expired/);
    expect(t.store.paperPositions()).toHaveLength(0);
  });
});

describe("the words, in Russian", () => {
  it("list, total, waiting and ran-out lines", () => {
    const menu = ["2 requests are waiting for your OK:", "1. Loosen your limits", "2. Turn Fren back on + Close xyz:ANT at market", "Money they put in or move: $250.00", "Reply /ok 1 for the first one, and so on, or /ok all for all 2."].join("\n");
    const ru = localize(menu, "ru");
    expect(ru).toBe(
      ["Твоего ок ждут запросов: 2", "1. Ослабить лимиты", "2. Снова включить Fren + Закрыть xyz:ANT по рынку", "Всего денег в них: $250.00", "Ответь /ok 1 для первого и так далее, или /ok all для всех 2."].join("\n"),
    );
    expect(localize("Waiting for your OK (reply /ok):\n• Withdraw $5.00 USDC from Hyperliquid to your Arbitrum wallet", "ru")).toBe("Ждёт твоего ок (ответь /ok):\n• Вывести $5.00 USDC из Hyperliquid на твой кошелёк Arbitrum");
    expect(localize("Nothing is waiting for your OK now: that request ran out (codes last 10 minutes). Ask me again if you still want it.", "uk")).toMatch(/^Зараз нічого не чекає/);
    expect(localize("Reply /ok within 10 min.", "ru")).toBe("Ответь /ok в течение 10 мин.");
  });
});

describe("store", () => {
  it("an older database gets the label and dollar columns without losing waiting codes", () => {
    const file = join(mkdtempSync(join(tmpdir(), "fren-ok-")), "fren.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE pending (code TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, expires_at TEXT NOT NULL)");
    old.prepare("INSERT INTO pending VALUES (?, ?, ?, ?)").run("ABCDEF", "resume", "", new Date(Date.now() + 60_000).toISOString());
    old.close();
    const s = new Store(file, 10_000);
    expect(s.livePending().map((p) => p.code)).toEqual(["ABCDEF"]);
    s.putPending({ code: "GHJKMN", kind: "limits", payload: "{}", expiresAt: new Date(Date.now() + 60_000).toISOString(), label: "Loosen your limits", usd: 5 });
    expect(s.livePending()[1]).toMatchObject({ label: "Loosen your limits", usd: 5 });
  });
});

/**
 * 22.11 18:24–18:55, the owner: asked to withdraw from Kamino, tapped Approve on the
 * dashboard, later typed "ок" and heard a bare "nothing is waiting", while the model kept
 * saying the withdrawal still waited. Now /ok names how the last request ended, and the
 * model hears the engine's live state before every answer.
 */
describe("how the last request ended", () => {
  it("went through: /ok says it already went through, with the time and the proof link when there is one", async () => {
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.approve("");
    const out = await t.fren.approve("");
    expect(out).toMatch(/^Nothing is waiting for your OK: the last request already went through \(\d\d:\d\d\):\n• Bet \$100 that GOLD goes up/);
    expect(out).not.toMatch(/Want it again/);
    expect(localize(out, "ru")).toMatch(/^Сейчас ничего не ждёт твоего ок: последний запрос уже выполнен \(\d\d:\d\d\):/);
  });

  it("went through with an explorer link: the link is shown and given to the model", async () => {
    const t = setup();
    t.store.setKv("ok_last", JSON.stringify({ label: "Withdraw all from Kamino to USDC", outcome: "done", at: new Date().toISOString(), link: "https://solscan.io/tx/abc" }));
    const out = await t.fren.approve("");
    expect(out).toMatch(/• Withdraw all from Kamino to USDC\n🔗 https:\/\/solscan\.io\/tx\/abc$/);
    expect(t.fren.agentContext()).toMatch(/Last request: Withdraw all from Kamino to USDC\. It already went through.*proof: https:\/\/solscan\.io\/tx\/abc/);
  });

  it("ran out: /ok says when and offers to prepare it anew, and never runs it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    await t.fren.submit(goldLong(100));
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const out = await t.fren.approve("");
    expect(out).toMatch(/ran out at \d\d:\d\d/);
    expect(localize(out, "ru")).toMatch(/истёк в \d\d:\d\d .*\n• [^\n]+\nПовторить\? Напиши, и я подготовлю заново\.$/s);
    expect(await t.fren.approve("all")).toMatch(/ran out/);
    expect(t.store.paperPositions()).toHaveLength(0);
  });

  it("an old outcome (over a day) is forgotten: plain \"nothing is waiting\"", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = setup();
    await t.fren.submit(goldLong(100));
    await t.fren.approve("");
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    expect(await t.fren.approve("")).toBe("Nothing is waiting for your OK right now.");
  });

  it("the model hears the live state: nothing waiting is said plainly, a waiting request is named", async () => {
    const t = setup();
    expect(t.fren.agentContext()).toMatch(/Nothing is waiting for the owner's \/ok\. Never say that something waits for \/ok\./);
    await t.fren.submit(goldLong(100));
    expect(t.fren.agentContext()).toMatch(/Waiting for the owner's \/ok \(or the Approve button on the dashboard\): Bet \$100 that GOLD goes up/);
    await t.fren.approve("");
    const ctx = t.fren.agentContext();
    expect(ctx).toMatch(/Nothing is waiting for the owner's \/ok/);
    expect(ctx).toMatch(/Last request: Bet \$100 that GOLD goes up.*already went through/);
  });
});
