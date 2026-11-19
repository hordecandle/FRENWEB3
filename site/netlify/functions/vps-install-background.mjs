// Runs after payment, once the server is up: SSH in with the server's first
// root password, install Fren in web-setup mode, and save the setup link. The
// installer locks root's password when it's done, and the wizard forgets it.
import { randomBytes } from "node:crypto";
import { installCommand, sshRun, wizard } from "./lib/runtime.mjs";

export default async (req) => {
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string") return;
  const updateKey = randomBytes(24).toString("base64url");
  await wizard().install(id, sshRun, installCommand(id, updateKey), updateKey);
};
