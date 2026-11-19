import { checkEvmTransaction, createSigner, generateKeys, type EvmTxRequest, type SignerApi } from "@fren/signer";
import { describe, expect, it } from "vitest";
import { BUY_RETRY_WINDOW_MS } from "./engine.js";
import { SnipeFeed, type MentionSource } from "./snipe-feed.js";
import { BASE_DOG, buildTestFren } from "./testing.js";

/** Snipes that don't give up: a buy of a token that can't trade yet waits for it, and Solana launches wake the loop live. */

const NEW_BASE = "0x5555555555555555555555555555555555555555";
const MIGRATING = "Migrat1ng11111111111111111111111111111pump";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const swap = (leg: Record<string, unknown>, when: unknown[] = []) => ({
  request: "test",
  steps: [{ leg: { kind: "swap", side: "buy", amount: { type: "usd", usd: 50 }, ...leg }, when }],
});

describe("a buy of a token that can't trade yet waits for it", () => {
  it("a plain buy before the pool is live turns into a snipe, then buys once it trades", async () => {
    const t = buildTestFren();
    t.fake.relayNoRoute = (b) => String(b.destinationCurrency).toLowerCase() === NEW_BASE;
    const res = await t.fren.submit(swap({ venue: "relay", chain: "base", token: NEW_BASE }));
    expect(res.verdict).toBe("executed");
    expect(res.text).toMatch(/⏳ Buy \$50\.00 of 0x5555…5555 on Base: .*no pool to buy from yet\. Fren keeps trying and buys the moment it trades, for up to 15 minutes/);
    const plan = t.store.getPlan(res.planId!)!;
    expect(plan.status).toBe("active");
    expect(plan.plan.steps[0]!.when).toEqual([{ type: "tradable", venue: "relay", chain: "base", token: NEW_BASE }]);

    await t.fren.snipeTick();
    expect(t.store.paperHoldings()).toHaveLength(0);

    // The pool goes live.
    t.fake.relayNoRoute = () => false;
    t.fake.evmTokens.push({ chainId: 8453, address: NEW_BASE, symbol: "NEW", name: "New", decimals: 18, verified: false, price: 0.01 });
    await t.fren.snipeTick();
    expect(t.notifier.sent.at(-1)).toMatch(/⚡ Triggered[\s\S]*Paper: Bought 5,000 NEW on Base for \$50\.00/);
    expect(t.store.getPlan(res.planId!)!.status).toBe("done");
  });

  it("retries quietly, and gives up after the retry window without spending anything", async () => {
    const real = createSigner(generateKeys());
    const sent: EvmTxRequest[] = [];
    const signer: SignerApi = {
      ...real,
      async evmSendTransaction(req) {
        checkEvmTransaction(req, (await real.addresses()).evm);
        sent.push(req);
        return { txHash: `0x${"1".padStart(64, "0")}` };
      },
    };
    const t = buildTestFren({ signer, live: true, evmBalances: { [`base:${BASE_USDC}`]: 100_000_000n } });
    // Relay's $1 probe routes, the real buy doesn't: the pool is too thin or still being set up.
    t.fake.relayNoRoute = (b) => String(b.destinationCurrency).toLowerCase() === BASE_DOG && b.amount !== "1000000";
    const res = await t.fren.submit(swap({ venue: "relay", chain: "base", token: BASE_DOG }));
    expect(res.text).toMatch(/⏳ .*DOG on Base has no pool Relay can reach yet/);

    const told = t.notifier.sent.length;
    await t.fren.snipeTick();
    await t.fren.snipeTick();
    expect(t.notifier.sent.length).toBe(told);
    expect(t.store.getSteps(res.planId!)[0]!.status).toBe("waiting");

    t.store.setKv(`buy_retry_since:${res.planId}:0`, String(Date.now() - BUY_RETRY_WINDOW_MS - 1000));
    await t.fren.snipeTick();
    expect(t.notifier.sent.at(-1)).toMatch(/❌ .*Gave up after 15 minutes of trying\. Nothing was bought\./);
    expect(t.store.getSteps(res.planId!)[0]!.status).toBe("failed");
    expect(sent).toHaveLength(0);
  });

  it("a snipe on a coin moving from its pump.fun curve to its pool waits, then buys in the pool", async () => {
    const t = buildTestFren();
    const curve = { mint: MIGRATING, complete: true, quote: "SOL" as const, quoteMint: "So11111111111111111111111111111111111111112", priceInQuote: 0.000_000_05, progressPct: 100, marketCapInQuote: 50, mayhem: false };
    t.pump.curves.set(MIGRATING, curve);
    const res = await t.fren.submit(swap({ venue: "jupiter", token: MIGRATING }, [{ type: "tradable", venue: "jupiter", token: MIGRATING }]));
    expect(res.text).toMatch(/👀 Watching/);
    await t.fren.snipeTick();
    expect(t.store.paperHoldings()).toHaveLength(0);

    // The pool is live and Jupiter routes it.
    t.fake.tokens.push({ id: MIGRATING, symbol: "MIGR", decimals: 6, isVerified: false, usdPrice: 0.00001 });
    await t.fren.snipeTick();
    expect(t.notifier.sent.at(-1)).toMatch(/⚡ Triggered[\s\S]*Paper: Bought 5,000,000 MIGR for \$50\.00/);
  });
});

describe("the live Solana feed", () => {
  function fakeSource() {
    const watched = new Map<number, { address: string; cb: () => void }>();
    let next = 1;
    const failing = new Set<string>();
    const source: MentionSource = {
      async watch(address, cb) {
        if (failing.has(address)) throw new Error("ws down");
        watched.set(next, { address, cb });
        return next++;
      },
      async unwatch(id) {
        watched.delete(id);
      },
    };
    const mention = (address: string) => [...watched.values()].filter((w) => w.address === address).forEach((w) => w.cb());
    return { source, watched, mention, failing };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("watches what snipes wait on, fires on a mention, and lets go of the rest", async () => {
    const { source, watched, mention } = fakeSource();
    let targets = ["CoinA", "CoinB"];
    let fired = 0;
    const feed = new SnipeFeed({ source, targets: () => targets, fire: async () => void fired++ });
    feed.sync();
    await settle();
    expect([...watched.values()].map((w) => w.address).sort()).toEqual(["CoinA", "CoinB"]);
    mention("CoinA");
    await settle();
    expect(fired).toBe(1);

    targets = ["CoinB"];
    feed.sync();
    await settle();
    expect([...watched.values()].map((w) => w.address)).toEqual(["CoinB"]);
    feed.close();
    await settle();
    expect(watched.size).toBe(0);
  });

  it("a burst of mentions runs the loop once more, not once per mention", async () => {
    const { source, mention } = fakeSource();
    let fired = 0;
    let release: () => void = () => {};
    const feed = new SnipeFeed({
      source,
      targets: () => ["Busy"],
      fire: () => {
        fired++;
        return new Promise<void>((r) => (release = r));
      },
    });
    feed.sync();
    await settle();
    mention("Busy");
    for (let i = 0; i < 20; i++) mention("Busy");
    expect(fired).toBe(1);
    release();
    await settle();
    expect(fired).toBe(2);
    release();
    await settle();
    expect(fired).toBe(2);
  });

  it("a watch that fails is tried again on the next sync", async () => {
    const { source, watched, failing } = fakeSource();
    failing.add("CoinA");
    const feed = new SnipeFeed({ source, targets: () => ["CoinA"], fire: async () => {} });
    feed.sync();
    await settle();
    expect(feed.watching()).toEqual([]);
    failing.clear();
    feed.sync();
    await settle();
    expect([...watched.values()].map((w) => w.address)).toEqual(["CoinA"]);
  });
});
