import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { describeMaxLoss, describeStep } from "@fren/core";
import { DashboardAuth, type Mailer, type WalletKind } from "./dashboard-auth.js";
import { okCommand, type ChatBridge } from "./dashboard-chat.js";
import { DASHBOARD_PAGE, LOGIN_PAGE, SIGNIN_PAGE } from "./dashboard-page.js";
import type { Fren, OwnerRequestResult } from "./engine.js";
import type { PendingAction, PendingKind } from "./store.js";

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
  /** The owner's conversation with Fren (the same one as in Telegram). None: the page has no chat. */
  chat?: ChatBridge | null;
  /** Sends email login codes. None: the email way in is off. */
  mailer?: Mailer | null;
  /** Shows the wallet keys after the owner's code. None: they stay locked in the signer. */
  keys?: KeyVault | null;
  /** The demo stand: plain-http cookie, a one-click login, codes shown on the page. Never on a real install. */
  demo?: boolean;
  /** A dashboard on the owner's own computer: plain http on 127.0.0.1, so the cookie can't be Secure. */
  local?: boolean;
}

/** What the owner can copy out to keep a backup of the wallets. */
export interface KeyVault {
  reveal(): Promise<{ label: string; value: string }[]>;
}

const KEY_CODE_TTL_MS = 5 * 60_000;
/** Login attempts (email codes, wallet signatures) per minute, across everyone. */
const AUTH_PER_MINUTE = 20;

export class Dashboard {
  private readonly links = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  private readonly now: () => number;
  readonly publicUrl: string;

  readonly auth: DashboardAuth;
  private readonly chat: ChatBridge | null;
  private readonly keys: KeyVault | null;
  private readonly demo: boolean;
  private readonly local: boolean;
  /** The last code sent for showing keys (demo: also shown on the page). */
  private keyCode: { code: string; exp: number; tries: number } | null = null;
  private authHits: number[] = [];
  /** Demo stand only: the latest code a real install would have sent away. */
  demoNote: string | null = null;

  constructor(
    private readonly fren: Fren,
    opts: DashboardOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.publicUrl = opts.publicUrl.replace(/\/+$/, "");
    this.chat = opts.chat ?? null;
    this.keys = opts.keys ?? null;
    this.demo = opts.demo ?? false;
    this.local = opts.local ?? false;
    this.auth = new DashboardAuth(fren.store, opts.mailer ?? null, this.now);
  }

  private authLimited(): boolean {
    const t = this.now();
    this.authHits = this.authHits.filter((x) => x > t - 60_000);
    this.authHits.push(t);
    return this.authHits.length > AUTH_PER_MINUTE;
  }

  /** A one-time login link, good for 10 minutes. */
  newLink(): string {
    this.sweep();
    const t = randomBytes(24).toString("base64url");
    this.links.set(t, this.now() + LINK_TTL_MS);
    return `${this.publicUrl}/login?t=${t}`;
  }

  /** The dashboard link in the owner's own terminal (`fren dashboard`), not in a chat. */
  directLink(): { text: string; link: string } {
    const link = this.newLink();
    return { text: `Your dashboard: ${link}\nIt works once, for 10 minutes.`, link };
  }

  /** The first time the chat comes up: a login link in the chat, so the install ends in the dashboard. */
  async welcomeLink(): Promise<void> {
    const kv = this.fren.store;
    if (kv.getKv("dash_welcome")) return;
    const link = this.newLink();
    const where = this.local ? "Open it on this computer. " : "";
    const sent = await this.fren.tellOwner(this.fren.localize(`🖥 Your Fren dashboard is ready: your balance in dollars, your history, and a short tour.\n${link}\n\n${where}The link works once, for 10 minutes. Later, send /fren_dashboard for a new one.`));
    if (sent) kv.setKv("dash_welcome", String(this.now()));
  }

  /** Makes a link and sends it to the owner privately. Falls back to returning it. */
  async sendLink(): Promise<{ text: string; link?: string }> {
    const link = this.newLink();
    const say = (t: string) => this.fren.localize(t);
    const sent = await this.fren.tellOwner(say(`🔑 Your Fren dashboard:\n${link}\n\nWorks once, for 10 minutes. Don't share it.`));
    if (sent) return { text: say("Sent you a login link for your dashboard in a separate message. It works once, for 10 minutes.") };
    return { text: say("Here's your dashboard login link. It works once, for 10 minutes. Don't share it."), link };
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
    const [positions, wallet, balances] = await Promise.all([
      this.fren.positions().catch((err: Error) => ({ error: err.message })),
      this.fren.wallet().catch(() => ({ addresses: null })),
      this.fren.balances().catch(() => null),
    ]);
    const store = this.fren.store;
    const events = store.eventsSince(0).slice(-30).reverse();
    // Everything waiting for the owner's OK, the way /ok sees it. The code itself never
    // leaves the server: the page gets a reference derived from it (see ref()).
    const waiting = store.livePending().map((p) => {
      const base = { ref: this.ref(p.code), kind: p.kind, label: p.label ?? KIND_LABEL[p.kind], usd: p.usd ?? 0, expiresAt: p.expiresAt };
      if (p.kind !== "plan") return base;
      const rec = store.getPlan(p.payload);
      if (!rec) return base;
      const resolved = store
        .getSteps(rec.id)
        .map((s) => s.resolved)
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return {
        ...base,
        id: rec.id,
        at: rec.createdAt,
        request: rec.request,
        steps: rec.plan.steps.map((st, i) => describeStep(st, resolved.find((r) => r.index === i))),
        maxLoss: describeMaxLoss(resolved),
      };
    });
    return {
      balances,
      history: this.fren.history(30),
      waiting,
      signIn: { email: this.auth.email(), wallets: this.auth.wallets(), emailWorks: this.auth.methods().email || (this.demo && Boolean(this.auth.email())) },
      chat: Boolean(this.chat),
      keysCanShow: Boolean(this.keys),
      demo: this.demo,
      limits,
      spentTodayUsd: store.spentTodayUsd(limits.mode),
      paperUsdc: limits.mode === "paper" ? store.paperUsdc() : null,
      positions: Array.isArray(positions) ? positions : [],
      positionsError: Array.isArray(positions) ? null : positions.error,
      addresses: wallet.addresses,
      card: cardTopUp(wallet.addresses),
      watching: store.plansWithStatus("active").map((p) => ({ id: p.id, createdAt: p.createdAt })),
      waitingForCode: store.plansWithStatus("pending_confirm").map((p) => p.id),
      events,
    };
  }

  /**
   * Approve and Cancel on the page go through the same door as /ok: the pending code.
   * The page never sees the code, only an HMAC of it under a key this process made at
   * start, so a reference is good for one install's lifetime and says nothing about the
   * code. The owner is the only one with a session (the login link only ever goes down the
   * private line), and the x-fren header keeps cross-site forms out.
   */
  private readonly refKey = randomBytes(32);
  private ref(code: string): string {
    return createHmac("sha256", this.refKey).update(code).digest("base64url");
  }
  private pendingByRef(ref: unknown): PendingAction | null {
    const want = Buffer.from(String(ref ?? ""));
    for (const p of this.fren.store.livePending()) {
      const have = Buffer.from(this.ref(p.code));
      if (have.length === want.length && timingSafeEqual(have, want)) return p;
    }
    return null;
  }

  /** Approve from the page. Same checks as /ok: a live request, limits and the day's budget again at run time. */
  private async approveFromPage(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const p = this.pendingByRef(body.ref);
    if (!p) return { status: 400, body: { error: "That request isn't waiting any more: it ran out, or was already approved or cancelled." } };
    // The page sends back the amount it showed. A request replaced since then (another
    // amount under the same button) is not approved blind.
    if (Number(body.usd ?? 0) !== (p.usd ?? 0)) return { status: 409, body: { error: "This request changed since the page loaded. Look at it again." } };
    const label = p.label ?? KIND_LABEL[p.kind];
    const r = await this.fren.approveWithReceipt(p.code);
    void this.fren.tellOwner(`${this.fren.localize(`🖥 You approved it from the dashboard: ${label}`)}${r.receiptSent ? "" : `\n${r.text}`}`);
    return { status: 200, body: { text: r.text } };
  }

  private async cancelFromPage(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const p = this.pendingByRef(body.ref);
    if (!p) return { status: 400, body: { error: "That request isn't waiting any more: it ran out, or was already approved or cancelled." } };
    const label = p.label ?? KIND_LABEL[p.kind];
    this.fren.store.takePending(p.code);
    if (p.kind === "plan") await this.fren.cancel(p.payload);
    void this.fren.tellOwner(this.fren.localize(`🖥 You cancelled it from the dashboard: ${label}`));
    return { status: 200, body: { text: "Cancelled. Nothing happens." } };
  }

  /** When the OpenClaw gateway last said it started (via the Fren plugin). */
  private chatUpAt: number | null = null;

  /** The gateway is up and has loaded Fren, so the bot answers. */
  chatUp(): void {
    this.chatUpAt = Date.now();
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
        // Public on purpose: the setup page polls it after "Start Fren" to say
        // "live" only once the bot can answer. It reveals one boolean.
        if (req.method === "GET" && url.pathname === "/ready") return json(200, { ready: this.chatUpAt !== null });
        const cookie = () => `fren_dash=${this.newSession()}; Path=/; HttpOnly;${this.demo || this.local ? "" : " Secure;"} SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
        if (req.method === "GET" && url.pathname === "/login") {
          const t = url.searchParams.get("t") ?? "";
          if (!this.takeLink(t)) return html(403, LOGIN_PAGE("That link has expired or was already used. Send /fren_dashboard to your bot for a new one."));
          return html(303, "", { location: "/", "set-cookie": cookie() });
        }
        if (this.demo && req.method === "GET" && url.pathname === "/demo-login") return html(303, "", { location: "/", "set-cookie": cookie() });

        // Other ways in: an email code or a wallet signature, for an email or wallet the owner added.
        if (req.method === "POST" && url.pathname.startsWith("/auth/")) {
          if (req.headers["x-fren"] !== "1") return json(403, { error: "forbidden" });
          if (this.authLimited()) return json(429, { error: "Too many tries. Wait a minute." });
          const body = await readJson(req);
          const str = (k: string) => String(body[k] ?? "");
          const kind = (str("kind") === "evm" ? "evm" : "solana") as WalletKind;
          const loggedIn = (ok: boolean, fail: string) => {
            if (!ok) return json(401, { error: fail });
            res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "application/json", "set-cookie": cookie() });
            return res.end(JSON.stringify({ ok: true }));
          };
          switch (url.pathname) {
            case "/auth/email/start": {
              if (this.demo) this.demoNote = null;
              const r = await this.auth.startEmail(str("email"));
              return json(200, { text: r.text, ...(this.demo ? { demoNote: this.demoNote } : {}) });
            }
            case "/auth/email/check":
              return loggedIn(this.auth.checkEmail(str("email"), str("code")), "That code didn't work. Check it, or ask for a new one.");
            case "/auth/wallet/challenge":
              return json(200, this.auth.challenge(kind, str("address"), "login"));
            case "/auth/wallet/check":
              return loggedIn(await this.auth.checkWallet(str("id"), kind, str("address"), str("signature")), "That wallet isn't one you added in your dashboard.");
          }
          return json(404, { error: "not found" });
        }

        const session = this.session(req);
        if (req.method === "GET" && url.pathname === "/") {
          if (session) return html(200, DASHBOARD_PAGE);
          return html(401, SIGNIN_PAGE({ ...this.auth.methods(), ...(this.demo ? { email: true, demo: true } : {}) }));
        }
        if (!url.pathname.startsWith("/api/")) return json(404, { error: "not found" });
        if (!session) return json(401, { error: "Logged out. Send /fren_dashboard to your bot for a new link." });

        if (req.method === "GET" && url.pathname === "/api/overview") return json(200, await this.overview());
        if (req.method === "GET" && url.pathname === "/api/chat") {
          if (!this.chat) return json(404, { error: "The chat isn't connected on this machine." });
          return json(200, await this.chat.history(60));
        }

        if (req.method !== "POST") return json(405, { error: "POST only." });
        // A cross-site form can't set this header, on top of SameSite=Lax (which already keeps the cookie off cross-site POSTs). Lax, not Strict, because the login link is opened from Telegram, and a Strict cookie would be dropped on the redirect.
        if (req.headers["x-fren"] !== "1") return json(403, { error: "forbidden" });
        const body = await readJson(req);
        const owner = (r: OwnerRequestResult) => {
          const needsCode = Boolean(r.codeSentPrivately !== undefined || r.ownerCode);
          return { text: needsCode ? "Waiting for your OK: approve or cancel it in “Fren wants to do this” above, or reply /ok in your chat." : r.text, needsCode };
        };
        switch (url.pathname) {
          case "/api/ok": {
            const r = await this.approveFromPage(body);
            return json(r.status, r.body);
          }
          case "/api/cancel": {
            const r = await this.cancelFromPage(body);
            return json(r.status, r.body);
          }
          case "/api/pause":
            return json(200, { text: await this.fren.stop() });
          case "/api/resume":
            return json(200, owner(await this.fren.requestResume()));
          case "/api/limits":
            return json(200, owner(await this.fren.changeLimits(String(body.args ?? ""))));
          case "/api/close_all":
            return json(200, owner(await this.fren.requestCloseAll()));
          case "/api/chat": {
            if (!this.chat) return json(404, { error: "The chat isn't connected on this machine." });
            const text = String(body.text ?? "").trim().slice(0, 2000);
            if (!text) return json(400, { error: "Type a message first." });
            // "ok" typed here is the owner's /ok, run by the engine like the Telegram command
            // (bare, a number from the list, all, or a code), never handed to the model: the
            // model can't approve anything, so it would only say "send /ok in Telegram".
            const okArg = okCommand(text);
            if (okArg !== null) {
              const r = await this.fren.approveWithReceipt(okArg);
              this.chat.note("you", text);
              this.chat.note("fren", r.text);
              void this.fren.tellOwner(`${this.fren.localize("🖥 You, from the dashboard:")}\n${text}${r.receiptSent ? "" : `\n\n${r.text}`}`);
              return json(200, { ok: true, answered: true });
            }
            // Other commands stay in the chat app. Here the page has buttons for the same things.
            if (text.startsWith("/"))
              return json(200, { hint: "Commands like /fren_stop belong in your Telegram chat. Here, use the buttons: Approve and Cancel in “Fren wants to do this”, Pause and Close everything in Safety." });
            await this.chat.send(text);
            // The chat app sees what was asked here, so both read as one conversation.
            void this.fren.tellOwner(`${this.fren.localize("🖥 You, from the dashboard:")}\n${text}`);
            return json(200, { ok: true });
          }
          case "/api/sign-in/email":
            return json(200, { email: this.auth.setEmail(body.email === null ? null : String(body.email ?? "")) });
          case "/api/sign-in/wallet/challenge":
            return json(200, this.auth.challenge(body.kind === "evm" ? "evm" : "solana", String(body.address ?? ""), "link"));
          case "/api/sign-in/wallet/link":
            return json(200, await this.auth.linkWallet(String(body.id ?? ""), body.kind === "evm" ? "evm" : "solana", String(body.address ?? ""), String(body.signature ?? "")));
          case "/api/sign-in/wallet/remove":
            this.auth.removeWallet(body.kind === "evm" ? "evm" : "solana", String(body.address ?? ""));
            return json(200, { ok: true });
          case "/api/keys/request": {
            if (!this.keys)
              return json(200, {
                locked: true,
                text: "Your keys stay locked inside the signer, a separate program that neither this page nor the AI can read, so they can't be shown here. To see them, open Terminal on the computer where Fren is installed and run: fren keys",
              });
            const code = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, "0");
            this.keyCode = { code, exp: this.now() + KEY_CODE_TTL_MS, tries: 0 };
            const sent = await this.fren.tellOwner(`🔐 Someone asked to show your wallet keys in the dashboard.\nCode: ${code}\n\nIf it wasn't you, don't share it and send /fren_stop.`);
            if (this.demo) this.demoNote = `Demo: on a real install this code goes to your Telegram. Code: ${code}`;
            return json(200, { needsCode: true, sent, text: "Fren sent a 6-digit code to your Telegram. Type it here to show the keys.", ...(this.demo ? { demoNote: this.demoNote } : {}) });
          }
          case "/api/keys/reveal": {
            const k = this.keyCode;
            if (!this.keys || !k || k.exp < this.now()) return json(400, { error: "Ask for a new code first." });
            k.tries++;
            const a = Buffer.from(k.code);
            const b = Buffer.from(String(body.code ?? "").trim());
            if (!(a.length === b.length && timingSafeEqual(a, b))) {
              if (k.tries >= 3) this.keyCode = null;
              return json(400, { error: "That code didn't work." });
            }
            this.keyCode = null;
            return json(200, { keys: await this.keys.reveal() });
          }
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


/** What a bare /ok would call each kind of request, for the page's "Fren wants to do this" box. */
const KIND_LABEL: Record<PendingKind, string> = {
  plan: "A trade plan",
  limits: "Loosen your limits",
  resume: "Turn Fren back on",
  fund: "Send USDC to a trading account",
  closeall: "Close every leveraged position",
  hlwithdraw: "Withdraw USDC from Hyperliquid",
};

export interface CardTopUp {
  provider: "Transak";
  /** live: real card payments; sandbox: Transak's test checkout, no real card charged; off: no partner key yet. */
  mode: "live" | "sandbox" | "off";
  /** The checkout without an amount; the page adds fiatAmount. Null while off. */
  url: string | null;
  network: "solana" | "base";
  coin: "USDC";
}

/**
 * Top-up by card, always shown next to sending crypto (the owner asked for it on 21.11; the
 * card is an extra way in, not a replacement). Provider: Transak, because its checkout takes
 * the wallet address, coin and network in the link, so the owner never types an address,
 * KYC and the card stay on Transak's side, and Fren never sees card details. USDC lands on
 * Solana, where Fren trades, so no bridging afterwards. Transak needs a partner key for
 * any checkout (its public page refuses without one), so without FREN_TRANSAK_KEY the
 * button is shown but off, with a plain line saying why. FREN_CARD_ONRAMP=live switches
 * from Transak's test checkout to real payments; that is a separate decision (production
 * key, KYC terms), so the default with a key is the sandbox.
 */
export function cardTopUp(addresses: { solana?: string | null; evm?: string | null } | null | undefined, env: NodeJS.ProcessEnv = process.env): CardTopUp {
  const network = addresses?.solana ? "solana" : "base";
  const wallet = addresses?.solana || addresses?.evm;
  const key = env.FREN_TRANSAK_KEY;
  if (!key || !wallet) return { provider: "Transak", mode: "off", url: null, network, coin: "USDC" };
  const live = env.FREN_CARD_ONRAMP === "live";
  const q = new URLSearchParams({
    apiKey: key,
    productsAvailed: "BUY",
    cryptoCurrencyCode: "USDC",
    network,
    walletAddress: wallet,
    disableWalletAddressForm: "true",
    fiatCurrency: "USD",
    themeColor: "a5caff",
  });
  return { provider: "Transak", mode: live ? "live" : "sandbox", url: `https://${live ? "global" : "global-stg"}.transak.com/?${q}`, network, coin: "USDC" };
}
