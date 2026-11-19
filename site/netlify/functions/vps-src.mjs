// Fren's source code for a new server, while its install runs. The repo is
// private, so the Netlify build packs it (see netlify.toml) and this hands it
// out only for an order whose install is in progress.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { json, wizard } from "./lib/runtime.mjs";

const FILE = "fren-src/fren.tar.gz";

async function tarball() {
  for (const dir of [process.env.LAMBDA_TASK_ROOT, process.cwd()].filter(Boolean)) {
    try {
      return await readFile(join(dir, FILE));
    } catch {}
  }
  return null;
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  const ok = await wizard()
    .mayDownload(id)
    .catch(() => false);
  if (!ok) return json(404, { error: "not found" });
  const body = await tarball();
  if (!body) return json(503, { error: "The Fren package is missing from this deploy." });
  return new Response(body, { headers: { "content-type": "application/gzip", "cache-control": "no-store" } });
};

export const config = { path: "/api/vps/src" };
