import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { BetQuery } from "./bets.js";
import type { Dashboard } from "./dashboard.js";
import { describeLimits, type Fren, type FundVenue } from "./engine.js";
import type { AgentBudget } from "./guard.js";

/**
 * Local HTTP API for the OpenClaw plugin. Bound to 127.0.0.1 and gated by a
 * bearer token. It exposes only what the plugin's tools and commands need;
 * there is no route that returns key material.
 */
export function createApi(fren: Fren, token: string, budget?: AgentBudget, opts: { slowMs?: number; dashboard?: Dashboard | null } = {}): Server {
  const slowMs = opts.slowMs ?? 90_000;
  const expected = Buffer.from(token);

  const authed = (req: IncomingMessage) => {
    const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const routes: Record<string, (body: Record<string, unknown>, url: URL) => Promise<unknown>> = {
    "GET /health": async () => ({ ok: true }),
    "GET /wallet": async () => fren.wallet(),
    "GET /status": async () => ({ text: await fren.status() }),
    "GET /markets": async (_b, url) => ({ text: await fren.searchMarkets(url.searchParams.get("q") ?? "") }),
    "GET /yield": async () => ({ text: await fren.yieldRates() }),
    "GET /limits": async () => ({ limits: fren.limits(), text: describeLimits(fren.limits()) }),
    "GET /events": async (_b, url) => ({ events: fren.recentEvents(Number(url.searchParams.get("since") ?? 0)) }),
    // The plugin asks before every agent turn; without a budget (old callers) it keeps its own count.
    "GET /agent/guard": async () => (budget ? { guard: budget.limits(), usedToday: budget.usedToday() } : { guard: null }),
    "POST /agent/turn": async () => (budget ? budget.take() : { allow: true, used: 0, limit: 0 }),
    "POST /plans": async (b) => fren.submit(b.plan),
    "POST /approve": async (b) => ({ text: await fren.approve(String(b.code ?? "")) }),
    "POST /limits": async (b) => fren.changeLimits(String(b.args ?? "")),
    "POST /resume": async () => fren.requestResume(),
    "POST /stop": async (b) => ({ text: await fren.stop(b.lang) }),
    "POST /close_all": async () => fren.requestCloseAll(),
    "POST /cancel": async (b) => ({ text: await fren.cancel(String(b.planId ?? "")) }),
    "POST /deposit/hyperliquid": async (b) => ({ text: await fren.depositToHyperliquid(Number(b.amountUsd)) }),
    "POST /bets/quote": async (b) => fren.quoteBet(betQuery(b), String(b.request ?? "")),
    /** /fren_dashboard: a one-time login link, sent to the owner privately when there's a line. */
    /** The Fren plugin calls this when the OpenClaw gateway starts: the chat line is up. */
    "POST /gateway/up": async () => {
      opts.dashboard?.chatUp();
      return { ok: true };
    },
    "POST /dashboard/link": async () =>
      opts.dashboard ? opts.dashboard.sendLink() : { text: "The dashboard isn't set up on this machine. It comes with the VPS install (install.sh --server --web)." },
    "POST /fund": async (b) => {
      const venue = String(b.venue);
      if (venue !== "derive" && venue !== "polymarket") throw new Error('venue must be "derive" or "polymarket".');
      return fren.requestFunding(venue as FundVenue, Number(b.amountUsd));
    },
  };

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!authed(req)) return send(401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://localhost");
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(404, { error: "not found" });
    try {
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 256 * 1024) return send(413, { error: "too large" });
          chunks.push(c as Buffer);
        }
        body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
      }
      const started = Date.now();
      const result = await handler(body, url);
      // A trade that ran long (EVM approve, swap and fill can take minutes) or whose chat
      // reply the agent may no longer be waiting for: tell the owner the outcome directly.
      const text = (result as { text?: string } | null)?.text;
      if (EXECUTES.has(url.pathname) && text && (res.destroyed || Date.now() - started > slowMs)) {
        await fren.tellOwner(`${text}`);
      }
      send(200, result);
    } catch (err) {
      send(500, { error: (err as Error).message });
    }
  });
}

const EXECUTES = new Set(["/plans", "/approve"]);

function betQuery(b: Record<string, unknown>): BetQuery {
  const q = { asset: String(b.asset ?? ""), target: Number(b.target), direction: b.direction === "below" ? "below" : "above", by: String(b.by ?? ""), budgetUsd: Number(b.budgetUsd) } as const;
  if (!q.asset) throw new Error("asset is required, e.g. ETH.");
  if (!(q.target > 0)) throw new Error("target must be a price above 0.");
  if (!(q.budgetUsd > 0)) throw new Error("budgetUsd must be above 0.");
  return q;
}
