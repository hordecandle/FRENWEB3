import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_TIMEOUT_SEC, parseRequest, runCode, type SandboxRequest, type SandboxResult } from "./sandbox-runner.js";
import { callSandbox, installSandbox, resolvers, safetyCheck, sandboxUnits, SANDBOX_DENY } from "./sandbox.js";
import { fakeSandboxSocket } from "./sandbox-testing.js";
import type { Runner } from "./setup.js";

/** Fren can write and run code, in a sandbox that holds no keys and can't reach this machine. */

const units = sandboxUnits({ node: "/usr/bin/node", runner: "/usr/local/lib/fren-sandbox/runner.mjs", socketGroup: "fren", dns: ["127.0.0.53", "8.8.8.8"] });
const service = units["fren-sandbox@.service"];
const line = (text: string, key: string) => text.split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

describe("the sandbox's systemd units", () => {
  it("only the agent's group can open the socket, a few runs at a time", () => {
    const sock = units["fren-sandbox.socket"];
    expect(line(sock, "ListenStream")).toBe("/run/fren-sandbox.sock");
    expect(line(sock, "SocketGroup")).toBe("fren");
    expect(line(sock, "SocketMode")).toBe("0660");
    expect(line(sock, "Accept")).toBe("yes");
    expect(Number(line(sock, "MaxConnections"))).toBeLessThanOrEqual(4);
  });

  it("each run is a throwaway user that can't see the keys, the homes or /etc/fren", () => {
    expect(line(service, "DynamicUser")).toBe("yes");
    expect(line(service, "ProtectHome")).toBe("yes");
    expect(line(service, "ProtectSystem")).toBe("strict");
    expect(line(service, "NoNewPrivileges")).toBe("yes");
    expect(line(service, "CapabilityBoundingSet")).toBe("");
    const hidden = line(service, "InaccessiblePaths")!.split(" ");
    expect(hidden).toEqual(expect.arrayContaining(["-/var/lib/fren-engine", "-/etc/fren"]));
    expect(line(service, "ExecStart")).toBe("/usr/bin/node /usr/local/lib/fren-sandbox/runner.mjs");
    expect(line(service, "StandardInput")).toBe("socket");
    expect(line(service, "StandardOutput")).toBe("socket");
    expect(line(service, "Environment")).toBe("HOME=/var/lib/fren-sandbox");
  });

  it("can't connect to this machine or its private networks, only to the DNS servers", () => {
    const deny = line(service, "IPAddressDeny")!.split(" ");
    expect(deny).toEqual(expect.arrayContaining(["localhost", "link-local", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "fc00::/7"]));
    expect(deny).toEqual(SANDBOX_DENY);
    expect(line(service, "IPAddressAllow")).toBe("127.0.0.53/32 8.8.8.8/32");
  });

  it("has hard limits, and always outlives the runner's own time limit", () => {
    expect(Number(line(service, "RuntimeMaxSec"))).toBeGreaterThan(MAX_TIMEOUT_SEC);
    expect(line(service, "MemoryMax")).toBe("768M");
    expect(line(service, "TasksMax")).toBe("128");
    expect(line(service, "LimitFSIZE")).toBe("200M");
    expect(line(units["fren-sandbox.slice"], "MemoryMax")).toBe("1G");
  });

  it("lets through the DNS servers in resolv.conf, never the metadata address", () => {
    expect(resolvers("# generated\nnameserver 1.1.1.1\nnameserver 169.254.169.254\nnameserver fe80::1%eth0\noptions edns0\n")).toEqual(["127.0.0.53", "1.1.1.1", "fe80::1"]);
    expect(resolvers("")).toEqual(["127.0.0.53"]);
  });
});

describe("the runner", () => {
  const ws = () => mkdtempSync(join(tmpdir(), "fren-sbx-"));
  const opts = (workspace: string) => ({ workspace, path: process.env.PATH ?? "/usr/bin:/bin" });
  const run = (workspace: string, req: Partial<SandboxRequest> & Pick<SandboxRequest, "lang" | "code">) => runCode({ timeoutSec: 30, ...req }, opts(workspace));

  it("runs node as an ES module, with top-level await", async () => {
    const r = await run(ws(), { lang: "node", code: 'import { createHash } from "node:crypto";\nawait new Promise((r) => setTimeout(r, 10));\nconsole.log(createHash("sha256").update("fren").digest("hex").slice(0, 8));' });
    expect(r).toMatchObject({ exitCode: 0, timedOut: false, truncated: false });
    expect(r.output.trim()).toBe("3ac30dd0");
  });

  it("runs python and bash, and reports a failing exit with its error", async () => {
    const w = ws();
    expect((await run(w, { lang: "python", code: "print(sum(range(10)))" })).output.trim()).toBe("45");
    expect((await run(w, { lang: "bash", code: "echo $((6 * 7))" })).output.trim()).toBe("42");
    const bad = await run(w, { lang: "node", code: 'throw new Error("nope")' });
    expect(bad.exitCode).toBe(1);
    expect(bad.output).toMatch(/Error: nope/);
  });

  it("gives the script a clean environment, nothing from the runner's", async () => {
    process.env.FREN_TEST_SECRET = "hunter2";
    try {
      const w = ws();
      const r = await run(w, { lang: "bash", code: "env | sort" });
      expect(r.output).not.toMatch(/hunter2/);
      expect(r.output).toMatch(new RegExp(`^HOME=${w}$`, "m"));
    } finally {
      delete process.env.FREN_TEST_SECRET;
    }
  });

  it("stops at the time limit, along with anything the script started", async () => {
    const w = ws();
    const r = await run(w, { lang: "bash", code: "sleep 30 &\necho $! > bg.pid\necho started\nsleep 30", timeoutSec: 1 });
    expect(r).toMatchObject({ timedOut: true, exitCode: null, signal: "SIGKILL", timeoutSec: 1 });
    expect(r.output).toMatch(/started/);
    expect(r.ms).toBeLessThan(5000);
    const pid = Number(readFileSync(join(w, "bg.pid"), "utf8"));
    // Gone, or a zombie waiting for init to reap it.
    const state = () => {
      try {
        return readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /s, "")[0];
      } catch {
        return "gone";
      }
    };
    expect(["gone", "Z", "X"]).toContain(state());
  });

  it("keeps the start and the end of long output", async () => {
    const r = await run(ws(), { lang: "node", code: 'for (let i = 0; i < 20000; i++) console.log("line " + i);' });
    expect(r.truncated).toBe(true);
    expect(r.output).toMatch(/^line 0\n/);
    expect(r.output).toMatch(/line 19999\n$/);
    expect(r.output).toMatch(/bytes cut/);
    expect(r.output.length).toBeLessThan(60_000);
  });

  it("keeps files between runs, so packages are installed once; reset empties the folder", async () => {
    const w = ws();
    mkdirSync(join(w, "node_modules", "fren-test-pkg"), { recursive: true });
    writeFileSync(join(w, "node_modules", "fren-test-pkg", "package.json"), JSON.stringify({ name: "fren-test-pkg", type: "module", exports: "./index.js" }));
    writeFileSync(join(w, "node_modules", "fren-test-pkg", "index.js"), "export const hi = 'from the workspace';");
    await run(w, { lang: "bash", code: "echo kept > note.txt" });
    const r = await run(w, { lang: "node", code: 'import { hi } from "fren-test-pkg";\nimport { readFileSync } from "node:fs";\nconsole.log(hi, readFileSync("note.txt", "utf8").trim());' });
    expect(r.output.trim()).toBe("from the workspace kept");
    const reset = await run(w, { lang: "bash", code: "", reset: true });
    expect(reset.output).toMatch(/empty/);
    expect(existsSync(join(w, "note.txt"))).toBe(false);
    expect(existsSync(join(w, "node_modules"))).toBe(false);
  });

  it("checks the request", () => {
    expect(() => parseRequest("nope")).toThrow(/isn't JSON/);
    expect(() => parseRequest(JSON.stringify({ lang: "ruby", code: "puts 1" }))).toThrow(/node, python, bash/);
    expect(() => parseRequest(JSON.stringify({ lang: "node", code: "  " }))).toThrow(/no code/);
    expect(parseRequest(JSON.stringify({ lang: "node", code: "1", timeoutSec: 9999 })).timeoutSec).toBe(MAX_TIMEOUT_SEC);
    expect(parseRequest(JSON.stringify({ lang: "node", code: "1" })).timeoutSec).toBe(60);
  });
});

describe("over the socket, the way systemd hands it the connection", () => {
  let sbx: Awaited<ReturnType<typeof fakeSandboxSocket>>;
  beforeAll(async () => {
    sbx = await fakeSandboxSocket(mkdtempSync(join(tmpdir(), "fren-sbx-sock-")));
  });
  afterAll(() => sbx.close());

  it("sends the script, half-closes, and reads the result back", async () => {
    const r = await callSandbox({ lang: "node", code: "console.log(process.cwd())" }, { socket: sbx.socket });
    expect(r.exitCode).toBe(0);
    expect(r.output.trim()).toBe(sbx.workspace);
  });

  it("a bad request gets an error back, not a hang", async () => {
    const r = (await callSandbox({ lang: "cobol" as never, code: "x" }, { socket: sbx.socket })) as SandboxResult;
    expect(r.error).toMatch(/lang must be/);
  });
});

describe("fren sandbox", () => {
  function deps(o: { call?: (req: SandboxRequest) => Promise<SandboxResult>; uid?: number } = {}) {
    const calls: string[] = [];
    const run: Runner = async (file, args) => {
      calls.push([file, ...args].join(" "));
      if (file === "id") return { code: 0, stdout: "fren\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const said: string[] = [];
    const ok = async (req: SandboxRequest): Promise<SandboxResult> => {
      const output = req.code.includes("6 * 7") ? "42\n" : req.code.includes("net.connect") ? "BLOCKED EPERM\n" : "checked\n";
      return { exitCode: 0, signal: null, timedOut: false, output, truncated: false, ms: 5, timeoutSec: 30 };
    };
    return { deps: { run, say: (t: string) => said.push(t), uid: o.uid ?? 0, platform: "linux" as const, call: o.call ?? ok }, calls, said };
  }
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), "fren-sbx-install-"));
    const unitDir = join(root, "units");
    mkdirSync(unitDir);
    const runnerSource = join(root, "runner.js");
    writeFileSync(runnerSource, "// runner");
    return { unitDir, libDir: join(root, "lib"), runnerSource, resolvConf: "nameserver 9.9.9.9\n" };
  };
  const base = { agentUser: "fren", agentHome: "/home/fren", node: "/usr/bin/node" };

  it("installs the units with the agent's group, starts the socket and checks it from inside", async () => {
    const { deps: d, calls, said } = deps();
    const p = dirs();
    await installSandbox(d, { ...base, ...p });
    expect(readFileSync(join(p.unitDir, "fren-sandbox.socket"), "utf8")).toMatch(/SocketGroup=fren/);
    expect(readFileSync(join(p.unitDir, "fren-sandbox@.service"), "utf8")).toMatch(/IPAddressAllow=127\.0\.0\.53\/32 9\.9\.9\.9\/32/);
    expect(readFileSync(join(p.libDir, "runner.mjs"), "utf8")).toBe("// runner");
    expect(calls).toEqual(expect.arrayContaining(["systemctl daemon-reload", "systemctl enable fren-sandbox.socket", "systemctl restart fren-sandbox.socket"]));
    expect(said.at(-1)).toMatch(/Code sandbox ready/);
  });

  it("turns itself off when a check fails", async () => {
    const leaky = async (req: SandboxRequest): Promise<SandboxResult> => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      output: req.code.includes("6 * 7") ? "42\n" : req.code.includes("net.connect") ? "REACHED\n" : "checked\n",
      truncated: false,
      ms: 5,
      timeoutSec: 30,
    });
    const { deps: d, calls } = deps({ call: leaky });
    await expect(installSandbox(d, { ...base, ...dirs() })).rejects.toThrow(/can reach services on this machine.*so it's off/);
    expect(calls.at(-1)).toBe("systemctl disable --now fren-sandbox.socket");
  });

  it("refuses a node it couldn't see, and needs root", async () => {
    await expect(installSandbox(deps().deps, { ...base, ...dirs(), node: "/home/fren/.nvm/versions/node/v24/bin/node" })).rejects.toThrow(/home folder/);
    await expect(installSandbox(deps({ uid: 1000 }).deps, { ...base, ...dirs() })).rejects.toThrow(/as root/);
  });

  it("--undo takes it all away", async () => {
    const { deps: d, calls } = deps();
    const p = dirs();
    await installSandbox(d, { ...base, ...p });
    await installSandbox(d, { ...base, ...p, undo: true });
    expect(existsSync(join(p.unitDir, "fren-sandbox.socket"))).toBe(false);
    expect(existsSync(p.libDir)).toBe(false);
    expect(calls).toContain("systemctl disable --now fren-sandbox.socket");
  });

  const ok: SandboxResult = { exitCode: 0, signal: null, timedOut: false, output: "", truncated: false, ms: 1, timeoutSec: 30 };
  it("the safety check catches a sandbox that can see the keys or reach this machine", async () => {
    // A "sandbox" with no isolation at all: the runner straight on this machine.
    const home = mkdtempSync(join(tmpdir(), "fren-sbx-home-"));
    mkdirSync(join(home, ".fren"));
    writeFileSync(join(home, ".fren", "api-token"), "x");
    const w = mkdtempSync(join(tmpdir(), "fren-sbx-open-"));
    const open = (req: SandboxRequest) => runCode(req, { workspace: w, path: process.env.PATH ?? "/usr/bin:/bin" });
    expect(await safetyCheck(open, home)).toBe(`it can see ${join(home, ".fren")}`);
    // Files hidden, network open: still off.
    const filesHidden = (req: SandboxRequest) => (req.lang === "bash" ? Promise.resolve({ ...ok, output: "checked\n" }) : open(req));
    expect(await safetyCheck(filesHidden, home)).toMatch(/can reach services on this machine/);
  });
});
