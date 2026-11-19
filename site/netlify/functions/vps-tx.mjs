import { handle, json, wizard } from "./lib/runtime.mjs";

// "I've paid": checks one pasted transaction against the order.
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only." });
  const body = await req.json().catch(() => ({}));
  return handle(() => wizard().submitTx(body.id, body.tx));
};

export const config = { path: "/api/vps/tx" };
