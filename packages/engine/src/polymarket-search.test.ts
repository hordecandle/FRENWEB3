import { describe, expect, it } from "vitest";
import { buildTestFren } from "./testing.js";

// Chat 22.11: "find Polymarket markets on the Fed in December, $5 on Yes" got a
// Derive option instead, because fren_markets didn't search Polymarket at all.
const world = () => {
  const t = buildTestFren();
  const dec = "2026-12-10T04:59:00Z";
  t.poly.addMarket({ slug: "fed-no-dissent-dec", question: "Will no one dissent the December Fed decision?", endDate: dec, yesAsk: 0.61 });
  t.poly.addMarket({ slug: "fed-cut-jan-2027", question: "Fed rate cut by January 2027 meeting?", endDate: "2027-02-08T04:59:00Z", yesAsk: 0.03 });
  t.poly.addMarket({ slug: "btc-100k-nov", question: "Will Bitcoin reach $100,000 in November?", endDate: "2026-12-01T05:00:00Z", yesAsk: 0.0025 });
  t.poly.addMarket({ slug: "thin", question: "Will Bitcoin dip to $1 in December?", endDate: dec, yesAsk: 0.01, depthUsd: 0.02 });
  return t;
};

describe("fren_markets finds Polymarket bets", () => {
  it("lists open Fed markets with prices, end date and the slug to trade", async () => {
    const t = world();
    const text = await t.fren.searchMarkets("Fed December on Polymarket");
    expect(t.poly.searches.at(-1)).toBe("Fed December"); // the venue's name isn't a search word
    expect(text).toMatch(/Polymarket bets \(venue "polymarket", kind "prediction"/);
    expect(text).toMatch(/• Will no one dissent the December Fed decision\?: Yes 61¢ \/ No 39¢, ends Dec 10, 2026\. market "fed-no-dissent-dec"/);
    // Best word match first: both words beat one.
    expect(text.indexOf("fed-no-dissent-dec")).toBeLessThan(text.indexOf("fed-cut-jan-2027"));
  });

  it("hides closed and resolved markets", async () => {
    const t = world();
    t.poly.resolve("btc-100k-nov", "No");
    const text = await t.fren.searchMarkets("bitcoin");
    expect(text).not.toMatch(/btc-100k-nov/);
    expect(text).toMatch(/market "thin"/);
  });

  it("quotes a $5 bet on Yes from the real book", async () => {
    const t = world();
    const text = await t.fren.searchMarkets("Fed December", 5);
    expect(text).toMatch(/\$5\.00 on Yes buys 8\.2 shares at about 61¢, pays \$8\.20 if Yes, else \$0\./);
  });

  it("says when a budget is under the share minimum or the book is empty", async () => {
    const t = world();
    const text = await t.fren.searchMarkets("bitcoin", 0.01);
    expect(text).toMatch(/\$0\.01 on Yes: too small, Polymarket's minimum here is 5 shares/);
    t.poly.books.set("thin-yes", { asks: [], bids: [], minOrderSize: 5 });
    expect(await t.fren.searchMarkets("dip", 5)).toMatch(/\$5\.00 on Yes: no sellers right now/);
  });

  it("the slug from the search places the $5 bet (practice)", async () => {
    const t = world();
    const res = await t.fren.submit({
      request: "$5 on yes, no one dissents in December",
      steps: [{ leg: { kind: "prediction", venue: "polymarket", side: "buy", market: "fed-no-dissent-dec", outcome: "Yes", amount: { type: "usd", usd: 5 } } }],
    });
    expect(res.verdict).toBe("executed");
    expect(res.text).toMatch(/Bought 8\.2 "Yes" shares in "Will no one dissent the December Fed decision\?"/);
  });

  it("says plainly when Polymarket can't be reached, instead of an empty result", async () => {
    const t = world();
    t.poly.search = async () => {
      throw new Error("SSL_ERROR_SYSCALL");
    };
    const text = await t.fren.searchMarkets("Fed December");
    expect(text).toMatch(/Polymarket didn't answer from this server just now/);
    expect(text).toMatch(/don't offer a Derive option/);
  });

  it("other searches still work and nothing breaks when Polymarket has nothing", async () => {
    const t = world();
    const text = await t.fren.searchMarkets("BTC");
    expect(text).toMatch(/Hyperliquid perps/);
    expect(await t.fren.searchMarkets("zzzqqq")).toBe('Nothing found for "zzzqqq".');
  });
});
