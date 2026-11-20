import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The owner's Telegram line, read from OpenClaw's own config when Fren's has
 * none. Installs made before Fren kept its own copy (and ones set up by hand)
 * only told the engine "send through the gateway", which can't show named
 * links or pictures. The bot token and the owner's chat id are both in
 * OpenClaw's config, which the engine already gets a copy of (`fren isolate`
 * copies it for `openclaw message send`), so receipts go straight to Telegram.
 */
export interface TelegramOwner {
  botToken: string;
  ownerChatId: string;
}

const TOKEN_RE = /^\d+:[\w-]{20,}$/;
const ID_RE = /^-?\d{3,}$/;

/** OpenClaw's config is JSON5: comments and trailing commas are allowed. */
export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Strip comments outside strings, then trailing commas.
    let out = "";
    let inStr: string | null = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (inStr) {
        out += c;
        if (c === "\\") out += text[++i] ?? "";
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        out += c;
      } else if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        out += "\n";
      } else if (c === "/" && text[i + 1] === "*") {
        i = text.indexOf("*/", i + 2);
        if (i < 0) break;
        i++;
      } else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** The bot token: channels.telegram.botToken, or the only (or "default") account's. */
function botToken(tg: Obj): string | null {
  const direct = str(tg.botToken);
  if (TOKEN_RE.test(direct)) return direct;
  const accounts = obj(tg.accounts);
  if (!accounts) return null;
  const names = Object.keys(accounts);
  const pick = accounts.default ?? (names.length === 1 ? accounts[names[0]!] : undefined);
  const t = str(obj(pick)?.botToken);
  return TOKEN_RE.test(t) ? t : null;
}

/** The owner: commands.ownerAllowFrom ("telegram:123"), else the one id the bot lets in, else the notify target. */
function ownerId(cfg: Obj, tg: Obj, notify: { channel: string; to: string }[]): string | null {
  const owners = obj(cfg.commands)?.ownerAllowFrom;
  if (Array.isArray(owners)) {
    for (const o of owners) {
      const m = /^telegram:(-?\d+)$/.exec(str(o));
      if (m) return m[1]!;
    }
  }
  const allow = Array.isArray(tg.allowFrom) ? tg.allowFrom.map(str).map((s) => s.replace(/^telegram:/, "")).filter((s) => ID_RE.test(s)) : [];
  if (allow.length === 1) return allow[0]!;
  const target = notify.find((n) => n.channel === "telegram")?.to.replace(/^telegram:/, "");
  return target && ID_RE.test(target) ? target : null;
}

export function telegramFromOpenClaw(configText: string, notify: { channel: string; to: string }[] = []): TelegramOwner | null {
  let cfg: Obj | null;
  try {
    cfg = obj(parseLooseJson(configText));
  } catch {
    return null;
  }
  const tg = obj(obj(cfg?.channels)?.telegram);
  if (!cfg || !tg || tg.enabled === false) return null;
  const token = botToken(tg);
  const owner = ownerId(cfg, tg, notify);
  return token && owner ? { botToken: token, ownerChatId: owner } : null;
}

/** OpenClaw's config file for this user (OPENCLAW_CONFIG_PATH, else ~/.openclaw/openclaw.json). */
export function openClawConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.OPENCLAW_CONFIG_PATH || join(env.OPENCLAW_STATE_DIR || join(home, ".openclaw"), "openclaw.json");
}

export function readTelegramOwner(notify: { channel: string; to: string }[], path = openClawConfigPath()): TelegramOwner | null {
  try {
    return telegramFromOpenClaw(readFileSync(path, "utf8"), notify);
  } catch {
    return null;
  }
}
