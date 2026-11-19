import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentsMd, writePersona } from "./persona.js";
import { personaExisting } from "./setup.js";
import type { Runner } from "./setup.js";

const pluginDir = join(__dirname, "../../openclaw-plugin");

function setup() {
  const ws = mkdtempSync(join(tmpdir(), "fren-persona-"));
  // OpenClaw's starter files, as they sit on a fresh install.
  mkdirSync(ws, { recursive: true });
  for (const f of ["AGENTS.md", "SOUL.md", "USER.md", "BOOTSTRAP.md"]) writeFileSync(join(ws, f), `# OpenClaw starter ${f}\nBirth Sequence, pick an avatar, git, files`);
  writeFileSync(join(ws, "IDENTITY.md"), "");
  const runs: string[] = [];
  const run: Runner = async (file, args) => {
    runs.push(`${file} ${args.join(" ")}`);
    // OpenClaw's own answer to "where is the workspace" (it can print a warning line first).
    if (args[0] === "agents" && args[1] === "list") return { code: 0, stdout: `warning: x\n${JSON.stringify([{ id: "main", workspace: ws, isDefault: true }])}`, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { ws, run, runs };
}

describe("Fren's persona in the OpenClaw workspace", () => {
  it("replaces the starter files, removes the first-run ritual and keeps what it replaced", async () => {
    const { ws, run } = setup();
    const r = await writePersona({ run, openclawBin: "openclaw", pluginDir });
    expect(r.dir).toBe(ws);
    expect(r.removed).toBe(true);
    expect(existsSync(join(ws, "BOOTSTRAP.md"))).toBe(false);
    const agents = readFileSync(join(ws, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/You are Fren/);
    expect(agents).toMatch(/no access to the owner's files, git, a browser or this computer/i);
    expect(agents).toMatch(/`fren_run_code`/);
    expect(agents).toMatch(/sandbox can't sign or spend/);
    expect(agents).not.toMatch(/Birth Sequence|avatar, git/); // the starter text is gone
    expect(readFileSync(join(ws, "AGENTS.md.openclaw"), "utf8")).toMatch(/OpenClaw starter/);
    expect(readFileSync(join(ws, "IDENTITY.md"), "utf8")).toMatch(/Name: Fren/);
    expect(readFileSync(join(ws, "SOUL.md"), "utf8")).toMatch(/Short messages/);
    expect(readFileSync(join(ws, "USER.md"), "utf8")).toMatch(/OpenClaw starter/); // not ours to touch
  });

  it("carries the trading rules of SKILL.md, which OpenClaw never puts in the prompt here", async () => {
    const md = agentsMd(pluginDir);
    expect(md).toMatch(/reply `\/ok <code>`/);
    expect(md).toMatch(/call `fren_trade` once/);
    expect(md).not.toMatch(/^name: fren/m); // front matter stripped
    expect(md).toMatch(/Long NVDA with \$100 margin, 2x/); // examples say what the number is
  });

  it("is safe to repeat and says when nothing changed", async () => {
    const { ws, run } = setup();
    await writePersona({ run, openclawBin: "openclaw", pluginDir });
    const again = await writePersona({ run, openclawBin: "openclaw", pluginDir });
    expect(again.written).toEqual([]);
    expect(again.removed).toBe(false);
    expect(readFileSync(join(ws, "AGENTS.md.openclaw"), "utf8")).toMatch(/OpenClaw starter/); // the backup isn't overwritten by our own text
  });

  it("`fren persona` writes the files and restarts the gateway", async () => {
    const { run, runs } = setup();
    const said: string[] = [];
    await personaExisting({ run, openclawBin: "openclaw", pluginDir }, (t) => said.push(t));
    expect(said.join("\n")).toMatch(/persona in .*AGENTS.md, SOUL.md, IDENTITY.md.*first-run ritual removed/);
    expect(runs.at(-1)).toBe("openclaw daemon restart");
  });
});

describe("chat model on update", () => {
  const runner = (current: string) => {
    const runs: string[] = [];
    const run: Runner = async (f, a) => {
      runs.push(`${f} ${a.join(" ")}`);
      if (a[0] === "config" && a[1] === "get") return { code: 0, stdout: `${current}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    return { run, runs };
  };

  it("moves the old default Haiku to Sonnet", async () => {
    const { upgradeDefaultModel } = await import("./setup.js");
    const { run, runs } = runner('"openrouter/anthropic/claude-haiku-4.5"');
    expect(await upgradeDefaultModel({ run, openclawBin: "openclaw" })).toBe("openrouter/anthropic/claude-sonnet-5.5");
    expect(runs).toContain('openclaw config set agents.defaults.model.primary "openrouter/anthropic/claude-sonnet-5.5"');
  });

  it("leaves a model the owner picked", async () => {
    const { upgradeDefaultModel } = await import("./setup.js");
    const { run, runs } = runner('"openrouter/openai/gpt-6"');
    expect(await upgradeDefaultModel({ run, openclawBin: "openclaw" })).toBeNull();
    expect(runs.some((r) => r.includes("config set"))).toBe(false);
  });
});

describe("where the workspace is", () => {
  it("falls back to the config value, then to the default under the user's home", async () => {
    const { workspaceDir } = await import("./persona.js");
    const fail: Runner = async () => ({ code: 1, stdout: "", stderr: "" });
    expect(await workspaceDir({ run: fail, openclawBin: "openclaw", home: "/home/x" })).toMatch(/\/home\/x\/\.openclaw\/workspace$|\.openclaw\/workspace$/);
    const cfg: Runner = async (_f, a) => (a[0] === "config" ? { code: 0, stdout: '"/data/ws"\n', stderr: "" } : { code: 1, stdout: "", stderr: "" });
    expect(await workspaceDir({ run: cfg, openclawBin: "openclaw" })).toBe("/data/ws");
  });
});
