import { createSigner, generateKeys, type SignerApi } from "@fren/signer";
import { describe, expect, it } from "vitest";
import { buildTestFren } from "./testing.js";

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
  it("shows the move, waits for the code, deposits from Arbitrum, moves it to the xyz market and opens", async () => {
    const { t, deposits } = fresh(70);
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/moves \$50\.75 USDC from your Arbitrum wallet into your Hyperliquid account/);
    expect(res.text).toMatch(/moves \$50\.75 USDC there inside your Hyperliquid account/);
    expect(deposits).toHaveLength(0);
    expect(t.fake.exchange).toHaveLength(0);

    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(deposits).toEqual([50.75]);
    const types = t.fake.exchange.map((b) => (b.action as { type: string }).type);
    expect(types).toEqual(["sendAsset", "approveAgent", "updateLeverage", "order"]);
    expect(t.fake.exchange[0]!.action).toMatchObject({ sourceDex: "", destinationDex: "xyz", amount: "50.75", token: expect.stringMatching(/^USDC:0x/) });
    expect(out).toMatch(/Moved \$50\.75 USDC from Arbitrum into Hyperliquid · https:\/\/sepolia\.arbiscan\.io\/tx\//);
    expect(out).toMatch(/Moved \$50\.75 USDC to Hyperliquid's xyz market/);
    expect(out).toMatch(/✅ Longed/);
  });

  it("a main-dex market only needs the deposit, and never less than Hyperliquid's $5 minimum", async () => {
    const { t, deposits } = fresh(20);
    t.fake.hlFree[""] = 1;
    const res = await t.fren.submit(long("BTC", 2, 2));
    expect(res.text).toMatch(/moves \$5\.00 USDC from your Arbitrum wallet/);
    await t.fren.approve(codeFrom(t.notifier.sent));
    expect(deposits).toEqual([5]);
    expect(t.fake.exchange.map((b) => (b.action as { type: string }).type)).not.toContain("sendAsset");
  });

  it("uses what's already on Hyperliquid's main dex before touching Arbitrum", async () => {
    const { t, deposits } = fresh(0);
    t.fake.hlFree[""] = 100;
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.text).not.toMatch(/Arbitrum/);
    await t.fren.approve(codeFrom(t.notifier.sent));
    expect(deposits).toHaveLength(0);
    expect(t.fake.exchange[0]!.action).toMatchObject({ type: "sendAsset", amount: "50.75" });
  });

  it("already funded: no move, no extra code", async () => {
    const { t, deposits } = fresh(0);
    t.fake.hlFree.xyz = 500;
    await t.fren.changeLimits("autoApproveUsd=100");
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("executed");
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
    await t.fren.submit(long("xyz:GOLD", 50, 10));
    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(out).toMatch(/hasn't arrived yet, so nothing was opened/);
    expect(t.fake.exchange.map((b) => (b.action as { type: string }).type)).toEqual([]);
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

  it("bridges only the gap from Solana, then deposits and trades, all after one code", async () => {
    const { t, bridged, deposits } = withBridge(20, 110);
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/moves \$30\.75 USDC from your Solana wallet to it with Circle's bridge/);
    expect(res.text).toMatch(/moves \$50\.75 USDC from your Arbitrum wallet into your Hyperliquid account/);
    expect(bridged).toHaveLength(0);
    const out = await t.fren.approve(codeFrom(t.notifier.sent));
    expect(bridged).toEqual([30.75]);
    expect(deposits).toEqual([50.75]);
    expect(out).toMatch(/Sent 30\.75 USDC from Solana[\s\S]*Moved \$50\.75 USDC from Arbitrum[\s\S]*✅ Longed/);
  });

  it("still refuses when Solana and Arbitrum together are short", async () => {
    const { t, bridged } = withBridge(10, 20);
    const res = await t.fren.submit(long("xyz:GOLD", 50, 10));
    expect(res.verdict).toBe("rejected");
    expect(res.text).toMatch(/\$10\.00 USDC on Arbitrum, \$20\.00 USDC on Solana/);
    expect(bridged).toHaveLength(0);
  });
});
