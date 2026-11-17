import { z } from "zod";
import type { Store } from "./store.js";

/**
 * Caps on the agent, so a loop can't burn the owner's AI key. The engine owns
 * the daily count (it survives gateway restarts and lives next to the config);
 * the plugin enforces the per-message and per-minute caps in memory.
 * Owner commands (/fren_stop, /ok, /resume, /limits) never pass through the
 * model, so they are never counted or blocked. Stops, takes and alerts don't
 * use the AI either.
 */
export const AgentGuard = z
  .object({
    /** Agent turns (one per message Fren answers with the AI) per UTC day. */
    turnsPerDay: z.number().int().min(1).max(100_000).default(200),
    /** Agent turns per chat per minute; messages over it get no AI reply. */
    turnsPerMinute: z.number().int().min(1).max(600).default(6),
    /** Tool calls the agent may make while answering one message. */
    toolCallsPerTurn: z.number().int().min(1).max(200).default(12),
  })
  .default({ turnsPerDay: 200, turnsPerMinute: 6, toolCallsPerTurn: 12 });
export type AgentGuard = z.infer<typeof AgentGuard>;

export const DAILY_LIMIT_NOTICE = (limit: number) =>
  `Fren has answered ${limit} messages today, its daily limit, so it's taking a break until 00:00 UTC. ` +
  `/fren_stop, /resume, /ok and /limits still work. To raise the limit, set agentGuard.turnsPerDay in ~/.fren/config.json.`;

export interface TurnDecision {
  allow: boolean;
  /** Turns used today, including this one when allowed. */
  used: number;
  limit: number;
  /** Set once per day, on the first refused turn: tell the owner, without the AI. */
  notice?: string;
}

const day = (at: Date) => at.toISOString().slice(0, 10);

export class AgentBudget {
  constructor(
    private readonly store: Store,
    /** Read on every turn, so a new limit in config.json applies without a restart. */
    private readonly guard: () => AgentGuard,
  ) {}

  limits(): AgentGuard {
    return this.guard();
  }

  /** Count one agent turn against today's limit, or refuse it. */
  take(at = new Date()): TurnDecision {
    const d = day(at);
    const key = `agentTurns:${d}`;
    const used = Number(this.store.getKv(key) ?? 0);
    const limit = this.guard().turnsPerDay;
    if (used < limit) {
      this.store.setKv(key, String(used + 1));
      return { allow: true, used: used + 1, limit };
    }
    const noticeKey = `agentLimitNotice:${d}`;
    if (this.store.getKv(noticeKey)) return { allow: false, used, limit };
    this.store.setKv(noticeKey, "1");
    return { allow: false, used, limit, notice: DAILY_LIMIT_NOTICE(limit) };
  }

  usedToday(at = new Date()): number {
    return Number(this.store.getKv(`agentTurns:${day(at)}`) ?? 0);
  }
}
