import { generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { PublicKey } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeMaxLoss, maxLoss } from "@fren/core";
import { Dashboard, type DashboardOptions } from "./dashboard.js";
import { MemoryChat, OpenClawChat, TIMED_OUT, okCommand, type ExecOut } from "./dashboard-chat.js";
import { buildTestFren } from "./testing.js";

let close: (() => void) | null = null;
afterEach(() => close?.());

async function start(opts: Partial<DashboardOptions> = {}) {
  const t = buildTestFren();
  let now = 1_000_000;
  const mail: { to: string; text: string }[] = [];
  const dash = new Dashboard(t.fren, {
    publicUrl: "https://1-2-3-4.sslip.io",
    now: () => now,
    mailer: { send: async (to, _s, text) => (mail.push({ to, text }), true) },
    ...opts,
  });
  const server = dash.server();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, cookie?: string) => fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const post = (path: string, body: unknown = {}, cookie = "") =>
    fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json", "x-fren": "1" }, body: JSON.stringify(body) });
  const login = async () => {
    const link = new URL(dash.newLink());
    const res = await get(link.pathname + link.search);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  return { ...t, dash, get, post, login, mail, tick: (ms: number) => (now += ms) };
}

const solanaWallet = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: new PublicKey(raw).toBase58(), sign: (m: string) => sign(null, Buffer.from(m, "utf8"), privateKey).toString("base64") };
};

describe("most you can lose", () => {
  it("says the money put in, the stop, and that a perp can borrow from the rest", () => {
    const perp = [{ index: 0, spendUsd: 200, step: { leg: { kind: "perp_open", stopLossPct: 10 } } }] as never;
    expect(maxLoss(perp)).toEqual({ usd: 200, withStopUsd: 20, borrowed: true });
    expect(describeMaxLoss(perp)).toMatch(/most you can lose: \$200.*stop should cut it at about \$20.*other money you keep on Hyperliquid/s);
    expect(describeMaxLoss([{ index: 0, spendUsd: 50, step: { leg: { kind: "swap" } } }] as never)).toMatch(/most you can lose: \$50/);
  });

  it("goes with every trade that waits for /ok", async () => {
    const t = buildTestFren();
    t.store.setLimits({ ...t.store.getLimits(), autoApproveUsd: 10 });
    const r = await t.fren.submit({ request: "short BTC", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "short", sizing: { type: "margin", usd: 200 }, leverage: 5, stopLossPct: 10 } }] });
    expect(r.verdict).toBe("needs_code");
    expect(t.notifier.sent.join("\n")).toMatch(/🧯 The most you can lose: \$200/);
  });

  it("says a short as a bet in plain words, in the chat too: no margin, position or price-move jargon", async () => {
    const t = buildTestFren();
    t.store.setLimits({ ...t.store.getLimits(), autoApproveUsd: 10 });
    await t.fren.submit({ request: "short BTC", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "short", sizing: { type: "margin", usd: 200 }, leverage: 5, stopLossPct: 10 } }] });
    const text = t.notifier.sent.join("\n");
    expect(text).toMatch(/Bet \$200 that BTC goes down, 5× boost on Hyperliquid\. Stop: if BTC rises ~2%, Fren closes it and you lose about \$20/);
    expect(text).not.toMatch(/margin|position\)|price move|Longed|Shorted/);
  });
});

describe("dashboard v2", () => {
  it("shows one total with the breakdown and trade history", async () => {
    const s = await start();
    s.store.setLimits({ ...s.store.getLimits(), autoApproveUsd: 300 });
    await s.fren.submit({ request: "buy $250 of SOL", steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: "So11111111111111111111111111111111111111112", amount: { type: "usd", usd: 250 } } }] });
    const d = await (await s.get("/api/overview", await s.login())).json();
    expect(d.balances.totalUsd).toBeCloseTo(10_000, 0);
    expect(d.balances.parts.map((p: { place: string }) => p.place)).toEqual(["Practice money", "SOL (practice)"]);
    expect(d.balances.parts.map((p: { network: string }) => p.network)).toEqual(["Practice cash", "Solana"]);
    expect(d.history[0]).toMatchObject({ request: "buy $250 of SOL", status: "done", maxLossUsd: 250 });
    expect(JSON.stringify(d)).not.toMatch(/passphrase|private|secret/i);
  });

  it("serves the sign-in page with only the ways the owner set up", async () => {
    const s = await start();
    let page = await (await s.get("/")).text();
    expect(page).toMatch(/fren_dashboard/);
    expect(page).not.toMatch(/id="em"/);
    s.dash.auth.setEmail("Me@Example.com");
    page = await (await s.get("/")).text();
    expect(page).toMatch(/id="em"/);
    expect(await (await s.get("/demo-login")).status).toBe(404);
  });

  it("logs in with an email code, once, and never says whose email it is", async () => {
    const s = await start();
    s.dash.auth.setEmail("me@example.com");
    const wrong = await (await s.post("/auth/email/start", { email: "you@example.com" })).json();
    const right = await (await s.post("/auth/email/start", { email: "ME@example.com" })).json();
    expect(wrong.text).toBe(right.text);
    expect(s.mail).toHaveLength(1);
    const code = s.mail[0]!.text.match(/\d{6}/)![0];
    expect((await s.post("/auth/email/check", { email: "me@example.com", code: "000000" === code ? "111111" : "000000" })).status).toBe(401);
    const ok = await s.post("/auth/email/check", { email: "me@example.com", code });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/fren_dash=.*HttpOnly; Secure; SameSite=Lax/);
    expect((await s.post("/auth/email/check", { email: "me@example.com", code })).status).toBe(401);
  });

  it("logs in with a Solana or EVM wallet only after the owner added it", async () => {
    const s = await start();
    const cookie = await s.login();
    const sol = solanaWallet();
    const evm = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

    // Not added yet: the signature is real, the door stays shut.
    let c = await (await s.post("/auth/wallet/challenge", { kind: "solana", address: sol.address })).json();
    expect(c.message).toMatch(/can't move money/);
    expect((await s.post("/auth/wallet/check", { kind: "solana", id: c.id, address: sol.address, signature: sol.sign(c.message) })).status).toBe(401);

    for (const w of [
      { kind: "solana", address: sol.address, sign: async (m: string) => sol.sign(m) },
      { kind: "evm", address: evm.address, sign: (m: string) => evm.signMessage({ message: m }) },
    ]) {
      c = await (await s.post("/api/sign-in/wallet/challenge", { kind: w.kind, address: w.address }, cookie)).json();
      const linked = await s.post("/api/sign-in/wallet/link", { kind: w.kind, id: c.id, address: w.address, signature: await w.sign(c.message) }, cookie);
      expect(linked.status).toBe(200);
      c = await (await s.post("/auth/wallet/challenge", { kind: w.kind, address: w.address })).json();
      // Someone else's signature of the same message doesn't count.
      const other = solanaWallet();
      expect((await s.post("/auth/wallet/check", { kind: w.kind, id: c.id, address: w.address, signature: w.kind === "solana" ? other.sign(c.message) : "0x" + "11".repeat(65) })).status).toBe(401);
      c = await (await s.post("/auth/wallet/challenge", { kind: w.kind, address: w.address })).json();
      const ok = await s.post("/auth/wallet/check", { kind: w.kind, id: c.id, address: w.address, signature: await w.sign(c.message) });
      expect(ok.status).toBe(200);
      // A challenge works once.
      expect((await s.post("/auth/wallet/check", { kind: w.kind, id: c.id, address: w.address, signature: await w.sign(c.message) })).status).toBe(401);
    }
    expect(s.dash.auth.wallets()).toHaveLength(2);
  });

  it("chat: shows the chat-app conversation, sends into it and tells the chat app", async () => {
    const chat = new MemoryChat(async () => "You hold $10k of practice money.");
    chat.fromApp("you", "hi from telegram");
    const s = await start({ chat });
    const cookie = await s.login();
    let h = await (await s.get("/api/chat", cookie)).json();
    expect(h.channel).toBe("telegram");
    expect(h.messages.map((m: { text: string }) => m.text)).toEqual(["hi from telegram"]);
    expect(await (await s.post("/api/chat", { text: "what do I hold?" }, cookie)).json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 20));
    h = await (await s.get("/api/chat", cookie)).json();
    expect(h.messages.map((m: { from: string }) => m.from)).toEqual(["you", "you", "fren"]);
    expect(s.notifier.sent.at(-1)).toBe("🖥 You, from the dashboard:\nwhat do I hold?");
    // Other commands stay in Telegram.
    expect((await (await s.post("/api/chat", { text: "/fren_stop" }, cookie)).json()).hint).toMatch(/Telegram/);
    expect(chat.messages).toHaveLength(3);
  });

  it("chat: reads OpenClaw's main session and sends with --deliver", async () => {
    const calls: string[][] = [];
    const exec: ExecOut = async (_bin, args) => {
      calls.push(args);
      if (args[0] === "gateway")
        return {
          code: 0,
          stderr: "",
          stdout: JSON.stringify({
            sessionInfo: { channel: "telegram" },
            messages: [
              { role: "user", content: [{ type: "text", text: "buy sol" }], timestamp: 1 },
              { role: "toolResult", content: [{ type: "text", text: "{}" }], timestamp: 2 },
              { role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Done ✅" }], timestamp: 3 },
            ],
          }),
        };
      return { code: 0, stdout: "{}", stderr: "" };
    };
    const c = new OpenClawChat({ exec });
    const h = await c.history(10);
    expect(h).toEqual({ channel: "telegram", thinking: false, messages: [{ id: "1-0", from: "you", text: "buy sol", at: 1 }, { id: "3-2", from: "fren", text: "Done ✅", at: 3 }] });
    expect(calls[0]).toEqual(["gateway", "call", "chat.history", "--json", "--params", '{"sessionKey":"agent:main:main","limit":10}']);
    await c.send("-rf hi");
    expect(calls[1]).toEqual(["agent", "--session-key", "agent:main:main", "--message=-rf hi", "--deliver", "--json"]);
  });

  it("chat send: a send the gateway turns down says so, on the page and later in the chat", async () => {
    const history = { code: 0, stderr: "", stdout: JSON.stringify({ messages: [] }) };
    const refused = { code: 1, stderr: "[openclaw] The CLI command failed.", stdout: JSON.stringify({ ok: false, error: { message: "Delivering to Telegram requires target <chatId>" } }) };
    // Turned down at once: the page gets an error, not "Sent".
    const fast = new OpenClawChat({ exec: async (_f, a) => (a[0] === "agent" ? refused : history), acceptMs: 50 });
    await expect(fast.send("hi")).rejects.toThrow(/couldn't find your Telegram chat/);
    // Gateway down while Fren restarts.
    const down = new OpenClawChat({ exec: async () => ({ code: 1, stdout: "", stderr: "Error: connect ECONNREFUSED 127.0.0.1:18789" }), acceptMs: 50 });
    await expect(down.send("hi")).rejects.toThrow(/restarting/);
    // Turned down after the page already said "Sent": the chat shows it.
    let finish: (r: typeof refused) => void = () => {};
    const slow = new OpenClawChat({ exec: (_f, a) => (a[0] === "agent" ? new Promise((r) => (finish = r)) : Promise.resolve(history)), acceptMs: 20, now: () => 5 });
    await slow.send("what do I hold?");
    finish({ code: 1, stdout: "", stderr: "something else" });
    await new Promise((r) => setTimeout(r, 5));
    const h = await slow.history();
    expect(h.messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "what do I hold?"],
      ["fren", "⚠️ Fren didn't get that message. Try again in a minute, or write in Telegram."],
    ]);
    // The next good send clears it.
    const ok = slow.send("again");
    finish({ code: 0, stdout: "{}", stderr: "" });
    await ok;
    expect((await slow.history()).messages).toEqual([]);
  });

  it("chat send from the page: a refused send is an error the page shows, and Telegram isn't told", async () => {
    const chat = new OpenClawChat({ exec: async () => ({ code: 1, stdout: "", stderr: "connect ECONNREFUSED" }), acceptMs: 50 });
    const s = await start({ chat });
    const cookie = await s.login();
    const before = s.notifier.sent.length;
    const r = await s.post("/api/chat", { text: "hi" }, cookie);
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/restarting/);
    expect(s.notifier.sent.length).toBe(before);
  });
});

/**
 * "ok" typed into the dashboard's chat (Timofey 22.11 18:36: "I type ok in the dashboard chat
 * and it hangs; the Approve button works"). It's the owner's /ok, run by the engine like the
 * Telegram command, never handed to the model; same checks as /ok and the Approve button.
 */
describe("ok typed in the dashboard chat", () => {
  afterEach(() => vi.useRealTimers());
  const goldLong = (margin: number) => ({
    request: `long gold 10x with $${margin}`,
    steps: [{ leg: { kind: "perp_open" as const, venue: "hyperliquid", market: "xyz:gold", side: "long" as const, sizing: { type: "margin" as const, usd: margin }, leverage: 10 } }],
  });
  async function waiting(n = 1) {
    const asked: string[] = [];
    const chat = new MemoryChat(async (t) => (asked.push(t), "model answer"));
    const s = await start({ chat });
    s.store.setLimits({ ...s.store.getLimits(), autoApproveUsd: 0 });
    const cookie = await s.login();
    for (let i = 0; i < n; i++) expect((await s.fren.submit(goldLong(100 + i))).verdict).toBe("needs_code");
    const say = async (text: string) => (await s.post("/api/chat", { text }, cookie)).json();
    return { ...s, chat, asked, cookie, say };
  }

  it("reads ok, ок, /ok, /ok 2, /ok all, ок все and a code; a question with ok in it is a question", () => {
    for (const [t, want] of [["ok", ""], ["OK!", ""], ["ок", ""], ["Окей.", ""], ["/ok", ""], ["/ok 2", "2"], ["/ok all", "all"], ["ок все", "все"], ["ок на всё", "на всё"], ["/ok AB12CD", "AB12CD"]] as const)
      expect(okCommand(t), t).toBe(want);
    for (const t of ["ok, and the fee?", "окно", "ok thanks a lot", "не ок", "/okay_then", "/ok 2 and 3", "book"]) expect(okCommand(t), t).toBeNull();
  });

  it("a bare ok runs the one waiting request at once, answers in the chat and tells Telegram; the model never sees it", async () => {
    const { say, chat, asked, store, notifier } = await waiting();
    expect(await say("ок")).toEqual({ ok: true, answered: true });
    expect(store.paperPositions()).toHaveLength(1);
    expect(store.livePending()).toHaveLength(0);
    expect(asked).toEqual([]);
    expect(chat.messages.map((m) => m.from)).toEqual(["you", "fren"]);
    expect(chat.messages[1]!.text).toMatch(/GOLD/);
    expect(notifier.sent.at(-1)).toMatch(/^🖥 You, from the dashboard:\nок/);
  });

  it("several waiting: ok lists them, ok 2 picks one, /ok all asks once more and then checks each", async () => {
    const { say, chat, store } = await waiting(3);
    await say("ok");
    expect(chat.messages.at(-1)!.text).toMatch(/3 requests are waiting/);
    expect(store.paperPositions()).toHaveLength(0);
    await say("/ok 2");
    expect(store.livePending()).toHaveLength(2);
    await say("/ok all");
    expect(chat.messages.at(-1)!.text).toMatch(/Approve all 2\?/);
    expect(store.livePending()).toHaveLength(2);
    await say("/ok all");
    expect(store.livePending()).toHaveLength(0);
    expect(store.plansWithStatus("pending_confirm")).toHaveLength(0);
  });

  it("limits tightened since are checked again, like the Approve button", async () => {
    const { say, chat, store } = await waiting();
    store.setLimits({ ...store.getLimits(), maxTradeUsd: 50 });
    await say("ok");
    expect(chat.messages.at(-1)!.text).toMatch(/Not doing this after all/);
    expect(store.paperPositions()).toHaveLength(0);
  });

  it("an ok after the request ran out approves nothing and says why", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { say, chat, store } = await waiting();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await say("ok");
    expect(chat.messages.at(-1)!.text).toMatch(/ran out/);
    expect(store.paperPositions()).toHaveLength(0);
  });

  it("an ok twice runs nothing twice; nothing waiting says so", async () => {
    const { say, chat, store } = await waiting();
    await say("ok");
    await say("ok");
    expect(chat.messages.at(-1)!.text).toMatch(/Nothing is waiting/);
    expect(store.paperPositions()).toHaveLength(1);
  });

  it("wrong codes count like in Telegram: after the limit every waiting request is dropped", async () => {
    const { say, store } = await waiting();
    for (let i = 0; i < 5; i++) await say("/ok ZZZZZ" + i);
    expect(store.livePending()).toHaveLength(0);
    expect(store.paperPositions()).toHaveLength(0);
  });

  it("needs the session and the header", async () => {
    const { post, store } = await waiting();
    expect((await post("/api/chat", { text: "ok" }, "fren_dash=nope")).status).toBe(401);
    expect(store.paperPositions()).toHaveLength(0);
    expect(store.livePending()).toHaveLength(1);
  });
});

describe("dashboard chat never hangs", () => {
  it("an OpenClaw send that runs past its limit leaves a note in the chat, without repeating the message", async () => {
    const history = { code: 0, stderr: "", stdout: JSON.stringify({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }) };
    let finish: (r: { code: number; stdout: string; stderr: string }) => void = () => {};
    const c = new OpenClawChat({ exec: (_f, a) => (a[0] === "agent" ? new Promise((r) => (finish = r)) : Promise.resolve(history)), acceptMs: 10, now: () => 2 });
    await c.send("hi");
    expect((await c.history()).thinking).toBe(true);
    finish({ code: 1, stdout: "", stderr: `\n${TIMED_OUT}` });
    await new Promise((r) => setTimeout(r, 5));
    const h = await c.history();
    expect(h.thinking).toBe(false);
    expect(h.messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "hi"],
      ["fren", "⏳ Fren hasn't answered in 4 minutes. If the answer comes, it shows up here and in Telegram; or ask again."],
    ]);
  });

  it("notes merge into the OpenClaw history by time", async () => {
    let t = 10;
    const history = { code: 0, stderr: "", stdout: JSON.stringify({ messages: [{ role: "user", content: "a", timestamp: 5 }, { role: "assistant", content: "b", timestamp: 20 }] }) };
    const c = new OpenClawChat({ exec: async () => history, now: () => t });
    c.note("you", "ok");
    t = 11;
    c.note("fren", "✅ done");
    expect((await c.history()).messages.map((m) => m.text)).toEqual(["a", "ok", "✅ done", "b"]);
  });
});
