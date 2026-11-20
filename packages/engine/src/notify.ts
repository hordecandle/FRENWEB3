import { execFile } from "node:child_process";
import type { Fetch } from "./http.js";
import type { Store } from "./store.js";
import { visibleLength } from "./receipt.js";

/** A receipt for the owner: Telegram HTML with named links, the same as plain text, and maybe a chart picture. */
export interface OwnerMessage {
  html: string;
  plain: string;
  photo?: Buffer | null;
  /** The picture's file name in the chat (default fren-trade.png). */
  photoName?: string;
  /** The venue's own one-line wording of the same result, kept for the event log. */
  text?: string;
}

/**
 * Messages to the owner that must not pass through the agent: confirmation
 * codes (so an injected prompt can't read and replay them) and watcher alerts
 * (which happen when no conversation is open).
 */
export interface Notifier {
  /** True when the owner has a direct line (Telegram, WhatsApp, ...) that bypasses the agent. */
  readonly hasPrivateLine: boolean;
  /** Send to the owner. Returns false when there's no line or none of them worked. */
  sendPrivate(text: string): Promise<boolean>;
  /** Watcher alerts. Logged as events for the plugin to relay, and sent to the owner when possible. */
  alert(text: string): Promise<void>;
  /** A receipt, with links and a picture where the line can show them. False when no line took it. */
  sendReceipt(msg: OwnerMessage): Promise<boolean>;
  /** True when a line can show pictures (worth drawing a chart for). */
  readonly showsImages: boolean;
  /** How receipts reach the owner, in words (for the settings reply). */
  readonly route: string;
}

/** One way to reach the owner. */
export interface OwnerLine {
  readonly name: string;
  send(text: string): Promise<boolean>;
  /** Lines that can show links and pictures. Others get the plain text. */
  sendRich?(msg: OwnerMessage): Promise<boolean>;
}

/** Telegram's limit for a photo caption, in visible characters. */
const CAPTION_MAX = 1024;

/**
 * The Telegram Bot API, called directly. Bots don't receive their own
 * messages, so OpenClaw never sees what goes out here: the most private line.
 */
export class TelegramLine implements OwnerLine {
  readonly name = "telegram";

  constructor(
    private readonly fetchFn: Fetch,
    private readonly cfg: { botToken: string; ownerChatId: string },
  ) {}

  async send(text: string): Promise<boolean> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.cfg.ownerChatId, text, disable_web_page_preview: true }),
    });
    return res.ok;
  }

  /**
   * HTML with named links, and the chart as a photo when there is one: one
   * message with the receipt as its caption when it fits, else the photo and
   * then the receipt. If Telegram refuses the HTML, the plain text still goes.
   */
  async sendRich(msg: OwnerMessage): Promise<boolean> {
    const api = `https://api.telegram.org/bot${this.cfg.botToken}`;
    if (msg.photo) {
      const fits = visibleLength(msg.html) <= CAPTION_MAX;
      const form = new FormData();
      form.set("chat_id", this.cfg.ownerChatId);
      form.set("photo", new Blob([new Uint8Array(msg.photo)], { type: imageType(msg.photo) ?? "image/png" }), msg.photoName ?? "fren-trade.png");
      if (fits) {
        form.set("caption", msg.html);
        form.set("parse_mode", "HTML");
      }
      const res = await this.fetchFn(`${api}/sendPhoto`, { method: "POST", body: form }).catch(() => null);
      if (res?.ok && fits) return true;
    }
    const res = await this.fetchFn(`${api}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.cfg.ownerChatId, text: msg.html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (res.ok) return true;
    return this.send(msg.plain);
  }
}

/** PNG, JPEG or WebP from the file's first bytes; null for anything else. */
export function imageType(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Runs a program without a shell. Resolves with its exit code. */
export type Exec = (file: string, args: string[]) => Promise<{ code: number; stderr: string }>;

export const execNoShell: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 30_000, maxBuffer: 1 << 20 }, (err, _stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stderr: String(stderr ?? "") });
    });
  });

export interface GatewayTarget {
  /** An OpenClaw channel: whatsapp, telegram, signal, discord, imessage, ... */
  channel: string;
  /** The owner on that channel, as `openclaw message send --target` takes it: +15551234567 on WhatsApp and Signal. */
  to: string;
  /** The channel account, when the gateway has several. */
  account?: string;
}

/**
 * Any channel OpenClaw is connected to, through the gateway's own sender
 * (`openclaw message send`). The message skips the model, but the gateway
 * records it in that conversation's history, so the agent can read it later.
 */
export class GatewayLine implements OwnerLine {
  readonly name: string;

  constructor(
    private readonly target: GatewayTarget,
    private readonly exec: Exec = execNoShell,
    private readonly bin = "openclaw",
  ) {
    this.name = target.channel;
  }

  async send(text: string): Promise<boolean> {
    // `--message=` keeps a message that starts with "-" from reading as a flag.
    const args = ["message", "send", "--channel", this.target.channel, "--target", this.target.to, `--message=${text}`];
    if (this.target.account) args.push("--account", this.target.account);
    const { code } = await this.exec(this.bin, args);
    return code === 0;
  }
}

/** Reaches the owner on the first line that works, in the order given. */
export class OwnerNotifier implements Notifier {
  readonly hasPrivateLine: boolean;
  readonly showsImages: boolean;

  constructor(
    private readonly store: Store,
    private readonly lines: OwnerLine[],
  ) {
    this.hasPrivateLine = lines.length > 0;
    this.showsImages = Boolean(lines[0]?.sendRich);
    const first = lines[0];
    this.route = !first
      ? "no direct line to you, so the chat relays them as text"
      : first instanceof TelegramLine
        ? "straight to Telegram, with named links and pictures"
        : `through OpenClaw on ${first.name}, as plain text without pictures`;
  }

  readonly route: string;

  async sendReceipt(msg: OwnerMessage): Promise<boolean> {
    for (const line of this.lines) {
      const ok = await (line.sendRich ? line.sendRich(msg) : line.send(msg.plain)).catch(() => false);
      if (ok) return true;
    }
    return false;
  }

  async sendPrivate(text: string): Promise<boolean> {
    for (const line of this.lines) {
      if (await line.send(text).catch(() => false)) return true;
    }
    return false;
  }

  async alert(text: string): Promise<void> {
    this.store.addEvent(text);
    await this.sendPrivate(text);
  }
}

/** For tests and for setups without a line to the owner. */
export class MemoryNotifier implements Notifier {
  readonly sent: string[] = [];
  readonly receipts: OwnerMessage[] = [];
  constructor(
    private readonly store: Store,
    readonly hasPrivateLine = true,
    readonly showsImages = true,
  ) {}
  readonly route = "memory";
  async sendReceipt(msg: OwnerMessage) {
    if (!this.hasPrivateLine) return false;
    this.receipts.push(msg);
    this.sent.push(msg.text ?? msg.plain);
    return true;
  }
  async sendPrivate(text: string) {
    if (!this.hasPrivateLine) return false;
    this.sent.push(text);
    return true;
  }
  async alert(text: string) {
    this.store.addEvent(text);
    await this.sendPrivate(text);
  }
}
