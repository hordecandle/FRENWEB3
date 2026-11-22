import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Dashboard } from "./dashboard.js";
import { dashboardUrl } from "./daemon.js";
import { buildTestFren } from "./testing.js";

let close: (() => void) | null = null;
afterEach(() => close?.());

async function start(opts: { privateLine?: boolean } = {}) {
  const t = buildTestFren(opts);
  let now = 1_000_000;
  const dash = new Dashboard(t.fren, { publicUrl: "https://1-2-3-4.sslip.io/", now: () => now });
  const server = dash.server();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, cookie?: string) => fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const post = (path: string, cookie: string, body: unknown = {}, headers: Record<string, string> = { "x-fren": "1" }) =>
    fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const login = async () => {
    const link = dash.newLink();
    const res = await get(new URL(link).pathname + new URL(link).search);
    expect(res.status).toBe(303);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  return { ...t, dash, get, post, login, tick: (ms: number) => (now += ms) };
}

describe("owner dashboard", () => {
  it("sends the one-time link privately and never through the chat", async () => {
    const { dash, notifier } = await start();
    const r = await dash.sendLink();
    expect(r.link).toBeUndefined();
    expect(r.text).toMatch(/separate message/);
    expect(notifier.sent.at(-1)).toMatch(/^🔑 Your Fren dashboard:\nhttps:\/\/1-2-3-4\.sslip\.io\/login\?t=[\w-]{30,}/);
  });

  it("hands the link back to the owner's command when there's no private line", async () => {
    const { dash } = await start({ privateLine: false });
    const r = await dash.sendLink();
    expect(r.link).toMatch(/^https:\/\/1-2-3-4\.sslip\.io\/login\?t=/);
  });

  it("says ready, without a session, only once the chat gateway has started", async () => {
    const { dash, get } = await start();
    expect(await (await get("/ready")).json()).toEqual({ ready: false });
    dash.chatUp();
    const r = await get("/ready");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ready: true });
  });

  it("shows nothing without a session", async () => {
    const { get } = await start();
    const page = await get("/");
    expect(page.status).toBe(401);
    expect(await page.text()).toMatch(/\/fren_dashboard/);
    expect((await get("/api/overview")).status).toBe(401);
  });

  it("a link works once, within 10 minutes, and sets a strict cookie", async () => {
    const { dash, get, tick } = await start();
    const link = new URL(dash.newLink());
    const first = await get(link.pathname + link.search);
    expect(first.status).toBe(303);
    expect(first.headers.get("set-cookie")).toMatch(/fren_dash=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    expect((await get(link.pathname + link.search)).status).toBe(403);
    const late = new URL(dash.newLink());
    tick(11 * 60_000);
    expect((await get(late.pathname + late.search)).status).toBe(403);
    expect((await get("/login?t=made-up-token-made-up-token")).status).toBe(403);
  });

  it("shows status, limits, positions and activity once logged in", async () => {
    const { get, login, store } = await start();
    store.addEvent("Bought 1 SOL");
    const cookie = await login();
    const page = await get("/", cookie);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
    const o = await (await get("/api/overview", cookie)).json();
    expect(o.limits).toMatchObject({ mode: "paper", paused: false });
    expect(o.positions).toEqual([]);
    expect(o.events.map((e: { text: string }) => e.text)).toContain("Bought 1 SOL");
    expect(JSON.stringify(o)).not.toMatch(/token|passphrase|private/i);
  });

  it("pauses at once, but resuming and raising limits still need the owner's code", async () => {
    const { post, login, fren, notifier } = await start();
    const cookie = await login();
    expect((await post("/api/pause", cookie)).status).toBe(200);
    expect(fren.limits().paused).toBe(true);

    const resume = await (await post("/api/resume", cookie)).json();
    expect(resume.needsCode).toBe(true);
    expect(fren.limits().paused).toBe(true);

    const before = fren.limits().maxTradeUsd;
    const raise = await (await post("/api/limits", cookie, { args: `maxTradeUsd=${before * 10}` })).json();
    expect(raise.needsCode).toBe(true);
    expect(fren.limits().maxTradeUsd).toBe(before);
    expect(notifier.sent.some((m) => /\/ok/.test(m))).toBe(true);
  });

  it("refuses actions without the custom header (cross-site forms)", async () => {
    const { post, login, fren } = await start();
    const cookie = await login();
    expect((await post("/api/pause", cookie, {}, {})).status).toBe(403);
    expect(fren.limits().paused).toBe(false);
  });

  it("logs out", async () => {
    const { post, get, login } = await start();
    const cookie = await login();
    await post("/api/logout", cookie);
    expect((await get("/api/overview", cookie)).status).toBe(401);
  });
});

describe("dashboard address", () => {
  it("is on only with an https address", () => {
    const old = process.env.FREN_DASHBOARD_URL;
    process.env.FREN_DASHBOARD_URL = "https://1-2-3-4.sslip.io";
    expect(dashboardUrl("/nonexistent")).toBe("https://1-2-3-4.sslip.io");
    process.env.FREN_DASHBOARD_URL = "http://1-2-3-4.sslip.io";
    expect(dashboardUrl("/nonexistent")).toBeNull();
    delete process.env.FREN_DASHBOARD_URL;
    expect(dashboardUrl("/nonexistent")).toBeNull();
    if (old !== undefined) process.env.FREN_DASHBOARD_URL = old;
  });
});

import { cardTopUp } from "./dashboard.js";
describe("card top-up", () => {
  const a = { evm: "0xabc", solana: "So1" };
  it("is off unless the sandbox flag and key are set", () => {
    expect(cardTopUp(a, {})).toBeNull();
    expect(cardTopUp(a, { FREN_CARD_ONRAMP: "sandbox" })).toBeNull();
    expect(cardTopUp(a, { FREN_CARD_ONRAMP: "live", FREN_TRANSAK_KEY: "k" })).toBeNull();
  });
  it("builds a sandbox link carrying the owner's own Base address", () => {
    const c = cardTopUp(a, { FREN_CARD_ONRAMP: "sandbox", FREN_TRANSAK_KEY: "k" })!;
    expect(c.url).toContain("global-stg.transak.com");
    expect(c.url).toContain("walletAddress=0xabc");
    expect(c.url).toContain("network=base");
  });
});
