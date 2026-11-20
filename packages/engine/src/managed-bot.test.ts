import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { frenPaths } from "./config.js";
import { claimManagedBot, createBotBroker, startManagedBot, type BotBroker } from "./managed-bot.js";
import type { Runner, SetupDeps } from "./setup.js";
import { createSetupServer } from "./setup-web.js";

const MANAGER = "111:AAmanagermanagermanagermanagerman";
const NEWBOT = "222333:AAnewbotnewbotnewbotnewbotnewbot";
const OWNER = 777000123;

/** Telegram as the manager bot and the new bot see it. Records every call; never real network. */
function fakeTelegram(opts: { canManage?: boolean } = {}) {
  const calls: { token: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const m = String(url).match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const [, token, method] = m;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ token: token!, method: method!, body });
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
    if (token === MANAGER) {
      if (method === "getMe") return ok({ id: 111, is_bot: true, username: "fren_setup_bot", can_manage_bots: opts.canManage ?? true });
      if (method === "getManagedBotToken") return body.user_id === 222333 ? ok(NEWBOT) : new Response(JSON.stringify({ ok: false, error_code: 400 }));
      if (method === "getUpdates") return ok([]);
      return ok(true);
    }
    if (token === NEWBOT) {
      if (method === "getMe") return ok({ id: 222333, is_bot: true, username: "fren_abc_bot" });
      return ok({});
    }
    return new Response(JSON.stringify({ ok: false, error_code: 401 }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** Sends Telegram calls to the fake and everything else (the broker) over real localhost HTTP. */
function routed(tg: typeof fetch): typeof fetch {
  return ((url: string, init?: RequestInit) => (String(url).startsWith("https://api.telegram.org/") ? tg(url, init) : fetch(url, init))) as typeof fetch;
}

const open: { close(): void }[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

async function startBroker(tg: ReturnType<typeof fakeTelegram>, extra: { ttlMs?: number; now?: () => number } = {}) {
  const logs: string[] = [];
  const b = createBotBroker({ managerToken: MANAGER, fetchFn: tg.fetchFn, log: (l) => logs.push(l), ...extra });
  await b.init();
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  open.push(b.server);
  return { b, url: `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`, logs };
}

const created = (b: BotBroker, username: string) =>
  b.handleUpdate({ update_id: 1, managed_bot: { user: { id: OWNER, first_name: "Bee" }, bot: { id: 222333, is_bot: true, username } } });

describe("bot broker", () => {
  it("refuses a manager bot without bot management switched on", async () => {
    const b = createBotBroker({ managerToken: MANAGER, fetchFn: fakeTelegram({ canManage: false }).fetchFn });
    await expect(b.init()).rejects.toThrow(/bot management/);
  });

  it("gives a t.me/newbot link and hands the token, sealed, to the right page once", async () => {
    const tg = fakeTelegram();
    const { b, url, logs } = await startBroker(tg);
    const fetchFn = routed(tg.fetchFn);
    const s = await startManagedBot(fetchFn, url);
    expect(s.link).toBe(`https://t.me/newbot/fren_setup_bot/${s.username}?name=Fren`);
    expect(s.username).toMatch(/^fren_[0-9a-f]{10}_bot$/);
    expect(await claimManagedBot(fetchFn, s)).toBeNull();

    // Someone else's bot, or a token change for an old one: nothing happens.
    await created(b, "someone_else_bot");
    expect(await claimManagedBot(fetchFn, s)).toBeNull();

    await created(b, s.username.toUpperCase());
    // A wrong claim secret gets nothing and doesn't burn the real one.
    await expect(claimManagedBot(fetchFn, { ...s, claim: "nope" })).rejects.toThrow(/expired/);
    const r = await claimManagedBot(fetchFn, s);
    expect(r).toEqual({ token: NEWBOT, bot: { id: "222333", username: s.username.toUpperCase() }, owner: { id: String(OWNER), name: "Bee" } });
    await expect(claimManagedBot(fetchFn, s)).rejects.toThrow(/expired/);

    // Only the owner can open the new bot.
    expect(tg.calls.find((c) => c.method === "setManagedBotAccessSettings")?.body).toEqual({ user_id: 222333, is_access_restricted: true });
    // The token is never logged.
    expect(logs.join("\n")).not.toContain(NEWBOT);
  });

  it("keeps only a sealed copy until claimed", async () => {
    const tg = fakeTelegram();
    const { b, url } = await startBroker(tg);
    const s = await startManagedBot(routed(tg.fetchFn), url);
    await created(b, s.username);
    const res = await fetch(`${url}/v1/claim`, { method: "POST", body: JSON.stringify({ sid: s.sid, claim: s.claim }) });
    const text = await res.text();
    expect(text).not.toContain(NEWBOT);
    expect(JSON.parse(text).sealed).toMatch(/^[A-Za-z0-9+/=]{300,}$/);
  });

  it("falls back to /start <sid> when the owner renamed the bot", async () => {
    const tg = fakeTelegram();
    const { b, url } = await startBroker(tg);
    const fetchFn = routed(tg.fetchFn);
    const s = await startManagedBot(fetchFn, url);
    expect(s.fallback).toBe(`https://t.me/fren_setup_bot?start=${s.sid}`);
    await b.handleUpdate({ update_id: 2, message: { chat: { id: OWNER, type: "private" }, from: { id: OWNER, first_name: "Bee" }, text: `/start ${s.sid}` } });
    const button = tg.calls.find((c) => c.method === "sendMessage")!.body as { reply_markup: { keyboard: { request_managed_bot: { suggested_username: string } }[][] } };
    expect(button.reply_markup.keyboard[0]![0]!.request_managed_bot.suggested_username).toBe(s.username);
    await b.handleUpdate({
      update_id: 3,
      message: { chat: { id: OWNER, type: "private" }, from: { id: OWNER, first_name: "Bee" }, managed_bot_created: { bot: { id: 222333, username: "my_own_name_bot" } } },
    });
    expect((await claimManagedBot(fetchFn, s))?.token).toBe(NEWBOT);
  });

  it("forgets links after the time limit", async () => {
    const tg = fakeTelegram();
    let t = 1_000;
    const { b, url } = await startBroker(tg, { ttlMs: 60_000, now: () => t });
    const fetchFn = routed(tg.fetchFn);
    const s = await startManagedBot(fetchFn, url);
    t += 61_000;
    await created(b, s.username);
    expect(tg.calls.some((c) => c.method === "getManagedBotToken")).toBe(false);
    await expect(claimManagedBot(fetchFn, s)).rejects.toThrow(/expired/);
  });

  it("rejects junk sessions", async () => {
    const { url } = await startBroker(fakeTelegram());
    const res = await fetch(`${url}/v1/sessions`, { method: "POST", body: JSON.stringify({ publicKey: "x", claimHash: "y" }) });
    expect(res.status).toBe(400);
  });
});

describe("web setup, one-tap Telegram bot", () => {
  it("goes from Create my bot to Telegram connected without a token or BotFather", async () => {
    const tg = fakeTelegram();
    const { b, url } = await startBroker(tg);
    const home = mkdtempSync(join(tmpdir(), "fren-onetap-"));
    const runs: string[] = [];
    const run: Runner = async (file, args) => {
      runs.push(`${file} ${args.join(" ")}`);
      return { code: 0, stdout: "", stderr: "" };
    };
    const deps: SetupDeps = {
      paths: frenPaths(join(home, ".fren")),
      io: { ask: async () => "", say: () => {}, close: () => {} },
      run,
      fetchFn: routed(tg.fetchFn),
      sleep: async () => {},
      openclawBin: "openclaw",
      pluginDir: "/app/plugin",
      frenCommand: ["node", "cli.js"],
      platform: "linux",
      home,
      user: "fren",
      writeFile: () => {},
      exists: existsSync,
      botBroker: url,
    };
    const SETUP = "s3cr3t-setup-token-0123456789abcdef";
    const server = createSetupServer(deps, { token: SETUP });
    open.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, body?: Record<string, unknown>) => {
      const res = await fetch(base + path, { method, headers: { cookie: `fren_setup=${SETUP}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };

    expect((await call("GET", "/api/state")).json.oneTapBot).toBe(true);
    const page = await (await fetch(`${base}/setup`, { headers: { cookie: `fren_setup=${SETUP}` } })).text();
    expect(page).toContain("Create my bot in Telegram");

    const made = await call("POST", "/api/telegram/new");
    expect(String(made.json.link)).toMatch(/^https:\/\/t\.me\/newbot\/fren_setup_bot\/fren_[0-9a-f]{10}_bot\?name=Fren$/);
    expect((await call("POST", "/api/telegram/new/wait")).json).toEqual({ ready: false });

    await created(b, String(made.json.username));
    const done = await call("POST", "/api/telegram/new/wait");
    expect(done.json).toEqual({ ready: true, bot: "fren_abc_bot", owner: "Bee" });
    expect(runs).toContain(`openclaw config set commands.ownerAllowFrom ["telegram:${OWNER}"]`);
    expect(runs).toContain(`openclaw channels add --channel telegram --token ${NEWBOT}`);
    expect((await call("GET", "/api/state")).json.channel).toBe("telegram");

    const fin = await call("POST", "/api/finish", { restricted: false });
    expect(fin.status).toBe(200);
    expect(JSON.parse(readFileSync(deps.paths.config, "utf8")).telegram).toEqual({ botToken: NEWBOT, ownerChatId: String(OWNER) });
  });

  it("is off without a broker, and the BotFather path stays", async () => {
    const home = mkdtempSync(join(tmpdir(), "fren-onetap-"));
    const deps = {
      paths: frenPaths(join(home, ".fren")),
      io: { ask: async () => "", say: () => {}, close: () => {} },
      run: (async () => ({ code: 0, stdout: "", stderr: "" })) as Runner,
      fetchFn: fakeTelegram().fetchFn,
      sleep: async () => {},
      openclawBin: "openclaw",
      pluginDir: "/app/plugin",
      frenCommand: ["node", "cli.js"],
      platform: "linux" as const,
      home,
      user: "fren",
      writeFile: () => {},
      exists: existsSync,
    };
    const SETUP = "s3cr3t-setup-token-0123456789abcdef";
    const server = createSetupServer(deps, { token: SETUP });
    open.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/telegram/new`, { method: "POST", headers: { cookie: `fren_setup=${SETUP}`, "content-type": "application/json" } });
    expect(((await res.json()) as { error: string }).error).toMatch(/BotFather/);
  });
});
