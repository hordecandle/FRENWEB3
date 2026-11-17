import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frenPaths } from "./config.js";
import { findTelegramOwner, guardExisting, runSetup, systemdUnit, type Prompt, type Runner, type SetupDeps } from "./setup.js";

const TOKEN = "123456789:AAtesttokentesttokentesttokentest";

function scriptedIo(answers: string[]): Prompt & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    ask: async (q, fallback) => {
      out.push(`? ${q}`);
      const a = answers.shift();
      if (a === undefined) throw new Error(`No answer scripted for "${q}"`);
      return a === "" && fallback !== undefined ? fallback : a;
    },
    say: (t) => out.push(t),
    close: () => {},
  };
}

/** Telegram Bot API fake: getMe works for TOKEN; getUpdates returns `updates` once. */
function fakeTelegram(updates: unknown[], getUpdatesError?: number) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let served = false;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith("https://api.telegram.org/")) {
      // AI company key check: keys with "bad" in them are refused.
      const auth = JSON.stringify(init?.headers ?? {});
      return new Response("{}", { status: auth.includes("bad") ? 401 : 200 });
    }
    const [, token, method] = String(url).match(/bot([^/]+)\/(\w+)$/)!;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method: method!, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    if (token !== TOKEN) return json({ ok: false, error_code: 401 });
    if (method === "getMe") return json({ ok: true, result: { username: "my_fren_bot" } });
    if (method === "getUpdates") {
      if (getUpdatesError) return json({ ok: false, error_code: getUpdatesError });
      const result = served ? [] : updates;
      served = true;
      return json({ ok: true, result });
    }
    return json({ ok: true, result: {} });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function fakeRunner(modelsReady: boolean) {
  const runs: string[] = [];
  const run: Runner = async (file, args, opts) => {
    runs.push(`${opts?.interactive ? "[tty] " : ""}${file} ${args.join(" ")}`);
    if (args[0] === "--version") return { code: 0, stdout: "OpenClaw 2026.10.5 (1b58cb9)", stderr: "" };
    if (args[0] === "models") {
      return { code: 0, stdout: JSON.stringify({ defaultModel: "anthropic/claude", auth: { missingProvidersInUse: modelsReady ? [] : ["anthropic"] } }), stderr: "" };
    }
    if (file === "systemctl" || file === "launchctl" || file === "loginctl") return { code: 1, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, runs };
}

function deps(over: Partial<SetupDeps> & Pick<SetupDeps, "io" | "run" | "fetchFn">): SetupDeps {
  const home = mkdtempSync(join(tmpdir(), "fren-setup-"));
  const files: Record<string, string> = {};
  return {
    paths: frenPaths(join(home, ".fren")),
    sleep: async () => {},
    openclawBin: "openclaw",
    pluginDir: "/app/packages/openclaw-plugin",
    frenCommand: ["/usr/bin/node", "/app/packages/engine/dist/cli.js"],
    platform: "linux",
    home,
    user: "fren",
    writeFile: (p, t) => (files[p] = t),
    exists: () => false,
    ...over,
  };
}

const startMessage = {
  update_id: 41,
  message: { chat: { type: "private" }, from: { id: 777000123, is_bot: false, first_name: "Bee", username: "beeonchain" } },
};

describe("fren setup", () => {
  it("stops before any question when the keys are locked away with the engine user", async () => {
    const { run, runs } = fakeRunner(false);
    const io = scriptedIo([]);
    const d = deps({ io, run, fetchFn: fakeTelegram([]).fetchFn });
    mkdirSync(d.paths.home, { recursive: true });
    writeFileSync(join(d.paths.home, "engine.json"), JSON.stringify({ engineUser: "fren-engine", frenHome: "/var/lib/fren-engine/.fren" }));
    await expect(runSetup(d, { server: true })).rejects.toThrow(/locked away/);
    expect(io.out.some((l) => l.startsWith("?"))).toBe(false);
    expect(runs).toEqual([]);
  });

  it("links Telegram with the owner as the only sender, creates wallets and installs the plugin", async () => {
    const tg = fakeTelegram([startMessage]);
    const { run, runs } = fakeRunner(false);
    // AI company 1 (OpenRouter), a short key, a refused key, a good key; chat 1 (telegram), token,
    // "is that you" yes, network 1 (mainnet), no Jupiter key, backup not saved yet, then saved.
    const io = scriptedIo(["1", "short", "sk-or-v1-bad-key-000", "sk-or-v1-good-key-123", "1", TOKEN, "y", "1", "", "n", "y"]);
    const d = deps({ io, run, fetchFn: tg.fetchFn });

    const res = await runSetup(d, { server: true });

    expect(res.channel).toBe("telegram");
    expect(res.network).toBe("mainnet");
    expect(res.addresses.solana).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    // The AI key is asked here like on the setup page, checked, then saved without OpenClaw's prompts.
    expect(io.out).toContain("Paste the whole key.");
    expect(io.out.some((l) => l.startsWith("OpenRouter (any model) says this key doesn't work."))).toBe(true);
    expect(runs.some((r) => r.startsWith("[tty]"))).toBe(false);
    expect(runs.some((r) => r.includes("onboard --non-interactive") && r.includes("--openrouter-api-key sk-or-v1-good-key-123") && !r.includes("bad"))).toBe(true);
    expect(runs).toContain(`openclaw config set agents.defaults.model.primary "openrouter/anthropic/claude-haiku-4.5"`);
    expect(io.out).toContain("? AI key (hidden while you paste)");
    expect(io.out).toContain("Copy the two files above first, then type y.");
    expect(io.out.some((l) => l.includes("paper mode: real prices, pretend money"))).toBe(true);
    expect(runs).toContain(`openclaw config set channels.telegram.allowFrom ["777000123"]`);
    expect(runs).toContain("openclaw config set channels.telegram.dmPolicy allowlist");
    expect(runs).toContain(`openclaw config set commands.ownerAllowFrom ["telegram:777000123"]`);
    expect(runs).toContain(`openclaw channels add --channel telegram --token ${TOKEN}`);
    expect(runs).toContain("openclaw plugins install --link --accept-capabilities --force /app/packages/openclaw-plugin");
    // C1: the agent gets chat and Fren's tools, no shell, files, browser or admin.
    expect(runs).toContain(`openclaw config set tools.profile "messaging"`);
    expect(runs).toContain(`openclaw config set tools.alsoAllow ["fren","web_search"]`);
    const deny = runs.find((r) => r.startsWith("openclaw config set tools.deny "));
    expect(JSON.parse(deny!.slice("openclaw config set tools.deny ".length))).toEqual(expect.arrayContaining(["group:runtime", "group:fs", "group:automation"]));
    expect(runs).toContain("openclaw config set tools.elevated.enabled false");
    // Loop guard: no background turns, a deadline per answer, loop detection, no groups.
    expect(runs).toContain(`openclaw config set agents.defaults.heartbeat.every "0m"`);
    expect(runs).toContain("openclaw config set cron.enabled false");
    expect(runs).toContain("openclaw config set agents.defaults.timeoutSeconds 600");
    expect(runs).toContain("openclaw config set tools.loopDetection.enabled true");
    expect(runs).toContain("openclaw config set tools.exec.notifyOnExit false");
    expect(runs).toContain("openclaw config set plugins.entries.fren.hooks.allowConversationAccess true");
    // Fren's own voice goes into the OpenClaw workspace (under this install's home), and the terminal says what it's doing.
    expect(readFileSync(join(d.home, ".openclaw/workspace/IDENTITY.md"), "utf8")).toMatch(/Name: Fren/);
    expect(io.out.some((l) => l.startsWith("Linking your bot to OpenClaw"))).toBe(true);
    expect(io.out.some((l) => l.startsWith("Making your wallets and setting up OpenClaw"))).toBe(true);
    expect(runs).toContain(`openclaw config set channels.telegram.groupPolicy "disabled"`);
    // Server mode: the VPS installer owns the services.
    expect(runs.some((r) => r.startsWith("systemctl") || r.startsWith("openclaw daemon"))).toBe(false);

    const cfg = JSON.parse(readFileSync(d.paths.config, "utf8"));
    expect(cfg.network).toBe("mainnet");
    expect(cfg.telegram).toEqual({ botToken: TOKEN, ownerChatId: "777000123" });
    // The old /start is acknowledged so the agent doesn't answer it later.
    expect(tg.calls.filter((c) => c.method === "getUpdates").at(-1)?.body.offset).toBe(42);
  });

  it("skips OpenClaw's model login when a model is already set up", async () => {
    const tg = fakeTelegram([startMessage]);
    const { run, runs } = fakeRunner(true);
    const io = scriptedIo(["n", "1", TOKEN, "y", "2", "", "y"]);
    const res = await runSetup(deps({ io, run, fetchFn: tg.fetchFn }), { server: true });
    expect(res.network).toBe("testnet");
    expect(runs.some((r) => r.includes("onboard"))).toBe(false);
  });

  it("can still hand the AI login to OpenClaw's own setup", async () => {
    const tg = fakeTelegram([startMessage]);
    const { run, runs } = fakeRunner(false);
    const io = scriptedIo(["5", "1", TOKEN, "y", "1", "", "y"]);
    await runSetup(deps({ io, run, fetchFn: tg.fetchFn }), { server: true });
    expect(runs).toContain("[tty] openclaw onboard --flow quickstart --skip-channels --skip-ui --skip-search --skip-daemon");
  });

  it("asks for the token again when it's wrong", async () => {
    const tg = fakeTelegram([startMessage]);
    const { run } = fakeRunner(true);
    const io = scriptedIo(["n", "1", "nope", TOKEN, "y", "1", "", "y"]);
    await runSetup(deps({ io, run, fetchFn: tg.fetchFn }), { server: true });
    expect(io.out).toContain("That token didn't work. Copy it again from BotFather, the whole thing.");
  });

  it("links WhatsApp with the QR login and sends codes to the owner's own number", async () => {
    const tg = fakeTelegram([]);
    const { run, runs } = fakeRunner(true);
    const io = scriptedIo(["n", "2", "+44 7700 900123", "1", "", "y"]);
    const d = deps({ io, run, fetchFn: tg.fetchFn });
    const res = await runSetup(d, { server: true });
    expect(res.channel).toBe("whatsapp");
    // Added without OpenClaw's prompts, as on the setup page; only the QR needs the terminal.
    expect(runs).toContain("openclaw plugins install @openclaw/whatsapp --force");
    expect(runs).toContain("openclaw channels add --channel whatsapp --account default");
    expect(runs).toContain(`openclaw config set channels.whatsapp.allowFrom ["+447700900123"]`);
    expect(runs).toContain(`openclaw config set commands.ownerAllowFrom ["whatsapp:+447700900123"]`);
    expect(runs).toContain(`openclaw config set channels.whatsapp.groupPolicy "disabled"`);
    expect(runs).toContain("openclaw config set channels.whatsapp.selfChatMode false");
    expect(runs).toContain("openclaw config set agents.defaults.heartbeat.every \"0m\"");
    // Not linked during "channels add", so it asks for the QR again.
    expect(runs).toContain("[tty] openclaw channels login --channel whatsapp");
    expect(JSON.parse(readFileSync(d.paths.config, "utf8")).notify).toEqual([{ channel: "whatsapp", to: "+447700900123" }]);
  });

  it("installs services locally and keeps the same wallets on a second run", async () => {
    const tg = fakeTelegram([startMessage]);
    const { run, runs } = fakeRunner(true);
    const io = scriptedIo(["n", "1", TOKEN, "y", "1", "", "y"]);
    const d = deps({ io, run, fetchFn: tg.fetchFn });
    const first = await runSetup(d, { server: false });
    expect(runs).toContain("openclaw daemon restart");
    // No systemd here: it says how to start the engine instead of claiming it's live.
    expect(io.out.some((l) => l.includes("Your Fren is set up. Start the two commands above"))).toBe(true);
    expect(io.out.some((l) => l.includes("Your Fren is live."))).toBe(false);
    const again = await runSetup({ ...d, io: scriptedIo(["n", "1", TOKEN, "y", "1", "", "y"]), fetchFn: fakeTelegram([startMessage]).fetchFn }, { server: false });
    expect(again.addresses).toEqual(first.addresses);
  });

  it("fails clearly when OpenClaw is missing", async () => {
    const run: Runner = async () => ({ code: 127, stdout: "", stderr: "not found" });
    await expect(runSetup(deps({ io: scriptedIo([]), run, fetchFn: fakeTelegram([]).fetchFn }), { server: false })).rejects.toThrow(/OpenClaw isn't installed/);
  });
});

describe("findTelegramOwner", () => {
  it("falls back to asking when OpenClaw already reads the bot", async () => {
    const io = scriptedIo(["abc", "777000123"]);
    const owner = await findTelegramOwner({ io, fetchFn: fakeTelegram([], 409).fetchFn, sleep: async () => {} }, TOKEN, "my_fren_bot");
    expect(owner.id).toBe("777000123");
    expect(io.out).toContain("Another app is already connected to this bot. Enter your Telegram ID below instead.");
  });

  it("ignores bots and group messages", async () => {
    const group = { update_id: 1, message: { chat: { type: "group" }, from: { id: 5, is_bot: false, first_name: "X" } } };
    const bot = { update_id: 2, message: { chat: { type: "private" }, from: { id: 6, is_bot: true, first_name: "B" } } };
    const io = scriptedIo(["y"]);
    const owner = await findTelegramOwner({ io, fetchFn: fakeTelegram([group, bot, startMessage]).fetchFn, sleep: async () => {} }, TOKEN, "b");
    expect(owner).toEqual({ id: "777000123", name: "Bee (@beeonchain)" });
  });
});

describe("systemdUnit", () => {
  it("runs as the given user on a server", () => {
    const u = systemdUnit({ node: "/usr/bin/node", cli: "/opt/fren/cli.js", pathEnv: "/usr/bin", frenHome: "/home/fren/.fren", user: "fren" });
    expect(u).toContain("User=fren");
    expect(u).toContain("ExecStart=/usr/bin/node /opt/fren/cli.js start");
    expect(u).toContain("WantedBy=multi-user.target");
  });
});

describe("fren guard", () => {
  it("puts the loop guard on an existing install for the channels it has, then restarts the gateway", async () => {
    const runs: string[] = [];
    const run: Runner = async (file, args) => {
      runs.push(`${file} ${args.join(" ")}`);
      // Only Telegram is set up here.
      if (args[0] === "config" && args[1] === "get") return { code: args[2] === "channels.telegram" ? 0 : 1, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const said: string[] = [];
    await guardExisting({ run, openclawBin: "openclaw" }, (t) => said.push(t));
    expect(runs).toContain(`openclaw config set agents.defaults.heartbeat.every "0m"`);
    expect(runs).toContain("openclaw config set agents.defaults.timeoutSeconds 600");
    expect(runs).toContain(`openclaw config set channels.telegram.groupPolicy "disabled"`);
    expect(runs.some((r) => r.startsWith("openclaw config set channels.whatsapp"))).toBe(false);
    expect(runs.at(-1)).toBe("openclaw daemon restart");
    expect(said.join("\n")).toMatch(/Loop guard on \(telegram\)/);
  });
});
