import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeSandboxSocket } from "../../engine/src/sandbox-testing.js";
import plugin from "./index.js";
import { SANDBOX_MISSING, SandboxBusy, formatRun, runInSandbox, runWhenFree, type RunCodeResult } from "./sandbox.js";

/** The agent's run-code tool: a script in, what it printed out, through the sandbox's socket. */

function loadTools(pluginConfig: Record<string, unknown>) {
  const tools = new Map<string, (ctx: Record<string, unknown>) => any>();
  const api = {
    registrationMode: "full",
    pluginConfig,
    registerTool: (factory: (ctx: Record<string, unknown>) => unknown, opts: { name: string }) => tools.set(opts.name, factory as never),
    registerCommand: () => {},
  };
  (plugin as unknown as { register: (api: unknown) => void }).register(api);
  return tools;
}

const dir = mkdtempSync(join(tmpdir(), "fren-plugin-sbx-"));
const tokenFile = join(dir, "api-token");
writeFileSync(tokenFile, "t");

describe("fren_run_code", () => {
  let sbx: Awaited<ReturnType<typeof fakeSandboxSocket>>;
  beforeAll(async () => {
    sbx = await fakeSandboxSocket(mkdtempSync(join(tmpdir(), "fren-plugin-sbx-sock-")));
  });
  afterAll(() => sbx.close());

  const run = async (params: Record<string, unknown>, config: Record<string, unknown> = { tokenFile, sandboxSocket: sbx.socket }) => {
    const tool = loadTools(config).get("fren_run_code")!({ senderIsOwner: true });
    return (await tool.execute("c1", params)).content[0].text as string;
  };

  it("runs the script and hands back how it ended and what it printed", async () => {
    const out = await run({ language: "python", code: "import json\nprint(json.dumps({'sum': 2 + 2}))" });
    expect(out).toMatch(/^Exit code 0 after \d+\.\ds\.\n\{"sum": 4\}$/);
  });

  it("a failing script comes back with its error, so the agent can fix it", async () => {
    const out = await run({ language: "node", code: "JSON.parse('{oops')" });
    expect(out).toMatch(/^Exit code 1/);
    expect(out).toMatch(/SyntaxError/);
  });

  it("files stay for the next run", async () => {
    await run({ language: "bash", code: "echo 0xabc > address.txt" });
    expect(await run({ language: "bash", code: "cat address.txt" })).toMatch(/0xabc/);
    await run({ language: "bash", code: "true", reset: true });
    expect(await run({ language: "bash", code: "cat address.txt" })).toMatch(/No such file/);
  });

  it("says plainly when this machine has no sandbox yet", async () => {
    expect(await run({ language: "bash", code: "echo hi" }, { tokenFile, sandboxSocket: join(dir, "nothing-here.sock") })).toBe(SANDBOX_MISSING);
  });

  it("is only there for the owner", () => {
    expect(loadTools({ tokenFile }).get("fren_run_code")!({ senderIsOwner: false })).toBeNull();
  });

  it("waits for a free slot when three runs are going", async () => {
    const busy = await fakeSandboxSocket(mkdtempSync(join(tmpdir(), "fren-plugin-sbx-busy-")), { busyFirst: 2 });
    try {
      await expect(runInSandbox({ lang: "bash", code: "echo 1" }, { socket: busy.socket })).rejects.toBeInstanceOf(SandboxBusy);
      let waits = 0;
      const r = await runWhenFree({ lang: "bash", code: "echo free" }, { socket: busy.socket, sleep: async () => void waits++ });
      expect(r.output.trim()).toBe("free");
      expect(waits).toBe(1);
    } finally {
      await busy.close();
    }
  });
});

describe("what the model reads back", () => {
  const base: RunCodeResult = { exitCode: 0, signal: null, timedOut: false, output: "", truncated: false, ms: 1234, timeoutSec: 60 };

  it("says why a run ended", () => {
    expect(formatRun({ ...base, output: "ok\n" })).toBe("Exit code 0 after 1.2s.\nok");
    expect(formatRun({ ...base, exitCode: null, signal: "SIGKILL", timedOut: true, timeoutSec: 5 })).toMatch(/^Stopped at the 5s time limit/);
    expect(formatRun({ ...base, exitCode: null, signal: "SIGKILL" })).toMatch(/memory limit is 768 MB/);
    expect(formatRun({ ...base })).toMatch(/\(no output\)$/);
    expect(formatRun({ error: "lang must be one of: node, python, bash." } as RunCodeResult)).toBe("Sandbox error: lang must be one of: node, python, bash.");
  });

  it("keeps the start and the end of long output", () => {
    const output = Array.from({ length: 5000 }, (_, i) => `row ${i}`).join("\n");
    const text = formatRun({ ...base, output }, 1000);
    expect(text).toMatch(/row 0\n/);
    expect(text).toMatch(/row 4999$/);
    expect(text).toMatch(/characters cut/);
    expect(text.length).toBeLessThan(1300);
  });
});
