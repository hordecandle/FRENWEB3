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
    if (req.source.kind === "hyperliquid") {
      const rows = await this.o.hyperliquidInfo<{ t: number; o: string; h: string; l: string; c: string }[]>({
        type: "candleSnapshot",
        req: { coin: req.source.coin, interval: "5m", startTime: now - HOURS * 3600_000, endTime: now + 60_000 },
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
      `${base}/networks/${network}/pools/${pool}/ohlcv/minute?aggregate=5&limit=${HOURS * 12}&currency=usd&token=${address}`,
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
