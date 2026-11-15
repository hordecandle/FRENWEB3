import { constants, createHash, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Fetch } from "./http.js";

/**
 * One-tap Telegram bot creation (Telegram "managed bots", Bot API 9.6).
 *
 * Instead of chatting with @BotFather and copying a token, the owner opens
 *   https://t.me/newbot/<manager>/<suggested_username>?name=Fren
 * and confirms in Telegram. The bot is theirs. Telegram tells the manager bot
 * (one shared bot, run by the bot broker below) and only the manager can read
 * the new bot's token, so the broker hands it to the setup page that asked.
 *
 * The token never sits anywhere readable on the way: the setup page makes a
 * fresh RSA key pair per attempt and sends only the public half; the broker
 * seals the token to it the moment it reads it, keeps the sealed copy in
 * memory for at most a few minutes, gives it out once to whoever holds the
 * claim secret, then forgets it. Nothing is written to disk or logged.
 *
 * What this does not change: Telegram lets the manager bot read the token of
 * every bot made through it, at any time. Whoever holds the manager bot's
 * token can take over those bots. Keep it like a signing key.
 */

// ---------------------------------------------------------------- client side

export interface ManagedBotSession {
  broker: string;
  sid: string;
  claim: string;
  privateKey: string;
  link: string;
  /** t.me/<manager>?start=<sid>: for when the owner changed the suggested username. */
  fallback: string;
  username: string;
}

export interface ManagedBotResult {
  token: string;
  bot: { id: string; username: string };
  owner: { id: string; name: string };
}

/** Asks the broker for a creation link. The private key stays with the caller. */
export async function startManagedBot(fetchFn: Fetch, broker: string, name = "Fren"): Promise<ManagedBotSession> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const claim = b64url(randomBytes(32));
  const r = await brokerCall<{ sid: string; link: string; fallback: string; username: string }>(fetchFn, broker, "/v1/sessions", {
    publicKey,
    claimHash: sha256(claim),
    name,
  });
  return { broker, sid: r.sid, claim, privateKey, link: r.link, fallback: r.fallback, username: r.username };
}

/** Null while the owner hasn't confirmed yet; throws if the attempt expired. */
export async function claimManagedBot(fetchFn: Fetch, s: ManagedBotSession): Promise<ManagedBotResult | null> {
  const r = await brokerCall<
    | { status: "waiting" }
    | { status: "ready"; sealed: string; bot: { id: string; username: string }; owner: { id: string; name: string } }
  >(fetchFn, s.broker, "/v1/claim", { sid: s.sid, claim: s.claim });
  if (r.status === "waiting") return null;
  const token = privateDecrypt(
    { key: s.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(r.sealed, "base64"),
  ).toString("utf8");
  return { token, bot: r.bot, owner: r.owner };
}

export class BrokerError extends Error {
  constructor(
    message: string,
    readonly expired = false,
  ) {
    super(message);
  }
}

async function brokerCall<T>(fetchFn: Fetch, broker: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(broker.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BrokerError("Couldn't reach Fren's bot service. Use the BotFather steps below instead.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; expired?: boolean };
  if (!res.ok) throw new BrokerError(data.error ?? "Fren's bot service said no.", !!data.expired);
  return data as T;
}

// ---------------------------------------------------------------- broker side

export interface BrokerOptions {
  /** Token of the manager bot (Bot Management switched on in @BotFather). */
  managerToken: string;
  fetchFn: Fetch;
  /** How long a creation link stays good. */
  ttlMs?: number;
  maxSessions?: number;
  now?: () => number;
  log?: (line: string) => void;
}

interface Session {
  sid: string;
  publicKey: string;
  claimHash: Buffer;
  username: string;
  /** Telegram user who opened the fallback /start link for this session. */
  userId?: string;
  ready?: { sealed: string; bot: { id: string; username: string }; owner: { id: string; name: string } };
  expires: number;
}

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  can_manage_bots?: boolean;
}

interface TgUpdate {
  update_id: number;
  managed_bot?: { user: TgUser; bot: TgUser };
  message?: { chat: { id: number; type: string }; from?: TgUser; text?: string; managed_bot_created?: { bot: TgUser } };
}

export interface BotBroker {
  server: Server;
  /** Manager bot username, known after init(). */
  manager(): string;
  init(): Promise<void>;
  handleUpdate(u: TgUpdate): Promise<void>;
  /** Long-polls Telegram until stop() is called. */
  poll(): Promise<void>;
  stop(): void;
}

export function createBotBroker(o: BrokerOptions): BotBroker {
  const ttl = o.ttlMs ?? 15 * 60_000;
  const max = o.maxSessions ?? 500;
  const now = o.now ?? Date.now;
  const log = o.log ?? ((l: string) => console.log(l));
  const sessions = new Map<string, Session>();
  let managerName = "";
  let stopped = false;
  let offset = 0;

  const tg = <T>(method: string, body?: unknown) => tgCall<T>(o.fetchFn, o.managerToken, method, body);

  const sweep = () => {
    const t = now();
    for (const [k, s] of sessions) if (s.expires <= t) sessions.delete(k);
  };

  /** Telegram told us a bot was made; find whose attempt it was and seal its token. */
  async function deliver(user: TgUser, bot: TgUser) {
    sweep();
    const uname = (bot.username ?? "").toLowerCase();
    const s =
      [...sessions.values()].find((x) => !x.ready && x.username === uname) ??
      [...sessions.values()].find((x) => !x.ready && x.userId === String(user.id));
    if (!s) return; // token change, owner change, or a bot nobody here asked for
    const token = await tg<string>("getManagedBotToken", { user_id: bot.id });
    if (!token.ok) {
      log(`broker: couldn't read token for session ${s.sid.slice(0, 6)}… (${token.error_code})`);
      return;
    }
    s.ready = {
      sealed: publicEncrypt(
        { key: s.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        Buffer.from(token.result, "utf8"),
      ).toString("base64"),
      bot: { id: String(bot.id), username: bot.username ?? "" },
      owner: { id: String(user.id), name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "you" },
    };
    // Only the owner can open the bot, on Telegram's side too (Fren also allow-lists them).
    await tg("setManagedBotAccessSettings", { user_id: bot.id, is_access_restricted: true });
    log(`broker: bot ready for session ${s.sid.slice(0, 6)}…`);
  }

  async function handleUpdate(u: TgUpdate) {
    if (u.managed_bot) return deliver(u.managed_bot.user, u.managed_bot.bot);
    const m = u.message;
    if (!m || m.chat.type !== "private" || !m.from) return;
    if (m.managed_bot_created) return deliver(m.from, m.managed_bot_created.bot);
    // Fallback: /start <sid> ties this Telegram user to the session and offers the button,
    // for when the owner changed the suggested username in the one-tap dialog.
    const sid = /^\/start\s+([\w-]{8,64})$/.exec(m.text ?? "")?.[1];
    sweep();
    const s = sid ? sessions.get(sid) : undefined;
    if (!s || s.ready) {
      await tg("sendMessage", { chat_id: m.chat.id, text: "This is Fren's setup helper. Open the link from your Fren setup page to make your bot." });
      return;
    }
    s.userId = String(m.from.id);
    await tg("sendMessage", {
      chat_id: m.chat.id,
      text: "Tap the button to create your own Fren bot. It belongs to you.",
      reply_markup: {
        keyboard: [[{ text: "Create my Fren bot", request_managed_bot: { request_id: 1, suggested_name: "Fren", suggested_username: s.username } }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  const routes: Record<string, (b: Record<string, unknown>) => { status: number; body: unknown }> = {
    "/v1/sessions": (b) => {
      sweep();
      const publicKey = String(b.publicKey ?? "");
      const claimHash = String(b.claimHash ?? "");
      if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(publicKey) || !/^[0-9a-f]{64}$/.test(claimHash))
        return { status: 400, body: { error: "Bad request." } };
      try {
        publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from("x"));
      } catch {
        return { status: 400, body: { error: "Bad key." } };
      }
      if (sessions.size >= max) return { status: 503, body: { error: "Busy, try again in a minute." } };
      const sid = b64url(randomBytes(12));
      // 5–32 chars ending in "bot"; random part makes it free on Telegram and ties it to this session.
      const username = `fren_${randomBytes(5).toString("hex")}_bot`;
      const name = String(b.name ?? "Fren").slice(0, 64) || "Fren";
      sessions.set(sid, { sid, publicKey, claimHash: Buffer.from(claimHash, "hex"), username, expires: now() + ttl });
      return {
        status: 200,
        body: {
          sid,
          username,
          link: `https://t.me/newbot/${managerName}/${username}?name=${encodeURIComponent(name)}`,
          fallback: `https://t.me/${managerName}?start=${sid}`,
          expiresInS: Math.round(ttl / 1000),
        },
      };
    },
    "/v1/claim": (b) => {
      sweep();
      const s = sessions.get(String(b.sid ?? ""));
      const given = createHash("sha256").update(String(b.claim ?? "")).digest();
      if (!s || !timingSafeEqual(given, s.claimHash))
        return { status: 404, body: { error: "This link expired. Make a new one.", expired: true } };
      if (!s.ready) return { status: 200, body: { status: "waiting", fallback: `https://t.me/${managerName}?start=${s.sid}` } };
      sessions.delete(s.sid); // one claim, then gone
      return { status: 200, body: { status: "ready", ...s.ready } };
    },
  };

  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    const route = req.method === "POST" ? routes[new URL(req.url ?? "/", "http://b").pathname] : undefined;
    if (!route) return json(res, 404, { error: "Not found." });
    try {
      const r = route(await readJson(req));
      json(res, r.status, r.body);
    } catch {
      json(res, 400, { error: "Bad request." });
    }
  });

  return {
    server,
    manager: () => managerName,
    async init() {
      const me = await tg<TgUser>("getMe");
      if (!me.ok) throw new Error("The manager bot token didn't work.");
      if (!me.result.can_manage_bots)
        throw new Error(`@${me.result.username} can't manage bots yet. Turn on bot management for it in the @BotFather Mini App.`);
      managerName = me.result.username ?? "";
    },
    handleUpdate,
    async poll() {
      while (!stopped) {
        const r = await tg<TgUpdate[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "managed_bot"] });
        if (!r.ok) {
          await new Promise((res) => setTimeout(res, 3000));
          continue;
        }
        for (const u of r.result) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((e: Error) => log(`broker: update failed: ${e.message}`));
        }
      }
    },
    stop() {
      stopped = true;
    },
  };
}

/** `fren bot-broker`: the shared manager bot. Token from FREN_MANAGER_BOT_TOKEN only. */
export async function serveBotBroker(o: BrokerOptions & { host?: string; port?: number }): Promise<void> {
  const b = createBotBroker(o);
  await b.init();
  const host = o.host ?? "127.0.0.1";
  const port = o.port ?? 7430;
  await new Promise<void>((r) => b.server.listen(port, host, r));
  console.log(`Fren bot broker for @${b.manager()} on http://${host}:${port}`);
  await b.poll();
}

// ---------------------------------------------------------------- helpers

type TgResult<T> = { ok: true; result: T } | { ok: false; error_code: number; description?: string };

async function tgCall<T>(fetchFn: Fetch, token: string, method: string, body?: unknown): Promise<TgResult<T>> {
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

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (raw.length > 16_000) throw new Error("too large");
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}
