import { execFile } from "node:child_process";

/**
 * The dashboard's chat is the same conversation as the owner's Telegram (or
 * WhatsApp) chat with Fren, not a second bot: it reads the OpenClaw gateway's
 * main session and sends into it. The agent's answer goes to the chat app as
 * usual (`--deliver`) and shows up here from the same history.
 */

export interface ChatMessage {
  /** Stable within a session: the gateway's message id, or a running number. */
  id: string;
  from: "you" | "fren";
  text: string;
  /** Epoch ms. */
  at: number;
}

export interface ChatState {
  messages: ChatMessage[];
  /** Fren is still working on the last message sent from the dashboard. */
  thinking: boolean;
  /** Where the same conversation lives, e.g. "telegram". Null when unknown. */
  channel: string | null;
}

export interface ChatBridge {
  history(limit?: number): Promise<ChatState>;
  /** Hands the message to the agent. Resolves once it's accepted, not answered. */
  send(text: string): Promise<void>;
}

/** Runs a program without a shell; resolves with its exit code and output. */
export type ExecOut = (file: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

export const execOut: ExecOut = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

export interface OpenClawChatOptions {
  bin?: string;
  /** The owner's conversation. OpenClaw's direct chats share the main session by default. */
  sessionKey?: string;
  exec?: ExecOut;
  now?: () => number;
  /** Default 4 s. */
  acceptMs?: number;
}

/** Text out of an OpenClaw transcript entry: a string or a list of parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

export class OpenClawChat implements ChatBridge {
  private readonly bin: string;
  private readonly sessionKey: string;
  private readonly exec: ExecOut;
  private readonly now: () => number;
  /** Sends still running, so the page can say "Fren is thinking". */
  private running = 0;
  /** How long a send may take to be turned down before the page says "Sent". */
  private readonly acceptMs: number;
  /** The last message that was accepted but then never reached Fren. */
  private failed: { text: string; at: number; why: string } | null = null;

  constructor(o: OpenClawChatOptions = {}) {
    this.bin = o.bin ?? "openclaw";
    this.sessionKey = o.sessionKey ?? "agent:main:main";
    this.exec = o.exec ?? execOut;
    this.now = o.now ?? Date.now;
    this.acceptMs = o.acceptMs ?? 4_000;
  }

  async history(limit = 40): Promise<ChatState> {
    const params = JSON.stringify({ sessionKey: this.sessionKey, limit });
    const r = await this.exec(this.bin, ["gateway", "call", "chat.history", "--json", "--params", params], 20_000);
    if (r.code !== 0) throw new Error("Couldn't reach your chat just now. Fren may be restarting; try again in a minute.");
    let data: { messages?: unknown[]; sessionInfo?: { channel?: unknown; lastChannel?: unknown } };
    try {
      data = JSON.parse(r.stdout);
    } catch {
      throw new Error("Couldn't read your chat just now.");
    }
    const messages: ChatMessage[] = [];
    (data.messages ?? []).forEach((raw, i) => {
      const m = raw as { role?: unknown; content?: unknown; timestamp?: unknown; id?: unknown; messageId?: unknown };
      if (m.role !== "user" && m.role !== "assistant") return;
      const text = textOf(m.content).trim();
      if (!text) return;
      const at = typeof m.timestamp === "number" ? m.timestamp : Date.parse(String(m.timestamp ?? "")) || this.now();
      messages.push({ id: String(m.id ?? m.messageId ?? `${at}-${i}`), from: m.role === "user" ? "you" : "fren", text, at });
    });
    // A message from here that never reached Fren shows up in the chat, not silently gone.
    if (this.failed) {
      const f = this.failed;
      messages.push({ id: `failed-${f.at}`, from: "you", text: f.text, at: f.at }, { id: `failed-${f.at}-why`, from: "fren", text: `⚠️ ${f.why}`, at: f.at });
    }
    const ch = data.sessionInfo?.channel ?? data.sessionInfo?.lastChannel;
    return { messages, thinking: this.running > 0, channel: typeof ch === "string" ? ch : null };
  }

  async send(text: string): Promise<void> {
    // `--message=` keeps a message that starts with "-" from reading as a flag.
    const args = ["agent", "--session-key", this.sessionKey, `--message=${text}`, "--deliver", "--json"];
    this.running++;
    this.failed = null;
    // The answer can take a while (tools, trades); the page polls the history meanwhile.
    // A send that never reached Fren (gateway restarting, no chat to deliver to) fails
    // within seconds: wait that long, so the page says so instead of "Sent".
    const run = this.exec(this.bin, args, 10 * 60_000)
      .catch((err: Error) => ({ code: 1, stdout: "", stderr: String(err?.message ?? err) }))
      .finally(() => this.running--);
    const early = await Promise.race([run, new Promise<null>((r) => {
        setTimeout(() => r(null), this.acceptMs).unref?.();
      })]);
    if (early && early.code !== 0) throw new Error(sendFailure(early));
    if (!early)
      void run.then((r) => {
        if (r.code !== 0) this.failed = { text, at: this.now(), why: sendFailure(r) };
      });
  }
}

/** Plain words for a send the gateway turned down. */
export function sendFailure(r: { stdout: string; stderr: string }): string {
  let msg = "";
  try {
    msg = String((JSON.parse(r.stdout) as { error?: { message?: unknown } }).error?.message ?? "");
  } catch {
    /* not JSON */
  }
  const all = `${msg} ${r.stderr}`;
  if (/requires target|no (delivery|route)|not paired/i.test(all))
    return "Fren couldn't find your Telegram chat to answer in. Send Fren any message in Telegram once, then try again here.";
  if (/ECONNREFUSED|gateway|timed? ?out|unreachable|ENOENT/i.test(all))
    return "Fren didn't get that: it's restarting or not running right now. Try again in a minute.";
  return "Fren didn't get that message. Try again in a minute, or write in Telegram.";
}

/**
 * A stand-in conversation for the demo stand and tests: keeps messages in
 * memory and answers through the given function (or a fixed line).
 */
export class MemoryChat implements ChatBridge {
  readonly messages: ChatMessage[] = [];
  private n = 0;
  private thinking = false;

  constructor(
    private readonly answer: (text: string) => Promise<string> = async () => "Got it.",
    private readonly now: () => number = Date.now,
    readonly channel = "telegram",
  ) {}

  /** A message that came in from the chat app itself (Telegram). */
  fromApp(from: "you" | "fren", text: string, at = this.now()): ChatMessage {
    const m = { id: `m${++this.n}`, from, text, at };
    this.messages.push(m);
    return m;
  }

  async history(limit = 40): Promise<ChatState> {
    return { messages: this.messages.slice(-limit), thinking: this.thinking, channel: this.channel };
  }

  async send(text: string): Promise<void> {
    this.fromApp("you", text);
    this.thinking = true;
    void this.answer(text)
      .then((reply) => void this.fromApp("fren", reply))
      .catch(() => void this.fromApp("fren", "Something went wrong on my side. Try again in a minute."))
      .finally(() => (this.thinking = false));
  }
}
