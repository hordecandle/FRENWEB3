import { createPublicKey, randomBytes, randomInt, timingSafeEqual, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyMessage } from "viem";
import type { Store } from "./store.js";

/**
 * More ways into the dashboard than the Telegram link: a code by email, or a
 * signature from the owner's own wallet (Phantom, MetaMask, ...). The owner
 * adds them from inside the dashboard, after logging in with the link, so a
 * stranger can never register their own email or wallet.
 *
 * Neither way can move money: the dashboard itself can't, and anything that
 * loosens a limit still needs the /ok code in the chat.
 */

export type WalletKind = "solana" | "evm";

export interface OwnerWallet {
  kind: WalletKind;
  address: string;
}

export interface Mailer {
  /** True when the mail went out. */
  send(to: string, subject: string, text: string): Promise<boolean>;
}

/** Sends through Resend's HTTP API (one key, no SMTP server on the VPS). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(to: string, subject: string, text: string): Promise<boolean> {
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    return Boolean(res?.ok);
  }
}

const EMAIL_CODE_TTL_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_TRIES = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export function normalEmail(e: string): string | null {
  const v = e.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

export function normalWallet(kind: WalletKind, address: string): string | null {
  const a = address.trim();
  if (kind === "evm") return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
  try {
    return new PublicKey(a).toBase58() === a ? a : null;
  } catch {
    return null;
  }
}

/** Checks a wallet's signature of a text message. Solana: base64 or hex of 64 bytes; EVM: personal_sign hex. */
export async function verifyWalletSignature(kind: WalletKind, address: string, message: string, signature: string): Promise<boolean> {
  try {
    if (kind === "evm") return await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
    const sig = /^[0-9a-f]{128}$/i.test(signature) ? Buffer.from(signature, "hex") : Buffer.from(signature, "base64");
    if (sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(new PublicKey(address).toBytes())]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}

export class DashboardAuth {
  private readonly emailCodes = new Map<string, { code: string; exp: number; tries: number }>();
  private readonly challenges = new Map<string, { message: string; exp: number }>();

  constructor(
    private readonly store: Store,
    private readonly mailer: Mailer | null,
    private readonly now: () => number = Date.now,
  ) {}

  // -- what the owner set up ------------------------------------------------

  email(): string | null {
    return this.store.getKv("dash_email");
  }

  setEmail(e: string | null): string | null {
    if (e === null || e.trim() === "") {
      this.store.setKv("dash_email", "");
      return null;
    }
    const v = normalEmail(e);
    if (!v) throw new Error("That doesn't look like an email address.");
    this.store.setKv("dash_email", v);
    return v;
  }

  wallets(): OwnerWallet[] {
    try {
      const v = JSON.parse(this.store.getKv("dash_wallets") ?? "[]");
      return Array.isArray(v) ? (v as OwnerWallet[]) : [];
    } catch {
      return [];
    }
  }

  private saveWallets(w: OwnerWallet[]) {
    this.store.setKv("dash_wallets", JSON.stringify(w));
  }

  removeWallet(kind: WalletKind, address: string) {
    this.saveWallets(this.wallets().filter((w) => !(w.kind === kind && w.address === address)));
  }

  /** Which ways in the login page offers. */
  methods(): { email: boolean; wallet: boolean } {
    return { email: Boolean(this.mailer && this.email()), wallet: this.wallets().length > 0 };
  }

  private sweep() {
    const t = this.now();
    for (const [k, v] of this.emailCodes) if (v.exp < t) this.emailCodes.delete(k);
    for (const [k, v] of this.challenges) if (v.exp < t) this.challenges.delete(k);
  }

  // -- email ------------------------------------------------------------------

  /**
   * Sends a 6-digit code when the address is the owner's. Says the same either
   * way, so the page can't be used to guess the owner's email.
   */
  async startEmail(input: string): Promise<{ text: string; code?: string }> {
    this.sweep();
    const text = "If that's the email you added in your dashboard, a 6-digit code is on its way. It works for 10 minutes.";
    const e = normalEmail(input);
    const owner = this.email();
    if (!e || !owner || e !== owner || !this.mailer) return { text };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.emailCodes.set(e, { code, exp: this.now() + EMAIL_CODE_TTL_MS, tries: 0 });
    await this.mailer.send(e, "Your Fren dashboard code", `Your code: ${code}\n\nIt works once, for 10 minutes. If you didn't ask for it, ignore this email.`);
    return { text };
  }

  checkEmail(input: string, code: string): boolean {
    this.sweep();
    const e = normalEmail(input);
    const rec = e ? this.emailCodes.get(e) : undefined;
    if (!e || !rec) return false;
    rec.tries++;
    const a = Buffer.from(rec.code);
    const b = Buffer.from(code.trim());
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (ok || rec.tries >= MAX_TRIES) this.emailCodes.delete(e);
    return ok;
  }

  // -- wallet -----------------------------------------------------------------

  /** The text the wallet signs. Free of jargon: it's what the owner reads in Phantom or MetaMask. */
  challenge(kind: WalletKind, address: string, purpose: "login" | "link"): { id: string; message: string } {
    this.sweep();
    const a = normalWallet(kind, address);
    if (!a) throw new Error(kind === "evm" ? "That isn't an EVM address (0x…)." : "That isn't a Solana address.");
    const id = randomBytes(18).toString("base64url");
    const what = purpose === "login" ? "Log in to my Fren dashboard." : "Use this wallet to log in to my Fren dashboard.";
    const message = `${what}\n\nThis only proves the wallet is mine. It costs nothing and can't move money.\n\nWallet: ${a}\nCode: ${id}\nTime: ${new Date(this.now()).toISOString()}`;
    this.challenges.set(id, { message, exp: this.now() + CHALLENGE_TTL_MS });
    return { id, message };
  }

  private async takeSigned(id: string, kind: WalletKind, address: string, signature: string): Promise<string | null> {
    this.sweep();
    const ch = this.challenges.get(id);
    this.challenges.delete(id);
    const a = normalWallet(kind, address);
    if (!ch || !a || !ch.message.includes(`\nWallet: ${a}\n`)) return null;
    return (await verifyWalletSignature(kind, a, ch.message, signature)) ? a : null;
  }

  /** Login: the signature must be from a wallet the owner added. */
  async checkWallet(id: string, kind: WalletKind, address: string, signature: string): Promise<boolean> {
    const a = await this.takeSigned(id, kind, address, signature);
    return a !== null && this.wallets().some((w) => w.kind === kind && w.address === a);
  }

  /** While logged in: prove a wallet is the owner's and add it as a way in. */
  async linkWallet(id: string, kind: WalletKind, address: string, signature: string): Promise<OwnerWallet> {
    const a = await this.takeSigned(id, kind, address, signature);
    if (!a) throw new Error("The signature didn't match that wallet. Try again.");
    const w = this.wallets().filter((x) => !(x.kind === kind && x.address === a));
    if (w.length >= 5) throw new Error("Up to 5 wallets. Remove one first.");
    const added = { kind, address: a };
    this.saveWallets([...w, added]);
    return added;
  }
}
