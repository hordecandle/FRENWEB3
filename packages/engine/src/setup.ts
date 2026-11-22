import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { FrenPaths, InitOptions } from "./config.js";
import { initFren } from "./config.js";
import { restrictedCountriesText } from "@fren/core";
import type { Fetch } from "./http.js";
import { claimManagedBot, startManagedBot } from "./managed-bot.js";
import { writePersona } from "./persona.js";

/**
 * `fren setup`: the guided first run. It asks a handful of questions and does
 * everything the README's quick start does by hand: OpenClaw's model login,
 * Telegram or WhatsApp with you as the only allowed sender and owner, wallets,
 * the plugin, and background services. Safe to run again: wallets are kept.
 */

export interface Prompt {
  /** `secret`: the answer isn't echoed (AI keys, bot tokens). */
  ask(question: string, fallback?: string, opts?: { secret?: boolean }): Promise<string>;
  say(text: string): void;
  close(): void;
}

/** Runs a program. `interactive` hands it the terminal (QR codes, OpenClaw's own prompts). */
export type Runner = (file: string, args: string[], opts?: { interactive?: boolean }) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface SetupDeps {
  paths: FrenPaths;
  io: Prompt;
  run: Runner;
  fetchFn: Fetch;
  sleep(ms: number): Promise<void>;
  openclawBin: string;
  /** packages/openclaw-plugin in this checkout. */
  pluginDir: string;
  /** How to start the engine: [node, cli.js]. */
  frenCommand: string[];
  platform: NodeJS.Platform;
  home: string;
  user: string;
  writeFile(path: string, text: string): void;
  exists(path: string): boolean;
  /** Fren's bot broker URL (FREN_BOT_BROKER): one-tap Telegram bots instead of BotFather. */
  botBroker?: string;
}

export interface SetupOptions {
  /** The VPS installer runs the engine and gateway as system services itself. */
  server: boolean;
}

export interface SetupResult {
  channel: "telegram" | "whatsapp";
  network: "mainnet" | "testnet";
  addresses: { solana: string; evm: string; hlAgent: string };
}

const E164 = /^\+[1-9]\d{6,14}$/;

export async function runSetup(deps: SetupDeps, opts: SetupOptions): Promise<SetupResult> {
  const { io } = deps;
  try {
    // Isolated: say so before the questions, not after five minutes of them.
    if (isolatedMarker(deps.paths)) throw new Error(LOCKED_AWAY);
    io.say(`
  ┌───────────────────────────────────────────┐
  │  Fren setup: a few questions, ~5 minutes  │
  └───────────────────────────────────────────┘
`);
    const oc = await openclawVersion(deps);
    if (!oc) {
      throw new Error(`OpenClaw isn't installed (looked for "${deps.openclawBin}"). Install it with:\n  curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard\nthen run \`fren setup\` again.`);
    }
    io.say(`✓ OpenClaw ${oc}`);

    // Same three steps, order and words as the setup page in the browser
    // (setup-page.ts): AI key, chat, wallets.
    io.say(stepTitle(1, "AI key"));
    await modelLogin(deps, opts);

    io.say(stepTitle(2, "Chat"));
    const channel = await choose(io, "Where do you want to talk to Fren?", [
      ["telegram", "Telegram (beta, recommended). Confirm codes come on a separate line the AI never sees."],
      ["whatsapp", "WhatsApp (beta). Needs a spare number for Fren."],
    ]);
    const line = channel === "telegram" ? await setupTelegram(deps) : await setupWhatsApp(deps);

    io.say(stepTitle(3, "Wallets"));
    io.say("Last thing: Fren makes two wallets for you, right here on this computer.");
    const network = await choose(io, "Network", [
      ["mainnet", "Mainnet (recommended): real prices, pretend money until you switch to live."],
      ["testnet", "Testnet: a practice network for developers."],
    ]);
    const jupiterApiKey = (await io.ask("Jupiter key (optional, makes fast buys of brand-new Solana coins more reliable; free at portal.jup.ag; Enter to skip)", "")).trim();

    const restrictedRegion = await restrictedQuestion(io);

    io.say("Making your wallets and setting up OpenClaw, about a minute, keep this window open…");
    const { addresses } = await finishSetup(deps, { network, jupiterApiKey, restrictedRegion, line });
    io.say(`
✓ Your wallets are ready
  Fren starts in paper mode: real prices, pretend money. No real money moves until you say so.

  Solana · spot, meme coins and Solana yield
    ${addresses.solana}
  Arbitrum and Base · perps, bets and coins on these chains
    ${addresses.evm}
  To trade for real later: send USDC here, plus a little SOL and a little ETH (on Arbitrum or Base) to pay network fees.

  Your backup is these two files. Anyone with them controls these wallets; lose them and the money is gone:
    ${deps.paths.keystore}
    ${deps.paths.passphrase}
  Copy both somewhere safe and offline (a USB stick, a password manager).
`);
    for (;;) {
      if (await yes(io, "I saved my backup somewhere safe and offline", false)) break;
      io.say("Copy the two files above first, then type y.");
    }

    const running = opts.server ? true : await installServices(deps);

    const where = channel === "telegram" ? "Open your bot in Telegram and say gm" : "Text Fren's number on WhatsApp and say gm";
    io.say(`
  ${running ? "✓ Your Fren is live." : "✓ Your Fren is set up. Start the two commands above, then it's live."}
  ${where}. Try "what's my wallet", "long BTC 5x with $20", "stop everything".

  Your dashboard (balance in dollars, history, a short tour) is ready too: a login link arrives in the chat right after you say gm, or type "fren dashboard" in this terminal.

  Paper mode: real prices, pretend money, until you switch to live.
  When you're ready for real money, send it: /limits mode=live
`);
    return { channel, network, addresses };
  } finally {
    io.close();
  }
}

/** True when OpenClaw has a default model and credentials for it. */
export async function modelReady(deps: Pick<SetupDeps, "run" | "openclawBin">): Promise<boolean> {
  const status = await deps.run(deps.openclawBin, ["models", "status", "--json"]);
  try {
    const s = JSON.parse(status.stdout) as { defaultModel?: string; auth?: { missingProvidersInUse?: string[] } };
    return status.code === 0 && !!s.defaultModel && (s.auth?.missingProvidersInUse ?? []).length === 0;
  } catch {
    return false;
  }
}

/** API-key logins OpenClaw can do without prompts, for the web setup. */
export const MODEL_PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", authChoice: "apiKey", flag: "--anthropic-api-key", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI", authChoice: "openai-api-key", flag: "--openai-api-key", keyUrl: "https://platform.openai.com/api-keys" },
  openrouter: { label: "OpenRouter (any model)", authChoice: "openrouter-api-key", flag: "--openrouter-api-key", keyUrl: "https://openrouter.ai/keys" },
  gemini: { label: "Google Gemini", authChoice: "gemini-api-key", flag: "--gemini-api-key", keyUrl: "https://aistudio.google.com/apikey" },
} as const;
export type ModelProvider = keyof typeof MODEL_PROVIDERS;

/** Why a key couldn't be used: the person should hear it in plain words. */
export class ModelKeyError extends Error {}

/**
 * Ask the provider whether this key works, before anything is saved. Each probe
 * is a free read-only call (no model run, no cost). A rejected key says so; a
 * provider we can't reach doesn't pass it either, so "connected" always means it.
 */
export async function checkModelKey(fetchFn: Fetch, provider: ModelProvider, apiKey: string): Promise<void> {
  const p = MODEL_PROVIDERS[provider];
  const probes: Record<ModelProvider, [string, Record<string, string>]> = {
    anthropic: ["https://api.anthropic.com/v1/models?limit=1", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }],
    openai: ["https://api.openai.com/v1/models", { authorization: `Bearer ${apiKey}` }],
    // /models is public on OpenRouter; /auth/key is the call that checks the key.
    openrouter: ["https://openrouter.ai/api/v1/auth/key", { authorization: `Bearer ${apiKey}` }],
    gemini: ["https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": apiKey }],
  };
  const [url, headers] = probes[provider];
  let status: number;
  try {
    status = (await fetchFn(url, { headers, signal: AbortSignal.timeout(15_000) })).status;
  } catch {
    throw new ModelKeyError(`Couldn't reach ${p.label} to check your key. Check the connection and try again.`);
  }
  if (status === 400 || status === 401 || status === 403) {
    throw new ModelKeyError(`${p.label} says this key doesn't work. Copy it again from ${p.keyUrl} (the whole key) and paste it here.`);
  }
  if (status >= 500) throw new ModelKeyError(`${p.label} isn't answering right now. Try again in a minute.`);
  // 2xx, or 429 (rate-limited but the key itself is fine).
}

/**
 * A fixed model instead of the provider's "auto" router (the router doubled
 * reply times, FIXES_1.md § 5). Sonnet, not Haiku: the small model told the
 * owner to do steps its tools do themselves. Only providers where the name was
 * checked (OpenRouter's model list, 2026-11-19); others keep OpenClaw's default.
 */
export const FAST_MODELS: Partial<Record<ModelProvider, string>> = {
  openrouter: "openrouter/anthropic/claude-sonnet-5.5",
  anthropic: "anthropic/claude-sonnet-5-5",
};

/** Models earlier setups picked by default. An update moves them to the current default; a model the owner chose stays. */
export const PREVIOUS_DEFAULT_MODELS: Record<string, string> = {
  "openrouter/anthropic/claude-haiku-4.5": FAST_MODELS.openrouter!,
  "anthropic/claude-haiku-4-5": FAST_MODELS.anthropic!,
};

/** Move an old default model to the current one. Returns the new model, or null when nothing changed. */
export async function upgradeDefaultModel(deps: Pick<SetupDeps, "run" | "openclawBin">): Promise<string | null> {
  const r = await deps.run(deps.openclawBin, ["config", "get", "agents.defaults.model.primary"]);
  if (r.code !== 0) return null;
  const current = r.stdout.trim().split("\n").pop()?.trim().replace(/^"|"$/g, "") ?? "";
  const next = PREVIOUS_DEFAULT_MODELS[current];
  if (!next) return null;
  await setConfig(deps, "agents.defaults.model.primary", JSON.stringify(next));
  return next;
}

export async function configureModelKey(deps: Pick<SetupDeps, "run" | "openclawBin" | "fetchFn">, provider: ModelProvider, apiKey: string): Promise<void> {
  await saveModelKey(deps, provider, apiKey);
  const fast = FAST_MODELS[provider];
  if (fast) await setConfig(deps, "agents.defaults.model.primary", JSON.stringify(fast));
}

async function saveModelKey(deps: Pick<SetupDeps, "run" | "openclawBin" | "fetchFn">, provider: ModelProvider, apiKey: string): Promise<void> {
  await checkModelKey(deps.fetchFn, provider, apiKey);
  const p = MODEL_PROVIDERS[provider];
  const r = await deps.run(deps.openclawBin, [
    "onboard", "--non-interactive", "--accept-risk", "--flow", "quickstart",
    "--auth-choice", p.authChoice, p.flag, apiKey,
    "--skip-channels", "--skip-daemon", "--skip-ui", "--skip-search", "--skip-health", "--skip-skills",
  ]);
  if (r.code === 0) return;
  // A key that replaces an earlier one is saved "inactive" until activated.
  // The provider has just vouched for it above, so switch it on ourselves.
  const out = `${r.stdout}\n${r.stderr}`;
  const m = out.match(/models auth activate (\S+) --agent (\S+)/);
  if (m && /Replacement credential saved but inactive/i.test(out)) {
    const a = await deps.run(deps.openclawBin, ["models", "auth", "activate", m[1]!, "--agent", m[2]!]);
    if (a.code === 0) return;
    throw new Error(`OpenClaw saved the new key but couldn't switch to it: ${lastLines(a)}`);
  }
  throw new Error(`OpenClaw didn't accept that key: ${lastLines(r)}`);
}

function lastLines(r: { stdout: string; stderr: string }): string {
  return (r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n");
}

const LOCKED_AWAY = "Fren's keys are locked away with the engine user. Run `sudo fren isolate --undo` first, then setup, then `sudo fren isolate` (on a VPS `sudo fren setup` does all three).";

/** Wallets, config and the plugin: the last step of both setups. */
export async function finishSetup(
  deps: Pick<SetupDeps, "run" | "openclawBin" | "paths" | "pluginDir" | "home">,
  o: { network: "mainnet" | "testnet"; jupiterApiKey?: string; restrictedRegion?: boolean; line: Pick<InitOptions, "telegram" | "notify"> },
) {
  if (isolatedMarker(deps.paths)) {
    // Wallets live with the engine's own user now; a fresh initFren here would
    // quietly make new ones.
    throw new Error(LOCKED_AWAY);
  }
  const res = initFren(deps.paths, {
    network: o.network,
    ...(o.jupiterApiKey ? { jupiterApiKey: o.jupiterApiKey } : {}),
    ...(o.restrictedRegion !== undefined ? { restrictedRegion: o.restrictedRegion } : {}),
    ...o.line,
  });
  await mustRun(deps, deps.openclawBin, ["plugins", "install", "--link", "--accept-capabilities", "--force", deps.pluginDir], "install the Fren plugin");
  await lockDownAgentTools(deps);
  await applyLoopGuard(deps);
  await writePersona(deps);
  return res;
}

/**
 * The agent spends the owner's AI key, so it must not be able to spin. OpenClaw
 * settings (same keys on 2026.10.5 and 2026.11.x):
 * - no heartbeat and no automations: by default OpenClaw wakes the agent every
 *   30 min with the whole chat history; Fren's engine watches stops itself;
 * - one answer may take at most LOOP_GUARD_TURN_SECONDS (default is 48 hours),
 *   which also ends OpenClaw's model retries on errors;
 * - OpenClaw's tool-loop detection on (off by default);
 * - no wake-up turns after background commands (the agent has none anyway);
 * - the Fren plugin may see turns, for its own caps (guard.ts in the plugin):
 *   tool calls per answer, answers per minute and per day.
 * Groups and WhatsApp self-chat are shut per channel (LOOP_GUARD_CHANNEL).
 */
export const LOOP_GUARD_TURN_SECONDS = 600;
export const LOOP_GUARD: [string, string][] = [
  ["agents.defaults.heartbeat.every", JSON.stringify("0m")],
  ["cron.enabled", "false"],
  ["agents.defaults.timeoutSeconds", String(LOOP_GUARD_TURN_SECONDS)],
  ["tools.loopDetection.enabled", "true"],
  ["tools.exec.notifyOnExit", "false"],
  ["plugins.entries.fren.hooks.allowConversationAccess", "true"],
];
export const LOOP_GUARD_CHANNEL: Record<"telegram" | "whatsapp", [string, string][]> = {
  telegram: [["channels.telegram.groupPolicy", JSON.stringify("disabled")]],
  whatsapp: [
    ["channels.whatsapp.groupPolicy", JSON.stringify("disabled")],
    // Fren's own number writing to itself is never a message from the owner.
    ["channels.whatsapp.selfChatMode", "false"],
  ],
};

export async function applyLoopGuard(deps: Pick<SetupDeps, "run" | "openclawBin">, channels: ("telegram" | "whatsapp")[] = []): Promise<void> {
  for (const [path, value] of LOOP_GUARD) {
    await (LOOP_GUARD_IF_SUPPORTED.has(path) ? setConfigIfSupported : setConfig)(deps, path, value);
  }
  for (const ch of channels) for (const [path, value] of LOOP_GUARD_CHANNEL[ch]) await setConfig(deps, path, value);
}

/**
 * `fren guard`: the same settings for a Fren that is already installed, for
 * whichever channels OpenClaw has. Then the gateway restarts to load them.
 */
export async function guardExisting(deps: Pick<SetupDeps, "run" | "openclawBin">, say: (t: string) => void): Promise<void> {
  const channels: ("telegram" | "whatsapp")[] = [];
  for (const ch of ["telegram", "whatsapp"] as const) {
    if ((await deps.run(deps.openclawBin, ["config", "get", `channels.${ch}`])).code === 0) channels.push(ch);
  }
  await applyLoopGuard(deps, channels);
  say(`✓ Loop guard on${channels.length ? ` (${channels.join(", ")})` : ""}: no background AI turns, ${LOOP_GUARD_TURN_SECONDS} s per answer, loop detection, groups off`);
  const restarted = (await deps.run(deps.openclawBin, ["daemon", "restart"])).code === 0;
  say(restarted ? "✓ OpenClaw gateway restarted" : `! Restart the OpenClaw gateway yourself: ${deps.openclawBin} daemon restart`);
}

/**
 * `fren persona`: Fren's own AGENTS.md, SOUL.md and IDENTITY.md for an install that
 * was set up before (the bot sounded like a bare OpenClaw), then a gateway restart.
 */
export async function personaExisting(deps: Pick<SetupDeps, "run" | "openclawBin" | "pluginDir"> & { home?: string }, say: (t: string) => void): Promise<void> {
  const r = await writePersona(deps);
  say(`✓ Fren's persona in ${r.dir}${r.written.length ? ` (${r.written.join(", ")})` : " (already up to date)"}${r.removed ? ", first-run ritual removed" : ""}`);
  const model = await upgradeDefaultModel(deps).catch(() => null);
  if (model) say(`✓ Chat model switched to ${model}`);
  const restarted = (await deps.run(deps.openclawBin, ["daemon", "restart"])).code === 0;
  say(restarted ? "✓ OpenClaw gateway restarted" : `! Restart the OpenClaw gateway yourself: ${deps.openclawBin} daemon restart`);
}

/**
 * The agent chats and calls Fren's tools, nothing else: no shell, no code
 * runner, no file tools, no browser, no gateway or plugin admin. A prompt
 * injection then has no tool that reads the keystore, the passphrase, the API
 * token or the database from disk (SECURITY_REVIEW C1). Deny beats allow in
 * OpenClaw, so a later `tools.allow` can't quietly undo it.
 */
export const AGENT_TOOL_POLICY = {
  profile: "messaging",
  alsoAllow: ["fren", "web_search"],
  deny: ["group:runtime", "group:fs", "group:ui", "group:nodes", "group:automation", "web_fetch", "sessions_spawn", "subagents"],
} as const;

export async function lockDownAgentTools(deps: Pick<SetupDeps, "run" | "openclawBin">): Promise<void> {
  await setConfig(deps, "tools.profile", JSON.stringify(AGENT_TOOL_POLICY.profile));
  await setConfig(deps, "tools.alsoAllow", JSON.stringify(AGENT_TOOL_POLICY.alsoAllow));
  await setConfig(deps, "tools.deny", JSON.stringify(AGENT_TOOL_POLICY.deny));
  // Elevated mode is OpenClaw's escape hatch to host exec: keep it shut.
  await setConfig(deps, "tools.elevated.enabled", "false");
}

/** Written by `fren isolate` into the agent's ~/.fren: where the engine's files went. */
export function isolatedMarker(paths: Pick<FrenPaths, "home">): { engineUser: string; frenHome: string } | null {
  try {
    return JSON.parse(readFileSync(join(paths.home, "engine.json"), "utf8")) as { engineUser: string; frenHome: string };
  } catch {
    return null;
  }
}

export async function openclawVersion(deps: SetupDeps): Promise<string | null> {
  try {
    const r = await deps.run(deps.openclawBin, ["--version"]);
    if (r.code !== 0) return null;
    return r.stdout.match(/\d{4}\.\d+\.\d+/)?.[0] ?? r.stdout.trim();
  } catch {
    return null;
  }
}

function stepTitle(n: number, name: string): string {
  return `\n━━ Step ${n} of 3 · ${name} ━━`;
}

/**
 * The AI key, as on the setup page: pick the AI company, paste a key, Fren
 * checks it with one tiny request before saving. "Something else" hands over
 * to OpenClaw's own login (accounts and providers the page doesn't list).
 */
async function modelLogin(deps: SetupDeps, opts: SetupOptions): Promise<void> {
  const { io } = deps;
  const ready = await modelReady(deps);
  if (ready && !(await yes(io, "Fren already has an AI key. Change it?", false))) return;
  io.say("Fren thinks with an AI model. You add your own AI key, so you pay the AI company directly for what you use and nobody in between sees your chats.");
  const order: ModelProvider[] = ["openrouter", "anthropic", "openai", "gemini"];
  const name = (p: ModelProvider) => MODEL_PROVIDERS[p].label.replace(/ \(any model\)$/, "");
  const provider = await choose<ModelProvider | "other">(io, "AI company", [
    ...order.map((p): [ModelProvider, string] => [p, p === "openrouter" ? `${name(p)} (recommended): one key, any model` : name(p)]),
    ["other", "Something else: sign in with OpenClaw's own setup"],
  ]);
  if (provider !== "other") {
    const p = MODEL_PROVIDERS[provider];
    io.say(
      provider === "openrouter"
        ? `\nGet a key on OpenRouter: ${p.keyUrl}\n  1. Sign in with Google or email.\n  2. Add a few dollars of credit.\n  3. Create a key and paste it below.`
        : `\nGet a key on ${name(provider)}: ${p.keyUrl}\n  1. Sign in.\n  2. Add a few dollars of credit or pick a plan.\n  3. Create a key and paste it below.`,
    );
    io.say("It stays on this computer. We check it works with one tiny request.");
    for (;;) {
      const key = (await io.ask("AI key (hidden while you paste)", undefined, { secret: true })).trim();
      if (key.length < 10) {
        io.say("Paste the whole key.");
        continue;
      }
      io.say("Checking…");
      try {
        await configureModelKey(deps, provider, key);
        io.say(`✓ AI key works (${name(provider)})`);
        return;
      } catch (err) {
        if (!(err instanceof ModelKeyError)) throw err;
        io.say(err.message);
      }
    }
  }
  io.say(`
OpenClaw now asks which AI model Fren should think with, and logs you in.
Skip its chat channel step: Fren sets that up right after.
`);
  const args = ["onboard", "--flow", "quickstart", "--skip-channels", "--skip-ui", "--skip-search"];
  // On a VPS the installer runs the gateway as a system service; locally OpenClaw installs its own.
  args.push(opts.server ? "--skip-daemon" : "--install-daemon");
  const r = await deps.run(deps.openclawBin, args, { interactive: true });
  if (r.code !== 0) throw new Error("OpenClaw's setup didn't finish. Run `fren setup` again to retry.");
}

async function setupTelegram(deps: SetupDeps): Promise<{ telegram: { botToken: string; ownerChatId: string } }> {
  const { io } = deps;
  if (deps.botBroker) {
    const line = await oneTapTelegram(deps, deps.botBroker).catch((e: Error) => {
      io.say(`One-tap bot didn't work (${e.message}). Let's do it with BotFather.`);
      return null;
    });
    if (line) return line;
  }
  io.say(`
Make your bot with @BotFather (takes a minute):
  1. Open https://t.me/BotFather in Telegram and send /newbot.
  2. Pick a name, then a username that ends in "bot".
  3. Copy the token it sends you (looks like 123456789:AA...) and paste it here.
`);
  let token = "";
  let bot = "";
  for (;;) {
    token = (await io.ask("Bot token")).trim();
    const found = await telegramBot(deps.fetchFn, token);
    if (found) {
      bot = found;
      break;
    }
    io.say("That token didn't work. Copy it again from BotFather, the whole thing.");
  }
  io.say(`✓ Bot @${bot}`);

  const owner = await findTelegramOwner(deps, token, bot);
  io.say("Linking your bot to OpenClaw, about a minute, keep this window open…");
  const line = await configureTelegram(deps, token, owner.id);
  io.say(`✓ Telegram linked: only ${owner.name} can use @${bot}`);
  return line;
}

/** Telegram makes the bot after one tap; Fren's broker hands its token back sealed to us. */
async function oneTapTelegram(deps: SetupDeps, broker: string) {
  const { io } = deps;
  const s = await startManagedBot(deps.fetchFn, broker);
  io.say(`
Make your Telegram bot in one tap. Open this on the phone with Telegram and press Create:
  ${s.link}

Waiting for you to press Create (up to 15 minutes)…`);
  for (let i = 0; i < 300; i++) {
    const r = await claimManagedBot(deps.fetchFn, s);
    if (r) {
      const bot = await telegramBot(deps.fetchFn, r.token);
      if (!bot) throw new Error("Telegram didn't accept the new bot's token");
      io.say(`Got it: @${bot}. Linking it to OpenClaw, about a minute, keep this window open…`);
      const line = await configureTelegram(deps, r.token, r.owner.id);
      io.say(`✓ Telegram linked: only ${r.owner.name} can use @${bot}. Open it and press Start.`);
      return line;
    }
    await deps.sleep(3000);
  }
  throw new Error("nobody pressed Create for 15 minutes");
}

/** You are the only one who can talk to the bot, and the owner for /ok, /stop and /limits. */
export async function configureTelegram(deps: Pick<SetupDeps, "run" | "openclawBin" | "fetchFn">, token: string, ownerId: string) {
  await setConfig(deps, "channels.telegram.allowFrom", JSON.stringify([ownerId]));
  await setConfig(deps, "channels.telegram.dmPolicy", "allowlist");
  await setConfig(deps, "commands.ownerAllowFrom", JSON.stringify([`telegram:${ownerId}`]));
  await setConfig(deps, "agents.defaults.typingMode", JSON.stringify("instant")); // "typing…" right away, not after the model's first token
  for (const [path, value] of LOOP_GUARD_CHANNEL.telegram) await setConfig(deps, path, value);
  await mustRun(deps, deps.openclawBin, ["channels", "add", "--channel", "telegram", "--token", token], "add the Telegram channel");
  await telegram(deps.fetchFn, token, "sendMessage", { chat_id: ownerId, text: "✅ Fren found you. Setup is finishing; I'll be ready in a minute." });
  return { telegram: { botToken: token, ownerChatId: ownerId } };
}

export async function telegramBot(fetchFn: Fetch, token: string): Promise<string | null> {
  const me = await telegram<{ username: string }>(fetchFn, token, "getMe");
  return me.ok ? me.result.username : null;
}

/** One look for a private message to the bot (long-polls up to `waitS`). */
export async function pollTelegramOwner(fetchFn: Fetch, token: string, offset: number, waitS = 20) {
  const r = await telegram<TgUpdate[]>(fetchFn, token, "getUpdates", { offset, timeout: waitS, allowed_updates: ["message"] });
  if (!r.ok) return { busy: r.error_code === 409, offset, candidates: [] as { id: string; name: string }[] };
  const candidates: { id: string; name: string }[] = [];
  for (const u of r.result) {
    offset = u.update_id + 1;
    const from = u.message?.from;
    if (!from || from.is_bot || u.message?.chat.type !== "private") continue;
    candidates.push({ id: String(from.id), name: tgName(from) });
  }
  return { busy: false, offset, candidates };
}

function tgName(from: { first_name: string; last_name?: string; username?: string }): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ") + (from.username ? ` (@${from.username})` : "");
}

/** Mark updates read so the agent doesn't answer an old "/start" later. */
export async function ackTelegram(fetchFn: Fetch, token: string, offset: number): Promise<void> {
  await telegram(fetchFn, token, "getUpdates", { offset, timeout: 0 });
}

/**
 * Your Telegram user id, read from the message you send the bot, so nobody
 * has to look it up. Falls back to asking when OpenClaw is already reading
 * this bot (Telegram allows one reader) or nothing arrives.
 */
export async function findTelegramOwner(deps: Pick<SetupDeps, "io" | "fetchFn" | "sleep">, token: string, bot: string): Promise<{ id: string; name: string }> {
  const { io } = deps;
  io.say(`Now open your bot and press Start, so Fren knows it's you: https://t.me/${bot}`);
  let offset = 0;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const r = await pollTelegramOwner(deps.fetchFn, token, offset);
    if (r.busy) {
      io.say("Another app is already connected to this bot. Enter your Telegram ID below instead.");
      break;
    }
    if (r.offset === offset && !r.candidates.length) {
      // An error (not a 409) or nothing new.
      await deps.sleep(500);
    }
    offset = r.offset;
    for (const c of r.candidates) {
      if (await yes(io, `Got a message from ${c.name}. Is that you?`, true)) {
        await ackTelegram(deps.fetchFn, token, offset);
        return c;
      }
    }
  }
  io.say("Not working? Message @userinfobot on Telegram (https://t.me/userinfobot), copy the Id it shows, and paste it here.");
  for (;;) {
    const id = (await io.ask("Your Telegram ID")).trim();
    if (/^\d{1,15}$/.test(id)) return { id, name: id };
    io.say("Use the number @userinfobot shows as Id, digits only.");
  }
}

interface TgUpdate {
  update_id: number;
  message?: { chat: { type: string }; from?: { id: number; is_bot: boolean; first_name: string; last_name?: string; username?: string } };
}

type TgResult<T> = { ok: true; result: T } | { ok: false; error_code: number; description?: string };

async function telegram<T>(fetchFn: Fetch, token: string, method: string, body?: unknown): Promise<TgResult<T>> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as TgResult<T>;
  } catch {
    return { ok: false, error_code: 0 };
  }
}

async function setupWhatsApp(deps: SetupDeps): Promise<{ notify: { channel: string; to: string }[] }> {
  const { io } = deps;
  io.say(`
Fren needs its own WhatsApp: a spare number, like an old phone or a second SIM.
You scan one QR code, then text Fren from your usual phone.
`);
  let mine = "";
  for (;;) {
    mine = normalizePhone(await io.ask("Your usual WhatsApp number (the one you'll text Fren from), with country code, e.g. +447700900123")) ?? "";
    if (mine) break;
    io.say("Start with + and your country code, digits only after that.");
  }
  // The same non-interactive steps as the setup page, so OpenClaw asks nothing here.
  io.say("Getting WhatsApp ready (the first time can take about a minute)…");
  await mustRun(deps, deps.openclawBin, ["plugins", "install", "@openclaw/whatsapp", "--force"], "install OpenClaw's WhatsApp plugin");
  await mustRun(deps, deps.openclawBin, ["channels", "add", "--channel", "whatsapp", "--account", "default"], "add WhatsApp");
  if (!deps.exists(whatsappCreds(deps.home))) {
    io.say(`
On the spare phone (Fren's WhatsApp): Settings → Linked devices → Link a device, then scan the QR code below.
It refreshes by itself every few seconds.
`);
    await mustRun(deps, deps.openclawBin, ["channels", "login", "--channel", "whatsapp"], "link WhatsApp", true);
  }
  const line = await configureWhatsAppOwner(deps, mine);
  io.say(`✓ WhatsApp linked: only ${mine} can use it`);
  return line;
}

export function whatsappCreds(home: string): string {
  return join(home, ".openclaw/credentials/whatsapp/default/creds.json");
}

export async function configureWhatsAppOwner(deps: Pick<SetupDeps, "run" | "openclawBin">, number: string) {
  await setConfig(deps, "channels.whatsapp.allowFrom", JSON.stringify([number]));
  await setConfig(deps, "channels.whatsapp.dmPolicy", "allowlist");
  await setConfig(deps, "commands.ownerAllowFrom", JSON.stringify([`whatsapp:${number}`]));
  for (const [path, value] of LOOP_GUARD_CHANNEL.whatsapp) await setConfig(deps, path, value);
  return { notify: [{ channel: "whatsapp", to: number }] };
}

export function normalizePhone(raw: string): string | null {
  const n = raw.replace(/[\s()-]/g, "");
  return E164.test(n) ? n : null;
}

async function setConfig(deps: Pick<SetupDeps, "run" | "openclawBin">, path: string, value: string): Promise<void> {
  await mustRun(deps, deps.openclawBin, ["config", "set", path, value], `set ${path}`);
}

/**
 * Settings that turn a feature off, where an OpenClaw without the feature is
 * already where we want it. OpenClaw 2026.11.5 dropped agents.defaults.heartbeat
 * (and refuses the key), so on it there is no heartbeat to turn off.
 */
export const LOOP_GUARD_IF_SUPPORTED = new Set(["agents.defaults.heartbeat.every"]);

async function setConfigIfSupported(deps: Pick<SetupDeps, "run" | "openclawBin">, path: string, value: string): Promise<void> {
  const r = await deps.run(deps.openclawBin, ["config", "set", path, value], {});
  if (r.code === 0) return;
  if (/Unrecognized key/i.test(`${r.stderr}\n${r.stdout}`)) return;
  throw new Error(`Couldn't set ${path}: ${lastLines(r)}`);
}

async function mustRun(deps: Pick<SetupDeps, "run">, file: string, args: string[], what: string, interactive = false): Promise<string> {
  const r = await deps.run(file, args, { interactive });
  if (r.code !== 0) throw new Error(`Couldn't ${what}: ${lastLines(r)}`);
  return r.stdout;
}

/** The engine as a login service (launchd on macOS, systemd --user on Linux), then a gateway restart to load the plugin. */
async function installServices(deps: SetupDeps): Promise<boolean> {
  const { io } = deps;
  const [node, cli] = deps.frenCommand as [string, string];
  const pathEnv = [dirname(node), dirname(await whichOr(deps, deps.openclawBin)), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].join(":");
  let engine = false;
  if (deps.platform === "darwin") {
    const plist = join(deps.home, "Library/LaunchAgents/sh.fren.engine.plist");
    deps.writeFile(plist, launchdPlist(node, cli, pathEnv, deps.paths.home));
    await deps.run("launchctl", ["unload", plist]);
    engine = (await deps.run("launchctl", ["load", "-w", plist])).code === 0;
  } else if (deps.platform === "linux" && (await deps.run("systemctl", ["--user", "show-environment"])).code === 0) {
    deps.writeFile(join(deps.home, ".config/systemd/user/fren.service"), systemdUnit({ node, cli, pathEnv, frenHome: deps.paths.home }));
    await deps.run("systemctl", ["--user", "daemon-reload"]);
    engine = (await deps.run("systemctl", ["--user", "enable", "--now", "fren.service"])).code === 0;
    // Keep running after you log out.
    await deps.run("loginctl", ["enable-linger", deps.user]);
  }
  if (engine) io.say("✓ Fren engine runs in the background and starts at login");
  else io.say(`! Couldn't install a background service here. Keep this running in its own terminal:\n    ${node} ${cli} start`);

  const gateway =
    (await deps.run(deps.openclawBin, ["daemon", "restart"])).code === 0 ||
    (await deps.run(deps.openclawBin, ["daemon", "install"])).code === 0;
  if (gateway) io.say("✓ OpenClaw gateway restarted with Fren loaded");
  else io.say(`! Couldn't start the OpenClaw gateway in the background. Keep this running in another terminal:\n    ${deps.openclawBin} gateway run`);
  return engine && gateway;
}

async function whichOr(deps: SetupDeps, bin: string): Promise<string> {
  if (bin.includes("/")) return resolve(bin);
  const r = await deps.run("sh", ["-c", `command -v ${bin}`]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : "/usr/local/bin/openclaw";
}

export function systemdUnit(o: { node: string; cli: string; pathEnv: string; frenHome: string; user?: string }): string {
  return `[Unit]
Description=Fren engine (policy, signer, watcher)
After=network-online.target
Wants=network-online.target

[Service]
${o.user ? `User=${o.user}\n` : ""}Environment=FREN_HOME=${o.frenHome}
Environment=PATH=${o.pathEnv}
ExecStart=${o.node} ${o.cli} start
Restart=always
RestartSec=5

[Install]
WantedBy=${o.user ? "multi-user.target" : "default.target"}
`;
}

export function launchdPlist(node: string, cli: string, pathEnv: string, frenHome: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>sh.fren.engine</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>${cli}</string><string>start</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>FREN_HOME</key><string>${frenHome}</string><key>PATH</key><string>${pathEnv}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${frenHome}/engine.log</string>
  <key>StandardErrorPath</key><string>${frenHome}/engine.log</string>
</dict>
</plist>
`;
}

/** The same question as the setup page: does the owner live where Polymarket is restricted? */
export const RESTRICTED_QUESTION = "Do you live in a country where Polymarket is restricted?";
export const RESTRICTED_YES = "Polymarket stays close-only for you: Fren can close bets there but won't open new ones. Everything else works.";

async function restrictedQuestion(io: Prompt): Promise<boolean> {
  io.say(`\nRestricted countries: ${restrictedCountriesText()}.`);
  // No default: Enter alone doesn't answer this one.
  for (;;) {
    const a = (await io.ask(`${RESTRICTED_QUESTION} Type yes or no`)).trim().toLowerCase();
    if (a === "yes" || a === "y") {
      io.say(RESTRICTED_YES);
      return true;
    }
    if (a === "no" || a === "n") return false;
    io.say("Type yes or no.");
  }
}

async function choose<T extends string>(io: Prompt, question: string, options: [T, string][]): Promise<T> {
  io.say(`\n${question}`);
  options.forEach(([, label], i) => io.say(`  ${i + 1}) ${label}`));
  for (;;) {
    const a = (await io.ask("Pick one", "1")).trim();
    const picked = options[Number(a) - 1] ?? options.find(([v]) => v === a.toLowerCase());
    if (picked) return picked[0];
    io.say(`Type a number from 1 to ${options.length}.`);
  }
}

async function yes(io: Prompt, question: string, fallback: boolean): Promise<boolean> {
  const a = (await io.ask(`${question} [${fallback ? "Y/n" : "y/N"}]`, fallback ? "y" : "n")).trim().toLowerCase();
  return a.startsWith("y");
}

/** One line from the terminal without showing it (typing or pasting). Ctrl-C quits. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let s = "";
    let esc = false;
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (d: Buffer) => {
      for (const ch of d.toString("utf8")) {
        if (esc) {
          // Skip a terminal escape sequence (arrow keys and the like) up to its final letter.
          if (/[A-Za-z~]/.test(ch)) esc = false;
          continue;
        }
        if (ch === "\r" || ch === "\n") return done(), resolve(s);
        if (ch === "\u0003") {
          done();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u001b") esc = true;
        else if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
        else if (ch >= " ") s += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** The real terminal, programs and network. */
export function systemSetupDeps(paths: FrenPaths): SetupDeps {
  // One readline at a time: it's closed while an interactive program (OpenClaw's
  // own prompts, the WhatsApp QR) has the terminal, so the two don't fight over it.
  let rl: ReturnType<typeof createInterface> | undefined;
  const terminal = () => (rl ??= createInterface({ input: process.stdin, output: process.stdout }));
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    paths,
    io: {
      ask: async (q, fallback, o) => {
        const prompt = fallback ? `${q} (${fallback}): ` : `${q}: `;
        let a = "";
        if (o?.secret && process.stdin.isTTY) {
          // Readline would echo the key; read it from the raw terminal instead.
          rl?.close();
          rl = undefined;
          a = await readHidden(prompt);
          process.stdout.write(a ? "••••••\n" : "\n");
        } else {
          a = await terminal().question(prompt);
        }
        return a.trim() === "" && fallback !== undefined ? fallback : a;
      },
      say: (t) => console.log(t),
      close: () => {
        rl?.close();
        rl = undefined;
      },
    },
    run: (file, args, opts) =>
      new Promise((done) => {
        if (opts?.interactive) {
          rl?.close();
          rl = undefined;
        }
        const child = spawn(file, args, { stdio: opts?.interactive ? "inherit" : ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", (err) => done({ code: 127, stdout, stderr: err.message }));
        child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
      }),
    fetchFn: fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    openclawBin: process.env.OPENCLAW_BIN ?? "openclaw",
    pluginDir: resolve(here, "../../openclaw-plugin"),
    frenCommand: [process.execPath, resolve(here, "cli.js")],
    platform: platform(),
    home: homedir(),
    user: userInfo().username,
    writeFile: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    exists: existsSync,
    ...(process.env.FREN_BOT_BROKER ? { botBroker: process.env.FREN_BOT_BROKER } : {}),
  };
}
