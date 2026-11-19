import { checkEvmTransaction, createSigner, generateKeys, type EvmTxRequest, type SignerApi } from "@fren/signer";
import { describe, expect, it } from "vitest";
import { BASE_DOG, buildTestFren } from "./testing.js";
import { SOL_BUY_RESERVE_LAMPORTS, solanaPayment } from "./venues/jupiter.js";
import { NATIVE_ETH, NATIVE_SELL_GAS_ALLOWANCE_WEI } from "./venues/relay.js";

/** A buy is paid from whichever of the owner's wallets has the money, without asking them to move it. */

const ROUTER = "0x0729e2a4716d9f7dd17858d5d504426d228697f7";
const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ETH = (n: number) => BigInt(Math.round(n * 1e9)) * 1_000_000_000n;
const RESERVE = ETH(0.0005);
const usdc = (n: number) => BigInt(Math.round(n * 1e6));

const buyDog = (usd: number) => ({
  request: `buy $${usd} of DOG`,
  steps: [{ leg: { kind: "swap", venue: "relay", chain: "base", side: "buy", token: BASE_DOG, amount: { type: "usd", usd } } }],
});

function live(balances: Record<string, bigint>, solanaUsdc = 0) {
  const real = createSigner(generateKeys());
  const sent: EvmTxRequest[] = [];
  const bridged: number[] = [];
  const signer: SignerApi = {
    ...real,
    async evmSendTransaction(req) {
      checkEvmTransaction(req, (await real.addresses()).evm);
      sent.push(req);
      return { txHash: `0x${String(sent.length).padStart(64, "0")}` };
    },
  };
  let t: ReturnType<typeof buildTestFren>;
  t = buildTestFren({
    signer,
    live: true,
    evmBalances: balances,
    solanaBridge: {
      async bridge(usd) {
        bridged.push(usd);
        t.fake.solanaUsdc -= usd;
        balances[`arbitrum:${ARB_USDC}`] = (balances[`arbitrum:${ARB_USDC}`] ?? 0n) + usdc(usd);
        return [`✅ Sent ${usd} USDC from Solana toward Arbitrum`, `✅ ${usd} USDC arrived on Arbitrum`];
      },
      finishPending: async () => [],
    },
  });
  t.fake.solanaUsdc = solanaUsdc;
  // One step into the Relay router, carrying whatever ETH the quote starts from.
  t.fake.relaySteps = (body) => [
    {
      id: "swap",
      kind: "transaction",
      items: [{ status: "incomplete", data: { from: body.user, to: ROUTER, data: "0xcd6e13f7", value: body.originCurrency === NATIVE_ETH ? String(body.amount) : "0", chainId: body.originChainId } }],
    },
  ];
  return { t, sent, bridged };
}

describe("EVM buys pay from any wallet", () => {
  it("USDC first: Base USDC buys a Base token", async () => {
    const { t, bridged } = live({ [`base:${BASE_USDC}`]: usdc(60), "arbitrum:native": ETH(1) });
    const res = await t.fren.submit(buyDog(50));
    expect(res.verdict).toBe("executed");
    expect(t.fake.relayQuotes.at(-1)).toMatchObject({ originChainId: 8453, originCurrency: expect.stringMatching(/^0x833589/i) });
    expect(res.text).not.toMatch(/Paid with/);
    expect(bridged).toHaveLength(0);
  });

  it("no USDC: pays with ETH on Arbitrum, keeping the gas reserve", async () => {
    const { t, sent, bridged } = live({ "arbitrum:native": ETH(0.1) }, 500);
    const res = await t.fren.submit(buyDog(50));
    expect(res.verdict).toBe("executed");
    // $50 at $2,000 an ETH.
    expect(t.fake.relayQuotes.at(-1)).toMatchObject({ originChainId: 42161, originCurrency: NATIVE_ETH, destinationChainId: 8453, amount: ETH(0.025).toString() });
    expect(sent[0]!.value).toBe(ETH(0.025).toString());
    expect(res.text).toMatch(/↪ Paid with 0\.025 ETH on Arbitrum, since your USDC was short/);
    expect(res.text).toMatch(/✅ Bought 5,000 DOG on Base for \$50\.00/);
    expect(bridged).toHaveLength(0);
  });

  it("ETH that is only the gas reserve isn't spent; Solana USDC is bridged over instead", async () => {
    const { t, sent, bridged } = live({ "arbitrum:native": RESERVE + NATIVE_SELL_GAS_ALLOWANCE_WEI + ETH(0.001), [`arbitrum:${ARB_USDC}`]: usdc(20) }, 100);
    const res = await t.fren.submit(buyDog(50));
    expect(res.verdict).toBe("executed");
    expect(bridged).toEqual([30]);
    expect(t.fake.relayQuotes.at(-1)).toMatchObject({ originChainId: 42161, originCurrency: expect.stringMatching(/^0xaf88/i), amount: usdc(50).toString() });
    expect(sent.every((s) => !s.value || s.value === "0")).toBe(true);
    expect(res.text).toMatch(/USDC arrived on Arbitrum[\s\S]*✅ Bought 5,000 DOG on Base/);
  });

  it("not enough anywhere: says what each wallet has and moves nothing", async () => {
    const { t, sent, bridged } = live({ [`arbitrum:${ARB_USDC}`]: usdc(10), [`base:${BASE_USDC}`]: usdc(5) }, 20);
    const res = await t.fren.submit(buyDog(50));
    expect(res.text).toMatch(/needs \$50\.00, and no wallet has enough: \$5\.00 USDC on Base, \$10\.00 USDC on Arbitrum, \$20\.00 USDC on Solana/);
    expect(sent).toHaveLength(0);
    expect(bridged).toHaveLength(0);
  });
});

describe("Solana buys pay from any wallet", () => {
  const base = { usdcRaw: 0n, lamports: 0n, solPx: 200, tipLamports: 0, evmUsdc: {}, canBridge: true, preferSol: false };
  const sol = (n: number) => BigInt(Math.round(n * 1e9));

  it("uses USDC when there is enough", () => {
    expect(solanaPayment({ ...base, usd: 50, usdcRaw: usdc(60), lamports: sol(10) })).toEqual({ kind: "usdc" });
  });

  it("pays in SOL when the USDC is short, keeping a reserve for fees", () => {
    expect(solanaPayment({ ...base, usd: 50, usdcRaw: usdc(10), lamports: sol(1) })).toEqual({ kind: "sol", lamports: sol(0.25) });
    // 0.25 SOL plus the reserve, less one lamport: not enough.
    expect(solanaPayment({ ...base, usd: 50, lamports: sol(0.25) + SOL_BUY_RESERVE_LAMPORTS - 1n }).kind).not.toBe("sol");
  });

  it("a snipe pays in SOL first, and keeps its tip", () => {
    expect(solanaPayment({ ...base, usd: 50, usdcRaw: usdc(60), lamports: sol(1), preferSol: true, tipLamports: 1_000_000 })).toEqual({ kind: "sol", lamports: sol(0.25) });
    expect(solanaPayment({ ...base, usd: 50, usdcRaw: usdc(60), lamports: sol(0.25) + SOL_BUY_RESERVE_LAMPORTS, preferSol: true, tipLamports: 1_000_000 })).toEqual({ kind: "usdc" });
  });

  it("brings the missing USDC over from Arbitrum or Base, with a little room for Relay's fee", () => {
    expect(solanaPayment({ ...base, usd: 50, usdcRaw: usdc(20), evmUsdc: { arbitrum: 10, base: 100 } })).toEqual({ kind: "bridge", usd: 30.3 });
    expect(solanaPayment({ ...base, usd: 500, usdcRaw: 0n, evmUsdc: { arbitrum: 600 } })).toEqual({ kind: "bridge", usd: 505 });
  });

  it("not enough anywhere: lists every wallet", () => {
    const r = solanaPayment({ ...base, usd: 50, usdcRaw: usdc(3), lamports: sol(0.07), evmUsdc: { arbitrum: 10, base: 0 } });
    expect(r).toEqual({ kind: "short", message: expect.stringMatching(/needs \$50\.00, and no wallet has enough: \$3\.00 USDC and about \$10\.00 of spare SOL on Solana, \$10\.00 USDC on Arbitrum, \$0\.00 USDC on Base/) });
    expect(solanaPayment({ ...base, usd: 50, evmUsdc: { arbitrum: 100 }, canBridge: false }).kind).toBe("short");
  });
});
