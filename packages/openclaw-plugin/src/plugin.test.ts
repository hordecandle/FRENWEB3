import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "@fren/engine";
import { createSigner, generateKeys } from "@fren/signer";
import { buildTestFren, optionName } from "../../engine/src/testing.js";
import plugin, { RECEIPT_NOTE, TOOL_NAMES, isOwner } from "./index.js";

type Registered = { tools: Map<string, (ctx: Record<string, unknown>) => any>; commands: Map<string, any> };

function loadPlugin(pluginConfig: Record<string, unknown>): Registered {
  const reg: Registered = { tools: new Map(), commands: new Map() };
  const api = {
    registrationMode: "full",
    pluginConfig,
    registerTool: (factory: (ctx: Record<string, unknown>) => unknown, opts: { name: string }) => reg.tools.set(opts.name, factory as never),
    registerCommand: (def: { name: string }) => reg.commands.set(def.name, def),
  };
  (plugin as unknown as { register: (api: unknown) => void }).register(api);
  return reg;
}

describe("OpenClaw plugin against a real engine", () => {
  const dir = mkdtempSync(join(tmpdir(), "fren-plugin-"));
  const tokenFile = join(dir, "api-token");
  writeFileSync(tokenFile, "plugin-test-token");
  // No private line: codes must go out via delivery.send.
  const t = buildTestFren({ privateLine: false });
  const { fren } = t;
  const server = createApi(fren, "plugin-test-token");
  let reg: Registered;

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    reg = loadPlugin({ apiUrl: `http://127.0.0.1:${port}`, tokenFile });
  });
  afterAll(() => server.close());

  const run = async (name: string, params: Record<string, unknown>, ctx: Record<string, unknown> = { senderIsOwner: true }) => {
    const tool = reg.tools.get(name)!(ctx);
    const res = await tool.execute("call-1", params);
    return res.content[0].text as string;
  };

  it("registers every declared tool and the owner commands", () => {
    expect([...reg.tools.keys()].sort()).toEqual([...TOOL_NAMES].sort());
    expect([...reg.commands.keys()].sort()).toEqual(["close_all", "fren_code", "fren_dashboard", "fren_images", "fren_snapshots", "fren_stop", "fren_update", "limits", "ok", "positions", "resume", "stop", "wallet"]);
  });

  it("/fren_update is owner-only and says plainly when the machine can't update", async () => {
    const cmd = reg.commands.get("fren_update");
    expect((await cmd.handler({ senderIsOwner: false, args: "" })).text).toMatch(/Only the owner/);
    expect((await cmd.handler({ senderIsOwner: true, args: "" })).text).toMatch(/aren.t set up on this machine/);
  });

  it("hides trading tools from people who aren't the owner", () => {
    expect(reg.tools.get("fren_trade")!({ senderIsOwner: false })).toBeNull();
  });

  it("sends the code around the model and lets only the owner approve it", async () => {
    const delivered: string[] = [];
    const ctx = { senderIsOwner: true, delivery: { send: async (m: { text: string }) => void delivered.push(m.text) } };
    const out = await run(
      "fren_trade",
      {
        plan: {
          request: "long gold 10x with $300",
          steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "gold", side: "long", sizing: { type: "margin", usd: 300 }, leverage: 10 } }],
        },
      },
      ctx,
    );
    expect(out).toMatch(/No Hyperliquid market called gold/);

    const markets = await run("fren_markets", { query: "gold" });
    expect(markets).toContain("xyz:GOLD");

    const out2 = await run(
      "fren_trade",
      {
        plan: {
          request: "long gold 10x with $300",
          steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:GOLD", side: "long", sizing: { type: "margin", usd: 300 }, leverage: 10 } }],
        },
      },
      ctx,
    );
    const code = /\/ok ([A-Z0-9]{6})/.exec(delivered[0] ?? "")?.[1];
    expect(code).toBeDefined();
    expect(out2).not.toContain(code!);
    expect(out2).toMatch(/you do not have it/);

    const ok = reg.commands.get("ok");
    expect((await ok.handler({ senderIsOwner: false, args: code })).text).toMatch(/Only the owner/);
    expect((await ok.handler({ senderIsOwner: true, args: code })).text).toMatch(/Bet on GOLD going up/);
  });

  it("quotes a price bet both ways and hands the model plans it can submit unchanged", async () => {
    const by = new Date(Date.now() + 60 * 86_400_000);
    t.fake.addOption(optionName("ETH", 55, 4000), { ask: 120, bid: 110, spot: 3_500 });
    t.poly.addMarket({ slug: "eth-4k", question: "Will Ethereum reach $4,000 by December 31?", endDate: by.toISOString(), yesAsk: 0.3 });
    const out = await run("fren_bet_quote", { asset: "ETH", target: 4000, direction: "above", by: by.toISOString().slice(0, 10), budgetUsd: 50 });
    expect(out).toMatch(/1\) Option on Derive: 0\.4 contracts of the ETH \$4,000 call/);
    expect(out).toMatch(/2\) Polymarket: "Will Ethereum reach \$4,000 by December 31\?"/);
    const plan = JSON.parse(/^polymarket: (.*)$/m.exec(out)![1]!);
    expect(await run("fren_trade", { plan })).toMatch(/📝 Practice: Bought 167 "Yes" shares/);
  });

  it("knows the owner from commands.ownerAllowFrom when OpenClaw doesn't say (2026.11+)", () => {
    const config = { commands: { ownerAllowFrom: ["telegram:777000123", "whatsapp:+447700900123"] } };
    expect(isOwner({ isAuthorizedSender: true, channel: "telegram", senderId: "777000123", config })).toBe(true);
    expect(isOwner({ isAuthorizedSender: true, channel: "whatsapp", senderId: "447700900123@s.whatsapp.net", config })).toBe(true);
    expect(isOwner({ isAuthorizedSender: true, channel: "telegram", senderId: "777000124", config })).toBe(false);
    expect(isOwner({ isAuthorizedSender: true, channel: "whatsapp", senderId: "777000123", config })).toBe(false);
    expect(isOwner({ isAuthorizedSender: false, channel: "telegram", senderId: "777000123", config })).toBe(false);
    expect(isOwner({ isAuthorizedSender: true, channel: "telegram", senderId: "", config })).toBe(false);
    expect(isOwner({ isAuthorizedSender: true, channel: "telegram", senderId: "777000123", config: {} })).toBe(false);
    expect(isOwner({ senderIsOwner: false, isAuthorizedSender: true, channel: "telegram", senderId: "777000123", config })).toBe(false);
  });

  it("pauses from /fren_stop (OpenClaw reserves /stop) and keeps positions; /close_all closes them", async () => {
    const res = await reg.commands.get("fren_stop").handler({ senderIsOwner: true, args: "" });
    expect(res.text).toMatch(/Paused/);
    expect(res.text).not.toMatch(/Closed long/);
    expect((await reg.commands.get("close_all").handler({ senderIsOwner: false })).text).toMatch(/Only the owner/);
    const closed = await reg.commands.get("close_all").handler({ senderIsOwner: true });
    expect(closed.text).toMatch(/Closed the GOLD up bet/);
    const resume = await reg.commands.get("resume").handler({ senderIsOwner: true });
    expect(resume.text).toMatch(/Code: [A-Z0-9]{6}/);
  });

  it("explains when the engine isn't running", async () => {
    const dead = loadPlugin({ apiUrl: "http://127.0.0.1:9", tokenFile });
    const res = await dead.tools.get("fren_status")!({ senderIsOwner: true }).execute("x", {});
    expect(res.content[0].text).toMatch(/Can't reach the Fren engine/);
  });
});

describe("Bee's ANT long, from the chat tools down, with only USDC on Solana", () => {
  const dir = mkdtempSync(join(tmpdir(), "fren-plugin-live-"));
  const tokenFile = join(dir, "api-token");
  writeFileSync(tokenFile, "plugin-live-token");
  const t = buildTestFren({ signer: createSigner(generateKeys()), live: true, solanaDirect: true });
  t.fake.hlFreeDefault = 0;
  t.fake.solanaUsdc = 110;
  const server = createApi(t.fren, "plugin-live-token");
  let reg: Registered;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    reg = loadPlugin({ apiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tokenFile });
  });
  afterAll(() => server.close());
  const run = async (name: string, params: Record<string, unknown>) => (await reg.tools.get(name)!({ senderIsOwner: true }).execute("c", params)).content[0].text as string;

  it("finds ANT, then one fren_trade funds it from Solana and opens it with the stop and the target", async () => {
    expect(await run("fren_markets", { query: "ANT" })).toMatch(/xyz:ANT: .*max 10x/);
    const out = await run("fren_trade", {
      plan: {
        request: "long ANT (anthropic) with $50 on 10x leverage with a stoploss so we don t lose more than 25$ and TP when we have $50 profit",
        steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:ANT", side: "long", sizing: { type: "margin", usd: 50 }, leverage: 10, stopLossUsd: 25, takeProfitUsd: 50 } }],
      },
    });
    expect(out).toMatch(/Moved \$51\.16 USDC from your Solana wallet into Hyperliquid through Relay/);
    expect(out).toMatch(/Moved \$50\.75 USDC to Hyperliquid's xyz market/);
    expect(out).toMatch(/✅ Bet on ANT going up: 2\.77 ANT at \$181\.8 \(moves like \$504 of ANT\), stop \$171, target \$198/);
    // The owner got the receipt straight from Fren; the model is told not to post it again.
    expect(out).toContain(RECEIPT_NOTE);
    expect(t.notifier.receipts).toHaveLength(1);
    expect(t.notifier.receipts[0]!.html).toMatch(/^✅ <b>Bet on ANT going up<\/b>/);
  });

  it("images on and off: /fren_images from the owner, or fren_settings when they ask in words", async () => {
    const cmd = reg.commands.get("fren_images");
    expect((await cmd.handler({ senderIsOwner: false, args: "off" })).text).toMatch(/Only the owner/);
    expect((await cmd.handler({ senderIsOwner: true, args: "off" })).text).toMatch(/snapshots on trade receipts: off/);
    expect(t.fren.settings().images).toBe(false);
    expect((await cmd.handler({ senderIsOwner: true, args: "" })).text).toMatch(/: off\. Turn them on with \/fren_images on/);
    expect(await run("fren_settings", { images: true })).toMatch(/: on\./);
    expect(await run("fren_settings", {})).toMatch(/: on\./);
    expect((await reg.commands.get("fren_snapshots").handler({ senderIsOwner: true, args: "nope" })).text).toMatch(/Fren error: .*on.*off/);
  });

  it("/ok after a code: the receipt is in the chat already, so the reply is one line", async () => {
    t.store.setLimits({ ...t.store.getLimits(), autoApproveUsd: 0 });
    t.fake.hlFreeDefault = 1_000_000;
    const out = await run("fren_trade", { plan: { request: "short BTC $20 2x", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "short", sizing: { type: "margin", usd: 20 }, leverage: 2 } }] } });
    expect(out).toMatch(/code/);
    const code = /\/ok ([A-Z0-9]{6})/.exec(t.notifier.sent.at(-1) ?? "")![1];
    const before = t.notifier.receipts.length;
    expect((await reg.commands.get("ok").handler({ senderIsOwner: true, args: code })).text).toBe("✅ Approved. Your receipt is just above.");
    expect(t.notifier.receipts).toHaveLength(before + 1);
    expect(t.notifier.receipts.at(-1)!.html).toMatch(/Bet on BTC going down/);
  });

  it("\"deposit $20 to Hyperliquid\" comes from Solana when Arbitrum has nothing", async () => {
    const out = await run("fren_deposit_hyperliquid", { amountUsd: 20 });
    expect(out).toMatch(/Moved \$20\.00 USDC from your Solana wallet into Hyperliquid through Relay/);
  });
});
