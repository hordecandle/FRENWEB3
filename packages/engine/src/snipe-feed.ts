import { Connection, PublicKey } from "@solana/web3.js";

/** Calls back whenever a transaction mentions an address: Solana's logsSubscribe. */
export interface MentionSource {
  watch(address: string, onMention: () => void): Promise<number>;
  unwatch(id: number): Promise<void>;
}

/** Mentions straight from the Solana RPC's websocket, at "processed": the earliest the RPC knows. */
export function solanaMentions(connection: Connection): MentionSource {
  return {
    watch: async (address, onMention) => connection.onLogs(new PublicKey(address), () => onMention(), "processed"),
    unwatch: (id) => connection.removeOnLogsListener(id),
  };
}

export interface SnipeFeedOptions {
  source: MentionSource;
  /** Solana mints that waiting snipes are watching for. */
  targets: () => string[];
  /** Run the snipe loop now. */
  fire: () => Promise<void>;
}

/**
 * Wakes the snipe loop the moment a transaction mentions a token a snipe is
 * waiting on (its launch, its first trade, its move to a pool) instead of at
 * the next poll. Polling stays on as the fallback if the websocket drops.
 */
export class SnipeFeed {
  private readonly subs = new Map<string, Promise<number | null>>();
  private running = false;
  private again = false;

  constructor(private readonly o: SnipeFeedOptions) {}

  /** Watch the tokens snipes wait on now, and stop watching the rest. Cheap: call it on every poll. */
  sync(): void {
    const want = new Set(this.o.targets());
    for (const token of want) {
      if (this.subs.has(token)) continue;
      const sub = this.o.source.watch(token, () => this.kick()).catch(() => {
        // Not watching after all (bad address, websocket down): the next sync tries again.
        this.subs.delete(token);
        return null;
      });
      this.subs.set(token, sub);
    }
    for (const [token, sub] of this.subs) {
      if (want.has(token)) continue;
      this.subs.delete(token);
      void sub.then((id) => (id === null ? undefined : this.o.source.unwatch(id))).catch(() => {});
    }
  }

  watching(): string[] {
    return [...this.subs.keys()];
  }

  close(): void {
    for (const [token, sub] of this.subs) {
      this.subs.delete(token);
      void sub.then((id) => (id === null ? undefined : this.o.source.unwatch(id))).catch(() => {});
    }
  }

  /** A busy coin mentions its mint many times a second: one run at a time, plus one more if woken meanwhile. */
  private kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void (async () => {
      try {
        do {
          this.again = false;
          await this.o.fire().catch(() => {});
        } while (this.again);
      } finally {
        this.running = false;
      }
    })();
  }
}
