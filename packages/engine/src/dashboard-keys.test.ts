import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, writeKeystore } from "@fren/signer";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { Dashboard, KEY_LABELS, type DashboardOptions } from "./dashboard.js";
import { KeystoreVault, keystoreVault } from "./keys-vault.js";
import { buildTestFren } from "./testing.js";

const SECRETS = ["SOLSECRET111", "0xEVMSECRET222", "0xHLSECRET333"];
const vault = { reveal: async () => KEY_LABELS.map((label, i) => ({ label, value: SECRETS[i]! })) };
const PUBLIC = "https://1-2-3-4.sslip.io";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

async function start(opts: Partial<DashboardOptions> = {}) {
  const t = buildTestFren();
  let now = 1_000_000;
  const dash = new Dashboard(t.fren, { publicUrl: PUBLIC, now: () => now, keys: vault, ...opts });
  const server = dash.server();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie: string, origin: string | null = PUBLIC) =>
    fetch(base + path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-fren": "1", ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  const login = async () => {
    const link = new URL(dash.newLink());
    const res = await fetch(base + link.pathname + link.search, { redirect: "manual" });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  const lastCode = () => t.notifier.sent.at(-1)!.match(/Code: (\d{6})/)![1]!;
  const unlock = async (cookie: string, which = 0) => {
    expect((await post("/api/keys/request", { word: "show" }, cookie)).status).toBe(200);
    return post("/api/keys/reveal", { code: lastCode(), which }, cookie);
  };
  return { ...t, dash, base, post, login, lastCode, unlock, tick: (ms: number) => (now += ms) };
}

describe("dashboard Keys block (like Render: dots, Reveal for 30 s, Copy)", () => {
  it("shows one key after SHOW + the Telegram code, for 30 s, and tells the owner in Telegram", async () => {
    const s = await start();
    const cookie = await s.login();
    const r = await (await s.unlock(cookie, 1)).json();
    expect(r.key).toEqual({ which: 1, label: KEY_LABELS[1], value: SECRETS[1] });
    expect(r.showForMs).toBe(30_000);
    expect(r).not.toHaveProperty("keys"); // never all at once
    expect(s.notifier.sent.at(-1)).toMatch(/EVM wallet key.*shown in your dashboard at \d\d:\d\d/s);
    // For two minutes the same browser can show or copy another one without a new code, each one reported.
    const c = await (await s.post("/api/keys/reveal", { which: 2, purpose: "copy" }, cookie)).json();
    expect(c.key.value).toBe(SECRETS[2]);
    expect(s.notifier.sent.at(-1)).toMatch(/Hyperliquid trading key: copied in your dashboard/);
    s.tick(2 * 60_000 + 1);
    expect((await s.post("/api/keys/reveal", { which: 0 }, cookie)).status).toBe(400);
  });

  it("the overview lists the rows but never a key", async () => {
    const s = await start();
    const cookie = await s.login();
    await s.unlock(cookie);
    const o = await (await fetch(s.base + "/api/overview", { headers: { cookie } })).text();
    expect(JSON.parse(o).keyLabels).toEqual([...KEY_LABELS]);
    for (const k of SECRETS) expect(o).not.toContain(k);
  });

  it("attack: no session → 401, nothing sent", async () => {
    const s = await start();
    const before = s.notifier.sent.length;
    expect((await s.post("/api/keys/request", { word: "SHOW" }, "")).status).toBe(401);
    expect((await s.post("/api/keys/reveal", { code: "123456" }, "fren_dash=forgedforgedforgedforged")).status).toBe(401);
    expect(s.notifier.sent.length).toBe(before);
  });

  it("attack: another site's Origin (or none) → 403, even with the owner's cookie", async () => {
    const s = await start();
    const cookie = await s.login();
    expect((await s.post("/api/keys/request", { word: "SHOW" }, cookie, "https://evil.example")).status).toBe(403);
    expect((await s.post("/api/keys/request", { word: "SHOW" }, cookie, null)).status).toBe(403);
    // DNS rebinding: a foreign name pointed at 127.0.0.1 still carries its own Origin.
    expect((await s.post("/api/keys/request", { word: "SHOW" }, cookie, "http://127.0.0.1.evil.example:7422")).status).toBe(403);
    await s.post("/api/keys/request", { word: "SHOW" }, cookie);
    expect((await s.post("/api/keys/reveal", { code: s.lastCode() }, cookie, "https://evil.example")).status).toBe(403);
  });

  it("attack: without the word no code goes out; a wrong code 3 times kills it; a used code doesn't work twice", async () => {
    const s = await start();
    const cookie = await s.login();
    const before = s.notifier.sent.length;
    expect((await s.post("/api/keys/request", {}, cookie)).status).toBe(400);
    expect((await s.post("/api/keys/request", { word: "yes" }, cookie)).status).toBe(400);
    expect(s.notifier.sent.length).toBe(before);
    await s.post("/api/keys/request", { word: "SHOW" }, cookie);
    const code = s.lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    // Asking without a code doesn't burn a try.
    expect((await s.post("/api/keys/reveal", { which: 0 }, cookie)).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await s.post("/api/keys/reveal", { code: wrong }, cookie)).status).toBe(400);
    expect((await s.post("/api/keys/reveal", { code }, cookie)).status).toBe(400);
    // Replay: a code that worked once, after the window is locked, is dead.
    const ok = await s.unlock(cookie);
    expect(ok.status).toBe(200);
    await s.post("/api/keys/lock", {}, cookie);
    const codeMsg = s.notifier.sent.filter((m) => /Code: \d{6}/.test(m)).at(-1)!;
    const replay = codeMsg.match(/Code: (\d{6})/)![1]!;
    expect((await s.post("/api/keys/reveal", { code: replay }, cookie)).status).toBe(400);
  });

  it("attack: the code only works in the browser session that asked for it", async () => {
    const s = await start();
    const mine = await s.login();
    const other = await s.login();
    await s.post("/api/keys/request", { word: "SHOW" }, mine);
    expect((await s.post("/api/keys/reveal", { code: s.lastCode() }, other)).status).toBe(400);
    const r = await s.post("/api/keys/reveal", { code: s.lastCode() }, mine);
    expect(r.status).toBe(200);
    // And the open window belongs to that session only.
    expect((await s.post("/api/keys/reveal", { which: 1 }, other)).status).toBe(400);
  });

  it("attack: codes and reveals are rate limited", async () => {
    const s = await start();
    const cookie = await s.login();
    for (let i = 0; i < 3; i++) expect((await s.post("/api/keys/request", { word: "SHOW" }, cookie)).status).toBe(200);
    expect((await s.post("/api/keys/request", { word: "SHOW" }, cookie)).status).toBe(429);
    s.tick(10 * 60_000 + 1);
    expect((await s.unlock(cookie)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await s.post("/api/keys/reveal", { which: i % 3 }, cookie)).status).toBe(200);
    expect((await s.post("/api/keys/reveal", { which: 0 }, cookie)).status).toBe(429);
  });

  it("attack: a bad key index gives nothing", async () => {
    const s = await start();
    const cookie = await s.login();
    const r = await s.unlock(cookie, 7);
    expect(r.status).toBe(400);
    const r2 = await s.post("/api/keys/reveal", { which: "0;1" }, cookie);
    expect(await r2.text()).not.toMatch(/SECRET/);
  });

  it("without a vault the block stays locked and points to fren keys", async () => {
    const s = await start({ keys: null });
    const cookie = await s.login();
    const r = await (await s.post("/api/keys/request", { word: "SHOW" }, cookie)).json();
    expect(r.locked).toBe(true);
    expect(r.text).toMatch(/fren keys/);
  });
});

describe("the AI side can't reach the keys", () => {
  it("the engine API (what the OpenClaw plugin talks to) has no keys route, and /agent/context has no key", async () => {
    const t = buildTestFren();
    const server = createApi(t.fren, "tok");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    closers.push(() => server.close());
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const h = { authorization: "Bearer tok", "content-type": "application/json" };
    for (const p of ["/keys", "/api/keys/reveal", "/keys/reveal", "/dashboard/keys"]) {
      const r = await fetch(base + p, { method: "POST", headers: h, body: "{}" });
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(await r.text()).not.toMatch(/SECRET|solanaSecret|evmMaster/);
    }
    const ctx = await (await fetch(base + "/agent/context", { headers: h })).text();
    expect(ctx).not.toMatch(/SECRET|solanaSecret|evmMaster|hlAgent"/);
  });

  it("the plugin's code never names the keys endpoints or the keystore", () => {
    const dir = join(__dirname, "../../openclaw-plugin/src");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/keys\/reveal|keys\/request|readKeystore|signer\.pass|keystore\.json/);
    }
  });
});

describe("KeystoreVault (the real install)", () => {
  it("reads the signer's keystore only when asked, with the same labels as the page", async () => {
    const d = mkdtempSync(join(tmpdir(), "fren-vault-"));
    closers.push(() => rmSync(d, { recursive: true, force: true }));
    const ks = join(d, "keystore.json");
    const pass = join(d, "signer.pass");
    writeFileSync(pass, "passphrase-for-test-123\n");
    const keys = generateKeys();
    writeKeystore(ks, keys, "passphrase-for-test-123");
    const v = keystoreVault(ks, pass)!;
    expect(v).toBeInstanceOf(KeystoreVault);
    expect(await v.reveal()).toEqual([
      { label: KEY_LABELS[0], value: keys.solanaSecret },
      { label: KEY_LABELS[1], value: keys.evmMaster },
      { label: KEY_LABELS[2], value: keys.hlAgent },
    ]);
    expect(keystoreVault(join(d, "nope.json"), pass)).toBeNull();
  });
});
