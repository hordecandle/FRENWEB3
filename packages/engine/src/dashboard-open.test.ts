import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { Dashboard } from "./dashboard.js";
import { buildTestFren } from "./testing.js";

/**
 * The OpenClaw plugin, and so the AI with a shell, holds the engine's API token. With it the
 * AI could ask for a login link and walk into the dashboard. These tests play that AI: no
 * route may hand the link back to the caller.
 */
const TOKEN = "t".repeat(32);
const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

async function engine(opts: { local?: boolean; browser?: boolean; privateLine?: boolean } = {}) {
  const t = buildTestFren({ privateLine: opts.privateLine ?? true });
  const opened: string[] = [];
  const dash = new Dashboard(t.fren, {
    publicUrl: "http://127.0.0.1:7422",
    local: opts.local ?? true,
    openBrowser: async (url) => (opts.browser === false ? false : (opened.push(url), true)),
  });
  const api = createApi(t.fren, TOKEN, undefined, { dashboard: dash });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  closers.push(() => api.close());
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const call = async (path: string) => {
    const res = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "{}" });
    return { status: res.status, raw: await res.text() };
  };
  return { ...t, opened, call };
}

const LINK = /\/login\?t=/;

describe("dashboard login link with the plugin's token (the AI's view)", () => {
  it("fren dashboard opens the owner's browser here and returns no link", async () => {
    const e = await engine();
    const r = await e.call("/dashboard/open");
    expect(r.status).toBe(200);
    expect(r.raw).not.toMatch(LINK);
    expect(r.raw).toMatch(/Opened your dashboard in the browser/);
    expect(e.opened).toHaveLength(1);
    expect(e.opened[0]).toMatch(LINK);
  });

  it("without a browser (a server) the link goes to the owner's private chat, not to the caller", async () => {
    const e = await engine({ browser: false });
    const r = await e.call("/dashboard/open");
    expect(r.raw).not.toMatch(LINK);
    expect(e.notifier.sent.at(-1)).toMatch(LINK);
  });

  it("a dashboard on a public address never opens a browser on the server", async () => {
    const e = await engine({ local: false });
    const r = await e.call("/dashboard/open");
    expect(r.raw).not.toMatch(LINK);
    expect(e.opened).toHaveLength(0);
    expect(e.notifier.sent.at(-1)).toMatch(LINK);
  });

  it("no browser and no private line: no link anywhere the caller can read", async () => {
    const e = await engine({ browser: false, privateLine: false });
    const r = await e.call("/dashboard/open");
    expect(r.raw).not.toMatch(LINK);
    expect(r.raw).toMatch(/\/fren_dashboard/);
  });

  it("the link the chat command asks for still only goes to the private line", async () => {
    const e = await engine();
    const r = await e.call("/dashboard/link");
    expect(r.raw).not.toMatch(LINK);
    expect(e.notifier.sent.at(-1)).toMatch(LINK);
  });
});
