import { price as fmtPrice } from "@fren/core";
import { renderTradeChart, type Candle } from "./chart.js";
import { getJson, type Fetch } from "./http.js";
import type { ChartRequest } from "./receipt.js";

/** Draws the chart picture for a receipt. Null when there's no price history to draw. */
export interface SnapshotMaker {
  chart(req: ChartRequest): Promise<Buffer | null>;
}

export interface SnapshotOptions {
  fetchFn: Fetch;
  /** Hyperliquid's info endpoint, through the venue's rate-limit handling. */
  hyperliquidInfo: <T>(body: Record<string, unknown>) => Promise<T>;
  geckoUrl?: string;
  now?: () => number;
}

const HOURS = 6;
const MAX_HOURS = 24 * 30;

/** Candle size for a span, so a chart has about 50 to 150 candles. */
export function candleStep(hours: number): { hlInterval: string; minutes: number; gecko: { timeframe: "minute" | "hour" | "day"; aggregate: number } } {
  if (hours <= 12) return { hlInterval: "5m", minutes: 5, gecko: { timeframe: "minute", aggregate: 5 } };
  if (hours <= 36) return { hlInterval: "15m", minutes: 15, gecko: { timeframe: "minute", aggregate: 15 } };
  if (hours <= 24 * 8) return { hlInterval: "1h", minutes: 60, gecko: { timeframe: "hour", aggregate: 1 } };
  if (hours <= 24 * 20) return { hlInterval: "4h", minutes: 240, gecko: { timeframe: "hour", aggregate: 4 } };
  return { hlInterval: "1d", minutes: 1440, gecko: { timeframe: "day", aggregate: 1 } };
}

/**
 * Candles from Hyperliquid for perps and from GeckoTerminal (free, no key)
 * for tokens on Solana, Base and Arbitrum, then the trade drawn on top.
 */
export class Snapshots implements SnapshotMaker {
  constructor(private readonly o: SnapshotOptions) {}

  async chart(req: ChartRequest): Promise<Buffer | null> {
    const candles = await this.candles(req).catch(() => [] as Candle[]);
    if (candles.length < 3) return null;
    const ref = req.levels[0]?.price ?? candles.at(-1)!.c;
    return renderTradeChart({
      title: req.title,
      ...(req.subtitle ? { subtitle: req.subtitle } : {}),
      candles,
      levels: req.levels,
      marks: req.marks,
      fmt: (n) => axisFmt(n, ref),
    });
  }

  private async candles(req: ChartRequest): Promise<Candle[]> {
    const now = this.o.now?.() ?? Date.now();
    const hours = Math.min(MAX_HOURS, Math.max(1, req.hours ?? HOURS));
    const step = candleStep(hours);
    if (req.source.kind === "hyperliquid") {
      const rows = await this.o.hyperliquidInfo<{ t: number; o: string; h: string; l: string; c: string }[]>({
        type: "candleSnapshot",
        req: { coin: req.source.coin, interval: step.hlInterval, startTime: now - hours * 3600_000, endTime: now + 60_000 },
      });
      return rows.map((k) => ({ t: k.t, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c) }));
    }
    const base = this.o.geckoUrl ?? "https://api.geckoterminal.com/api/v2";
    const { network, address } = req.source;
    const pools = await getJson<{ data?: { attributes?: { address?: string } }[] }>(this.o.fetchFn, `${base}/networks/${network}/tokens/${address}/pools?page=1`);
    const pool = pools.data?.[0]?.attributes?.address;
    if (!pool) return [];
    const ohlcv = await getJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
      this.o.fetchFn,
      `${base}/networks/${network}/pools/${pool}/ohlcv/${step.gecko.timeframe}?aggregate=${step.gecko.aggregate}&limit=${Math.min(1000, Math.ceil((hours * 60) / step.minutes))}&currency=usd&token=${address}`,
    );
    return (ohlcv.data?.attributes?.ohlcv_list ?? [])
      .map(([t, o, h, l, c]) => ({ t: Number(t) * 1000, o: Number(o), h: Number(h), l: Number(l), c: Number(c) }))
      .sort((a, b) => a.t - b.t);
  }
}

/** Axis prices: enough digits to tell the levels apart, no "$" (the tags are narrow). */
function axisFmt(n: number, ref: number): string {
  if (ref >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (ref >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fmtPrice(n).replace("$", "");
}
