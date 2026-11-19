import { checkEvmTransaction, createSigner, generateKeys, nativeValueLeavesReserve, type EvmTxRequest, type SignerApi } from "@fren/signer";
import { describe, expect, it } from "vitest";
import { BASE_DOG, buildTestFren } from "./testing.js";
import { NATIVE_ETH, NATIVE_SELL_GAS_ALLOWANCE_WEI } from "./venues/relay.js";

/** Selling the wallet's own ETH on Arbitrum and Base for USDC through Relay. */

const ROUTER = "0x0729e2a4716d9f7dd17858d5d504426d228697f7";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH = (n: number) => BigInt(Math.round(n * 1e9)) * 1_000_000_000n;
const RESERVE = ETH(0.0005);
const HELD = ETH(0.018158); // what Bee sent to the Mac wallet

const codeFrom = (sent: string[]) => /\/ok ([A-Z0-9]{6})/.exec(sent.at(-1) ?? "")?.[1] ?? "";

/** Real signer rules, chain stubbed: the reserve is checked against the test's ETH balance. */
function recordingSigner(balances: Record<string, bigint>) {
  const real = createSigner(generateKeys());
  const sent: EvmTxRequest[] = [];
  const signer: SignerApi = {
    ...real,
    async evmSendTransaction(req) {
      const { valueWei } = checkEvmTransaction(req, (await real.addresses()).evm);
      const chain = req.chainId === 8453 ? "base" : "arbitrum";
      nativeValueLeavesReserve({ balance: balances[`${chain}:native`] ?? 0n, value: valueWei, gas: BigInt(req.gas ?? "600000"), maxFeePerGas: 20_000_000n, reserve: RESERVE });
      sent.push(req);
      return { txHash: `0x${String(sent.length).padStart(64, "0")}` };
    },
  };
  return { signer, sent };
}

/** One step, like the live Arbitrum quote: ETH straight into the Relay router. */
const nativeSwapStep = (valueOf: (body: Record<string, unknown>) => string) => (body: Record<string, unknown>) => [
  {
    id: "swap",
    kind: "transaction",
    items: [{ status: "incomplete", data: { from: body.user, to: ROUTER, data: "0xcd6e13f7", value: valueOf(body), chainId: body.originChainId, gas: "592417" } }],
  },
];

const sellEth = (chain: string, amount: Record<string, unknown>) => ({
  request: "sell eth",
  steps: [{ leg: { kind: "swap", venue: "relay", chain, side: "sell", token: "ETH", amount } }],
});

async function live(balances: Record<string, bigint>) {
  const { signer, sent } = recordingSigner(balances);
  const t = buildTestFren({ signer, live: true, evmBalances: balances });
  await t.fren.changeLimits("autoApproveUsd=0");
  t.fake.relaySteps = nativeSwapStep((b) => String(b.amount));
  const run = async (plan: object) => {
    const res = await t.fren.submit(plan);
    if (res.verdict !== "needs_code") return res.text;
    return t.fren.approve(codeFrom(t.notifier.sent));
  };
  return { t, sent, run };
}

describe("selling native ETH, live", () => {
  it("sells 90% of the ETH on Arbitrum for USDC and links Arbiscan", async () => {
    const { t, sent, run } = await live({ "arbitrum:native": HELD });
    const out = await run(sellEth("arbitrum", { type: "fraction", fraction: 0.9 }));
    const amount = (HELD * 900_000n) / 1_000_000n;
    expect(t.fake.relayQuotes.at(-1)).toMatchObject({ originChainId: 42161, destinationChainId: 42161, originCurrency: NATIVE_ETH, destinationCurrency: ARB_USDC, amount: amount.toString() });
    expect(sent).toEqual([{ chainId: 42161, to: ROUTER, data: "0xcd6e13f7", value: amount.toString(), gas: "592417" }]);
    expect(out).toMatch(/✅ Sold 0\.01634 ETH on Arbitrum for \$32\.68 at \$2,000.* · https:\/\/arbiscan\.io\/tx\/0x0+1/);
  });

  it("with auto-approve $0 the sale waits for /ok and sends nothing before it", async () => {
    const { t, sent } = await live({ "arbitrum:native": HELD });
    const res = await t.fren.submit(sellEth("arbitrum", { type: "usd", usd: 28 }));
    expect(res.verdict).toBe("needs_code");
    expect(sent).toHaveLength(0);
    expect(await t.fren.approve(codeFrom(t.notifier.sent))).toMatch(/✅ Sold/);
    expect(sent).toHaveLength(1);
  });

  it("'sell all my ETH' keeps the gas reserve", async () => {
    const { sent, run } = await live({ "arbitrum:native": HELD });
    const out = await run(sellEth("arbitrum", { type: "fraction", fraction: 1 }));
    expect(out).toMatch(/✅ Sold/);
    expect(BigInt(sent[0]!.value!)).toBe(HELD - RESERVE - NATIVE_SELL_GAS_ALLOWANCE_WEI);
  });

  it("sells a dollar amount of ETH on Base", async () => {
    const { t, sent, run } = await live({ "base:native": HELD });
    const out = await run(sellEth("base", { type: "usd", usd: 20 }));
    expect(t.fake.relayQuotes.at(-1)).toMatchObject({ originChainId: 8453, originCurrency: NATIVE_ETH, destinationCurrency: BASE_USDC, amount: ETH(0.01).toString() });
    expect(sent[0]!.value).toBe(ETH(0.01).toString());
    expect(out).toMatch(/Sold 0\.01000 ETH on Base for \$20\.00 at .* · https:\/\/basescan\.org\/tx\//);
  });

  it("'sell 0.01 ETH' sells exactly 0.01 ETH, not $0.01 of it", async () => {
    const { t, sent } = await live({ "arbitrum:native": HELD });
    const res = await t.fren.submit(sellEth("arbitrum", { type: "tokens", tokens: 0.01 }));
    expect(res.verdict).toBe("needs_code");
    expect(res.text).toMatch(/Sell 0\.01 ETH on Arbitrum/);
    expect(await t.fren.approve(codeFrom(t.notifier.sent))).toMatch(/✅ Sold 0\.01000 ETH on Arbitrum/);
    expect(sent[0]!.value).toBe(ETH(0.01).toString());
  });

  it("a sale priced under auto-approve runs at once, whether given in coins or as a share", async () => {
    const { t, sent } = await live({ "arbitrum:native": HELD });
    await t.fren.changeLimits("autoApproveUsd=50");
    await t.fren.approve(codeFrom(t.notifier.sent));
    // 0.01 ETH at $2,000 is $20.
    const coins = await t.fren.submit(sellEth("arbitrum", { type: "tokens", tokens: 0.01 }));
    expect(coins.verdict).toBe("executed");
    expect(coins.text).toMatch(/✅ Sold 0\.01000 ETH on Arbitrum/);
    // Half the ETH above the reserve, about $18.
    const half = await t.fren.submit(sellEth("arbitrum", { type: "fraction", fraction: 0.5 }));
    expect(half.verdict).toBe("executed");
    expect(sent).toHaveLength(2);
  });

  it("a sale worth more than auto-approve still asks", async () => {
    const { t } = await live({ "arbitrum:native": ETH(1) });
    await t.fren.changeLimits("autoApproveUsd=50");
    await t.fren.approve(codeFrom(t.notifier.sent));
    // 0.1 ETH at $2,000 is $200.
    const res = await t.fren.submit(sellEth("arbitrum", { type: "tokens", tokens: 0.1 }));
    expect(res.verdict).toBe("needs_code");
  });

  it("asking to sell more ETH than the wallet holds sells nothing and says how much it can", async () => {
    const { sent, run } = await live({ "arbitrum:native": HELD });
    expect(await run(sellEth("arbitrum", { type: "tokens", tokens: 1 }))).toMatch(/can sell up to 0\.017558 ETH on Arbitrum .*not 1/);
    expect(sent).toHaveLength(0);
  });

  it("a dollar amount larger than the wallet sells only what's above the reserve", async () => {
    const { sent, run } = await live({ "arbitrum:native": HELD });
    expect(await run(sellEth("arbitrum", { type: "usd", usd: 1000 }))).toMatch(/✅ Sold/);
    expect(BigInt(sent[0]!.value!)).toBe(HELD - RESERVE - NATIVE_SELL_GAS_ALLOWANCE_WEI);
  });

  it("says there's nothing to sell when the wallet only holds the reserve", async () => {
    const { sent, run } = await live({ "arbitrum:native": ETH(0.0005) });
    expect(await run(sellEth("arbitrum", { type: "fraction", fraction: 1 }))).toMatch(/keeps 0\.0006 for gas, so there's nothing to sell/);
    expect(sent).toHaveLength(0);
  });

  it("won't sell the gas ETH on Robinhood Chain", async () => {
    const { t, sent } = await live({ "arbitrum:native": HELD });
    const res = await t.fren.submit(sellEth("robinhood", { type: "fraction", fraction: 1 }));
    expect(res.text).toMatch(/sells ETH on Arbitrum and Base only/);
    expect(sent).toHaveLength(0);
  });

  it("'ETH' is native ETH, never WETH or a lookalike token", async () => {
    const { t, run } = await live({ "arbitrum:native": HELD });
    t.fake.evmTokens.push({ chainId: 42161, address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0001", symbol: "ETH", name: "Fake ETH", decimals: 18, verified: true, price: 1 });
    await run(sellEth("arbitrum", { type: "fraction", fraction: 0.5 }));
    expect(t.fake.relayQuotes.at(-1)!.originCurrency).toBe(NATIVE_ETH);
  });
});

describe("attacks on an ETH sale", () => {
  it("Relay asks for more ETH than the sale: nothing is sent", async () => {
    const { t, sent, run } = await live({ "arbitrum:native": HELD });
    t.fake.relaySteps = nativeSwapStep((b) => String(BigInt(String(b.amount)) + 1n));
    expect(await run(sellEth("arbitrum", { type: "fraction", fraction: 0.5 }))).toMatch(/❌ .*Relay asked to send .* ETH for a sale of .* ETH/);
    expect(sent).toHaveLength(0);
  });

  it("Relay splits the ETH over two steps that add up to more than the sale: the second is not sent", async () => {
    const { t, sent, run } = await live({ "arbitrum:native": HELD });
    t.fake.relaySteps = (body) => [...nativeSwapStep((b) => String(b.amount))(body), ...nativeSwapStep(() => "1")(body)];
    expect(await run(sellEth("arbitrum", { type: "fraction", fraction: 0.5 }))).toMatch(/❌ .*Relay asked to send/);
    expect(sent).toHaveLength(1);
  });

  it("Relay attaches ETH to a token sale: nothing is sent", async () => {
    const balances = { "base:native": HELD, [`base:${BASE_DOG}`]: 10n ** 21n };
    const { t, sent, run } = await live(balances);
    t.fake.relaySteps = nativeSwapStep(() => "1000");
    const out = await run({ request: "sell dog", steps: [{ leg: { kind: "swap", venue: "relay", chain: "base", side: "sell", token: BASE_DOG, amount: { type: "fraction", fraction: 1 } } }] });
    expect(out).toMatch(/❌ .*doesn't sell ETH/);
    expect(sent).toHaveLength(0);
  });

  it("Relay attaches ETH to a USDC buy: nothing is sent", async () => {
    const { t, sent, run } = await live({ "arbitrum:native": HELD, "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831": 500_000_000n });
    t.fake.relaySteps = nativeSwapStep(() => "1");
    const out = await run({ request: "buy brett", steps: [{ leg: { kind: "swap", venue: "relay", chain: "base", side: "buy", token: "BRETT", amount: { type: "usd", usd: 10 } } }] });
    expect(out).toMatch(/❌ .*doesn't sell ETH/);
    expect(sent).toHaveLength(0);
  });

  it("Relay sends the ETH somewhere else: the signer refuses", async () => {
    const { t, sent, run } = await live({ "arbitrum:native": HELD });
    t.fake.relaySteps = (body) => [
      { id: "swap", kind: "transaction", items: [{ status: "incomplete", data: { from: body.user, to: "0x9999999999999999999999999999999999999999", data: "0x", value: String(body.amount), chainId: body.originChainId } }] },
    ];
    expect(await run(sellEth("arbitrum", { type: "fraction", fraction: 0.5 }))).toMatch(/❌ .*never send ETH/);
    expect(sent).toHaveLength(0);
  });
});

describe("ETH in paper mode", () => {
  it("buys and sells ETH by ticker on Arbitrum", async () => {
    const t = buildTestFren();
    t.store.setLimits({ ...t.store.getLimits(), autoApproveUsd: 100 }); // the default is $50; a $100 buy would ask for a code
    const buy = await t.fren.submit({ request: "buy eth", steps: [{ leg: { kind: "swap", venue: "relay", chain: "arbitrum", side: "buy", token: "ETH", amount: { type: "usd", usd: 100 } } }] });
    expect(buy.text).toMatch(/Paper: Bought 0\.05000 ETH on Arbitrum for \$100 at \$2,000/);
    const sell = await t.fren.submit(sellEth("arbitrum", { type: "fraction", fraction: 0.5 }));
    expect(sell.text).toMatch(/Paper: Sold 0\.02500 ETH on Arbitrum for \$50/);
  });

  it("has no paper ETH to sell before buying any", async () => {
    const t = buildTestFren();
    expect((await t.fren.submit(sellEth("arbitrum", { type: "fraction", fraction: 1 }))).text).toMatch(/You hold no paper ETH on Arbitrum/);
  });
});
