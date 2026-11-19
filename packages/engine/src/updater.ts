import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * /fren_update. The engine has no root and never runs the installer itself: it
 * drops a request file in its own folder, and a root path unit the VPS installer
 * made (fren-update.path) runs the update, which keeps every wallet and setting.
 * The update script writes a result file that the engine reports at next start.
 */
export const UPDATE_ENABLED_FILE = "/etc/fren/update.enabled";
const REQUEST = "update-request";
const RESULT = "update-result";
/** Ignore a second /fren_update while one is still running (they take a few minutes). */
const BUSY_MS = 20 * 60_000;

export class Updater {
  constructor(
    private readonly dir: string,
    private readonly o: { enabledFile?: string; now?: () => number } = {},
  ) {}

  private get now() {
    return this.o.now ?? Date.now;
  }

  available(): boolean {
    return existsSync(this.o.enabledFile ?? UPDATE_ENABLED_FILE);
  }

  request(): { text: string } {
    if (!this.available()) {
      return { text: "This server can't update itself. It was installed before Fren had updates. A fresh install gets them." };
    }
    const file = join(this.dir, REQUEST);
    if (existsSync(file) && this.now() - statSync(file).mtimeMs < BUSY_MS) {
      return { text: "An update is already running. I'll message you when I'm back." };
    }
    writeFileSync(file, new Date(this.now()).toISOString() + "\n", { mode: 0o600 });
    return {
      text: "Updating Fren. Your wallets and settings stay as they are. I'll be offline for a few minutes and message you when I'm back.",
    };
  }

  /** What the last update did, once, for the owner. Null when there's nothing new. */
  takeResult(): string | null {
    const file = join(this.dir, RESULT);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8").trim();
    rmSync(file, { force: true });
    const [status, ...rest] = raw.split("\n");
    const detail = rest.join("\n").trim();
    if (status === "ok") return `✅ Fren is updated${detail ? ` (${detail})` : ""}. Wallets and settings are as you left them.`;
    return `⚠️ The update didn't finish, so Fren kept running the version it had.${detail ? ` ${detail}` : ""}`;
  }
}
