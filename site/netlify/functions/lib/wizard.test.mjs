import { describe, expect, it } from "vitest";
import { chainClient, fromUnits, toUnits, USDC, walletUri } from "./chain.mjs";
import { resellerClient } from "./reseller.mjs";
import { createWizard, hostnameFor } from "./wizard.mjs";

const BASE_ADDR = "0x1111111111111111111111111111111111111111";
const SOL_ADDR = "FrenPay1111111111111111111111111111111111";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const hex = (n) => "0x" + BigInt(n).toString(16);
const txh = (n) => "0x" + String(n).padStart(64, "0");

/** A fake Base node behind fetch: USDC transfer logs and receipts. */
function fakeBase() {
  const s = { head: 1_000, logs: [], receipts: new Map(), calls: [] };
  const fetchFn = async (_url, init) => {
    const { method, params, id } = JSON.parse(init.body);
    s.calls.push(method);
    const ok = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
    if (method === "eth_blockNumber") return ok(hex(s.head));
    if (method === "eth_getLogs") {
      const [{ address, topics, fromBlock, toBlock }] = params;
      return ok(s.logs.filter((l) => l.address === address && l.topics[0] === topics[0] && l.topics[2] === topics[2] && l.block >= Number(fromBlock) && l.block <= Number(toBlock)));
    }
    if (method === "eth_getTransactionReceipt") return ok(s.receipts.get(params[0]) ?? null);
    if (method === "eth_getBlockByNumber") return ok({ timestamp: hex(Math.floor(s.blockTime / 1000)) });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { message: "unknown" } }));
  };
  /** A USDC transfer of `amount` to our address, mined at `block`. */
  s.pay = (amount, { block = s.head, tx = txh(s.logs.length + 1), to = BASE_ADDR, confirm = true } = {}) => {
    const log = { address: USDC.base.mint, topics: [TRANSFER, pad("0x2222222222222222222222222222222222222222"), pad(to)], data: hex(toUnits(amount)), transactionHash: tx, block };
    s.logs.push(log);
    s.receipts.set(tx, { status: "0x1", blockNumber: hex(block), logs: [log] });
    if (confirm) s.head = Math.max(s.head, block + 4);
    return tx;
  };
  return { s, fetchFn };
}

/** A fake EQVPS reseller API behind fetch. */
function fakeReseller() {
  const s = { clients: [], services: [], calls: [], orderFails: 0 };
  const fetchFn = async (url, init = {}) => {
    const path = new URL(url).pathname.replace("/api/reseller", "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    const m = init.method ?? "GET";
    s.calls.push(`${m} ${path}`);
    const json = (status, v) => new Response(JSON.stringify(v), { status });
    if (init.headers.authorization !== "Bearer rk_test") return json(401, { message: "Unauthenticated." });
    if (path === "/os") return json(200, { data: [{ os_id: 9, name: "Debian 12", family: "linux" }, { os_id: 4, name: "Ubuntu 24.04", family: "linux" }] }); // shape seen live
    if (path === "/clients" && m === "GET") return json(200, { data: s.clients });
    if (path === "/clients") {
      const c = { id: 500 + s.clients.length, email: body.email };
      s.clients.push(c);
      return json(201, { data: { client_id: c.id } });
    }
    if (path === "/services" && m === "GET") return json(200, { data: s.services });
    if (path === "/orders") {
      if (s.orderRefusal) return json(400, s.orderRefusal);
      if (s.orderFails > 0) {
        s.orderFails--;
        return json(500, { message: "busy" });
      }
      const svc = { id: 41 + s.services.length, hostname: body.hostname, status: "provisioning", body };
      s.services.push(svc);
      return json(201, { data: { service_id: svc.id } });
    }
    const sv = path.match(/^\/services\/(\d+)(\/\w+)?$/);
    if (sv) {
      const svc = s.services.find((x) => x.id === Number(sv[1]));
      if (!svc) return json(404, { message: "no such service" });
      if (sv[2] === "/autorenew") return (svc.autorenew = body.enabled), json(200, {});
      if (sv[2] === "/password") {
        if (s.resetBusy > 0) return s.resetBusy--, json(429, { error: "too often", retry_after_s: 30 });
        return (svc.pw = "reset-pw"), (svc.hidden = false), json(200, { data: { status: "queued" } });
      }
      if (sv[2] === "/reinstall") return (svc.reinstalledWith = body.os_id), json(200, { data: { status: "reinstalling" } });
      // EQVPS shows the root password once ("password_revealed"), then hides it.
      if (svc.status !== "active") return json(200, { data: { status: svc.status } });
      const password = svc.hidden ? undefined : (svc.pw ?? "root-pw");
      if (s.revealOnce) svc.hidden = true;
      return json(200, { data: { status: "active", hostname: svc.hostname, access: { host: "1.2.3.4", port: 22, ...(password ? { password } : {}) } } });
    }
    return json(404, { message: "nope" });
  };
  s.boot = () => s.services.forEach((x) => (x.status = "active"));
  return { s, fetchFn };
}

function setup({ addresses = { base: BASE_ADDR, solana: SOL_ADDR }, reseller = true, planId = "77", contact = "", location = "fi" } = {}) {
  const base = fakeBase();
  const rs = fakeReseller();
  const chain = chainClient({ baseRpc: "https://base.test", solanaRpc: "https://sol.test", fetchFn: base.fetchFn });
  const db = new Map();
  const triggered = [];
  let t = 1_700_000_000_000;
  base.s.blockTime = t;
  const wizard = createWizard({
    config: { priceUsd: 10, addresses, planId, contact, location },
    chain,
    reseller: reseller ? resellerClient({ token: "rk_test", base: "https://b2b.test/api/reseller", fetchFn: rs.fetchFn }) : null,
    store: { get: async (id) => (db.has(id) ? structuredClone(db.get(id)) : null), set: async (id, v) => void db.set(id, structuredClone(v)) },
    triggerInstall: async (id) => void triggered.push(id),
    now: () => t,
  });
  return { wizard, base: base.s, rs: rs.s, db, triggered, tick: (ms) => (t += ms) };
}

/** Polls past the 8 s RPC throttle. */
async function poll(t, id) {
  t.tick(9_000);
  return t.wizard.status(id);
}

describe("amounts", () => {
  it("converts USDC amounts exactly", () => {
    expect(toUnits("10.0437")).toBe(10_043_700n);
    expect(toUnits(10)).toBe(10_000_000n);
    expect(fromUnits(10_043_700n)).toBe("10.0437");
    expect(fromUnits(10_000_000n)).toBe("10.00");
  });

  it("builds wallet links that fill in token, amount and address", () => {
    expect(walletUri("base", BASE_ADDR, "10043700")).toBe(`ethereum:${USDC.base.mint}@8453/transfer?address=${BASE_ADDR}&uint256=10043700`);
    expect(walletUri("solana", SOL_ADDR, "10043700")).toMatch(new RegExp(`^solana:${SOL_ADDR}\\?amount=10\\.0437&spl-token=${USDC.solana.mint}`));
  });
});

describe("VPS wizard", () => {
  it("stays closed until every setting is there", async () => {
    for (const opts of [{ reseller: false }, { planId: "" }, { addresses: {} }]) {
      const { wizard } = setup(opts);
      expect((await wizard.plans()).open).toBe(false);
      await expect(wizard.start("a@b.co", "base")).rejects.toThrow(/isn't open yet/);
    }
    expect(await setup().wizard.plans()).toEqual({
      open: true,
      priceUsd: 10,
      networks: [
        { id: "base", label: "Base", token: "USDC" },
        { id: "solana", label: "Solana", token: "USDC" },
      ],
    });
  });

  it("shows the exact amount, token, network and address, and orders nothing yet", async () => {
    const t = setup();
    const v = await t.wizard.start(" Bee@Example.com ", "base");
    expect(v).toMatchObject({ stage: "awaiting_payment", network: "base", networkLabel: "Base", token: "USDC", address: BASE_ADDR });
    expect(v.amount).toMatch(/^10\.0\d{1,3}$/);
    expect(Number(v.amount)).toBeGreaterThan(10);
    expect(Number(v.amount)).toBeLessThan(10.1);
    expect(v.walletUri).toContain(String(toUnits(v.amount)));
    expect(v.expiresAt).toBeGreaterThan(v.now);
    expect(t.db.get(v.id).email).toBe("bee@example.com");
    expect(t.rs.calls).toEqual([]); // no server account, no order, no email before payment
  });

  it("gives two open orders different amounts", async () => {
    const t = setup();
    const seen = new Set();
    for (let i = 0; i < 30; i++) seen.add((await t.wizard.start(`a${i}@b.co`, "base")).amount);
    expect(seen.size).toBe(30);
  });

  it("never says paid without a matching transfer on-chain", async () => {
    const t = setup();
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.base.pay("10"); // wrong amount
    t.base.pay(amount, { to: "0x3333333333333333333333333333333333333333" }); // wrong address
    for (let i = 0; i < 5; i++) expect((await poll(t, id)).stage).toBe("awaiting_payment");
    // An RPC outage is a wait, not a payment.
    t.base.head = NaN;
    expect((await poll(t, id)).stage).toBe("awaiting_payment");
    expect(t.rs.calls).toEqual([]);
    expect(t.triggered).toEqual([]);
  });

  it("does not take a transfer mined before the order", async () => {
    const t = setup();
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.base.pay(amount, { block: 900 }); // before the order's starting block
    t.base.head += 10;
    expect((await poll(t, id)).stage).toBe("awaiting_payment");
  });

  it("waits for confirmations, then confirms the exact amount and orders the server once", async () => {
    const t = setup();
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    const tx = t.base.pay(amount, { block: t.base.head + 1, confirm: false });
    t.base.head += 2; // 1 confirmation
    expect((await poll(t, id)).stage).toBe("awaiting_payment");
    t.base.head += 5;
    const v = await poll(t, id);
    expect(v).toMatchObject({ stage: "provisioning", paidTx: tx, paidAmount: amount, paidTxUrl: `https://basescan.org/tx/${tx}` });
    expect(v.address).toBeUndefined();
    expect(t.rs.services).toHaveLength(1);
    expect(t.rs.services[0]).toMatchObject({ hostname: hostnameFor({ id }), autorenew: false, body: { client_id: 500, plan_id: "77", os_id: 4, location: "fi" } });
    expect(t.rs.clients).toEqual([{ id: 500, email: "bee@example.com" }]);

    // Still booting: no install yet, no second order.
    expect((await poll(t, id)).stage).toBe("provisioning");
    expect(t.triggered).toEqual([]);
    t.rs.boot();
    expect((await poll(t, id)).stage).toBe("installing");
    expect(t.db.get(id)).toMatchObject({ host: "1.2.3.4", port: 22, password: "root-pw" });
    expect(t.triggered).toEqual([id]);
    expect((await poll(t, id)).stage).toBe("installing");
    expect(t.triggered).toEqual([id]);
    expect(t.rs.calls.filter((c) => c === "POST /orders")).toHaveLength(1);
  });

  it("retries a refused order a few times, then says so without charging twice", async () => {
    const t = setup({ contact: "help@fren.example" });
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.base.pay(amount);
    t.rs.orderFails = 1;
    expect((await poll(t, id)).stage).toBe("paid");
    expect((await poll(t, id)).stage).toBe("provisioning");
    expect(t.rs.services).toHaveLength(1);

    const u = setup({ contact: "help@fren.example" });
    const o = await u.wizard.start("bee@example.com", "base");
    u.base.pay(o.amount);
    u.rs.orderFails = 9;
    for (let i = 0; i < 4; i++) await poll(u, o.id);
    const v = await poll(u, o.id);
    expect(v).toMatchObject({ stage: "failed", retryable: true, retryKind: "order", contact: "help@fren.example", error: expect.stringMatching(/got your payment/) });
  });

  it("keeps the host's reason, and the operator orders again on the same payment", async () => {
    const t = setup();
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.base.pay(amount);
    // EQVPS's 400 has no "message" field: the reason must still reach the log.
    t.rs.orderRefusal = { error: "Location fi is not available for this plan" };
    for (let i = 0; i < 4; i++) await poll(t, id);
    const v = await poll(t, id);
    expect(v).toMatchObject({ stage: "failed", retryable: true, retryKind: "order", paidTx: expect.any(String), detail: expect.stringMatching(/Location fi is not available/) });
    expect(v.error).toMatch(/won't be charged again/);
    expect(t.rs.services).toHaveLength(0);

    // Try again while the host still refuses: failed again, reason kept, still no server.
    await t.wizard.retry(id);
    for (let i = 0; i < 4; i++) await poll(t, id);
    expect(await poll(t, id)).toMatchObject({ stage: "failed", retryable: true, retryKind: "order" });
    expect(t.rs.services).toHaveLength(0);

    t.rs.orderRefusal = null; // the plan got Finland
    const r = await t.wizard.retry(id);
    // A double click right after is harmless and orders nothing more.
    expect(await t.wizard.retry(id)).toMatchObject({ stage: "provisioning" });
    expect(r).toMatchObject({ stage: "provisioning", paidTx: v.paidTx });
    expect(r.error).toBeUndefined();
    expect(t.rs.services).toHaveLength(1);
    // Nothing left to reorder: never a second server.
    await expect(t.wizard.reorder(id)).rejects.toThrow(/no paid order waiting/);
    expect(t.rs.calls.filter((c) => c === "POST /orders").length).toBeGreaterThan(1);
    expect(t.rs.services).toHaveLength(1);
  });

  it("finds an order that went through even if the answer got lost", async () => {
    const t = setup();
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.base.pay(amount);
    // The server exists already (e.g. the last attempt timed out after EQVPS made it).
    t.rs.services.push({ id: 90, hostname: hostnameFor({ id }), status: "provisioning" });
    expect((await poll(t, id)).stage).toBe("provisioning");
    expect(t.rs.calls.filter((c) => c === "POST /orders")).toHaveLength(0);
    expect(t.db.get(id).serviceId).toBe(90);
  });

  describe("pasted transaction", () => {
    it("accepts a rounded amount from an exchange when it covers the price", async () => {
      const t = setup();
      const { id } = await t.wizard.start("bee@example.com", "base");
      const tx = t.base.pay("10.05");
      expect((await poll(t, id)).stage).toBe("awaiting_payment"); // not the exact amount, so no auto match
      expect(await t.wizard.submitTx(id, tx)).toMatchObject({ stage: "paid", paidTx: tx, paidAmount: "10.05" });
      expect((await poll(t, id)).stage).toBe("provisioning");
    });

    it("refuses too little, junk, failed, foreign and reused transactions", async () => {
      const t = setup();
      const a = await t.wizard.start("a@b.co", "base");
      const b = await t.wizard.start("c@d.co", "base");
      await expect(t.wizard.submitTx(a.id, "hello")).rejects.toThrow(/doesn't look like a Base transaction/);
      await expect(t.wizard.submitTx(a.id, t.base.pay("9.5"))).rejects.toThrow(/sent 9.50 USDC. The server is 10.00/);
      await expect(t.wizard.submitTx(a.id, t.base.pay("10", { to: "0x4444444444444444444444444444444444444444" }))).rejects.toThrow(/didn't send USDC/);
      const failedTx = txh(999);
      t.base.receipts.set(failedTx, { status: "0x0", blockNumber: hex(990), logs: [] });
      await expect(t.wizard.submitTx(a.id, failedTx)).rejects.toThrow(/failed on-chain/);
      await expect(t.wizard.submitTx(a.id, txh(12345))).rejects.toThrow(/isn't confirmed yet/);
      // B's exact amount belongs to B.
      await expect(t.wizard.submitTx(a.id, t.base.pay(b.amount))).rejects.toThrow(/different order/);
      // One payment, one order.
      const tx = t.base.pay("10.5");
      await t.wizard.submitTx(a.id, tx);
      await expect(t.wizard.submitTx(b.id, tx)).rejects.toThrow(/already used/);
    });

    it("refuses a transaction from before the order", async () => {
      const t = setup();
      t.base.blockTime -= 60 * 60_000;
      const { id } = await t.wizard.start("a@b.co", "base");
      await expect(t.wizard.submitTx(id, t.base.pay("10"))).rejects.toThrow(/before this order/);
    });
  });

  it("an hour without payment shows expired, and a late exact payment still counts", async () => {
    const t = setup();
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.tick(61 * 60_000);
    expect((await poll(t, id)).stage).toBe("expired");
    t.base.pay(amount);
    expect((await poll(t, id)).stage).toBe("provisioning");
  });

  async function installing(opts) {
    const t = setup(opts);
    const { id, amount } = await t.wizard.start("bee@example.com", "base");
    t.base.pay(amount);
    await poll(t, id);
    t.rs.boot();
    await poll(t, id);
    return { ...t, id };
  }
  const OK = (u = "abc") => async () => ({ code: 0, output: `lots\nFREN_SETUP_URL=https://1-2-3-4.sslip.io/setup?t=${u}\n` });
  const BAD = async () => ({ code: 1, output: "x Couldn't download Fren from https://github.com/beeonchain/frenweb3.git.\n" });

  it("installs over SSH with the first root password, keeps the setup link and forgets the password", async () => {
    const { wizard, db, id } = await installing();
    let seen;
    await wizard.install(id, async (o) => {
      seen = o;
      o.onLine("==> Building Fren (a couple of minutes)");
      return OK()();
    }, "INSTALL");
    expect(seen).toMatchObject({ host: "1.2.3.4", port: 22, password: "root-pw", command: "INSTALL" });
    expect(await wizard.status(id)).toMatchObject({ stage: "ready", setupUrl: "https://1-2-3-4.sslip.io/setup?t=abc" });
    expect(db.get(id).password).toBeUndefined();
    await wizard.install(id, async () => {
      throw new Error("should not run");
    }, "x");
  });

  it("keeps Polymarket's answer from the new server, and shows it", async () => {
    // What polymarket.com/api/geoblock answers from Finland, and from Germany.
    const fi = await installing();
    await fi.wizard.install(fi.id, async () => ({ code: 0, output: `FREN_SETUP_URL=https://1-2-3-4.sslip.io/setup?t=a\nFREN_POLYMARKET_GEO={"blocked":false,"ip":"1.2.3.4","country":"FI","region":"18"}\n` }), "I");
    expect(await fi.wizard.status(fi.id)).toMatchObject({ stage: "ready", polymarket: { blocked: false, country: "FI" } });
    const de = await installing();
    await de.wizard.install(de.id, async () => ({ code: 0, output: `FREN_SETUP_URL=https://1-2-3-4.sslip.io/setup?t=b\nFREN_POLYMARKET_GEO={"blocked":true,"ip":"1.2.3.4","country":"DE","region":"HE"}\n` }), "I");
    expect((await de.wizard.status(de.id)).polymarket).toEqual({ blocked: true, country: "DE" });
    // No answer (Polymarket down): still ready, nothing claimed.
    const none = await installing();
    await none.wizard.install(none.id, async () => ({ code: 0, output: "FREN_SETUP_URL=https://1-2-3-4.sslip.io/setup?t=c\nFREN_POLYMARKET_GEO=\n" }), "I");
    const v = await none.wizard.status(none.id);
    expect(v.stage).toBe("ready");
    expect(v.polymarket).toBeUndefined();
  });

  it("hands out the Fren code only while that order's install runs", async () => {
    const { wizard, id } = await installing();
    expect(await wizard.mayDownload(id)).toBe(true);
    await wizard.install(id, OK(), "x");
    expect(await wizard.mayDownload(id)).toBe(false);
    const other = setup();
    const { id: unpaid } = await other.wizard.start("a@b.co", "base");
    expect(await other.wizard.mayDownload(unpaid)).toBe(false);
    await expect(other.wizard.mayDownload("x".repeat(32))).rejects.toThrow(/couldn't find/);
  });

  it("after the install, hands out newer code only with that server's update key", async () => {
    const { wizard, db, id } = await installing();
    const key = "k".repeat(32);
    await wizard.install(id, OK(), "u", key);
    expect(db.get(id).updateKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.get(id))).not.toContain(key);
    expect(await wizard.mayDownload(id, key)).toBe(true);
    expect(await wizard.mayDownload(id, "x".repeat(32))).toBe(false);
    expect(await wizard.mayDownload(id)).toBe(false);
  });

  it("a broken install retries once by itself, then offers a button, on the same server", async () => {
    const { wizard, db, rs, triggered, id } = await installing();
    await wizard.install(id, BAD, "u");
    expect(await wizard.status(id)).toMatchObject({ stage: "installing", progress: expect.stringMatching(/trying again/i) });
    expect(triggered).toEqual([id, id]);
    await wizard.install(id, BAD, "u");
    const v = await wizard.status(id);
    expect(v).toMatchObject({ stage: "failed", retryable: true, error: expect.stringMatching(/paid for/), detail: expect.stringMatching(/Couldn't download/) });
    expect(JSON.stringify(v)).not.toMatch(/root-pw|rk_/);
    expect(db.get(id).password).toBe("root-pw");
    expect(await wizard.retry(id)).toMatchObject({ stage: "installing" });
    await wizard.install(id, OK("late"), "u");
    expect(await wizard.status(id)).toMatchObject({ stage: "ready" });
    expect(rs.calls.filter((c) => c === "POST /orders")).toHaveLength(1);
    await expect(wizard.retry(id)).rejects.toThrow(/nothing to retry/);
  });

  it("an install that never reports back is retried, then offered again", async () => {
    const { wizard, tick, triggered, id } = await installing();
    tick(18 * 60_000);
    expect((await wizard.status(id)).stage).toBe("installing");
    expect(triggered).toHaveLength(2);
    tick(18 * 60_000);
    expect(await wizard.status(id)).toMatchObject({ stage: "failed", retryable: true });
  });

  it("reinstalls the same server on request, waits for it, then installs again", async () => {
    const { wizard, db, rs, triggered, tick, id } = await installing();
    await expect(wizard.reinstall(id)).rejects.toThrow(/no finished server/);
    await wizard.install(id, OK("old"), "u");
    expect(await wizard.reinstall(id)).toMatchObject({ stage: "provisioning", progress: expect.stringMatching(/reinstalling/i) });
    expect(rs.services[0].reinstalledWith).toBe(4);
    expect(db.get(id).setupUrl).toBeUndefined();
    // EQVPS still says "active" right after: don't SSH into the old system.
    tick(30_000);
    expect((await wizard.status(id)).stage).toBe("provisioning");
    expect(triggered).toEqual([id]);
    tick(4 * 60_000);
    expect((await wizard.status(id)).stage).toBe("installing");
    expect(triggered).toEqual([id, id]);
    await wizard.install(id, OK("new"), "u");
    expect(await wizard.status(id)).toMatchObject({ stage: "ready", setupUrl: expect.stringContaining("t=new") });
    expect(rs.calls.filter((c) => c === "POST /orders")).toHaveLength(1);
  });

  it("when EQVPS already showed the password once, resets it without hammering, and waits out a busy answer", async () => {
    const { wizard, db, rs, tick, id } = await installing();
    await wizard.install(id, OK("old"), "u");
    await wizard.reinstall(id);
    rs.revealOnce = true;
    rs.services[0].hidden = true;
    rs.resetBusy = 1;
    tick(4 * 60_000);
    expect((await wizard.status(id)).stage).toBe("provisioning"); // reset refused (429): no error, keep waiting
    tick(10_000);
    expect((await wizard.status(id)).stage).toBe("provisioning"); // too soon to ask again
    expect(rs.calls.filter((c) => c.endsWith("/password"))).toHaveLength(1);
    tick(90_000);
    expect((await wizard.status(id)).stage).toBe("provisioning"); // reset accepted, password shows on the next read
    tick(10_000);
    expect((await wizard.status(id)).stage).toBe("installing");
    expect(db.get(id).password).toBe("reset-pw");
    expect(rs.calls.filter((c) => c.endsWith("/password"))).toHaveLength(2);
  });

  it("rejects bad input and unknown ids", async () => {
    const { wizard } = setup();
    await expect(wizard.start("nope", "base")).rejects.toThrow(/email/);
    await expect(wizard.start("a@b.co", "tron")).rejects.toThrow(/Base or Solana/);
    await expect(wizard.status("x".repeat(32))).rejects.toThrow(/couldn't find/);
    await expect(wizard.status("../../etc/passwd/xxxxxxxxxxxxxxxx")).rejects.toThrow(/couldn't find/);
  });

  it("only offers the networks that have an address", async () => {
    const { wizard } = setup({ addresses: { solana: SOL_ADDR } });
    expect((await wizard.plans()).networks.map((n) => n.id)).toEqual(["solana"]);
    await expect(wizard.start("a@b.co", "base")).rejects.toThrow(/Base or Solana/);
  });
});

describe("Solana payments", () => {
  it("reads USDC that reached the owner's token account", async () => {
    const calls = [];
    const tx = "5".repeat(88);
    const fetchFn = async (_u, init) => {
      const { method, params, id } = JSON.parse(init.body);
      calls.push(method);
      const ok = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
      if (method === "getTokenAccountsByOwner") return ok({ value: [{ pubkey: "ATA111111111111111111111111111111111" }] });
      if (method === "getSignaturesForAddress") return ok(params[1].until ? [] : [{ signature: tx, blockTime: 1_700_000_100, err: null }]);
      if (method === "getTransaction")
        return ok({
          blockTime: 1_700_000_100,
          meta: {
            err: null,
            preTokenBalances: [{ mint: USDC.solana.mint, owner: SOL_ADDR, uiTokenAmount: { amount: "1000000" } }],
            postTokenBalances: [{ mint: USDC.solana.mint, owner: SOL_ADDR, uiTokenAmount: { amount: "11043700" } }],
          },
        });
    };
    const c = chainClient({ baseRpc: "x", solanaRpc: "https://sol.test", fetchFn });
    const r = await c.solana.transfersTo(SOL_ADDR, null);
    expect(r).toEqual({ transfers: [{ tx, units: 10_043_700n, at: 1_700_000_100_000 }], next: tx });
    expect((await c.solana.transfersTo(SOL_ADDR, tx)).transfers).toEqual([]);
    expect(await c.solana.transferInTx(SOL_ADDR, tx)).toEqual({ tx, units: 10_043_700n, at: 1_700_000_100_000 });
  });
});
