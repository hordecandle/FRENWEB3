import { createConnection } from "node:net";

/**
 * The agent's side of Fren's code sandbox (engine/src/sandbox.ts): one script
 * per connection to a socket only the agent's user can open. The sandbox has
 * no keys and can't reach the engine, so nothing here can sign or spend.
 */

export const DEFAULT_SANDBOX_SOCKET = "/run/fren-sandbox.sock";
/** What the model gets back: the start and the end of the output. */
const MAX_REPLY_CHARS = 8000;

export interface RunCodeRequest {
  lang: "node" | "python" | "bash";
  code: string;
  timeoutSec?: number;
  reset?: boolean;
}

export interface RunCodeResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  output: string;
  truncated: boolean;
  ms: number;
  timeoutSec: number;
  error?: string;
  /** Pictures the script saved in $FREN_OUT (base64), for the owner's chat. */
  images?: { name: string; base64: string }[];
}

/** Where `fren sandbox` puts the screenshot helper, beside the runner. */
export const SHOT_HELPER = "/usr/local/lib/fren-sandbox/shot.mjs";

/** The sandbox script for one screenshot: prints "SHOT {json}" and leaves the PNG in $FREN_OUT. */
export function screenshotCode(o: { url: string; width?: number; height?: number; waitSec?: number; fullPage?: boolean }, helper = SHOT_HELPER): string {
  const opts = { url: o.url, width: o.width ?? 1280, height: o.height ?? 800, waitSec: o.waitSec ?? 6, fullPage: o.fullPage === true, timeoutSec: 75 };
  return `import { screenshot } from ${JSON.stringify(helper)};
try {
  const r = await screenshot({ ...${JSON.stringify(opts)}, out: process.env.FREN_OUT + "/screenshot.png" });
  console.log("SHOT " + JSON.stringify({ ok: true, title: r.title, finalUrl: r.finalUrl }));
} catch (err) {
  console.log("SHOT " + JSON.stringify({ ok: false, error: String(err && err.message || err) }));
}
process.exit(0);
`;
}

export class SandboxUnavailable extends Error {}
/** systemd turned the connection away: three runs are going already. */
export class SandboxBusy extends Error {}

export function runInSandbox(req: RunCodeRequest, o: { socket?: string; timeoutMs?: number } = {}): Promise<RunCodeResult> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(o.socket ?? DEFAULT_SANDBOX_SOCKET);
    const chunks: Buffer[] = [];
    let connected = 0;
    const timer = setTimeout(() => sock.destroy(new Error("The sandbox didn't answer in time.")), o.timeoutMs ?? 200_000);
    sock.on("connect", () => {
      connected = Date.now();
      sock.end(JSON.stringify(req));
    });
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (!connected && ["ENOENT", "ECONNREFUSED", "EACCES"].includes(err.code ?? "")) reject(new SandboxUnavailable(err.code));
      else if (!chunks.length && Date.now() - connected < 2000 && ["ECONNRESET", "EPIPE"].includes(err.code ?? "")) reject(new SandboxBusy(err.code));
      else reject(err);
    });
    sock.on("end", () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw) as RunCodeResult);
      } catch {
        // Accepted but nothing came back: the run was killed (its time or memory ran out).
        reject(new Error(raw ? "The sandbox's answer wasn't readable." : "The run was stopped before it could answer (time or memory limit)."));
      }
    });
  });
}

/** Waits out a full sandbox (three runs at once) for a while before giving up. */
export async function runWhenFree(
  req: RunCodeRequest,
  o: { socket?: string; tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunCodeResult> {
  const tries = o.tries ?? 10;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await runInSandbox(req, o.socket ? { socket: o.socket } : {});
    } catch (err) {
      if (!(err instanceof SandboxBusy) || i >= tries) throw err;
      await sleep(o.waitMs ?? 2000);
    }
  }
}

export const SANDBOX_BUSY = "The sandbox is running three scripts already and none finished in 20 seconds. Wait for them, then run this again.";

export const SANDBOX_MISSING =
  "The code sandbox isn't set up on this machine. On a Fren server the owner sends /fren_update once and it's installed; tell them that in one line, and answer without running code meanwhile.";

/** On a Mac or Windows there is no sandbox to install: it is a systemd unit with its own user (engine sandbox.ts). */
export const SANDBOX_NOT_HERE =
  "Running code isn't possible on this computer: Fren's code sandbox only exists on a Linux server. Tell the owner that in one line, don't suggest /fren_update (it won't add it here), and answer without running code.";

/** What the model hears when there's no sandbox, honest about whether one can be installed here. */
export function sandboxMissing(platform: string = process.platform): string {
  return platform === "linux" ? SANDBOX_MISSING : SANDBOX_NOT_HERE;
}

/** The result as the model reads it: how it ended, then what it printed. */
export function formatRun(r: RunCodeResult, maxChars = MAX_REPLY_CHARS): string {
  if (r.error && r.exitCode === undefined) return `Sandbox error: ${r.error}`;
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  const how = r.error
    ? `Didn't run: ${r.error}`
    : r.timedOut
      ? `Stopped at the ${r.timeoutSec}s time limit (raise timeoutSec, up to 150, or do less per run).`
      : r.signal
        ? `Killed by ${r.signal} after ${secs} (memory limit is 768 MB).`
        : `Exit code ${r.exitCode} after ${secs}.`;
  let out = r.output ?? "";
  if (out.length > maxChars) {
    const head = Math.floor(maxChars * 0.6);
    const tail = maxChars - head;
    out = `${out.slice(0, head)}\n… [${out.length - maxChars} characters cut; print less, or write it to a file and print a summary] …\n${out.slice(-tail)}`;
  }
  return `${how}\n${out.trim() ? out.replace(/\s+$/, "") : "(no output)"}`;
}
