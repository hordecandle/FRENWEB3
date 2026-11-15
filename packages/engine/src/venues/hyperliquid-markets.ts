import { HttpError, postJson, type Fetch } from "../http.js";

/** One perp market on Hyperliquid's main dex or a builder-deployed (HIP-3) dex. */
export interface PerpMarket {
  /** Full symbol: "BTC" on the main dex, "<dex>:<asset>" on builder dexes. */
  name: string;
  dex: string;
  assetId: number;
  szDecimals: number;
  maxLeverage: number;
  isolatedOnly: boolean;
  markPx: number;
  midPx: number;
  /** Current hourly funding rate in percent. */
  fundingHourlyPct: number;
  openInterestUsd: number;
  dayVolumeUsd: number;
}

interface MetaUniverse {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  marginMode?: string;
}
interface AssetCtx {
  markPx: string;
  midPx: string | null;
  funding: string;
  openInterest: string;
  dayNtlVlm: string;
}

/** Everyday words people use for markets that trade under a ticker. */
const ALIASES: Record<string, string[]> = {
  gold: ["GOLD", "XAU", "PAXG"],
  silver: ["SILVER", "XAG"],
  oil: ["OIL", "WTI", "BRENT", "CL", "USOIL"],
  "s&p": ["SPX", "SP500", "US500", "SPY"],
  sp500: ["SPX", "SP500", "US500", "SPY"],
  nasdaq: ["NDX", "NAS100", "XYZ100", "QQQ", "US100"],
  bitcoin: ["BTC"],
  ether: ["ETH"],
  ethereum: ["ETH"],
  solana: ["SOL"],
  tesla: ["TSLA"],
  nvidia: ["NVDA"],
  apple: ["AAPL"],
};

export function assetIdFor(dexIndex: number, index: number): number {
  return dexIndex === 0 ? index : 100_000 + dexIndex * 10_000 + index;
}

export interface HyperliquidMarketsOptions {
  /**
   * Builder dexes (HIP-3) to load besides the main one. Hyperliquid's testnet has
   * ~280 of them and the heavy request costs 20 rate-limit points each, so the
   * default is just "xyz" (gold, silver, stocks). ["*"] loads every dex.
   */
  dexes?: string[];
  /** How long the full market list (funding, volume, leverage) is reused. */
  ttlMs?: number;
  /** How long the list of dexes is reused. */
  dexListTtlMs?: number;
  /** First pause after a 429, doubling up to maxBackoffMs. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Oldest market list we still hand out when Hyperliquid is rate-limiting us. */
  maxStaleMs?: number;
  now?: () => number;
}

export const DEFAULT_HL_DEXES = ["xyz"];

/** Sees Hyperliquid's rate limit (429) and answers it by backing off, never by hammering. */
export class HyperliquidMarkets {
  private cache: { at: number; markets: PerpMarket[] } | null = null;
  private dexCache: { at: number; dexes: ({ name: string } | null)[] } | null = null;
  private inflight: Promise<PerpMarket[]> | null = null;
  private strikes = 0;
  private blockedUntil = 0;
  /** Time of the last 429; the engine reads it. */
  lastLimitedAt = 0;
  private readonly dexWant: string[];
  private readonly ttlMs: number;
  private readonly dexListTtlMs: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxStaleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly fetchFn: Fetch,
    private readonly apiUrl: string,
    opts: HyperliquidMarketsOptions = {},
  ) {
    this.dexWant = opts.dexes ?? DEFAULT_HL_DEXES;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.dexListTtlMs = opts.dexListTtlMs ?? 10 * 60_000;
    this.backoffMs = opts.backoffMs ?? 10_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 120_000;
    this.maxStaleMs = opts.maxStaleMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Seconds until we'll talk to Hyperliquid again, or 0. */
  get retryInSec(): number {
    return Math.max(0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  async info<T>(body: Record<string, unknown>): Promise<T> {
    const wait = this.blockedUntil - this.now();
    if (wait > 0) throw new HttpError(`Hyperliquid is rate-limiting us; waiting ${Math.ceil(wait / 1000)}s before asking again`, 429, "");
    try {
      const out = await postJson<T>(this.fetchFn, `${this.apiUrl}/info`, body);
      this.strikes = 0;
      return out;
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        this.strikes++;
        this.lastLimitedAt = this.now();
        this.blockedUntil = this.now() + Math.min(this.maxBackoffMs, this.backoffMs * 2 ** (this.strikes - 1));
      }
      throw err;
    }
  }

  private async dexList(): Promise<({ name: string } | null)[]> {
    if (this.dexCache && this.now() - this.dexCache.at < this.dexListTtlMs) return this.dexCache.dexes;
    try {
      const dexes = await this.info<({ name: string } | null)[]>({ type: "perpDexs" });
      this.dexCache = { at: this.now(), dexes };
      return dexes;
    } catch (err) {
      if (this.dexCache) return this.dexCache.dexes;
      throw err;
    }
  }

  /** The dexes we load: the main one plus the wanted builder dexes that exist. */
  private async wantedDexes(): Promise<{ name: string; index: number }[]> {
    const list = await this.dexList();
    return list.flatMap((d, index) => {
      const name = d?.name ?? "";
      return name === "" || this.dexWant.includes("*") || this.dexWant.includes(name) ? [{ name, index }] : [];
    });
  }

  /** Names of the dexes this instance loads ("" is the main one). */
  async dexNames(): Promise<string[]> {
    return (await this.wantedDexes()).map((d) => d.name);
  }

  /**
   * Fresh mid prices, one light request per dex (2 points each instead of 20).
   * Throws when Hyperliquid can't be reached: the caller must treat that as
   * "blind", not as "price unchanged".
   */
  async mids(): Promise<Map<string, number>> {
    const dexes = await this.wantedDexes();
    const out = new Map<string, number>();
    const lists = await Promise.all(
      dexes.map((d) => this.info<Record<string, string>>({ type: "allMids", ...(d.name ? { dex: d.name } : {}) })),
    );
    for (const l of lists) {
      for (const [name, px] of Object.entries(l)) {
        if (name.startsWith("@") || name.startsWith("#")) continue; // spot and outcome markets
        const n = Number(px);
        if (Number.isFinite(n) && n > 0) out.set(name, n);
      }
    }
    return out;
  }

  /**
   * Every market of the loaded dexes with leverage, funding and volume. Reused
   * for ttlMs; when Hyperliquid answers 429 we keep serving the last list for up
   * to maxStaleMs rather than failing every request.
   */
  async all(force = false): Promise<PerpMarket[]> {
    if (!force && this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.markets;
    if (!this.inflight) {
      this.inflight = this.load().finally(() => {
        this.inflight = null;
      });
    }
    try {
      return await this.inflight;
    } catch (err) {
      if (this.cache && this.now() - this.cache.at < this.maxStaleMs) return this.cache.markets;
      throw err;
    }
  }

  private async load(): Promise<PerpMarket[]> {
    const dexes = await this.wantedDexes();
    const lists = await Promise.all(
      dexes.map(async ({ name: dexName, index: dexIndex }) => {
        const [meta, ctxs] = await this.info<[{ universe: MetaUniverse[] }, AssetCtx[]]>({
          type: "metaAndAssetCtxs",
          ...(dexName ? { dex: dexName } : {}),
        });
        return meta.universe.flatMap((u, i): PerpMarket[] => {
          const ctx = ctxs[i];
          if (!ctx || u.isDelisted) return [];
          const mark = Number(ctx.markPx);
          const name = dexName && !u.name.includes(":") ? `${dexName}:${u.name}` : u.name;
          return [
            {
              name,
              dex: dexName,
              assetId: assetIdFor(dexIndex, i),
              szDecimals: u.szDecimals,
              maxLeverage: u.maxLeverage,
              isolatedOnly: Boolean(u.onlyIsolated) || u.marginMode === "strictIsolated" || u.marginMode === "noCross",
              markPx: mark,
              midPx: ctx.midPx ? Number(ctx.midPx) : mark,
              fundingHourlyPct: Number(ctx.funding) * 100,
              openInterestUsd: Number(ctx.openInterest) * mark,
              dayVolumeUsd: Number(ctx.dayNtlVlm),
            },
          ];
        });
      }),
    );
    const markets = lists.flat();
    this.cache = { at: this.now(), markets };
    return markets;
  }

  /** Exact lookup. Accepts "btc", "BTC", "xyz:GOLD"; a bare name falls back to the main dex. */
  async get(symbol: string): Promise<PerpMarket | null> {
    const want = symbol.trim().toUpperCase();
    const markets = await this.all();
    return (
      markets.find((m) => m.name.toUpperCase() === want) ??
      markets.find((m) => m.dex === "" && m.name.toUpperCase() === want.split(":").pop()) ??
      null
    );
  }

  /** Fuzzy search for the agent: "gold", "nasdaq", "pepe". Best matches first. */
  async search(query: string, limit = 8): Promise<PerpMarket[]> {
    const q = query.trim().toLowerCase();
    const terms = new Set([q.toUpperCase(), ...(ALIASES[q] ?? [])]);
    const markets = await this.all();
    const scored = markets.flatMap((m) => {
      const base = (m.name.split(":").pop() ?? m.name).toUpperCase();
      let score = 0;
      for (const t of terms) {
        if (base === t) score = Math.max(score, 3);
        else if (base.startsWith(t)) score = Math.max(score, 2);
        else if (base.includes(t)) score = Math.max(score, 1);
      }
      return score > 0 ? [{ m, score }] : [];
    });
    scored.sort((a, b) => b.score - a.score || b.m.dayVolumeUsd - a.m.dayVolumeUsd);
    return scored.slice(0, limit).map((s) => s.m);
  }
}
