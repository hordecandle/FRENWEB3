// Operator-only actions, for when a paid server needs fixing by hand.
// The key is the EQVPS reseller token itself: whoever holds it can already
// wipe these servers at EQVPS, so this grants nothing new and needs no extra
// setting. Anything else gets the same 404 as an unknown path.
//
//   POST /api/vps/admin { key, action: "reinstall", hostname: "fren-…" }
//
// "reinstall" wipes that order's server, puts a fresh OS on it and installs
// the current Fren again. The buyer's order page then shows the progress and
// a new setup link, as on the first install.
import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { handle, json, wizard } from "./lib/runtime.mjs";
import { hostnameFor, UserError } from "./lib/wizard.mjs";

const keyOk = (given) => {
  const want = (process.env.EQVPS_RESELLER_TOKEN ?? "").trim();
  if (want.length < 24 || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function orderIdFor(hostname) {
  const { blobs } = await getStore({ name: "fren-vps", consistency: "strong" }).list();
  const hit = blobs.find((b) => !b.key.startsWith("amt-") && hostnameFor({ id: b.key }) === hostname);
  if (!hit) throw new UserError("No order has that server.", 404);
  return hit.key;
}

export default async (req) => {
  if (req.method !== "POST") return json(404, { error: "Not found." });
  const body = await req.json().catch(() => ({}));
  if (!keyOk(body.key)) return json(404, { error: "Not found." });
  return handle(async () => {
    if (body.action !== "reinstall") throw new UserError("Unknown action.");
    if (typeof body.hostname !== "string" || !/^fren-[a-z0-9]{1,12}$/.test(body.hostname)) throw new UserError("Give the server's hostname (fren-…).");
    return wizard().reinstall(await orderIdFor(body.hostname));
  });
};

export const config = { path: "/api/vps/admin" };
