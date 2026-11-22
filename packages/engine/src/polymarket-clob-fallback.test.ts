import { describe, expect, it } from "vitest";
import { ClobMarketList, SdkPolymarketData } from "./venues/polymarket-sdk.js";

// Chat 22.11 live run: from Timofey's home network gamma-api.polymarket.com dies
// at TLS (SSL_ERROR_SYSCALL), so Fed/BTC searches said "Polymarket unreachable",
// while clob.polymarket.com answers. Search and slug lookup fall back to it.

const tok = (id: string, outcome: string, price: number) => ({ token_id: id, outcome, price, winner: false });
const page1 = {
  data: [
    {
      question: "Will the Fed increase interest rates by 25 bps after the December 2026 meeting?",
      market_slug: "fed-hike-25-dec-2026",
      end_date_iso: "2026-12-10T00:00:00Z",
      active: true,
      closed: false,
      accepting_orders: true,
      enable_order_book: true,
      tokens: [tok("111", "Yes", 0.895), tok("112", "No", 0.105)],
    },
    {
      question: "Will the December amendment to the Federal Act be approved?",
      market_slug: "swiss-federal-act",
      end_date_iso: "2026-11-29T00:00:00Z",
      active: true,
      closed: false,
      accepting_orders: true,
      tokens: [tok("131", "Yes", 0.47), tok("132", "No", 0.53)],
    },
    {
      question: "Will no one dissent the January Fed decision?",
      market_slug: "fed-dissent-jan",
      end_date_iso: "2027-01-28T00:00:00Z",
      active: true,
      closed: false,
      accepting_orders: true,
      tokens: [tok("121", "Yes", 0.59), tok("122", "No", 0.41)],
    },
  ],
  next_cursor: "MjA=",

};
const page2 = {
  data: [
    {
      question: "Will Bitcoin reach $100,000 by December 31, 2026?",
      market_slug: "btc-100k-dec-2026",
      end_date_iso: "2027-01-01T00:00:00Z",
      active: true,
      closed: false,
      accepting_orders: true,
      tokens: [tok("211", "Yes", 0.02), tok("212", "No", 0.98)],
    },
    {
      question: "Will Bitcoin reach $200,000 in December?",
      market_slug: "btc-closed",
      active: true,
      closed: true,
      accepting_orders: false,
      tokens: [tok("221", "Yes", 0), tok("222", "No", 1)],
    },
  ],
  next_cursor: "LTE=",
};

function fakeFetch() {
  const calls: { url: string; ua: string | undefined }[] = [];
  const fn = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, ua: init?.headers?.["user-agent"] });
    const body = url.includes("next_cursor=MjA%3D") ? page2 : page1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("Polymarket search without gamma-api", () => {
  it("finds the December Fed market across pages, with prices and token ids", async () => {
    const f = fakeFetch();
    const list = new ClobMarketList(f.fn);
    const found = await list.search("Fed December");
    expect(found[0]?.slug).toBe("fed-hike-25-dec-2026");
    expect(found[0]?.outcomes).toEqual([
      { label: "Yes", assetId: "111", price: 0.895 },
      { label: "No", assetId: "112", price: 0.105 },
    ]);
    // "Federal" isn't "Fed": the Swiss vote matches only "December", not both words.
    const swiss = await list.search("Fed");
    expect(swiss.map((m) => m.slug)).not.toContain("swiss-federal-act");
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]?.ua).toBeTruthy(); // Cloudflare refuses requests without one
  });

  it("skips closed markets and keeps the list for ten minutes", async () => {
    const f = fakeFetch();
    let now = 0;
    const list = new ClobMarketList(f.fn, { now: () => now });
    const btc = await list.search("bitcoin");
    expect(btc.map((m) => m.slug)).toEqual(["btc-100k-dec-2026"]);
    await list.search("fed");
    expect(f.calls).toHaveLength(2);
    now = 11 * 60_000;
    await list.search("fed");
    expect(f.calls).toHaveLength(4);
  });

  it("looks a slug up for a quote, and says nothing on an unknown one", async () => {
    const list = new ClobMarketList(fakeFetch().fn);
    expect((await list.market("btc-100k-dec-2026"))?.question).toMatch(/Bitcoin reach \$100,000/);
    expect(await list.market("nope")).toBeNull();
  });

  it("ignores filler words, so 'polymarket price' alone matches nothing", async () => {
    const list = new ClobMarketList(fakeFetch().fn);
    expect(await list.search("polymarket price")).toEqual([]);
  });

  it("throws when the list host is down too, so the bot can say Polymarket is unreachable", async () => {
    const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    await expect(new ClobMarketList(down).search("fed")).rejects.toThrow(/503/);
  });

  it("is what SdkPolymarketData uses when its own search throws", async () => {
    const data = new SdkPolymarketData({
      search: async (q) => [{ slug: `fb:${q}`, question: q, endDate: null, closed: false, acceptingOrders: true, resolved: false, outcomes: [] }],
      market: async () => null,
    });
    // Replace the SDK client with one whose host is cut, like gamma-api from the Mac.
    (data as unknown as { client: unknown }).client = {
      search: () => ({ firstPage: async () => Promise.reject(new Error("fetch failed")) }),
      fetchMarket: async () => Promise.reject(new Error("fetch failed")),
    };
    expect((await data.search("Fed December"))[0]?.slug).toBe("fb:Fed December");
    expect(await data.market("x")).toBeNull();
  });
});
