import { handle, json, wizard } from "./lib/runtime.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only." });
  const body = await req.json().catch(() => ({}));
  return handle(() => wizard().retry(body.id));
};

export const config = { path: "/api/vps/retry" };
