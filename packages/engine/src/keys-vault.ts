import { existsSync, readFileSync } from "node:fs";
import { readKeystore } from "@fren/signer";
import { KEY_LABELS, type KeyVault } from "./dashboard.js";

/**
 * The owner's keys for the dashboard's Keys block, read from the signer's own
 * keystore at the moment the owner asks (after the word, the Telegram code and
 * the origin check in Dashboard), with the same code as `fren keys`. Nothing is
 * kept in memory between asks, nothing is logged, and nothing outside the
 * dashboard holds a reference to this: the engine API, /agent/context and the
 * OpenClaw plugin can't reach it.
 */
export class KeystoreVault implements KeyVault {
  constructor(
    private readonly keystorePath: string,
    private readonly passphraseFile: string,
  ) {}

  async reveal(): Promise<{ label: string; value: string }[]> {
    const pass = existsSync(this.passphraseFile) ? readFileSync(this.passphraseFile, "utf8").trim() : process.env.FREN_PASSPHRASE;
    if (!pass) throw new Error("Can't unlock the keys here. Run fren keys in Terminal instead.");
    const k = readKeystore(this.keystorePath, pass);
    return [
      { label: KEY_LABELS[0], value: k.solanaSecret },
      { label: KEY_LABELS[1], value: k.evmMaster },
      { label: KEY_LABELS[2], value: k.hlAgent },
    ];
  }
}

/** A vault when this engine can read the keystore itself; none otherwise (the page then points to `fren keys`). */
export function keystoreVault(keystorePath: string, passphraseFile: string): KeystoreVault | null {
  if (!existsSync(keystorePath)) return null;
  if (!existsSync(passphraseFile) && !process.env.FREN_PASSPHRASE) return null;
  return new KeystoreVault(keystorePath, passphraseFile);
}
