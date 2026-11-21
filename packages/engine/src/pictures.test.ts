import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner, generateKeys } from "@fren/signer";
import { describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { renderTradeChart } from "./chart.js";
import { runCode } from "./sandbox-runner.js";
import { checkUrl, findBrowser } from "./sandbox-shot.js";
import { candleStep } from "./snapshot.js";
import { buildTestFren } from "./testing.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function live() {
  const t = buildTestFren({ live: true, signer: createSigner(generateKeys()), snapshots: true });
  t.store.setLimits({ ...t.store.getLimits(), maxTradeUsd: 1_000, autoApproveUsd: 1_000 });
  t.fake.hlCandles = Array.from({ length: 72 }, (_, i) => {
    const o = 178 + Math.sin(i / 6) * 3;
    return { t: t.clock.t - (72 - i) * 300_000, o: String(o), h: String(o + 1), l: String(o - 1), c: String(o + Math.cos(i) * 0.8) };
  });
  return t;
}

/** The open ANT long, as Hyperliquid's clearinghouse shows it once filled. */
function holdAnt(t: ReturnType<typeof live>) {
  t.fake.hlPositions.xyz = [{ position: { coin: "xyz:ANT", szi: "2.77", entryPx: "180", marginUsed: "50", unrealizedPnl: "1.25", liquidationPx: "163.5" } }];
}

const antLong = {
  request: "long ANT with $50 on 10x",
  steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:ANT", side: "long", sizing: { type: "margin", usd: 50 }, leverage: 10 } }],
};

describe("charts on request", () => {
  it("draws a market's chart with the owner's position on it and sends it with the links", async () => {
    const t = live();
    await t.fren.submit(antLong);
    holdAnt(t);
    t.notifier.receipts.length = 0;
    const r = await t.fren.sendChart({ market: "ANT", hours: 24 });
    expect(r.sent).toBe(true);
    expect(r.text).toMatch(/24h chart of ANT/);
    const [msg] = t.notifier.receipts;
    expect(msg!.photo!.subarray(0, 8).equals(PNG)).toBe(true);
    expect(msg!.photoName).toBe("fren-chart.png");
    expect(msg!.html).toMatch(/^ANT \$[\d.]+ · 24h · Hyperliquid perp · your long 2\.77, PnL \+\$1\.25/);
    expect(msg!.html).toContain('<a href="https://app.hyperliquid-testnet.xyz/trade/xyz:ANT">Chart</a>');
    // 24 hours come in 15-minute candles.
    expect(t.fake.hlCalls.candleSnapshot).toBe(2);
  });

  it("says why when it can't: no market named, or no price history", async () => {
    const t = live();
    expect((await t.fren.sendChart({})).text).toMatch(/Name a Hyperliquid market/);
    t.fake.hlCandles = [];
    expect(await t.fren.sendChart({ market: "BTC" })).toEqual({ sent: false, text: expect.stringMatching(/No price history/) });
    expect(t.notifier.receipts).toHaveLength(0);
  });

  it("picks a candle size that fits the span", () => {
    expect(candleStep(6).hlInterval).toBe("5m");
    expect(candleStep(24).hlInterval).toBe("15m");
    expect(candleStep(168)).toMatchObject({ hlInterval: "1h", gecko: { timeframe: "hour", aggregate: 1 } });
    expect(candleStep(720).hlInterval).toBe("1d");
  });
});

describe("pictures for the owner", () => {
  it("sends a PNG with its caption and named link, and refuses anything that isn't a picture", async () => {
    const t = live();
    const png = renderTradeChart({ title: "x", candles: [1, 2, 3, 4].map((i) => ({ t: i, o: i, h: i + 1, l: i - 1, c: i })), levels: [], marks: [], fmt: String });
    const r = await t.fren.sendImage({ image: png, caption: "📸 Hyperdash <me>", links: [{ label: "hyperdash.com", url: "https://hyperdash.com/address/0xabc" }, { label: "bad", url: "javascript:alert(1)" }], name: "../../etc/passwd" });
    expect(r.sent).toBe(true);
    const [msg] = t.notifier.receipts;
    expect(msg!.html).toBe('📸 Hyperdash &lt;me&gt;\n🔗 <a href="https://hyperdash.com/address/0xabc">hyperdash.com</a>');
    expect(msg!.photoName).toBe("etcpasswd.png");
    expect((await t.fren.sendImage({ image: Buffer.from("<svg/>") })).text).toMatch(/isn't a PNG/);
    expect(t.notifier.receipts).toHaveLength(1);
  });

  it("takes a screenshot-sized picture over the API (bigger than other requests may be)", async () => {
    const t = live();
    const server = createApi(t.fren, "tok");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const image = Buffer.concat([PNG, Buffer.alloc(2_000_000, 7)]);
      const res = await fetch(`http://127.0.0.1:${port}/owner/image`, {
        method: "POST",
        headers: { authorization: "Bearer tok", "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: image.toString("base64"), caption: "page", links: [{ url: "https://hyperdash.com/address/0xabc" }] }),
      });
      expect(await res.json()).toEqual({ sent: true, text: "Sent the picture to the owner's chat." });
      expect(t.notifier.receipts[0]!.photo!.length).toBe(image.length);
      expect(t.notifier.receipts[0]!.html).toContain(">Hyperdash</a>");
      const big = await fetch(`http://127.0.0.1:${port}/limits`, { method: "POST", headers: { authorization: "Bearer tok" }, body: "x".repeat(300_000) });
      expect(big.status).toBe(413);
    } finally {
      server.close();
    }
  });
});

describe("close all", () => {
  it("each closed position gets its receipt", async () => {
    const t = live();
    t.store.setLimits({ ...t.store.getLimits(), maxTradeUsd: 1_000, autoApproveUsd: 1_000 });
    await t.fren.submit(antLong);
    holdAnt(t);
    t.notifier.receipts.length = 0;
    expect((await t.fren.requestCloseAll()).text).toMatch(/confirmation code privately/);
    expect(t.notifier.sent.at(-1)).toMatch(/Close xyz:ANT now at market/);
    const code = /\/ok ([A-Z0-9]+)/.exec(t.notifier.sent.at(-1) ?? "")?.[1];
    const r = await t.fren.approveWithReceipt(code!);
    expect(r.receiptSent).toBe(true);
    expect(t.notifier.receipts).toHaveLength(1);
    expect(t.notifier.receipts[0]!.html).toMatch(/ANT up bet closed/);
    expect(t.notifier.receipts[0]!.html).toContain("Spot tokens were left as they are.");
  });
});

describe("the sandbox hands pictures back", () => {
  it("returns what a script saved in $FREN_OUT, pictures only", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "fren-sbx-"));
    const code = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.FREN_OUT + "/a.png", Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]));
writeFileSync(process.env.FREN_OUT + "/notes.txt", "not a picture");
console.log("done");`;
    const r = await runCode({ lang: "node", code, timeoutSec: 20 }, { workspace, path: process.env.PATH ?? "/usr/bin:/bin" });
    expect(r.output.trim()).toBe("done");
    expect(r.images?.map((i) => i.name)).toEqual(["a.png"]);
    expect(Buffer.from(r.images![0]!.base64, "base64").subarray(0, 8).equals(PNG)).toBe(true);
    const none = await runCode({ lang: "node", code: "console.log(1)", timeoutSec: 20 }, { workspace, path: process.env.PATH ?? "/usr/bin:/bin" });
    expect(none.images).toBeUndefined();
  });

  it("screenshots only web pages, with the browser the installer put in place", () => {
    expect(checkUrl("https://hyperdash.com/address/0xabc")).toBe("https://hyperdash.com/address/0xabc");
    expect(() => checkUrl("file:///etc/passwd")).toThrow(/Only http and https/);
    expect(() => checkUrl("nope")).toThrow(/Not a web address/);
    expect(findBrowser({}, join(tmpdir(), "no-such-browser-dir"))).toBeNull();
  });
});
