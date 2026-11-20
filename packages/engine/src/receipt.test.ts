import { createSigner, generateKeys } from "@fren/signer";
import { describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { TelegramLine } from "./notify.js";
import { receiptFromText, receiptHtml, rowFromText } from "./receipt.js";
import { buildTestFren } from "./testing.js";
import { openReceipt } from "./venues/hyperliquid.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const antLong = {
  request: "long ANT with $50 on 10x, stop so we don't lose more than $25, TP at $50 profit",
  steps: [
    {
      leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:ANT", side: "long", sizing: { type: "margin", usd: 50 }, leverage: 10, stopLossUsd: 25, takeProfitUsd: 50 },
    },
  ],
};

function live(opts: { snapshots?: boolean; privateLine?: boolean } = {}) {
  const t = buildTestFren({ live: true, signer: createSigner(generateKeys()), snapshots: opts.snapshots ?? true, ...(opts.privateLine === false ? { privateLine: false } : {}) });
  t.store.setLimits({ ...t.store.getLimits(), maxTradeUsd: 1_000, autoApproveUsd: 1_000 });
  // Six hours of 5-minute ANT candles around $180, as candleSnapshot gives them.
  t.fake.hlCandles = Array.from({ length: 72 }, (_, i) => {
    const o = 178 + Math.sin(i / 6) * 3;
    return { t: t.clock.t - (72 - i) * 300_000, o: String(o), h: String(o + 1), l: String(o - 1), c: String(o + Math.cos(i) * 0.8) };
  });
  // The open's fill as Hyperliquid lists it: its hash opens the order on the explorer.
  t.fake.hlFills.push({ coin: "xyz:ANT", px: "180", sz: "2.77", time: Date.now(), dir: "Open Long", closedPnl: "0", hash: "0xopenhash", oid: 42, fee: "0.2" });
  return t;
}

describe("one receipt for every trade", () => {
  it("the ANT long: numbers, named proof links and a chart of the entry, stop and target", async () => {
    const t = live();
    const res = await t.fren.submit(antLong);
    expect(res.verdict).toBe("executed");
    expect(res.receiptSent).toBe(true);
    const [msg] = t.notifier.receipts;
    expect(msg!.html).toMatch(/^✅ <b>Long ANT opened<\/b>/);
    // The fake fills at the order's 1% slippage limit, so the stop and target are measured from that real fill.
    expect(msg!.html).toContain("Size: 2.77 ANT, a $504 position on $50.00 margin at 10x");
    expect(msg!.html).toContain("Entry: $181.8");
    expect(msg!.html).toContain("Stop: $171 (about -$29.92)");
    expect(msg!.html).toContain("Target: $198 (about +$44.87)");
    expect(msg!.html).toContain('<a href="https://app.hyperliquid-testnet.xyz/explorer/tx/0xopenhash">Order on Hyperliquid explorer</a>');
    expect(msg!.html).toMatch(/<a href="https:\/\/app\.hyperliquid-testnet\.xyz\/explorer\/address\/0x[0-9a-fA-F]{40}">Hyperliquid explorer<\/a>/);
    // Links are names, never pasted URLs.
    expect(msg!.html.replace(/href="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
    // The chart is a real PNG, drawn from Hyperliquid's candles.
    expect(msg!.photo?.subarray(0, 4).equals(PNG)).toBe(true);
    expect(msg!.photo!.length).toBeGreaterThan(2_000);
    expect(t.fake.hlCalls.candleSnapshot).toBe(1);
    // What the model gets still has the facts, so it can answer questions about the trade.
    expect(res.text).toMatch(/✅ Longed 2\.77 xyz:ANT at \$181\.8/);
  });

  it("on mainnet the position links to Hyperdash, where the PnL can be followed", () => {
    const plan = { isBuy: true, size: "2.77", notionalUsd: 500, orders: [], grouping: "normalTpsl" as const, stopPx: 171, takeProfitPx: 198 };
    const r = openReceipt({
      icon: "✅",
      side: "long",
      coin: "xyz:ANT",
      size: 2.77,
      px: 180,
      leverage: 10,
      plan,
      moved: ["✅ Moved $50.75 USDC from Arbitrum into Hyperliquid · https://arbiscan.io/tx/0xdep"],
      liq: 163.5,
      links: [{ label: "Track PnL on Hyperdash", url: "https://hyperdash.com/address/0xabc" }],
    });
    const html = receiptHtml({ steps: [r] });
    expect(html).toContain('🔗 <a href="https://hyperdash.com/address/0xabc">Track PnL on Hyperdash</a>');
    expect(html).toContain('↪ Moved $50.75 USDC from Arbitrum into Hyperliquid · <a href="https://arbiscan.io/tx/0xdep">Arbiscan tx</a>');
    expect(html).toContain("Liquidation: about $163.5");
    expect(r.chart?.levels.map((l) => l.kind)).toEqual(["entry", "stop", "target", "liq"]);
  });

  it("images off: the same receipt, without the chart, and the setting survives", async () => {
    const t = live();
    expect(t.fren.settings()).toEqual({ images: true });
    t.fren.setSettings({ images: false });
    await t.fren.submit(antLong);
    expect(t.notifier.receipts[0]!.photo).toBeNull();
    expect(t.fake.hlCalls.candleSnapshot).toBeUndefined();
    expect(t.store.getKv("receipt_images")).toBe("off");
  });

  it("/settings turns images on and off over the API", async () => {
    const t = live();
    const server = createApi(t.fren, "tok");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const call = async (method: string, body?: unknown) =>
      (await (
        await fetch(`http://127.0.0.1:${port}/settings`, { method, headers: { authorization: "Bearer tok", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
      ).json()) as { text: string; settings?: { images: boolean }; error?: string };
    try {
      expect((await call("POST", { images: "off" })).text).toMatch(/snapshots on trade receipts: off/);
      expect(t.fren.settings().images).toBe(false);
      expect((await call("POST", { images: "on" })).settings).toEqual({ images: true });
      expect((await call("POST", { images: "maybe" })).error).toMatch(/on.*off/);
    } finally {
      server.close();
    }
  });

  it("a buy gets the same receipt: what was bought, the proof, and the token's chart", async () => {
    const t = buildTestFren();
    await t.fren.submit({ request: "buy $25 of JUP", steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: "JUP", amount: { type: "usd", usd: 25 } } }] });
    const { html } = t.notifier.receipts[0]!;
    expect(html).toMatch(/^<b>📝 Paper mode<\/b>\n\n📝 <b>Bought 25 JUP for \$25\.00 at \$1<\/b>/);
    expect(html).toContain('<a href="https://dexscreener.com/solana/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN">Chart on DexScreener</a>');
  });

  it("a plan that only watches sends no receipt yet: it goes out when it fires", async () => {
    const t = buildTestFren();
    const res = await t.fren.submit({
      request: "if SOL drops under 100, long it",
      steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "SOL", side: "long", sizing: { type: "margin", usd: 20 }, leverage: 2 }, when: [{ type: "price", venue: "hyperliquid", market: "SOL", op: "<", value: 100 }] }],
    });
    expect(res.receiptSent).toBeUndefined();
    expect(t.notifier.receipts).toHaveLength(0);
    t.fake.main.find((m) => m.name === "SOL")!.mid = 99;
    await t.fren.tick();
    const { html } = t.notifier.receipts[0]!;
    expect(html).toMatch(/⚡ Paper plan fired: ✅ SOL price/);
    expect(html).toContain("📝 <b>Long SOL opened</b>");
    expect(html).toContain('You asked: "if SOL drops under 100, long it"');
  });
});

describe("stops and targets that fill on Hyperliquid", () => {
  it("sends a receipt when the exchange closes the position, once, and leaves Fren's own closes alone", async () => {
    const t = live({ snapshots: false });
    await t.fren.submit(antLong);
    t.notifier.receipts.length = 0;
    const later = Date.now() + 2_000;
    t.fake.hlFills.push(
      { coin: "xyz:ANT", px: "171", sz: "1.5", time: later, dir: "Close Long", closedPnl: "-13.5", hash: "0xstophash", oid: 77, fee: "0.1" },
      { coin: "xyz:ANT", px: "171", sz: "1.27", time: later, dir: "Close Long", closedPnl: "-11.43", hash: "0xstophash", oid: 77, fee: "0.09" },
      // Fren's own order (the open's oid stands in for a close Fren sent): it had its receipt already.
      { coin: "xyz:ANT", px: "171", sz: "0.1", time: later, dir: "Close Long", closedPnl: "-1", hash: "0xours", oid: 42, fee: "0" },
    );
    t.fake.hlOrderTypes[77] = "Stop Market";
    await t.fren.checkExchangeExits(Date.now() + 60_000);
    expect(t.notifier.receipts).toHaveLength(1);
    const { html } = t.notifier.receipts[0]!;
    expect(html).toMatch(/^🛑 <b>Long ANT stop hit<\/b>/);
    expect(html).toContain("Closed: 2.77 ANT at $171");
    expect(html).toContain("Entry was $180");
    expect(html).toContain("PnL: about -$24.93 (fees $0.19)");
    expect(html).toContain('<a href="https://app.hyperliquid-testnet.xyz/explorer/tx/0xstophash">Order on Hyperliquid explorer</a>');
    await t.fren.checkExchangeExits(Date.now() + 120_000);
    expect(t.notifier.receipts).toHaveLength(1);
  });

  it("calls a take-profit a target hit", async () => {
    const t = live({ snapshots: false });
    await t.fren.submit(antLong);
    t.notifier.receipts.length = 0;
    t.fake.hlFills.push({ coin: "xyz:ANT", px: "198", sz: "2.77", time: Date.now() + 2_000, dir: "Close Long", closedPnl: "49.86", hash: "0xtp", oid: 78, fee: "0.2" });
    t.fake.hlOrderTypes[78] = "Take Profit Market";
    await t.fren.checkExchangeExits(Date.now() + 60_000);
    expect(t.notifier.receipts[0]!.html).toMatch(/^🎯 <b>Long ANT target hit<\/b>/);
    expect(t.notifier.receipts[0]!.html).toContain("PnL: about +$49.86");
  });

  it("does nothing in paper mode or before any live position", async () => {
    const paper = buildTestFren();
    await paper.fren.checkExchangeExits();
    expect(paper.fake.hlCalls.userFillsByTime).toBeUndefined();
    const t = live({ snapshots: false });
    await t.fren.checkExchangeExits();
    expect(t.fake.hlCalls.userFillsByTime).toBeUndefined();
  });
});

describe("links out of a venue's text", () => {
  it("named after where they point", () => {
    expect(rowFromText("↪ Sent $10.00 USDC from Arbitrum to your Derive account. https://arbiscan.io/tx/0x1")).toEqual({
      text: "↪ Sent $10.00 USDC from Arbitrum to your Derive account.",
      links: [{ label: "Arbiscan tx", url: "https://arbiscan.io/tx/0x1" }],
    });
    const r = receiptFromText("✅ Bought 1,000 DOG on Base for $10.00 at $0.01 · https://basescan.org/tx/0xabc");
    expect(r).toMatchObject({ icon: "✅", title: "Bought 1,000 DOG on Base for $10.00 at $0.01", links: [{ label: "Basescan tx", url: "https://basescan.org/tx/0xabc" }] });
  });
});

describe("Telegram delivery", () => {
  const capture = () => {
    const calls: { url: string; body: unknown }[] = [];
    let status = 200;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : JSON.parse(String(init?.body)) });
      const s = status;
      return new Response("{}", { status: s });
    }) as typeof fetch;
    return { calls, fetchFn, fail: (s: number) => void (status = s) };
  };
  const msg = { html: "✅ <b>Long ANT opened</b>\n🔗 <a href=\"https://hyperdash.com/address/0x1\">Track PnL on Hyperdash</a>", plain: "✅ Long ANT opened\n🔗 Track PnL on Hyperdash: https://hyperdash.com/address/0x1" };

  it("sends the chart with the receipt as its caption, in one message", async () => {
    const c = capture();
    const line = new TelegramLine(c.fetchFn, { botToken: "123:abc", ownerChatId: "777" });
    expect(await line.sendRich({ ...msg, photo: PNG })).toBe(true);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]!.url).toMatch(/\/sendPhoto$/);
    expect(c.calls[0]!.body).toMatchObject({ chat_id: "777", caption: msg.html, parse_mode: "HTML", photo: "<file>" });
  });

  it("without a chart, HTML with link previews off; if Telegram refuses the HTML, plain text still goes", async () => {
    const c = capture();
    const line = new TelegramLine(c.fetchFn, { botToken: "123:abc", ownerChatId: "777" });
    await line.sendRich(msg);
    expect(c.calls[0]).toMatchObject({ body: { parse_mode: "HTML", disable_web_page_preview: true, text: msg.html } });
    c.fail(400);
    expect(await line.sendRich(msg)).toBe(false);
    expect(c.calls.at(-1)!.body).toMatchObject({ text: msg.plain });
  });
});
