import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { DASHBOARD_PAGE, LOGIN_PAGE } from "./dashboard-page.js";
import type { Fren, OwnerRequestResult } from "./engine.js";

/**
 * The owner's web dashboard: what Fren holds and is doing, plus the kill switch.
 *
 * It sits behind Caddy on the server's own HTTPS address and listens on
 * 127.0.0.1 only. There is no password: the owner sends /fren_dashboard to their
 * bot, the engine sends a one-time login link straight to the owner (on
 * Telegram that's the Bot API, which the AI agent never sees), and the link
 * opens a session cookie for 12 hours.
 *
 * The security model doesn't change: anything that loosens a limit, resumes
 * after a stop or closes live positions still needs the code Fren sends to the
 * owner, answered with /ok in the chat. The dashboard can only pause right away,
 * because pausing only ever makes Fren do less.
 */

const LINK_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_SESSIONS = 20;

export interface DashboardOptions {
  /** Public base URL, e.g. https://1-2-3-4.sslip.io */
  publicUrl: string;
  now?: () => number;
}

export class Dashboard {
  private readonly links = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  private readonly now: () => number;
  readonly publicUrl: string;

  constructor(
    private readonly fren: Fren,
    opts: DashboardOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.publicUrl = opts.publicUrl.replace(/\/+$/, "");
  }

  /** A one-time login link, good for 10 minutes. */
  newLink(): string {
    this.sweep();
    const t = randomBytes(24).toString("base64url");
    this.links.set(t, this.now() + LINK_TTL_MS);
    return `${this.publicUrl}/login?t=${t}`;
  }

  /** Makes a link and sends it to the owner privately. Falls back to returning it. */
  async sendLink(): Promise<{ text: string; link?: string }> {
    const link = this.newLink();
    const sent = await this.fren.tellOwner(`🔑 Your Fren dashboard:\n${link}\n\nWorks once, for 10 minutes. Don't share it.`);
    if (sent) return { text: "I sent you a login link for your dashboard in a private message. It works once, for 10 minutes." };
    return { text: "Here's your dashboard login link. It works once, for 10 minutes. Don't share it.", link };
  }

  private sweep() {
    const t = this.now();
    for (const [k, exp] of this.links) if (exp < t) this.links.delete(k);
    for (const [k, exp] of this.sessions) if (exp < t) this.sessions.delete(k);
  }

  private takeLink(t: string): boolean {
    this.sweep();
    const exp = this.links.get(t);
    this.links.delete(t);
    return exp !== undefined && exp >= this.now();
  }

  private newSession(): string {
    // Keep the newest sessions only: an old forgotten browser drops off first.
    while (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    const s = randomBytes(32).toString("base64url");
    this.sessions.set(s, this.now() + SESSION_TTL_MS);
    return s;
  }

  private session(req: IncomingMessage): string | null {
    this.sweep();
    const m = (req.headers.cookie ?? "").match(/(?:^|;\s*)fren_dash=([\w-]{20,})/);
    if (!m) return null;
    for (const [k] of this.sessions) {
      const a = Buffer.from(k);
      const b = Buffer.from(m[1]!);
      if (a.length === b.length && timingSafeEqual(a, b)) return k;
    }
    return null;
  }

  /** Everything the page shows, in one call. */
  async overview() {
    const limits = this.fren.limits();
    const [positions, wallet] = await Promise.all([
      this.fren.positions().catch((err: Error) => ({ error: err.message })),
      this.fren.wallet().catch(() => ({ addresses: null })),
    ]);
    const store = this.fren.store;
    const events = store.eventsSince(0).slice(-30).reverse();
    return {
      limits,
      spentTodayUsd: store.spentTodayUsd(limits.mode),
      paperUsdc: limits.mode === "paper" ? store.paperUsdc() : null,
      positions: Array.isArray(positions) ? positions : [],
      positionsError: Array.isArray(positions) ? null : positions.error,
      addresses: wallet.addresses,
      watching: store.plansWithStatus("active").map((p) => ({ id: p.id, createdAt: p.createdAt })),
      waitingForCode: store.plansWithStatus("pending_confirm").map((p) => p.id),
      events,
    };
  }

  server(): Server {
    return createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const html = (status: number, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", ...headers });
        res.end(body);
      };
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      try {
        if (req.method === "GET" && url.pathname === "/login") {
          const t = url.searchParams.get("t") ?? "";
          if (!this.takeLink(t)) return html(403, LOGIN_PAGE("That link has expired or was already used. Send /fren_dashboard to your bot for a new one."));
          const s = this.newSession();
          return html(303, "", {
            location: "/",
            "set-cookie": `fren_dash=${s}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
          });
        }

        const session = this.session(req);
        if (req.method === "GET" && url.pathname === "/") {
          return session ? html(200, DASHBOARD_PAGE) : html(401, LOGIN_PAGE("Send /fren_dashboard to your Fren bot. It replies with a private login link."));
        }
        if (!url.pathname.startsWith("/api/")) return json(404, { error: "not found" });
        if (!session) return json(401, { error: "Logged out. Send /fren_dashboard to your bot for a new link." });

        if (req.method === "GET" && url.pathname === "/api/overview") return json(200, await this.overview());

        if (req.method !== "POST") return json(405, { error: "POST only." });
        // A cross-site form can't set this header, on top of SameSite=Strict.
        if (req.headers["x-fren"] !== "1") return json(403, { error: "forbidden" });
        const body = await readJson(req);
        const owner = (r: OwnerRequestResult) => ({
          text: r.codeSentPrivately === false || r.ownerCode ? `${r.text}\nSend /fren_code in your chat to see the code.` : r.text,
          needsCode: Boolean(r.codeSentPrivately !== undefined || r.ownerCode),
        });
        switch (url.pathname) {
          case "/api/pause":
            return json(200, { text: await this.fren.stop() });
          case "/api/resume":
            return json(200, owner(await this.fren.requestResume()));
          case "/api/limits":
            return json(200, owner(await this.fren.changeLimits(String(body.args ?? ""))));
          case "/api/close_all":
            return json(200, owner(await this.fren.requestCloseAll()));
          case "/api/logout":
            this.sessions.delete(session);
            return json(200, { ok: true });
        }
        return json(404, { error: "not found" });
      } catch (err) {
        return json(500, { error: (err as Error).message });
      }
    });
  }
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16 * 1024) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

