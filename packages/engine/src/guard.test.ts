import { describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { AgentBudget, AgentGuard } from "./guard.js";
import { Store } from "./store.js";
import { buildTestFren } from "./testing.js";

describe("agent budget", () => {
  it("allows turnsPerDay turns a UTC day, tells the owner once, then is silent until 00:00 UTC", () => {
    const store = new Store(":memory:", 10_000);
    const budget = new AgentBudget(store, () => AgentGuard.parse({ turnsPerDay: 200 }));
    const day = new Date("2026-11-17T10:00:00Z");
    const results = Array.from({ length: 300 }, () => budget.take(day));
    expect(results.filter((r) => r.allow)).toHaveLength(200);
    const notices = results.filter((r) => r.notice);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.notice).toMatch(/200 messages today/);
    expect(notices[0]!.notice).not.toMatch(/\$|USD|cost|money/i);
    expect(budget.usedToday(day)).toBe(200);
    // Next UTC day: a fresh count and a fresh notice.
    const next = new Date("2026-11-18T00:00:01Z");
    expect(budget.take(next)).toMatchObject({ allow: true, used: 1 });
  });

  it("picks up a new limit from the config without a restart", () => {
    const store = new Store(":memory:", 10_000);
    let guard = AgentGuard.parse({ turnsPerDay: 1 });
    const budget = new AgentBudget(store, () => guard);
    expect(budget.take().allow).toBe(true);
    expect(budget.take().allow).toBe(false);
    guard = AgentGuard.parse({ turnsPerDay: 5 });
    expect(budget.take().allow).toBe(true);
  });

  it("has safe defaults when config.json says nothing", () => {
    expect(AgentGuard.parse(undefined)).toEqual({ turnsPerDay: 200, turnsPerMinute: 10, toolCallsPerTurn: 20 });
    expect(() => AgentGuard.parse({ turnsPerDay: 0 })).toThrow();
  });

  it("is served to the plugin over the token-protected API", async () => {
    const t = buildTestFren();
    const budget = new AgentBudget(t.store, () => AgentGuard.parse({ turnsPerDay: 2 }));
    const server = createApi(t.fren, "secret-token", budget);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const call = (method: string, path: string, token = "secret-token") =>
      fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
    try {
      expect((await call("POST", "/agent/turn", "wrong")).status).toBe(401);
      expect(await (await call("GET", "/agent/guard")).json()).toEqual({ guard: { turnsPerDay: 2, turnsPerMinute: 10, toolCallsPerTurn: 20 }, usedToday: 0 });
      expect(await (await call("POST", "/agent/turn")).json()).toMatchObject({ allow: true, used: 1, limit: 2 });
      expect(await (await call("POST", "/agent/turn")).json()).toMatchObject({ allow: true, used: 2 });
      const refused = (await (await call("POST", "/agent/turn")).json()) as { allow: boolean; notice?: string };
      expect(refused.allow).toBe(false);
      expect(refused.notice).toMatch(/daily limit/);
      expect(((await (await call("POST", "/agent/turn")).json()) as { notice?: string }).notice).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

describe("trade results that outlive the chat", () => {
  const planBody = JSON.stringify({ plan: { request: "long gold 10x with $50", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "xyz:gold", side: "long", sizing: { type: "margin", usd: 50 }, leverage: 10 } }] } });
  const post = (port: number) => fetch(`http://127.0.0.1:${port}/plans`, { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: planBody });

  it("sends the outcome to the owner once when the trade ran longer than slowMs", async () => {
    const t = buildTestFren();
    const server = createApi(t.fren, "t", undefined, { slowMs: -1 });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = (await (await post((server.address() as { port: number }).port)).json()) as { text: string; receiptSent?: boolean };
      // The receipt already reached the owner on their own line: it isn't sent a second time.
      expect(res.receiptSent).toBe(true);
      expect(t.notifier.sent).toHaveLength(1);
      expect(t.notifier.receipts[0]!.plain).toContain("Bet on GOLD going up");
    } finally {
      server.close();
    }
  });

  it("a quick trade sends only its receipt", async () => {
    const t = buildTestFren();
    const server = createApi(t.fren, "t");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      await post((server.address() as { port: number }).port);
      expect(t.notifier.sent).toHaveLength(1);
      expect(t.notifier.receipts).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
