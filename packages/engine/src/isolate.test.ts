import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolate, isolatedEngineUnit, SECRET_FILES } from "./isolate.js";
import { finishSetup, isolatedMarker, type Runner } from "./setup.js";
import { frenPaths } from "./config.js";

function world(opts: { agentCanRead?: boolean; engineUserExists?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fren-isolate-"));
  const agentHome = join(root, "home/fren");
  const engineHome = join(root, "var/lib/fren-engine");
  const agentDir = join(agentHome, ".fren");
  mkdirSync(agentDir, { recursive: true });
  for (const f of ["config.json", "keystore.json", "signer.pass", "fren.sqlite", "api-token"]) writeFileSync(join(agentDir, f), `${f}-content`);
  mkdirSync(join(agentHome, ".openclaw"), { recursive: true });
  writeFileSync(join(agentHome, ".openclaw/openclaw.json"), "{}");
  const runs: string[] = [];
  const run: Runner = async (file, args) => {
    runs.push(`${file} ${args.join(" ")}`);
    if (file === "id") return { code: opts.engineUserExists ? 0 : 1, stdout: "", stderr: "" };
    if (file === "runuser") return opts.agentCanRead ? { code: 0, stdout: "x", stderr: "" } : { code: 1, stdout: "", stderr: "Permission denied" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const said: string[] = [];
  const deps = { run, say: (t: string) => said.push(t), uid: 0, platform: "linux" as const };
  return { root, agentHome, engineHome, agentDir, engineDir: join(engineHome, ".fren"), runs, said, deps };
}

describe("fren isolate (C1)", () => {
  it("moves every secret to the engine user, leaves the agent only a token copy, and proves the agent can't read them", async () => {
    const w = world();
    const res = await isolate(w.deps, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome });
    expect(res.moved).toEqual(["config.json", "keystore.json", "signer.pass", "fren.sqlite"]);
    for (const f of SECRET_FILES) expect(existsSync(join(w.agentDir, f))).toBe(false);
    expect(readFileSync(join(w.engineDir, "keystore.json"), "utf8")).toBe("keystore.json-content");
    expect(readFileSync(join(w.agentDir, "api-token"), "utf8")).toBe("api-token-content");
    expect(readFileSync(join(w.engineDir, "api-token"), "utf8")).toBe("api-token-content");
    expect(existsSync(join(w.engineHome, ".openclaw/openclaw.json"))).toBe(true);
    expect(w.runs.some((r) => r.startsWith("useradd --system --user-group") && r.endsWith("fren-engine"))).toBe(true);
    expect(w.runs).toContain(`chown -R fren-engine:fren-engine ${w.engineHome}`);
    expect(w.runs).toContain(`chmod -R go-rwx ${w.engineHome}`);
    expect(w.runs).toContain(`runuser -u fren -- cat ${join(w.engineDir, "keystore.json")}`);
    expect(w.runs).toContain(`runuser -u fren -- cat ${join(w.engineDir, "signer.pass")}`);
    expect(isolatedMarker({ home: w.agentDir })).toEqual({ engineUser: "fren-engine", frenHome: w.engineDir });
  });

  it("fails loudly if the agent user can still read the keys", async () => {
    const w = world({ agentCanRead: true });
    await expect(isolate(w.deps, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome })).rejects.toThrow(/can still read/);
  });

  it("never merges two different wallets", async () => {
    const w = world({ engineUserExists: true });
    mkdirSync(w.engineDir, { recursive: true });
    writeFileSync(join(w.engineDir, "keystore.json"), "another wallet");
    await expect(isolate(w.deps, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome })).rejects.toThrow(/Two different keystores/);
    expect(readFileSync(join(w.agentDir, "keystore.json"), "utf8")).toBe("keystore.json-content");
  });

  it("is safe to run twice, and --undo brings the files back", async () => {
    const w = world();
    await isolate(w.deps, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome });
    await isolate({ ...w.deps }, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome });
    expect(readFileSync(join(w.engineDir, "keystore.json"), "utf8")).toBe("keystore.json-content");
    await isolate(w.deps, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome, undo: true });
    expect(readFileSync(join(w.agentDir, "keystore.json"), "utf8")).toBe("keystore.json-content");
    expect(isolatedMarker({ home: w.agentDir })).toBeNull();
  });

  it("refuses off Linux and without root", async () => {
    const w = world();
    await expect(isolate({ ...w.deps, platform: "darwin" }, { agentUser: "fren", agentHome: w.agentHome })).rejects.toThrow(/Linux only/);
    await expect(isolate({ ...w.deps, uid: 1000 }, { agentUser: "fren", agentHome: w.agentHome })).rejects.toThrow(/as root/);
  });

  it("setup won't make new wallets on top of an isolated install", async () => {
    const w = world();
    await isolate(w.deps, { agentUser: "fren", agentHome: w.agentHome, engineHome: w.engineHome });
    const run: Runner = async () => ({ code: 0, stdout: "", stderr: "" });
    await expect(finishSetup({ run, openclawBin: "openclaw", paths: frenPaths(w.agentDir), pluginDir: "/x" }, { network: "testnet", line: {} })).rejects.toThrow(/locked away/);
    expect(existsSync(join(w.agentDir, "keystore.json"))).toBe(false);
  });

  it("the engine unit runs as the engine user with its own home and no access to /home", () => {
    const u = isolatedEngineUnit({ node: "/opt/fren/bin/node", cli: "/opt/fren/app/packages/engine/dist/cli.js", pathEnv: "/usr/bin", engineUser: "fren-engine", engineHome: "/var/lib/fren-engine" });
    expect(u).toContain("User=fren-engine");
    expect(u).toContain("Environment=FREN_HOME=/var/lib/fren-engine/.fren");
    expect(u).toContain("ProtectHome=yes");
    expect(u).toContain("NoNewPrivileges=yes");
  });
});
