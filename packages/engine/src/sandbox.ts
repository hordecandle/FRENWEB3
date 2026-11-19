import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import type { SandboxRequest, SandboxResult } from "./sandbox-runner.js";
import type { Runner } from "./setup.js";

/**
 * `fren sandbox` (Linux, as root): somewhere for the agent to write and run
 * code. Each run is a systemd service of its own, started when the agent's
 * plugin connects to a socket only the agent's group can open:
 *
 *   - a throwaway user (DynamicUser), so it owns nothing anyone else has;
 *   - no keys: the engine's home, /etc/fren and every home folder are hidden;
 *   - no local services: localhost, the private ranges and the cloud metadata
 *     address are firewalled, so it can't reach the engine's API, the gateway or
 *     Caddy's admin port. The internet is open, so it can read chains and APIs;
 *   - time, memory, process and file-size limits, and one folder that persists.
 *
 * Install checks it all from inside before turning it on, and turns it off again
 * if any check fails.
 */

export const SANDBOX_SOCKET = "/run/fren-sandbox.sock";
export const SANDBOX_LIB = "/usr/local/lib/fren-sandbox";
export const SANDBOX_UNITS = ["fren-sandbox.socket", "fren-sandbox@.service", "fren-sandbox.slice"] as const;
/** Cloud metadata endpoints: never reachable, even when listed as a resolver. */
const METADATA = new Set(["169.254.169.254", "fd00:ec2::254"]);
const RESOLVED_STUB = "127.0.0.53";

/** What the sandbox never sees. ProtectHome covers /home, /root and /run/user. */
export const SANDBOX_HIDDEN = ["/var/lib/fren-engine", "/etc/fren", "/var/log/fren-update.log", "/run/dbus", "/run/docker.sock", "/var/run/docker.sock", "/run/containerd"];

/** Addresses scripts may not connect to: this machine and anything on its private networks. */
export const SANDBOX_DENY = ["localhost", "link-local", "multicast", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "fc00::/7"];

/** The DNS servers in resolv.conf, so names still resolve with the rest of the private ranges shut. */
export function resolvers(resolvConf: string): string[] {
  const out = new Set<string>([RESOLVED_STUB]);
  for (const line of resolvConf.split("\n")) {
    const m = line.trim().match(/^nameserver\s+([0-9a-fA-F.:]+)(?:%\S+)?\s*$/);
    if (m && !METADATA.has(m[1]!.toLowerCase())) out.add(m[1]!);
  }
  return [...out];
}

export interface SandboxUnitOptions {
  node: string;
  runner: string;
  /** The agent's group: the only one that may open the socket. */
  socketGroup: string;
  dns: string[];
  socket?: string;
}

export function sandboxUnits(o: SandboxUnitOptions): Record<(typeof SANDBOX_UNITS)[number], string> {
  const socket = o.socket ?? SANDBOX_SOCKET;
  const pathEnv = [nodeDir(o.node), "/usr/local/bin", "/usr/bin", "/bin"].filter((d, i, a) => a.indexOf(d) === i).join(":");
  const allow = o.dns.map((ip) => (ip.includes(":") ? `${ip}/128` : `${ip}/32`)).join(" ");
  return {
    "fren-sandbox.socket": `[Unit]
Description=Fren code sandbox (the agent connects here to run a script)

[Socket]
ListenStream=${socket}
SocketUser=root
SocketGroup=${o.socketGroup}
SocketMode=0660
Accept=yes
MaxConnections=3

[Install]
WantedBy=sockets.target
`,
    "fren-sandbox.slice": `[Unit]
Description=Fren code sandbox runs, all together

[Slice]
MemoryMax=1G
MemorySwapMax=256M
CPUQuota=100%
TasksMax=256
`,
    "fren-sandbox@.service": `[Unit]
Description=Fren code sandbox run (no keys, no local services)

[Service]
Slice=fren-sandbox.slice
DynamicUser=yes
User=fren-sandbox
StateDirectory=fren-sandbox
WorkingDirectory=/var/lib/fren-sandbox
Environment=HOME=/var/lib/fren-sandbox
Environment=PATH=${pathEnv}
ExecStart=${o.node} ${o.runner}
StandardInput=socket
StandardOutput=socket
StandardError=journal
RuntimeMaxSec=180
TimeoutStopSec=5
MemoryMax=768M
MemorySwapMax=256M
TasksMax=128
CPUQuota=100%
LimitFSIZE=200M
LimitCORE=0
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
PrivateIPC=yes
ProtectSystem=strict
ProtectHome=yes
ProtectProc=invisible
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RemoveIPC=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
# AF_UNIX for child process pipes, AF_NETLINK for name lookups.
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
IPAddressAllow=${allow}
IPAddressDeny=${SANDBOX_DENY.join(" ")}
InaccessiblePaths=${SANDBOX_HIDDEN.map((p) => `-${p}`).join(" ")}
`,
  };
}

const nodeDir = (node: string) => node.replace(/\/[^/]+$/, "") || "/";

/** One run, over the socket: send the request, half-close, read the answer. */
export function callSandbox(req: SandboxRequest, o: { socket?: string; timeoutMs?: number } = {}): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(o.socket ?? SANDBOX_SOCKET);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => sock.destroy(new Error("The sandbox didn't answer in time.")), o.timeoutMs ?? 200_000);
    sock.on("connect", () => sock.end(JSON.stringify(req)));
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as SandboxResult);
      } catch {
        reject(new Error("The sandbox's answer wasn't readable."));
      }
    });
  });
}

export interface SandboxInstallDeps {
  run: Runner;
  say(text: string): void;
  uid: number;
  platform: NodeJS.Platform;
  /** Talks to the sandbox for the safety checks (the real socket by default). */
  call?: (req: SandboxRequest) => Promise<SandboxResult>;
}

export interface SandboxInstallOptions {
  agentUser: string;
  agentHome: string;
  node: string;
  /** The built runner (dist/sandbox-runner.js). */
  runnerSource: string;
  undo?: boolean;
  unitDir?: string;
  libDir?: string;
  resolvConf?: string;
}

export async function installSandbox(deps: SandboxInstallDeps, o: SandboxInstallOptions): Promise<void> {
  if (deps.platform !== "linux") throw new Error("The code sandbox is set up on Linux servers only.");
  if (deps.uid !== 0) throw new Error("Run it as root: sudo fren sandbox");
  const unitDir = o.unitDir ?? "/etc/systemd/system";
  const libDir = o.libDir ?? SANDBOX_LIB;

  if (o.undo) {
    await deps.run("systemctl", ["disable", "--now", "fren-sandbox.socket"]);
    for (const u of SANDBOX_UNITS) rmSync(join(unitDir, u), { force: true });
    rmSync(libDir, { recursive: true, force: true });
    await deps.run("systemctl", ["daemon-reload"]);
    deps.say("✓ The code sandbox is off and removed.");
    return;
  }

  if (/^\/(home|root)(\/|$)/.test(o.node)) throw new Error(`Node is in a home folder (${o.node}), which the sandbox can't see. Install Node system-wide and run this again.`);
  if ((await deps.run("systemctl", ["--version"])).code !== 0) throw new Error("The code sandbox needs systemd.");
  const group = await deps.run("id", ["-gn", o.agentUser]);
  if (group.code !== 0 || !group.stdout.trim()) throw new Error(`No user ${o.agentUser}.`);

  mkdirSync(libDir, { recursive: true, mode: 0o755 });
  const runner = join(libDir, "runner.mjs");
  copyFileSync(o.runnerSource, runner);
  await must(deps, "chmod", ["644", runner], "make the runner readable");
  let resolvConf = "";
  try {
    resolvConf = o.resolvConf ?? readFileSync("/etc/resolv.conf", "utf8");
  } catch {
    // No resolv.conf: systemd-resolved's stub is the guess.
  }
  const units = sandboxUnits({ node: o.node, runner, socketGroup: group.stdout.trim(), dns: resolvers(resolvConf) });
  for (const [name, text] of Object.entries(units)) writeFileSync(join(unitDir, name), text);
  await must(deps, "systemctl", ["daemon-reload"], "reload systemd");
  await must(deps, "systemctl", ["enable", "fren-sandbox.socket"], "enable the sandbox");
  await must(deps, "systemctl", ["restart", "fren-sandbox.socket"], "start the sandbox");

  const problem = await safetyCheck(deps.call ?? ((req) => callSandbox(req, { timeoutMs: 60_000 })), o.agentHome);
  if (problem) {
    await deps.run("systemctl", ["disable", "--now", "fren-sandbox.socket"]);
    throw new Error(`The code sandbox failed its safety check (${problem}), so it's off. Everything else works.`);
  }
  deps.say("✓ Code sandbox ready: scripts run with no keys, no local services, and time and memory limits");
}

/** Proves it from inside: code runs, secrets aren't there, this machine's own services aren't reachable. */
export async function safetyCheck(call: (req: SandboxRequest) => Promise<SandboxResult>, agentHome: string): Promise<string | null> {
  let r: SandboxResult;
  try {
    r = await call({ lang: "node", code: "console.log(6 * 7)", timeoutSec: 30 });
  } catch (err) {
    return `it didn't start: ${(err as Error).message}`;
  }
  if (r.error || r.output.trim() !== "42") return `a test script didn't run: ${r.error ?? r.output.trim().slice(0, 200)}`;

  const paths = [join(agentHome, ".fren"), join(agentHome, ".openclaw"), "/var/lib/fren-engine", "/etc/fren", "/root"];
  const look = paths.map((p) => `if ls -A ${shq(p)} >/dev/null 2>&1; then echo "SEEN ${p}"; fi`).join("\n");
  r = await call({ lang: "bash", code: `${look}\necho checked`, timeoutSec: 30 });
  const seen = r.output.match(/^SEEN (.+)$/m);
  if (seen) return `it can see ${seen[1]}`;
  if (!/checked/.test(r.output)) return `the file check didn't run: ${r.error ?? r.output.trim().slice(0, 200)}`;

  // A listener on this machine's loopback: the firewall must keep the sandbox away from it.
  let reached = false;
  const server = createServer((s) => {
    reached = true;
    s.destroy();
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as { port: number }).port;
  try {
    r = await call({
      lang: "node",
      timeoutSec: 30,
      code: `import net from "node:net";
const s = net.connect(${port}, "127.0.0.1");
s.on("connect", () => { console.log("REACHED"); process.exit(0); });
s.on("error", (e) => { console.log("BLOCKED " + e.code); process.exit(0); });
setTimeout(() => { console.log("BLOCKED timeout"); process.exit(0); }, 5000);`,
    });
  } finally {
    server.close();
  }
  if (reached || /REACHED/.test(r.output)) return "it can reach services on this machine (the firewall isn't working here)";
  if (!/BLOCKED/.test(r.output)) return `the network check didn't run: ${r.error ?? r.output.trim().slice(0, 200)}`;
  return null;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function must(deps: SandboxInstallDeps, file: string, args: string[], what: string): Promise<void> {
  const r = await deps.run(file, args);
  if (r.code !== 0) throw new Error(`Couldn't ${what}: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")}`);
}
