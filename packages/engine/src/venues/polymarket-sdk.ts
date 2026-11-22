import type { GeoCheck } from "./polymarket.js";
import { createPublicClient, createSecureClient, OrderSide, type PublicClient, type SecureClient, type Signer } from "@polymarket/client";
import type { PolyTypedData, SignerApi } from "@fren/signer";
import type { Fetch } from "../http.js";
import type { PolyBook, PolyFill, PolyLivePosition, PolyMarket, PolymarketData, PolymarketTrader } from "./polymarket.js";
import { VenueError } from "./types.js";

/**
 * The real Polymarket, through Polymarket's official SDK (@polymarket/client).
 * The SDK talks to Polymarket's APIs; every signature it needs comes from
 * Fren's signer process, which only signs Polymarket logins, orders and
 * deposit-wallet approvals (see signer/src/polymarket.ts).
 */

type Market = Awaited<ReturnType<PublicClient["fetchMarket"]>>;

function toMarket(m: Market): PolyMarket {
  const slug = m.slug ?? String(m.id);
  const outcomes = [m.outcomes.yes, m.outcomes.no].map((o) => ({
    label: o.label,
    assetId: String((m.version === "v2" ? o.positionId : o.tokenId) ?? o.tokenId ?? o.positionId ?? ""),
    price: o.price === null ? null : Number(o.price),
  }));
  const settled = m.resolution.umaResolutionStatus === "resolved" || m.resolution.umaResolutionStatus === "settled";
  const final = outcomes.every((o) => o.price === 0 || o.price === 1);
  return {
    slug,
    question: m.question ?? m.groupItemTitle ?? slug,
    endDate: m.state.endDate ?? null,
    closed: Boolean(m.state.closed),
    acceptingOrders: m.state.acceptingOrders !== false && m.state.enableOrderBook !== false,
    resolved: Boolean(m.state.closed) && (settled || final),
    outcomes: outcomes.filter((o) => o.assetId),
    ...(m.description ? { rules: m.description.slice(0, 400) } : {}),
  };
}

export class SdkPolymarketData implements PolymarketData {
  private readonly client: PublicClient = createPublicClient();

  /** `fallback` answers search and market lookups when the SDK's host can't be reached. */
  constructor(private readonly fallback?: Pick<PolymarketData, "search" | "market">) {}

  async search(query: string): Promise<PolyMarket[]> {
    try {
      const page = await this.client.search({ q: query, eventsStatus: "active", pageSize: 10 }).firstPage();
      return page.items.events.flatMap((e) => e.markets).map(toMarket);
    } catch (e) {
      if (!this.fallback) throw e;
      return this.fallback.search(query);
    }
  }

  async market(slug: string): Promise<PolyMarket | null> {
    try {
      return toMarket(await this.client.fetchMarket({ slug }));
    } catch {
      return this.fallback ? this.fallback.market(slug).catch(() => null) : null;
    }
  }

  async book(assetId: string): Promise<PolyBook> {
    const b = await this.client.fetchOrderBook({ assetId });
    const levels = (xs: { price: string; size: string }[]) => xs.map((l) => ({ price: Number(l.price), size: Number(l.size) }));
    // The SDK lists asks highest first and bids lowest first; walking a book wants the best price first.
    return { asks: levels(b.asks).sort((x, y) => x.price - y.price), bids: levels(b.bids).sort((x, y) => y.price - x.price), minOrderSize: Number(b.minOrderSize) };
  }
}

/** The SDK's wallet interface, backed by Fren's signer. Raw messages and transactions are refused. */
export function frenPolymarketSigner(signer: SignerApi): Signer {
  return {
    getAddress: async () => (await signer.addresses()).evm as Awaited<ReturnType<Signer["getAddress"]>>,
    signTypedData: async (payload) =>
      (await signer.polySignTypedData(payload as unknown as PolyTypedData)) as Awaited<ReturnType<Signer["signTypedData"]>>,
    signMessage: async () => {
      throw new Error("Fren's signer doesn't sign raw messages for Polymarket.");
    },
    sendTransaction: async () => {
      throw new Error("Fren's signer doesn't send Polymarket transactions directly; the deposit wallet's gasless relayer does.");
    },
  };
}

export class SdkPolymarketTrader implements PolymarketTrader {
  private client: Promise<SecureClient> | null = null;
  private approved = false;

  constructor(private readonly signer: SignerApi) {}

  private secure(): Promise<SecureClient> {
    // Logs in with a ClobAuth signature and uses the signer's own deposit wallet.
    this.client ??= createSecureClient({ signer: frenPolymarketSigner(this.signer) }).catch((err: unknown) => {
      this.client = null;
      throw new VenueError(`Couldn't log in to Polymarket: ${(err as Error).message}`);
    });
    return this.client;
  }

  async wallet(): Promise<string> {
    return (await this.secure()).account.wallet;
  }

  async closedOnly(): Promise<boolean> {
    return (await this.secure()).fetchClosedOnlyMode();
  }

  private async ready(): Promise<SecureClient> {
    const c = await this.secure();
    if (!this.approved) {
      await c.setupTradingApprovals();
      this.approved = true;
    }
    return c;
  }

  async buy(req: { assetId: string; usd: number; maxPrice: number }): Promise<PolyFill> {
    const c = await this.ready();
    const res = await c.placeMarketOrder({ assetId: req.assetId, side: OrderSide.BUY, amount: req.usd, maxSpend: req.usd, maxPrice: req.maxPrice });
    if (!res.ok) throw new VenueError(`Polymarket refused the order: ${res.message}`);
    return { usd: Number(res.makingAmount), shares: Number(res.takingAmount), txs: res.transactionsHashes };
  }

  async sell(req: { assetId: string; shares: number; minPrice: number }): Promise<PolyFill> {
    const c = await this.ready();
    const res = await c.placeMarketOrder({ assetId: req.assetId, side: OrderSide.SELL, shares: req.shares, minPrice: req.minPrice });
    if (!res.ok) throw new VenueError(`Polymarket refused the order: ${res.message}`);
    return { shares: Number(res.makingAmount), usd: Number(res.takingAmount), txs: res.transactionsHashes };
  }

  async positions(): Promise<PolyLivePosition[]> {
    const page = await (await this.secure()).listPositions().firstPage();
    return page.items.map((p) => ({
      assetId: String(p.assetId),
      title: p.title ?? String(p.conditionId),
      outcome: p.outcome ?? "",
      size: Number(p.currentSize),
      avgPrice: Number(p.avgPrice),
      currentPrice: Number(p.currentPrice),
      currentValue: Number(p.currentValue),
    }));
  }
}

/** Polymarket's own check of whether this IP may place orders, and where it thinks the IP is. */
export function polymarketGeoblock(fetchFn: Fetch): () => Promise<GeoCheck> {
  return async () => {
    const res = await fetchFn("https://polymarket.com/api/geoblock", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`geoblock check returned ${res.status}`);
    const body = (await res.json()) as { blocked?: boolean; country?: string; region?: string };
    return {
      blocked: body.blocked === true,
      ...(typeof body.country === "string" ? { country: body.country } : {}),
      ...(typeof body.region === "string" ? { region: body.region } : {}),
    };
  };
}

/** One market as Polymarket's order-book host (clob.polymarket.com) lists it. */
interface ClobMarket {
  question?: string;
  market_slug?: string;
  condition_id?: string;
  description?: string;
  end_date_iso?: string | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  accepting_orders?: boolean;
  enable_order_book?: boolean;
  tokens?: { token_id?: string; outcome?: string; price?: number | null; winner?: boolean }[];
}

const SEARCH_STOP = new Set(["the", "will", "and", "for", "market", "markets", "polymarket", "price", "bet", "bets", "yes", "with", "from", "after", "before", "what", "about"]);

/**
 * Market search without the SDK's search host (gamma-api.polymarket.com).
 * Some home ISPs cut that host at TLS (22.11, Timofey's Mac in UA:
 * SSL_ERROR_SYSCALL) while the order-book host answers, and the order book is
 * where quotes come from anyway. Lists every open market (~8k, a few pages),
 * keeps it for `ttlMs`, and matches the words of the query in the question.
 */
export class ClobMarketList implements Pick<PolymarketData, "search" | "market"> {
  private cache: { at: number; markets: PolyMarket[] } | null = null;
  private loading: Promise<PolyMarket[]> | null = null;

  constructor(
    private readonly fetchFn: Fetch,
    private readonly o: { base?: string; ttlMs?: number; maxPages?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  private async all(): Promise<PolyMarket[]> {
    const ttl = this.o.ttlMs ?? 10 * 60_000;
    if (this.cache && this.now() - this.cache.at < ttl) return this.cache.markets;
    if (!this.loading) {
      this.loading = this.load()
        .then((markets) => {
          this.cache = { at: this.now(), markets };
          return markets;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  private async load(): Promise<PolyMarket[]> {
    const base = this.o.base ?? "https://clob.polymarket.com";
    const out: PolyMarket[] = [];
    let cursor = "";
    for (let page = 0; page < (this.o.maxPages ?? 20); page++) {
      const url = `${base}/sampling-markets${cursor ? `?next_cursor=${encodeURIComponent(cursor)}` : ""}`;
      // Cloudflare in front of the host refuses requests without a user agent.
      const res = await this.fetchFn(url, { headers: { accept: "application/json", "user-agent": "fren" } });
      if (!res.ok) throw new VenueError(`Polymarket's market list answered ${res.status}.`);
      const body = (await res.json()) as { data?: ClobMarket[]; next_cursor?: string };
      for (const m of body.data ?? []) {
        const pm = fromClob(m);
        if (pm) out.push(pm);
      }
      cursor = body.next_cursor ?? "";
      if (!cursor || cursor === "LTE=") break;
    }
    return out;
  }

  async search(query: string): Promise<PolyMarket[]> {
    const words = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}$]+/u)
      .filter((w) => w.length > 2 && !SEARCH_STOP.has(w));
    if (!words.length) return [];
    const need = Math.max(1, Math.ceil(words.length / 2));
    // Whole words: "fed" must not match "Federal".
    const res = words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[$]/g, "\\$&")}(?!\\p{L})`, "iu"));
    const scored = (await this.all())
      .filter((m) => !m.closed && m.acceptingOrders)
      .map((m) => ({ m, h: res.filter((r) => r.test(m.question)).length }))
      .filter((x) => x.h >= need);
    const end = (m: PolyMarket) => (m.endDate ? new Date(m.endDate).getTime() : Infinity);
    scored.sort((a, b) => b.h - a.h || end(a.m) - end(b.m));
    return scored.slice(0, 20).map((x) => x.m);
  }

  async market(slug: string): Promise<PolyMarket | null> {
    const s = slug.trim();
    return (await this.all()).find((m) => m.slug === s) ?? null;
  }
}

function fromClob(m: ClobMarket): PolyMarket | null {
  const slug = m.market_slug || m.condition_id;
  if (!slug || !m.question) return null;
  const outcomes = (m.tokens ?? [])
    .filter((t) => t.token_id && t.outcome)
    .map((t) => ({ label: t.outcome!, assetId: String(t.token_id), price: typeof t.price === "number" ? t.price : null }));
  const closed = Boolean(m.closed) || Boolean(m.archived);
  return {
    slug,
    question: m.question,
    endDate: m.end_date_iso ?? null,
    closed,
    acceptingOrders: m.accepting_orders !== false && m.enable_order_book !== false && m.active !== false,
    resolved: closed && (m.tokens ?? []).some((t) => t.winner === true),
    outcomes,
    ...(m.description ? { rules: m.description.slice(0, 400) } : {}),
  };
}
