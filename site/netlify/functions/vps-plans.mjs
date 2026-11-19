import { handle, wizard } from "./lib/runtime.mjs";

// Price and payment networks, and whether the wizard is open (all settings present).
export default async () => handle(() => wizard().plans());

export const config = { path: "/api/vps/plans" };
