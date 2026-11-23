import { describe, expect, it } from "vitest";
import { isDashboardRequest, registerLoopGuard } from "./index.js";

/** 22.11: the owner tapped /dashboard in the Telegram menu and got OpenClaw's "session dashboard" skill. */
const NATIVE =
  "Use the following explicitly referenced skills for this request. Read each skill's SKILL.md before acting:\n- control-ui (SKILL.md: /x/control-ui/SKILL.md)\n\nUser request:\n\n$control-ui Create a dashboard for this session.";

function hook(gate?: unknown) {
  let fn: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  const api = { on: (name: string, f: typeof fn) => void (name === "before_agent_reply" && (fn = f)) };
  const calls: string[] = [];
  const client = {
    call: async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      return { text: "Sent you a login link for your dashboard in a separate message. It works once, for 10 minutes." } as never;
    },
  };
  const guard = { beforeReply: async () => gate, beforeTool: async () => undefined, endRun: async () => undefined };
  registerLoopGuard(api as never, guard as never, client as never);
  return { run: (body: string, ctx: Record<string, unknown> = { trigger: "user" }) => fn!({ cleanedBody: body }, ctx), calls };
}

describe("/dashboard is the Fren dashboard", () => {
  it("recognises the menu tap and the typed command, not ordinary talk about dashboards", () => {
    expect(isDashboardRequest(NATIVE)).toBe(true);
    expect(isDashboardRequest("/dashboard")).toBe(true);
    expect(isDashboardRequest("/dashboard@fren_bot")).toBe(true);
    expect(isDashboardRequest("how do I open the dashboard?")).toBe(false);
    expect(isDashboardRequest("Create a dashboard for this session.")).toBe(false);
  });

  it("answers with the Fren link message and no AI turn", async () => {
    const h = hook();
    const r = (await h.run(NATIVE)) as { handled: boolean; reply: { text: string } };
    expect(r.handled).toBe(true);
    expect(r.reply.text).toMatch(/login link for your dashboard/);
    expect(h.calls).toEqual(["POST /dashboard/link"]);
  });

  it("other messages go to the AI as before; background turns never get a link", async () => {
    const h = hook();
    expect(await h.run("long gold 10x")).toBeUndefined();
    expect(await h.run(NATIVE, { trigger: "heartbeat" })).toBeUndefined();
    expect(h.calls).toEqual([]);
  });

  it("the rate limit still applies", async () => {
    const h = hook({ handled: true, reason: "fren-guard: too many messages this minute" });
    expect(await h.run(NATIVE)).toMatchObject({ reason: /too many/ });
    expect(h.calls).toEqual([]);
  });
});
