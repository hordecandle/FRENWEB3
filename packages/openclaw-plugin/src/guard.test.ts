import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentBudget, AgentGuard, createApi } from "@fren/engine";
import { buildTestFren } from "../../engine/src/testing.js";
import { LoopGuard } from "./guard.js";
import plugin from "./index.js";

type Hook = (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<any>;

/** Loads the real plugin with a host that records hooks and commands. */
function loadPlugin(pluginConfig: Record<string, unknown>) {
  const hooks = new Map<string, Hook>();
  const commands = new Map<string, any>();
  const api = {
    registrationMode: "full",
    pluginConfig,
    registerTool: () => {},
    registerCommand: (def: { name: string }) => commands.set(def.name, def),
    on: (name: string, fn: Hook) => hooks.set(name, fn),
  };
  (plugin as unknown as { register: (api: unknown) => void }).register(api);
  return { hooks, commands };
}

/**
 * A stand-in for the OpenClaw gateway and a model provider. Each inbound message
 * goes through before_agent_reply like in OpenClaw; if it isn't claimed, a fake
 * model answers. The "looping" model asks for a tool on every step and never
 * stops by itself; OpenClaw's own stop after 3 identical tool errors in a row
 * is modelled, so the count shows what the plugin cap leaves.
 */
function fakeGateway(hooks: Map<string, Hook>, model: "looping" | "polite" = "polite") {
  let modelCalls = 0;
  let toolCalls = 0;
  let run = 0;
  const replies: string[] = [];
  async function inbound(ctx: Record<string, unknown>) {
    const runId = `run-${++run}`;
    const full = { trigger: "user", channel: "telegram", chatId: "777", senderId: "777", runId, inputProvenance: { kind: "external_user" }, ...ctx };
    const claim = await hooks.get("before_agent_reply")!({}, full);
    if (claim?.handled) {
      if (claim.reply?.text) replies.push(claim.reply.text);
      return;
    }
    let blockedInARow = 0;
    for (let step = 0; step < 1_000; step++) {
      modelCalls++;
      if (model === "polite" && step > 0) break; // one tool, then the answer
      const gate = await hooks.get("before_tool_call")!({ runId, toolName: "fren_status" }, { runId, sessionKey: "main" });
      if (gate?.block) {
        if (++blockedInARow >= 3) break; // OpenClaw: 3 identical tool errors stop the run
      } else {
        toolCalls++;
        blockedInARow = 0;
      }
    }
    await hooks.get("agent_end")!({}, { runId });
  }
  return { inbound, replies, get modelCalls() { return modelCalls; }, get toolCalls() { return toolCalls; } };
}

describe("loop guard scenarios (plugin + real engine + fake model)", () => {
  const dir = mkdtempSync(join(tmpdir(), "fren-guard-"));
  const tokenFile = join(dir, "api-token");
  writeFileSync(tokenFile, "guard-token");
  const t = buildTestFren({ privateLine: false });
  const budget = new AgentBudget(t.store, () => AgentGuard.parse({}));
  const server = createApi(t.fren, "guard-token", budget);
  let apiUrl = "";

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  it("cuts a tool loop at 12 tool calls in one message", async () => {
    const { hooks } = loadPlugin({ apiUrl, tokenFile });
    const gw = fakeGateway(hooks, "looping");
    await gw.inbound({});
    expect(gw.toolCalls).toBe(12);
    // 12 allowed + 3 refused, then OpenClaw stops: a bounded run, not 1000 calls.
    expect(gw.modelCalls).toBe(15);
    // The next message starts with a fresh allowance.
    await gw.inbound({});
    expect(gw.toolCalls).toBe(24);
  });

  it("gives bots and other agents 0 model calls", async () => {
    const { hooks } = loadPlugin({ apiUrl, tokenFile });
    const gw = fakeGateway(hooks);
    for (let i = 0; i < 50; i++) {
      await gw.inbound({ chatId: "-100group", senderId: `bot${i % 2}`, channelContext: { sender: { isBot: true } } });
      await gw.inbound({ chatId: "-100group", inputProvenance: { kind: "inter_session" } });
    }
    expect(gw.modelCalls).toBe(0);
    expect(gw.replies).toEqual([]);
  });

  it("makes 0 model calls in a quiet hour of heartbeats, cron and wake-ups", async () => {
    const { hooks } = loadPlugin({ apiUrl, tokenFile });
    const gw = fakeGateway(hooks, "looping");
    for (let minute = 0; minute < 60; minute++) {
      await gw.inbound({ trigger: "heartbeat" });
      await gw.inbound({ trigger: "cron" });
      await gw.inbound({ trigger: "exec-event" });
    }
    expect(gw.modelCalls).toBe(0);
  });

  it("answers 300 messages a day with exactly 200 turns, one notice, and /fren_stop still works", async () => {
    // A fresh engine: today's count starts at 0.
    const t2 = buildTestFren({ privateLine: false });
    const server2 = createApi(t2.fren, "guard-token", new AgentBudget(t2.store, () => AgentGuard.parse({})));
    await new Promise<void>((r) => server2.listen(0, "127.0.0.1", r));
    try {
      const { hooks, commands } = loadPlugin({ apiUrl: `http://127.0.0.1:${(server2.address() as { port: number }).port}`, tokenFile });
      const gw = fakeGateway(hooks);
      // Spread over the day so the per-minute cap isn't what stops them: separate chats.
      for (let i = 0; i < 300; i++) await gw.inbound({ chatId: `chat-${i}` });
      expect(gw.modelCalls).toBe(200 * 2); // polite model: tool call + answer per turn
      expect(gw.replies).toHaveLength(1);
      expect(gw.replies[0]).toMatch(/200 messages today/);
      expect(gw.replies[0]).not.toMatch(/\$|cost|money|spend/i);
      const stop = await commands.get("fren_stop").handler({ senderIsOwner: true, args: "" });
      expect(stop.text).toMatch(/Stopped/);
      const limits = await commands.get("limits").handler({ senderIsOwner: true, args: "" });
      expect(limits.text).toBeTruthy();
    } finally {
      server2.close();
    }
  });
});

describe("LoopGuard", () => {
  it("lets 6 messages a minute through per chat, drops the rest silently", async () => {
    let now = Date.parse("2026-11-17T12:00:00Z");
    const g = new LoopGuard(null, () => now);
    const ctx = { trigger: "user", channel: "telegram", chatId: "1", inputProvenance: { kind: "external_user" } };
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await g.beforeReply(ctx));
    expect(results.filter((r) => r === undefined)).toHaveLength(6);
    expect(results.filter((r) => r?.handled && !r.reply)).toHaveLength(4);
    // Another chat has its own minute.
    expect(await g.beforeReply({ ...ctx, chatId: "2" })).toBeUndefined();
    now += 61_000;
    expect(await g.beforeReply(ctx)).toBeUndefined();
  });

  it("keeps a daily count of its own when the engine is down", async () => {
    const down = { call: async () => { throw new Error("ECONNREFUSED"); } };
    let now = Date.parse("2026-11-17T12:00:00Z");
    const g = new LoopGuard(down as never, () => now);
    let allowed = 0;
    const notices: string[] = [];
    for (let i = 0; i < 205; i++) {
      now += 61_000; // one a minute
      const r = await g.beforeReply({ trigger: "user", chatId: "1" });
      if (r === undefined) allowed++;
      else if (r.reply) notices.push(r.reply.text);
    }
    expect(allowed).toBe(200);
    expect(notices).toHaveLength(1);
  });

  it("reads the limits from the engine", async () => {
    const engine = { call: async (_m: string, path: string) => (path === "/agent/guard" ? { guard: { turnsPerDay: 200, turnsPerMinute: 6, toolCallsPerTurn: 2 } } : { allow: true, used: 1, limit: 200 }) };
    const g = new LoopGuard(engine as never);
    expect(await g.beforeTool({ runId: "r" })).toBeUndefined();
    expect(await g.beforeTool({ runId: "r" })).toBeUndefined();
    expect((await g.beforeTool({ runId: "r" }))?.block).toBe(true);
  });

  it("doesn't count Tool Search's dispatch_action on top of the tool it dispatches", async () => {
    const g = new LoopGuard(null);
    let passed = 0;
    for (let i = 0; i < 20; i++) {
      if (!(await g.beforeTool({ runId: "r", toolName: "dispatch_action" }))) passed++;
      if (!(await g.beforeTool({ runId: "r", toolName: "fren_status" }))) passed++;
    }
    // 20 wrappers pass, 12 real calls pass.
    expect(passed).toBe(32);
  });
});
