import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * systemd's side of the sandbox, for tests: a socket that starts the real runner
 * for each connection with the connection as its stdin and stdout (Accept=yes,
 * StandardInput=socket, StandardOutput=socket), minus the isolation.
 */
export async function fakeSandboxSocket(dir: string, o: { busyFirst?: number } = {}): Promise<{ socket: string; workspace: string; close(): Promise<void> }> {
  const socket = join(dir, "sandbox.sock");
  const workspace = join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });
  const runner = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./sandbox-runner.ts" : "./sandbox-runner.js", import.meta.url));
  let busy = o.busyFirst ?? 0;
  const server: Server = createServer({ pauseOnConnect: true }, (conn) => {
    if (busy > 0) {
      // What systemd does past MaxConnections: close it unread, so the client sees a reset.
      busy--;
      setTimeout(() => conn.destroy(), 50);
      return;
    }
    const child = spawn(process.execPath, [runner], { cwd: workspace, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdio: [conn, conn, "ignore"] });
    child.on("exit", () => conn.destroy());
  });
  await new Promise<void>((r) => server.listen(socket, r));
  return { socket, workspace, close: () => new Promise<void>((r) => server.close(() => r())) };
}
