import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "@fren/engine";
import { createSigner, generateKeys } from "@fren/signer";
import { fakeSandboxSocket } from "../../engine/src/sandbox-testing.js";
import { buildTestFren } from "../../engine/src/testing.js";
import plugin, { PICTURE_NOTE, SCREENSHOT_MISSING } from "./index.js";

/**
 * "Send me a screenshot": the plugin's picture tools against a real engine and
 * the real sandbox runner. The browser is a stand-in module that writes a PNG
 * the way shot.mjs does, so this runs anywhere.
 */

const dir = mkdtempSync(join(tmpdir(), "fren-plugin-pics-"));
const tokenFile = join(dir, "api-token");
writeFileSync(tokenFile, "pics-token");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const helper = join(dir, "shot.mjs");
writeFileSync(
  helper,
  `import { writeFileSync } from "node:fs";
export async function screenshot(o) {
  if (o.url.includes("blocked")) throw new Error("The page didn't open: net::ERR_NAME_NOT_RESOLVED");
  writeFileSync(o.out, Buffer.from(${JSON.stringify(PNG)}));
  return { out: o.out, title: "0x9aD1...f061 | Hyperdash", finalUrl: o.url, bytes: 12 };
}
`,
);

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

describe("pictures from the chat", () => {
  const t = buildTestFren({ live: true, signer: createSigner(generateKeys()), snapshots: true });
  t.fake.hlCandles = Array.from({ length: 72 }, (_, i) => ({ t: t.clock.t - (72 - i) * 300_000, o: "88", h: "89", l: "87", c: String(88 + Math.sin(i / 5)) }));
  const server = createApi(t.fren, "pics-token");
  let sbx: Awaited<ReturnType<typeof fakeSandboxSocket>>;
  let tools: ReturnType<typeof loadTools>;

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    sbx = await fakeSandboxSocket(mkdtempSync(join(tmpdir(), "fren-plugin-pics-sock-")));
    const port = (server.address() as { port: number }).port;
    tools = loadTools({ apiUrl: `http://127.0.0.1:${port}`, tokenFile, sandboxSocket: sbx.socket, screenshotHelper: helper });
  });
  afterAll(async () => {
    server.close();
    await sbx.close();
  });

  const run = async (name: string, params: Record<string, unknown>) => (await tools.get(name)!({ senderIsOwner: true }).execute("c1", params)).content[0].text as string;

  it("screenshots a page and sends it to the owner with its link, not through the model", async () => {
    t.notifier.receipts.length = 0;
    const url = "https://hyperdash.com/address/0x9aD1a4F679a9eAFc420E50cF5e34d887A524f061";
    const out = await run("fren_screenshot", { url });
    expect(out).toBe(`Sent the owner a screenshot of "0x9aD1...f061 | Hyperdash" (${url}). ${PICTURE_NOTE}`);
    const [msg] = t.notifier.receipts;
    expect([...msg!.photo!.subarray(0, 8)]).toEqual(PNG.slice(0, 8));
    expect(msg!.photoName).toBe("fren-screenshot.png");
    expect(msg!.html).toBe(`📸 0x9aD1...f061 | Hyperdash\n🔗 <a href="${url}">Hyperdash</a>`);
  });

  it("says why a page didn't come out, and only takes web addresses", async () => {
    t.notifier.receipts.length = 0;
    expect(await run("fren_screenshot", { url: "https://blocked.example" })).toMatch(/^The screenshot didn't work: The page didn't open: net::ERR_NAME_NOT_RESOLVED/);
    expect(await run("fren_screenshot", { url: "file:///etc/passwd" })).toMatch(/Only http and https/);
    expect(await run("fren_screenshot", { url: "hyperdash" })).toMatch(/isn't a web address/);
    expect(t.notifier.receipts).toHaveLength(0);
  });

  it("tells the owner /fren_update installs the browser when the server doesn't have it yet", async () => {
    const port = (server.address() as { port: number }).port;
    const old = loadTools({ apiUrl: `http://127.0.0.1:${port}`, tokenFile, sandboxSocket: sbx.socket, screenshotHelper: join(dir, "missing.mjs") });
    expect((await old.get("fren_screenshot")!({ senderIsOwner: true }).execute("c1", { url: "https://hyperdash.com" })).content[0].text).toBe(SCREENSHOT_MISSING);
  });

  it("draws the chart itself for \"send me a screenshot of the $ANT chart\"", async () => {
    t.notifier.receipts.length = 0;
    const out = await run("fren_chart", { market: "ANT", hours: 6 });
    expect(out).toMatch(/^Sent the owner a 6h chart of ANT \$\d/);
    expect(t.notifier.receipts[0]!.photoName).toBe("fren-chart.png");
    expect(t.notifier.receipts[0]!.html).toContain(">Chart</a>");
  });

  it("a picture the agent's code saves in $FREN_OUT goes to the chat too", async () => {
    t.notifier.receipts.length = 0;
    const out = await run("fren_run_code", {
      language: "node",
      code: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.FREN_OUT + "/pnl.png", Buffer.from(${JSON.stringify(PNG)})); console.log("plotted");`,
    });
    expect(out).toMatch(/plotted\n\(Sent 1 picture from \$FREN_OUT to the owner's chat\./);
    expect(t.notifier.receipts[0]!.photoName).toBe("pnl.png");
  });
});
