import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Updater } from "./updater.js";

function world(enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), "fren-upd-"));
  const enabledFile = join(dir, "update.enabled");
  if (enabled) writeFileSync(enabledFile, "");
  let now = Date.now();
  const u = new Updater(dir, { enabledFile, now: () => now });
  return { dir, u, tick: (ms: number) => (now += ms) };
}

describe("/fren_update", () => {
  it("asks the root updater once, and says so", () => {
    const { dir, u } = world();
    expect(u.request().text).toMatch(/Updating Fren\. Your wallets and settings stay/);
    expect(existsSync(join(dir, "update-request"))).toBe(true);
    expect(u.request().text).toMatch(/already running/);
  });

  it("says plainly when this server can't update itself", () => {
    const { dir, u } = world(false);
    expect(u.request().text).toMatch(/can't update itself/);
    expect(existsSync(join(dir, "update-request"))).toBe(false);
  });

  it("reports the result once, then forgets it", () => {
    const { dir, u } = world();
    expect(u.takeResult()).toBeNull();
    writeFileSync(join(dir, "update-result"), "ok\n\n");
    expect(u.takeResult()).toMatch(/^✅ Fren is updated\. Wallets and settings are as you left them\.$/);
    expect(u.takeResult()).toBeNull();
    writeFileSync(join(dir, "update-result"), "failed\nThe build failed.\n");
    expect(u.takeResult()).toMatch(/didn't finish, so Fren kept running the version it had\. The build failed\./);
  });
});
