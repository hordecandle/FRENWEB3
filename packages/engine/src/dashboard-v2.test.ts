import { generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { PublicKey } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { describeMaxLoss, maxLoss } from "@fren/core";
import { Dashboard, type DashboardOptions } from "./dashboard.js";
import { MemoryChat, OpenClawChat, type ExecOut } from "./dashboard-chat.js";
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
    // /ok and friends stay in Telegram.
    expect((await (await s.post("/api/chat", { text: "/ok 123456" }, cookie)).json()).hint).toMatch(/Telegram/);
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

  it("keys: locked without a vault; with one, a code from the chat, 3 tries", async () => {
    let s = await start();
    let cookie = await s.login();
    expect((await (await s.post("/api/keys/request", {}, cookie)).json()).locked).toBe(true);
    close?.();

    s = await start({ keys: { reveal: async () => [{ label: "Solana", value: "SECRETKEY" }] } });
    cookie = await s.login();
    expect((await s.post("/api/keys/reveal", { code: "123456" }, cookie)).status).toBe(400);
    const r = await (await s.post("/api/keys/request", {}, cookie)).json();
    expect(r.needsCode).toBe(true);
    expect(r.demoNote).toBeUndefined();
    const code = s.notifier.sent.at(-1)!.match(/Code: (\d{6})/)![1]!;
    for (let i = 0; i < 3; i++) expect((await s.post("/api/keys/reveal", { code: code === "000000" ? "111111" : "000000" }, cookie)).status).toBe(400);
    expect((await s.post("/api/keys/reveal", { code }, cookie)).status).toBe(400);
    await s.post("/api/keys/request", {}, cookie);
    const code2 = s.notifier.sent.at(-1)!.match(/Code: (\d{6})/)![1]!;
    expect(await (await s.post("/api/keys/reveal", { code: code2 }, cookie)).json()).toEqual({ keys: [{ label: "Solana", value: "SECRETKEY" }] });
    expect(JSON.stringify(await (await s.get("/api/overview", cookie)).json())).not.toMatch(/SECRETKEY/);
  });
});
