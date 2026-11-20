import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Runs one script for the agent, inside fren-sandbox@.service (see sandbox.ts):
 * a throwaway system user with no keys, no Fren engine, no local services and
 * hard time and memory limits. The request comes in on stdin (the connection
 * systemd accepted), the result goes back on stdout, both as JSON.
 *
 * Node built-ins only: `fren sandbox` copies this file on its own to
 * /usr/local/lib/fren-sandbox/runner.mjs, outside the home folders the unit hides.
 */

export type SandboxLang = "node" | "python" | "bash";

export interface SandboxRequest {
  lang: SandboxLang;
  code: string;
  timeoutSec?: number;
  /** Empty the working folder first (installed packages and saved files go too). */
  reset?: boolean;
}

export interface SandboxResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  output: string;
  truncated: boolean;
  ms: number;
  timeoutSec: number;
  error?: string;
  /** Pictures the script saved in $FREN_OUT, for the owner's chat. */
  images?: SandboxImage[];
}

export interface SandboxImage {
  name: string;
  base64: string;
}

/** What comes back from $FREN_OUT: a few pictures, each small enough for Telegram. */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export const DEFAULT_TIMEOUT_SEC = 60;
/** The unit's RuntimeMaxSec is a little longer, so the runner always gets to answer. */
export const MAX_TIMEOUT_SEC = 150;
export const MAX_CODE_BYTES = 256 * 1024;
const HEAD_BYTES = 32 * 1024;
const TAIL_BYTES = 16 * 1024;

const LANGS: Record<SandboxLang, { file: string; cmd: string; args: (file: string) => string[] }> = {
  // .mjs: import works, and so does top-level await.
  node: { file: "main.mjs", cmd: "node", args: (f) => [f] },
  python: { file: "main.py", cmd: "python3", args: (f) => ["-u", f] },
  bash: { file: "main.sh", cmd: "bash", args: (f) => [f] },
};

export function parseRequest(raw: string): SandboxRequest {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("The request isn't JSON.");
  }
  const r = (v ?? {}) as Record<string, unknown>;
  if (typeof r.lang !== "string" || !(r.lang in LANGS)) throw new Error(`lang must be one of: ${Object.keys(LANGS).join(", ")}.`);
  const code = typeof r.code === "string" ? r.code : "";
  const reset = r.reset === true;
  if (!code.trim() && !reset) throw new Error("There's no code to run.");
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new Error(`The code is over ${MAX_CODE_BYTES / 1024} KB.`);
  const t = Number(r.timeoutSec ?? DEFAULT_TIMEOUT_SEC);
  const timeoutSec = Number.isFinite(t) ? Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.round(t))) : DEFAULT_TIMEOUT_SEC;
  return { lang: r.lang as SandboxLang, code, timeoutSec, reset };
}

/** stdout and stderr together, in the order they came; the start and the end are kept when it's long. */
class Output {
  private head: Buffer[] = [];
  private headLen = 0;
  private tail = Buffer.alloc(0);
  private total = 0;

  add(chunk: Buffer) {
    this.total += chunk.length;
    if (this.headLen < HEAD_BYTES) {
      const take = chunk.subarray(0, HEAD_BYTES - this.headLen);
      this.head.push(take);
      this.headLen += take.length;
      chunk = chunk.subarray(take.length);
    }
    if (chunk.length) {
      this.tail = Buffer.concat([this.tail, chunk]);
      if (this.tail.length > TAIL_BYTES) this.tail = this.tail.subarray(this.tail.length - TAIL_BYTES);
    }
  }

  result(): { output: string; truncated: boolean } {
    const head = Buffer.concat(this.head).toString("utf8");
    const cut = this.total - this.headLen - this.tail.length;
    if (cut <= 0) return { output: head + this.tail.toString("utf8"), truncated: false };
    return { output: `${head}\n… [${cut} bytes cut] …\n${this.tail.toString("utf8")}`, truncated: true };
  }
}

export interface RunOptions {
  /** The working folder: kept between runs, so installed packages and saved files stay. */
  workspace: string;
  /** PATH for the script (the unit's: node's folder and the system's). */
  path: string;
}

export async function runCode(req: SandboxRequest, o: RunOptions): Promise<SandboxResult> {
  const started = Date.now();
  const timeoutSec = req.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  mkdirSync(o.workspace, { recursive: true });
  if (req.reset) for (const name of readdirSync(o.workspace)) rmSync(join(o.workspace, name), { recursive: true, force: true });
  if (!req.code.trim()) return { exitCode: 0, signal: null, timedOut: false, output: "The working folder is empty now.", truncated: false, ms: Date.now() - started, timeoutSec };

  const lang = LANGS[req.lang];
  const runDir = join(o.workspace, `.run-${randomBytes(6).toString("hex")}`);
  mkdirSync(runDir);
  const file = join(runDir, lang.file);
  writeFileSync(file, req.code);
  const outDir = join(runDir, "out");
  mkdirSync(outDir);
  // Nothing from the runner's own environment: the script gets a clean one.
  const env: Record<string, string> = {
    HOME: o.workspace,
    PATH: [join(o.workspace, ".venv", "bin"), join(o.workspace, "node_modules", ".bin"), o.path].join(":"),
    LANG: "C.UTF-8",
    TMPDIR: "/tmp",
    FREN_OUT: outDir,
    NO_COLOR: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };

  const out = new Output();
  try {
    return await new Promise<SandboxResult>((resolve) => {
      let timedOut = false;
      let settled = false;
      const child = spawn(lang.cmd, lang.args(file), { cwd: o.workspace, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
      // The script and anything it started run as one process group: stop them all.
      const killAll = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killAll();
      }, timeoutSec * 1000);
      child.stdout.on("data", (c: Buffer) => out.add(c));
      child.stderr.on("data", (c: Buffer) => out.add(c));
      const finish = (exitCode: number | null, signal: string | null, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const images = collectImages(outDir);
        resolve({ exitCode, signal, timedOut, ...out.result(), ms: Date.now() - started, timeoutSec, ...(error ? { error } : {}), ...(images.length ? { images } : {}) });
      };
      let grace: NodeJS.Timeout | undefined;
      child.on("error", (err) => finish(null, null, `Couldn't start ${lang.cmd}: ${err.message}`));
      child.on("exit", (code, signal) => {
        // Background processes the script left behind go too; give the pipes a moment to drain.
        killAll();
        grace = setTimeout(() => finish(code, signal), 1000);
      });
      child.on("close", (code, signal) => {
        clearTimeout(grace);
        finish(code, signal);
      });
    });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

/** The pictures a run left in its out folder, in name order. Others (too big, too many, not pictures) are skipped. */
export function collectImages(dir: string): SandboxImage[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => IMAGE_EXT.test(n)).sort();
  } catch {
    return [];
  }
  const out: SandboxImage[] = [];
  for (const name of names) {
    if (out.length >= MAX_IMAGES) break;
    try {
      const p = join(dir, name);
      const st = statSync(p);
      if (!st.isFile() || st.size === 0 || st.size > MAX_IMAGE_BYTES) continue;
      out.push({ name, base64: readFileSync(p).toString("base64") });
    } catch {
      // Gone or unreadable: skip it.
    }
  }
  return out;
}

async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  let res: SandboxResult | { error: string };
  try {
    for await (const c of process.stdin as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > MAX_CODE_BYTES * 2) throw new Error(`The request is over ${(MAX_CODE_BYTES * 2) / 1024} KB.`);
      chunks.push(c);
    }
    const req = parseRequest(Buffer.concat(chunks).toString("utf8"));
    res = await runCode(req, { workspace: process.env.FREN_SANDBOX_WORKSPACE ?? process.cwd(), path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" });
  } catch (err) {
    res = { error: (err as Error).message };
  }
  process.stdout.write(JSON.stringify(res) + "\n", () => process.exit(0));
}

function isMain(): boolean {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) void main();
