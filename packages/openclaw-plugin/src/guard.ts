import type { EngineClient } from "./client.js";

/**
 * Loop guard: the AI key is the owner's, so Fren must not be able to spin.
 * Runs as OpenClaw plugin hooks (OpenClaw ≥2026.10.5; both exist there and in
 * 2026.11): `before_agent_reply` decides whether a message gets an AI turn at
 * all, `before_tool_call` caps the tool calls inside one turn. Owner commands
 * (/fren_stop, /ok, /resume, /limits) are plugin commands that never reach the
 * model, so nothing here counts or blocks them.
 *
 * Needs plugins.entries.fren.hooks.allowConversationAccess=true (setup sets it):
 * OpenClaw only runs before_agent_reply for non-bundled plugins with that grant.
 * Who may talk to Fren at all is OpenClaw's job, set by setup: DMs from the
 * owner only (allowFrom), groups disabled, WhatsApp self-chat off.
 */

export interface GuardLimits {
  turnsPerDay: number;
  turnsPerMinute: number;
  toolCallsPerTurn: number;
}

export const DEFAULT_GUARD: GuardLimits = { turnsPerDay: 200, turnsPerMinute: 10, toolCallsPerTurn: 20 };

/** What the plugin's hooks see; a subset of OpenClaw's PluginHookAgentContext. */
export interface TurnContext {
  trigger?: string;
  runId?: string;
  sessionKey?: string;
  channel?: string;
  messageProvider?: string;
  chatId?: string;
  channelId?: string;
  senderId?: string;
  inputProvenance?: { kind?: string };
  channelContext?: { sender?: Record<string, unknown> };
}

export interface ToolContext {
  runId?: string;
  sessionKey?: string;
  toolName?: string;
}

/**
 * OpenClaw 2026.11 Tool Search: the model calls a plugin tool through
 * dispatch_action, and the tool it dispatches gets its own before_tool_call.
 * Counting both would halve the cap (seen on a real gateway), so the wrapper
 * isn't counted. tool_search and tool_describe are real steps and are.
 */
const WRAPPERS = new Set(["dispatch_action"]);

type Reply = { handled: true; reply?: { text: string }; reason: string } | undefined;
type ToolGate = { block: true; blockReason: string } | undefined;

interface TurnDecision {
  allow: boolean;
  notice?: string;
}

const TOO_FAST = "Too many messages at once, give me a few seconds and send it again. /fren_stop always works.";

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export class LoopGuard {
  private limits: GuardLimits = { ...DEFAULT_GUARD };
  private limitsAt = 0;
  /** Per chat, start times of recent turns. */
  private readonly recent = new Map<string, number[]>();
  /** Per chat, when the "too many messages" line was last sent. */
  private readonly told = new Map<string, number>();
  /** Per run, tool calls so far. */
  private readonly toolCalls = new Map<string, { n: number; at: number }>();
  /** Used only when the engine can't be reached. */
  private local = { day: "", used: 0, noticed: false };

  constructor(
    private readonly engine: Pick<EngineClient, "call"> | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Limits from the engine's config.json, re-read every few minutes. */
  async current(): Promise<GuardLimits> {
    if (this.engine && this.now() - this.limitsAt > 5 * 60_000) {
      this.limitsAt = this.now();
      try {
        const r = await this.engine.call<{ guard: GuardLimits | null }>("GET", "/agent/guard");
        if (r.guard) this.limits = { ...DEFAULT_GUARD, ...r.guard };
      } catch {
        /* keep the last known limits */
      }
    }
    return this.limits;
  }

  /** before_agent_reply: undefined lets the AI answer; handled=true answers without it (or stays silent). */
  async beforeReply(ctx: TurnContext): Promise<Reply> {
    // Heartbeats, cron, wakes after background work: Fren watches stops itself
    // (engine watcher, no AI), so no turn the owner didn't start.
    if (ctx.trigger && ctx.trigger !== "user") return silent("background turn");
    const prov = ctx.inputProvenance?.kind;
    if (prov && prov !== "external_user") return silent(`input from ${prov}`);
    const sender = ctx.channelContext?.sender;
    if (sender && (sender.isBot === true || sender.is_bot === true || sender.bot === true)) return silent("message from a bot");

    const limits = await this.current();
    const key = `${ctx.channel ?? ctx.messageProvider ?? ""}:${ctx.chatId ?? ctx.channelId ?? ctx.senderId ?? ctx.sessionKey ?? ""}`;
    const t = this.now();
    const times = (this.recent.get(key) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= limits.turnsPerMinute) {
      this.recent.set(key, times);
      // One short line per minute, so a fast typist isn't left thinking the bot froze.
      if (t - (this.told.get(key) ?? 0) >= 60_000) {
        this.told.set(key, t);
        return { handled: true, reply: { text: TOO_FAST }, reason: "fren-guard: too many messages this minute" };
      }
      return silent("too many messages this minute");
    }

    const d = await this.takeTurn(limits);
    if (!d.allow) return d.notice ? { handled: true, reply: { text: d.notice }, reason: "daily limit" } : silent("daily limit");
    times.push(t);
    this.recent.set(key, times);
    return undefined;
  }

  /** before_tool_call: the Nth+1 call in one turn is refused; the model has to answer with what it has. */
  async beforeTool(ctx: ToolContext): Promise<ToolGate> {
    if (ctx.toolName && WRAPPERS.has(ctx.toolName)) return undefined;
    const limits = await this.current();
    const key = ctx.runId ?? ctx.sessionKey ?? "";
    const t = this.now();
    for (const [k, v] of this.toolCalls) if (t - v.at > 10 * 60_000) this.toolCalls.delete(k);
    const entry = this.toolCalls.get(key) ?? { n: 0, at: t };
    entry.n += 1;
    entry.at = t;
    this.toolCalls.set(key, entry);
    if (entry.n <= limits.toolCallsPerTurn) return undefined;
    return {
      block: true,
      blockReason: `Fren limit: ${limits.toolCallsPerTurn} tool calls per message reached. Do not call any more tools; answer the user now with what you have.`,
    };
  }

  /** agent_end: forget the run. */
  endRun(ctx: { runId?: string; sessionKey?: string }) {
    this.toolCalls.delete(ctx.runId ?? ctx.sessionKey ?? "");
  }

  private async takeTurn(limits: GuardLimits): Promise<TurnDecision> {
    if (this.engine) {
      try {
        const r = await this.engine.call<TurnDecision & { limit: number }>("POST", "/agent/turn");
        if (r.limit > 0 || !r.allow) return r;
      } catch {
        /* engine down: fall through to the local count */
      }
    }
    const d = day(this.now());
    if (this.local.day !== d) this.local = { day: d, used: 0, noticed: false };
    if (this.local.used < limits.turnsPerDay) {
      this.local.used += 1;
      return { allow: true };
    }
    if (this.local.noticed) return { allow: false };
    this.local.noticed = true;
    return {
      allow: false,
      notice: `Fren has answered ${limits.turnsPerDay} messages today, its daily limit, so it's taking a break until 00:00 UTC. /fren_stop, /resume, /ok and /limits still work.`,
    };
  }
}

function silent(reason: string): Reply {
  return { handled: true, reason: `fren-guard: ${reason}` };
}
