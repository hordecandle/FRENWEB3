import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "./setup.js";

/**
 * `fren isolate` (Linux, as root): the engine and its signer move to their own
 * system user, so the OpenClaw gateway (and any prompt injection inside it)
 * runs as a user that physically can't read the keystore, the passphrase, the
 * database with pending codes or the config. The agent keeps one file: a copy
 * of the API token, which is all the plugin needs (SECURITY_REVIEW C1).
 *
 *   agent user  ~/.fren/          api-token, engine.json (where the rest went)
 *   engine user <engineHome>/.fren/  config.json keystore.json signer.pass fren.sqlite* api-token  (0700)
 *
 * `--undo` moves the files back, for `fren setup` to run again; the service
 * wrapper does that round trip by itself on a VPS.
 */

export const ENGINE_USER = "fren-engine";
export const ENGINE_HOME = "/var/lib/fren-engine";
/** The engine's secrets: these never stay where the agent can read them. */
export const SECRET_FILES = ["config.json", "keystore.json", "signer.pass", "fren.sqlite", "fren.sqlite-wal", "fren.sqlite-shm"];

export interface IsolateOptions {
  /** The user OpenClaw runs as (`fren` on a VPS, you on your own computer). */
  agentUser: string;
  agentHome: string;
  engineUser?: string;
  engineHome?: string;
  undo?: boolean;
}

export interface IsolateDeps {
  run: Runner;
  say(text: string): void;
  uid: number;
  platform: NodeJS.Platform;
}

export interface IsolateResult {
  engineUser: string;
  engineFrenHome: string;
  agentFrenHome: string;
  moved: string[];
}

export async function isolate(deps: IsolateDeps, o: IsolateOptions): Promise<IsolateResult> {
  if (deps.platform !== "linux") throw new Error("A separate engine user is set up on Linux only. On a Mac, see docs/SECURITY.md (Same OS user).");
  if (deps.uid !== 0) throw new Error("Run it as root: sudo fren isolate");
  const engineUser = o.engineUser ?? ENGINE_USER;
  const engineHome = o.engineHome ?? ENGINE_HOME;
  if (engineUser === o.agentUser) throw new Error("The engine user must be different from the agent user.");
  const agentDir = join(o.agentHome, ".fren");
  const engineDir = join(engineHome, ".fren");
  const marker = join(agentDir, "engine.json");

  if (o.undo) {
    const moved = moveSecrets(engineDir, agentDir);
    await must(deps, "chown", ["-R", `${o.agentUser}:`, agentDir], "give the files back to the agent user");
    rmSync(marker, { force: true });
    deps.say(`✓ Fren's files are back in ${agentDir} (${moved.join(", ") || "nothing to move"}). Run \`sudo fren isolate\` again after setup.`);
    return { engineUser, engineFrenHome: engineDir, agentFrenHome: agentDir, moved };
  }

  if ((await deps.run("id", ["-u", engineUser])).code !== 0) {
    await must(
      deps,
      "useradd",
      ["--system", "--user-group", "--home-dir", engineHome, "--create-home", "--shell", "/usr/sbin/nologin", "--comment", "Fren engine and signer", engineUser],
      `create the ${engineUser} user`,
    );
    deps.say(`✓ Created system user ${engineUser}`);
  }
  mkdirSync(engineDir, { recursive: true, mode: 0o700 });

  // Never two different wallets: if both sides have a keystore, they must match.
  const a = join(agentDir, "keystore.json");
  const e = join(engineDir, "keystore.json");
  if (existsSync(a) && existsSync(e) && readFileSync(a, "utf8") !== readFileSync(e, "utf8")) {
    throw new Error(`Two different keystores: ${a} and ${e}. Nothing was moved; keep both and ask for help.`);
  }
  const moved = moveSecrets(agentDir, engineDir);
  if (!existsSync(e)) throw new Error(`No keystore in ${agentDir} or ${engineDir}. Run \`fren setup\` first.`);

  // The API token is shared: the engine checks it, the plugin presents it.
  const agentToken = join(agentDir, "api-token");
  const engineToken = join(engineDir, "api-token");
  if (existsSync(agentToken)) copyFileSync(agentToken, engineToken);
  else if (existsSync(engineToken)) copyFileSync(engineToken, agentToken);
  else throw new Error(`No API token in ${agentDir}. Run \`fren setup\` first.`);

  // WhatsApp and other gateway lines: the engine runs `openclaw message send`,
  // which needs the gateway's address and token from OpenClaw's config.
  const ocConfig = join(o.agentHome, ".openclaw", "openclaw.json");
  if (existsSync(ocConfig)) {
    mkdirSync(join(engineHome, ".openclaw"), { recursive: true, mode: 0o700 });
    copyFileSync(ocConfig, join(engineHome, ".openclaw", "openclaw.json"));
  }

  await must(deps, "chown", ["-R", `${engineUser}:${engineUser}`, engineHome], `give ${engineHome} to ${engineUser}`);
  await must(deps, "chmod", ["-R", "go-rwx", engineHome], `lock ${engineHome}`);
  writeFileSync(marker, JSON.stringify({ engineUser, frenHome: engineDir }, null, 2) + "\n", { mode: 0o644 });
  await must(deps, "chown", [`${o.agentUser}:`, marker, agentToken], "hand the token copy to the agent user");
  await must(deps, "chmod", ["600", agentToken], "lock the token copy");

  // Prove it: the agent user must not be able to read any of it.
  for (const f of [...SECRET_FILES.filter((n) => existsSync(join(engineDir, n))), "api-token"]) {
    const r = await deps.run("runuser", ["-u", o.agentUser, "--", "cat", join(engineDir, f)]);
    if (r.code === 0) throw new Error(`${o.agentUser} can still read ${join(engineDir, f)}. Not isolated; check the permissions of ${engineHome}.`);
  }
  deps.say(`✓ Keys, passphrase, database and config now belong to ${engineUser} (${engineDir}); ${o.agentUser} can't read them`);
  return { engineUser, engineFrenHome: engineDir, agentFrenHome: agentDir, moved };
}

function moveSecrets(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true, mode: 0o700 });
  const moved: string[] = [];
  for (const name of SECRET_FILES) {
    const src = join(from, name);
    if (!existsSync(src)) continue;
    const dst = join(to, name);
    try {
      renameSync(src, dst);
    } catch {
      // Different filesystems: copy, then remove the original.
      copyFileSync(src, dst);
      rmSync(src);
    }
    moved.push(name);
  }
  return moved;
}

async function must(deps: IsolateDeps, file: string, args: string[], what: string): Promise<void> {
  const r = await deps.run(file, args);
  if (r.code !== 0) throw new Error(`Couldn't ${what}: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")}`);
}

/** The unit that runs the engine as its own user (VPS and Linux desktops alike). */
export function isolatedEngineUnit(o: { node: string; cli: string; pathEnv: string; engineUser: string; engineHome: string }): string {
  return `[Unit]
Description=Fren engine (policy, signer, watcher) as ${o.engineUser}
After=network-online.target
Wants=network-online.target

[Service]
User=${o.engineUser}
Group=${o.engineUser}
WorkingDirectory=${o.engineHome}
Environment=HOME=${o.engineHome}
Environment=FREN_HOME=${o.engineHome}/.fren
Environment=PATH=${o.pathEnv}
ExecStart=${o.node} ${o.cli} start
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes

[Install]
WantedBy=multi-user.target
`;
}
