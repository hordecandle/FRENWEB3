import { createSigner, generateKeys, type SignerApi } from "@fren/signer";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTestFren } from "./testing.js";
import { relaySolanaInstructions, type RelayQuote } from "./venues/relay.js";

/** "Long X" from a fresh wallet: Fren moves the USDC into Hyperliquid itself, after the owner's code. */

const ARB_USDC = "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const codeFrom = (sent: string[]) => /\/ok ([A-Z0-9]{6})/.exec(sent.at(-1) ?? "")?.[1] ?? "";

const long = (market: string, margin: number, leverage: number) => ({
  request: `long ${market} ${leverage}x with $${margin}`,
  steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market, side: "long", sizing: { type: "margin", usd: margin }, leverage } }],
});

function fresh(arbitrumUsdc: number, opts: { landsAfter?: number; solanaUsdc?: number } = {}) {
  const real = createSigner(generateKeys());
  const deposits: number[] = [];
  let pending = 0;
  const signer: SignerApi = {
    ...real,
    async hlDepositFromArbitrum({ amountUsd }) {
      deposits.push(amountUsd);
      pending += amountUsd;
      return { txHash: `0x${"ab".repeat(32)}` };
    },
  };
  const t = buildTestFren({ signer, live: true, evmBalances: { [ARB_USDC]: usdc(arbitrumUsdc) } });
  t.fake.hlFreeDefault = 0;
  t.fake.solanaUsdc = opts.solanaUsdc ?? 0;
  // The deposit shows up on Hyperliquid after a few checks, like the real bridge.
  const land = opts.landsAfter ?? 2;
  t.fake.onHlWait = () => {
    if (pending && t.fake.hlTicks >= land) {
      t.fake.hlFree[""] = (t.fake.hlFree[""] ?? 0) + pending;
      pending = 0;
    }
  };
  return { t, deposits };
}

describe("a perp pays for itself", () => {
  it("within auto-approve: deposits from Arbitrum, moves it to the xyz market and opens, no code", async () => {
    const { t, deposits } = fresh(70);
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("executed");
    // No code: the only message to the owner is the receipt.
    expect(t.notifier.sent.some((m) => m.includes("/ok"))).toBe(false);
    expect(t.notifier.receipts).toHaveLength(1);
    expect(deposits).toEqual([50.75]);
    const types = t.fake.exchange.map((b) => (b.action as { type: string }).type);
    expect(types).toEqual(["sendAsset", "approveAgent", "updateLeverage", "order"]);
    expect(t.fake.exchange[0]!.action).toMatchObject({ sourceDex: "", destinationDex: "xyz", amount: "50.75", token: expect.stringMatching(/^USDC:0x/) });
    expect(res.text).toMatch(/Moved \$50\.75 USDC from Arbitrum into Hyperliquid · https:\/\/sepolia\.arbiscan\.io\/tx\//);
    expect(res.text).toMatch(/Moved \$50\.75 USDC to Hyperliquid's xyz market/);
    expect(res.text).toMatch(/✅ Bet on/);
    // What it was going to do is not repeated after it's done.
    expect(res.text).not.toMatch(/Fren first moves/);
  });

  it("over auto-approve: shows the move, asks once, then funds and opens", async () => {
    const { t, deposits } = fresh(150);
    const res = await t.fren.submit(long("xyz:GOLD", 100, 5));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/moves \$101 USDC from your Arbitrum wallet into your Hyperliquid account/);
    expect(res.text).toMatch(/moves \$101 USDC there inside your Hyperliquid account/);
    expect(deposits).toHaveLength(0);
    expect(t.fake.exchange).toHaveLength(0);

    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(deposits).toEqual([100.75]);
    expect(out).toMatch(/Moved \$101 USDC from Arbitrum into Hyperliquid/);
    expect(out).toMatch(/✅ Bet on/);
  });

  it("a main-dex market only needs the deposit, and never less than Hyperliquid's $5 minimum", async () => {
    const { t, deposits } = fresh(20);
    t.fake.hlFree[""] = 1;
    const res = await t.fren.submit(long("BTC", 4, 3));
    expect(res.verdict).toBe("executed");
    expect(res.text).toMatch(/Moved \$5\.00 USDC from Arbitrum into Hyperliquid/);
    expect(deposits).toEqual([5]);
    expect(t.fake.exchange.map((b) => (b.action as { type: string }).type)).not.toContain("sendAsset");
  });

  it("uses what's already on Hyperliquid's main dex before touching Arbitrum", async () => {
    const { t, deposits } = fresh(0);
    t.fake.hlFree[""] = 100;
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.text).not.toMatch(/Arbitrum/);
    expect(deposits).toHaveLength(0);
    expect(t.fake.exchange[0]!.action).toMatchObject({ type: "sendAsset", amount: "50.75" });
  });

  it("already funded: no move, nothing extra to say", async () => {
    const { t, deposits } = fresh(0);
    t.fake.hlFree.xyz = 500;
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("executed");
    expect(res.text).not.toMatch(/Moved/);
    expect(deposits).toHaveLength(0);
  });

  it("not enough anywhere: says where the money is and moves nothing", async () => {
    const { t, deposits } = fresh(3, { solanaUsdc: 110 });
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/needs about \$50\.75 .* \$3\.00 USDC on Arbitrum, \$110 USDC on Solana/);
    expect(deposits).toHaveLength(0);
  });

  it("a deposit that doesn't arrive in time opens nothing and links the transfer", async () => {
    const { t } = fresh(70, { landsAfter: 1_000_000 });
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.text).toMatch(/hasn't arrived yet, so nothing was opened/);
    expect(t.fake.exchange.map((b) => (b.action as { type: string }).type)).toEqual([]);
  });

  it("a waiting long says it will fund itself when it triggers", async () => {
    const { t } = fresh(70);
    const res = await t.fren.submit({ ...long("xyz:GOLD", 50, 10), steps: [{ ...long("xyz:GOLD", 50, 10).steps[0]!, when: [{ type: "price", venue: "hyperliquid", market: "xyz:GOLD", op: "<", value: 1 }] }] });
    expect(res.verdict).toBe("executed");
    expect(res.text).toMatch(/👀 Watching[\s\S]*moves the USDC it needs into Hyperliquid itself/);
  });
});

describe("topping Arbitrum up from Solana", () => {
  function withBridge(arbitrumUsdc: number, solanaUsdc: number) {
    const bridged: number[] = [];
    const real = createSigner(generateKeys());
    const deposits: number[] = [];
    let pending = 0;
    let t: ReturnType<typeof buildTestFren>;
    const signer: SignerApi = {
      ...real,
      async hlDepositFromArbitrum({ amountUsd }) {
        deposits.push(amountUsd);
        pending += amountUsd;
        return { txHash: `0x${"cd".repeat(32)}` };
      },
    };
    const balances = { [ARB_USDC]: usdc(arbitrumUsdc) };
    t = buildTestFren({
      signer,
      live: true,
      evmBalances: balances,
      solanaBridge: {
        async bridge(usd) {
          bridged.push(usd);
          t.fake.solanaUsdc -= usd;
          balances[ARB_USDC] = balances[ARB_USDC]! + usdc(usd);
          return [`✅ Sent ${usd} USDC from Solana`, "✅ arrived on Arbitrum"];
        },
        finishPending: async () => [],
      },
    });
    t.fake.hlFreeDefault = 0;
    t.fake.solanaUsdc = solanaUsdc;
    t.fake.onHlWait = () => {
      if (pending) (t.fake.hlFree[""] = (t.fake.hlFree[""] ?? 0) + pending), (pending = 0);
    };
    return { t, bridged, deposits };
  }

  it("bridges only the gap from Solana, then deposits and trades, with no code within auto-approve", async () => {
    const { t, bridged, deposits } = withBridge(20, 110);
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("executed");
    expect(bridged).toEqual([30.75]);
    expect(deposits).toEqual([50.75]);
    expect(res.text).toMatch(/Sent 30\.75 USDC from Solana[\s\S]*Moved \$50\.75 USDC from Arbitrum[\s\S]*✅ Bet on/);
  });

  it("over auto-approve, the code is asked once and covers the bridge, the deposit and the trade", async () => {
    const { t, bridged, deposits } = withBridge(20, 110);
    await t.fren.changeLimits("autoApproveUsd=25");
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/moves \$30\.75 USDC from your Solana wallet to it with Circle's bridge/);
    expect(res.text).toMatch(/moves \$50\.75 USDC from your Arbitrum wallet into your Hyperliquid account/);
    expect(bridged).toHaveLength(0);
    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(bridged).toEqual([30.75]);
    expect(deposits).toEqual([50.75]);
    expect(out).toMatch(/✅ Bet on/);
  });

  it("still refuses when Solana and Arbitrum together are short", async () => {
    const { t, bridged } = withBridge(10, 20);
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/\$10\.00 USDC on Arbitrum, \$20\.00 USDC on Solana/);
    expect(bridged).toHaveLength(0);
  });
});

describe("straight from Solana USDC through Relay", () => {
  const signers = new WeakMap<object, SignerApi>();
  const signerOf = (t: { fren: object }) => signers.get(t.fren)!;
  /** Bee's wallet: USDC on Solana, nothing on Arbitrum or Hyperliquid, no ETH anywhere. */
  function solanaOnly(solanaUsdc: number, o: { both?: boolean } = {}) {
    const bridged: number[] = [];
    const signer = createSigner(generateKeys());
    const t = buildTestFren({
      signer,
      live: true,
      solanaDirect: true,
      ...(o.both ? { solanaBridge: { bridge: async (usd: number) => (bridged.push(usd), []), finishPending: async () => [] } } : {}),
    });
    signers.set(t.fren, signer);
    t.fake.hlFreeDefault = 0;
    t.fake.solanaUsdc = solanaUsdc;
    return { t, bridged };
  }

  const antLong = {
    request: "long ANT (anthropic) with $50 on 10x leverage with a stoploss so we don t lose more than 25$ and TP when we have $50 profit",
    steps: [
      {
        leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:ANT", side: "long", sizing: { type: "margin", usd: 50 }, leverage: 10, stopLossUsd: 25, takeProfitUsd: 50 },
      },
    ],
  };

  it("the ANT long: Solana USDC to Hyperliquid, onto the xyz market, opened with its stop and target, in one go", async () => {
    const { t, bridged } = solanaOnly(110);
    const res = await t.fren.submit(antLong);
    expect(res.verdict).toBe("executed");
    expect(t.notifier.sent.some((m) => m.includes("/ok"))).toBe(false);
    // One receipt, straight to the owner: the numbers, and every proof as a named link, never a pasted URL.
    expect(res.receiptSent).toBe(true);
    expect(t.notifier.receipts).toHaveLength(1);
    const { html } = t.notifier.receipts[0]!;
    expect(html).toMatch(/^✅ <b>Bet on ANT going up<\/b>/);
    expect(html).toMatch(/Put in: \$50\.00, 10× boost \(moves like \$504 of ANT, 2\.77 ANT\)/);
    expect(html).toMatch(/Entry: \$181\.8/);
    expect(html).toMatch(/Stop: \$171 \(about -\$[\d.]+\)/);
    expect(html).toMatch(/Target: \$198 \(about \+\$[\d.]+\)/);
    expect(html).toContain('Moved $51.16 USDC from your Solana wallet into Hyperliquid through Relay (about $51.13 after Relay\'s fee) · <a href="https://solscan.io/tx/relaysig1">Solscan tx</a>');
    expect(html).toContain('<a href="https://app.hyperliquid-testnet.xyz/trade/xyz:ANT">Chart</a>');
    expect(html.replace(/href="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
    // One Relay deposit from the Solana wallet, signed after the signer's checks, to the wallet's own Hyperliquid account.
    expect(t.fake.relaySolanaTxs).toHaveLength(1);
    const q = t.fake.relayQuotes.at(-1)!;
    expect(q).toMatchObject({ originChainId: 792703809, destinationChainId: 1337, user: expect.any(String), refundTo: q.user, tradeType: "EXACT_INPUT" });
    expect(String(q.recipient).toLowerCase()).toBe((await signerOf(t).addresses()).evm.toLowerCase());
    expect(t.fake.relaySolanaTxs[0]!.usd).toBeCloseTo(51.16, 2);
    expect(t.fake.solanaUsdc).toBeCloseTo(110 - 51.16, 2);
    expect(bridged).toHaveLength(0);
    const types = t.fake.exchange.map((b) => (b.action as { type: string }).type);
    expect(types).toEqual(["sendAsset", "approveAgent", "updateLeverage", "order"]);
    expect(t.fake.exchange[0]!.action).toMatchObject({ sourceDex: "", destinationDex: "xyz", amount: "50.75" });
    const order = t.fake.exchange[3]!.action as { orders: { b: boolean; r?: boolean; t: { trigger?: { triggerPx: string; tpsl: string } } }[]; grouping?: string };
    // Entry plus the stop and the target as exchange orders: -$25 is a 5% drop at 10x, +$50 a 10% rise (ANT at $180).
    expect(order.grouping).toBe("normalTpsl");
    expect(order.orders.map((o) => o.t.trigger && { px: Number(o.t.trigger.triggerPx), tpsl: o.t.trigger.tpsl, reduceOnly: o.r })).toEqual([
      undefined,
      { px: 171, tpsl: "sl", reduceOnly: true },
      { px: 198, tpsl: "tp", reduceOnly: true },
    ]);
    expect(res.text).toMatch(/Moved \$51\.16 USDC from your Solana wallet into Hyperliquid through Relay \(about \$51\.13 after Relay's fee\) · https:\/\/solscan\.io\/tx\/relaysig1/);
    expect(res.text).toMatch(/Moved \$50\.75 USDC to Hyperliquid's xyz market/);
    expect(res.text).toMatch(/✅ Bet on/);
    expect(res.text).not.toMatch(/deposit \$|First, say/);
  });

  it("shows the stop and the target in dollars, and asks once when it's over auto-approve", async () => {
    const { t } = solanaOnly(110);
    await t.fren.changeLimits("autoApproveUsd=25");
    const res = await t.fren.submit(antLong);
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/Stop: if ANT falls ~5%, Fren closes it and you lose about \$25/);
    expect(res.text).toMatch(/Take profit: if ANT rises ~10%, Fren closes it and you win about \$50/);
    expect(res.text).toMatch(/sends \$51\.16 USDC from your Solana wallet straight into your Hyperliquid account through Relay/);
    expect(t.fake.relaySolanaTxs).toHaveLength(0);
    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(t.fake.relaySolanaTxs).toHaveLength(1);
    expect(out).toMatch(/✅ Bet on/);
  });

  it("goes through Relay rather than Circle's bridge, which needs ETH on Arbitrum", async () => {
    const { t, bridged } = solanaOnly(110, { both: true });
    const res = await t.fren.submit(antLong);
    expect(res.verdict).toBe("executed");
    expect(bridged).toHaveLength(0);
    expect(t.fake.relaySolanaTxs).toHaveLength(1);
  });

  it("not enough on Solana either: says where the money is and sends nothing", async () => {
    const { t } = solanaOnly(30);
    const res = await t.fren.submit(antLong);
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/\$30\.00 USDC on Solana/);
    expect(res.text).toMatch(/sends it straight from Solana/);
    expect(t.fake.relaySolanaTxs).toHaveLength(0);
  });

  it("refuses a Relay quote that would pay someone else's Hyperliquid account", async () => {
    const { t } = solanaOnly(110);
    t.fake.editRelaySolanaQuote = (q) => {
      q.details.recipient = "0x000000000000000000000000000000000000bEEF";
    };
    const res = await t.fren.submit(antLong);
    expect(res.text).toMatch(/different Hyperliquid account\. Nothing was sent/);
    expect(t.fake.relaySolanaTxs).toHaveLength(0);
    expect(t.fake.exchange.map((b) => (b.action as { type: string }).type)).not.toContain("order");
  });
});

describe("Relay's real Solana deposit", () => {
  const fx = JSON.parse(readFileSync(new URL("../../signer/src/fixtures/relay-solana-to-hl.json", import.meta.url), "utf8")) as { evm: string; quote: RelayQuote & { details: { sender: string } } };
  const w = { solana: fx.quote.details.sender, evm: fx.evm, amountRaw: 25_300_000n };

  it("is one deposit into the depository, for the amount asked", () => {
    const ixs = relaySolanaInstructions(fx.quote, w);
    expect(ixs).toHaveLength(1);
    expect(ixs[0]!.programId.toBase58()).toBe("99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2");
    expect(ixs[0]!.keys[1]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ixs[0]!.keys[1]!.pubkey.toBase58()).toBe(w.solana);
  });

  it("is refused for another amount, another recipient or another sender", () => {
    expect(() => relaySolanaInstructions(fx.quote, { ...w, amountRaw: 25_300_001n })).toThrow(/isn't for the amount asked/);
    expect(() => relaySolanaInstructions(fx.quote, { ...w, evm: "0x2222222222222222222222222222222222222222" })).toThrow(/different Hyperliquid account/);
    expect(() => relaySolanaInstructions(fx.quote, { ...w, solana: "11111111111111111111111111111111" })).toThrow(/different Solana wallet/);
  });
});

const longStop = (market: string, margin: number, leverage: number, stopLossPct: number) => ({
  request: `long ${market} ${leverage}x with $${margin}, stop -${stopLossPct}%`,
  steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market, side: "long", sizing: { type: "margin", usd: margin }, leverage, stopLossPct } }],
});

describe("Hyperliquid's $10 minimum, checked before anything moves (22.11 live test)", () => {
  it("$5 at 2x with a -20% stop: refused before the code and before any deposit, with the margin or leverage that works", async () => {
    const { t, deposits } = fresh(30);
    const res = await t.fren.submit(longStop("BTC", 5, 2, 20));
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/Hyperliquid's minimum order is \$10\.00/);
    expect(res.text).toMatch(/Nothing was moved or opened/);
    expect(res.text).toMatch(/put in \$6\.00 at 2x, or keep \$5\.00 and use 3x/);
    expect(deposits).toHaveLength(0);
    expect(t.fake.exchange).toHaveLength(0);
    expect(t.notifier.sent.some((m) => m.includes("/ok"))).toBe(false);
  });

  it("the suggested sizes really pass", async () => {
    for (const [margin, lev] of [[6, 2], [5, 3]] as const) {
      const { t } = fresh(30);
      const res = await t.fren.submit(longStop("BTC", margin, lev, 20));
      expect(res.verdict, `${margin} at ${lev}x`).not.toBe("rejected");
    }
  });

  it("says it in Russian for a Russian owner", async () => {
    const { t } = fresh(30);
    t.fren.setOwnerLang("ru");
    const res = await t.fren.submit(longStop("BTC", 5, 2, 20));
    expect(res.text).toMatch(/Минимальный заказ на Hyperliquid \$10\.00/);
    expect(res.text).toMatch(/вложить \$6\.00 с плечом 2x или оставить \$5\.00 и взять плечо 3x/);
  });

  it("a short is checked at the price it may fill at, not the mid", async () => {
    const { t } = fresh(30);
    // $10.20 of BTC at the mid, but the IOC limit sits 1% under it.
    const res = await t.fren.submit({ request: "short", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "short", sizing: { type: "notional", usd: 10.2 }, leverage: 2 } }] });
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/minimum order/);
  });

  it("practice mode follows the same rule as the exchange", async () => {
    const t = buildTestFren();
    const res = await t.fren.submit(longStop("BTC", 5, 2, 20));
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/minimum order/);
  });
});

describe("money already on Hyperliquid is used as is (22.11: $5.26 there, Fren offered $5 more)", () => {
  it("$5.26 free covers $5 at 3x: no deposit, and the plan says where the money comes from", async () => {
    const { t, deposits } = fresh(30);
    t.fake.hlFree[""] = 5.26;
    t.store.setLimits({ ...t.store.getLimits(), autoApproveUsd: 0 });
    const res = await t.fren.submit(longStop("BTC", 5, 3, 20));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).not.toMatch(/Fren first moves/);
    expect(res.text).toMatch(/Paid from the \$5\.26 USDC already on your Hyperliquid account/);
    if (res.verdict === "needs_code") await t.fren.approve(codeFrom(t.notifier.sent));
    expect(deposits).toHaveLength(0);
    expect(t.fake.exchange.map((b) => (b.action as { type: string }).type)).toContain("order");
  });

  it("not enough for the margin itself: still tops up", async () => {
    const { t, deposits } = fresh(30);
    t.fake.hlFree[""] = 4.9;
    const res = await t.fren.submit(longStop("BTC", 5, 3, 20));
    if (res.verdict === "needs_code") await t.fren.approve(codeFrom(t.notifier.sent));
    expect(deposits).toEqual([5]);
  });
});

describe("withdraw from Hyperliquid back to the own Arbitrum wallet", () => {
  const withdraws = (t: ReturnType<typeof fresh>["t"]) => t.fake.exchange.filter((b) => (b.action as { type: string }).type === "withdraw3").map((b) => b.action as Record<string, unknown>);

  it("everything free: asks with a code, then withdraws to its own address only", async () => {
    const { t } = fresh(0);
    t.fake.hlFree[""] = 10.26;
    const res = await t.fren.requestHlWithdraw("all");
    const evm = /wallet (0x[0-9a-fA-F]{40})/.exec(t.notifier.sent.at(-1) ?? "")![1]!;
    expect(withdraws(t)).toHaveLength(0);
    expect(t.notifier.sent.at(-1)).toMatch(/Withdraw everything free \(\$10\.26\) USDC from Hyperliquid to your own Arbitrum wallet 0x[0-9a-fA-F]{40}\? Hyperliquid keeps \$1\.00, so about \$9\.26 arrives/);
    expect(res.text).toMatch(/\/ok/);
    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(out).toMatch(/✅ Withdrew \$10\.26 USDC from Hyperliquid to your Arbitrum wallet/);
    const [w] = withdraws(t);
    expect(w).toMatchObject({ type: "withdraw3", amount: "10.26", destination: evm.toLowerCase() });
  });

  it("a wrong code moves nothing", async () => {
    const { t } = fresh(0);
    t.fake.hlFree[""] = 10.26;
    await t.fren.requestHlWithdraw("all");
    expect(await t.fren.approve("ZZZZZZ")).toMatch(/wrong or expired/);
    expect(withdraws(t)).toHaveLength(0);
  });

  it("the code is used once: a second /ok with it does nothing", async () => {
    const { t } = fresh(0);
    t.fake.hlFree[""] = 10.26;
    await t.fren.requestHlWithdraw(6);
    const code = codeFrom(t.notifier.sent);
    await t.fren.approve(code);
    expect(await t.fren.approve(code)).toMatch(/wrong or expired/);
    expect(withdraws(t)).toHaveLength(1);
  });

  it("more than is free, or not more than the $1 fee, or NaN: refused without a code", async () => {
    const { t } = fresh(0);
    t.fake.hlFree[""] = 10.26;
    for (const usd of [50, 1, 0.5, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = await t.fren.requestHlWithdraw(usd);
      expect(res.text, String(usd)).not.toMatch(/\/ok/);
    }
    expect(t.notifier.sent.some((m) => m.includes("/ok"))).toBe(false);
  });

  it("if a bet took some of it before /ok, only what is still free leaves", async () => {
    const { t } = fresh(0);
    t.fake.hlFree[""] = 10.26;
    await t.fren.requestHlWithdraw(10);
    t.fake.hlFree[""] = 4;
    await t.fren.approve(codeFrom(t.notifier.sent));
    expect(withdraws(t)[0]).toMatchObject({ amount: "4" });
  });

  it("/fren_stop cancels a waiting withdrawal code", async () => {
    const { t } = fresh(0);
    t.fake.hlFree[""] = 10.26;
    await t.fren.requestHlWithdraw("all");
    const code = codeFrom(t.notifier.sent);
    await t.fren.stop();
    expect(await t.fren.approve(code)).toMatch(/wrong or expired/);
    expect(withdraws(t)).toHaveLength(0);
  });

  it("practice mode has nothing to withdraw", async () => {
    const t = buildTestFren();
    expect((await t.fren.requestHlWithdraw("all")).text).toMatch(/Practice mode has nothing/);
  });
});
