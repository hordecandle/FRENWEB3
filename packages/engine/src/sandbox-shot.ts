import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A screenshot of a web page, taken inside Fren's code sandbox with a headless
 * Chromium (installed by the VPS installer in /usr/local/lib/fren-browser).
 *
 *   node /usr/local/lib/fren-sandbox/shot.mjs <url> <out.png> [width] [height] [waitSec] [full]
 *
 * The browser talks to us over a pipe (--remote-debugging-pipe), not a port:
 * the sandbox can't reach this machine's own network, and doesn't need to. It
 * runs as the sandbox's throwaway user with no keys, like any other script.
 *
 * Node built-ins only: `fren sandbox` copies this file on its own.
 */

export const BROWSER_DIR = "/usr/local/lib/fren-browser";

export interface ShotOptions {
  url: string;
  out: string;
  width?: number;
  height?: number;
  /** Seconds to let the page draw after it loaded (charts and apps fill in late). */
  waitSec?: number;
  fullPage?: boolean;
  browser?: string;
  /** Give up after this long, in seconds. */
  timeoutSec?: number;
}

export interface ShotResult {
  out: string;
  title: string;
  finalUrl: string;
  bytes: number;
}

/** The Chromium binary: $FREN_BROWSER, the installer's link, or one found in its folder. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env, dir = BROWSER_DIR): string | null {
  if (env.FREN_BROWSER && existsSync(env.FREN_BROWSER)) return env.FREN_BROWSER;
  const link = join(dir, "chrome");
  if (existsSync(link)) return link;
  const names = new Set(["chrome-headless-shell", "headless_shell", "chrome", "chromium"]);
  const walk = (d: string, depth: number): string | null => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isFile() && names.has(e) && st.mode & 0o111) return p;
      if (st.isDirectory() && depth < 4) {
        const found = walk(p, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(dir, 0);
}

export function checkUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Not a web address: ${raw}`);
  }
  // data: is for the installer's own check page.
  if (u.protocol !== "https:" && u.protocol !== "http:" && u.protocol !== "data:") throw new Error("Only http and https pages can be screenshotted.");
  return u.href;
}

export async function screenshot(o: ShotOptions): Promise<ShotResult> {
  const url = checkUrl(o.url);
  const browser = o.browser ?? findBrowser();
  if (!browser) throw new Error("No browser is installed in the sandbox. On a Fren server, /fren_update installs it.");
  const width = clamp(o.width ?? 1280, 320, 2560);
  const height = clamp(o.height ?? 800, 240, 2560);
  const waitMs = clamp(o.waitSec ?? 4, 0, 30) * 1000;
  const profile = mkdtempSync(join(tmpdir(), "fren-shot-"));
  const args = [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    "--renderer-process-limit=2",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--remote-debugging-pipe",
    // Extra flags, e.g. a proxy where the machine needs one.
    ...(process.env.FREN_BROWSER_FLAGS ?? "").split(/\s+/).filter(Boolean),
    "about:blank",
  ];
  const child = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: { ...process.env, HOME: profile } });
  let stderr = "";
  child.stderr!.on("data", (c: Buffer) => (stderr = (stderr + c.toString("utf8")).slice(-4000)));
  const toBrowser = child.stdio[3] as NodeJS.WritableStream;
  const fromBrowser = child.stdio[4] as NodeJS.ReadableStream;
  const cdp = new Cdp(toBrowser, fromBrowser);
  const deadline = setTimeout(() => cdp.fail(new Error(`The page took longer than ${o.timeoutSec ?? 60}s.`)), (o.timeoutSec ?? 60) * 1000);
  child.on("exit", (code) => cdp.fail(new Error(`The browser stopped (exit ${code}). ${stderr.trim().split("\n").slice(-3).join(" ")}`)));
  try {
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const s = (method: string, params: Record<string, unknown> = {}) => cdp.send<Record<string, unknown>>(method, params, sessionId);
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const loaded = cdp.once("Page.loadEventFired", sessionId);
    const nav = (await s("Page.navigate", { url })) as { errorText?: string };
    if (nav.errorText) throw new Error(`The page didn't open: ${nav.errorText}`);
    await Promise.race([loaded, sleep(25_000)]);
    await sleep(waitMs);
    const info = (await s("Runtime.evaluate", { expression: "JSON.stringify({t: document.title, u: location.href, h: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)})", returnByValue: true })) as {
      result?: { value?: string };
    };
    const page = JSON.parse(info.result?.value ?? "{}") as { t?: string; u?: string; h?: number };
    const params: Record<string, unknown> = { format: "png" };
    if (o.fullPage && page.h && page.h > height) {
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width, height: Math.min(page.h, 8000), scale: 1 };
    }
    const shot = (await s("Page.captureScreenshot", params)) as { data: string };
    const png = Buffer.from(shot.data, "base64");
    writeFileSync(o.out, png);
    await cdp.send("Browser.close").catch(() => undefined);
    return { out: o.out, title: page.t ?? "", finalUrl: page.u ?? url, bytes: png.length };
  } finally {
    clearTimeout(deadline);
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((r) => child.once("exit", () => r()));
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    // The browser writes to its profile until it's gone; the picture is saved either way.
    await Promise.race([exited, sleep(3000)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // /tmp is the run's own and goes with it.
    }
  }
}

/** Chrome DevTools Protocol over the pipe: JSON messages, each ended by a NUL byte. */
class Cdp {
  private id = 0;
  private buf = Buffer.alloc(0);
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners: { method: string; sessionId?: string; resolve: () => void }[] = [];
  private failed: Error | null = null;

  constructor(
    private readonly out: NodeJS.WritableStream,
    input: NodeJS.ReadableStream,
  ) {
    input.on("data", (c: Buffer) => {
      this.buf = Buffer.concat([this.buf, c]);
      let end: number;
      while ((end = this.buf.indexOf(0)) >= 0) {
        const raw = this.buf.subarray(0, end).toString("utf8");
        this.buf = this.buf.subarray(end + 1);
        this.onMessage(raw);
      }
    });
    input.on("error", (e: Error) => this.fail(e));
  }

  private onMessage(raw: string) {
    let m: { id?: number; result?: unknown; error?: { message: string }; method?: string; sessionId?: string };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id !== undefined) {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message));
      else w.resolve(m.result ?? {});
      return;
    }
    if (m.method) {
      this.listeners = this.listeners.filter((l) => {
        if (l.method !== m.method || (l.sessionId && l.sessionId !== m.sessionId)) return true;
        l.resolve();
        return false;
      });
    }
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }

  once(method: string, sessionId?: string): Promise<void> {
    return new Promise((resolve) => this.listeners.push({ method, ...(sessionId ? { sessionId } : {}), resolve }));
  }

  fail(err: Error) {
    if (this.failed) return;
    this.failed = err;
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.round(n) : lo));

async function main() {
  const [url, out, w, h, wait, full] = process.argv.slice(2);
  if (!url || !out) {
    console.error("usage: shot.mjs <url> <out.png> [width] [height] [waitSec] [full]");
    process.exit(2);
  }
  try {
    const r = await screenshot({ url, out, ...(w ? { width: Number(w) } : {}), ...(h ? { height: Number(h) } : {}), ...(wait ? { waitSec: Number(wait) } : {}), fullPage: full === "full" });
    console.log(JSON.stringify({ ok: true, ...r }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: (err as Error).message }));
    process.exit(1);
  }
}

function isMain(): boolean {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) void main();
