#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readKeystoreAddresses } from "@fren/signer";
import { frenPaths, initFren, loadConfig, parseNotify } from "./config.js";
import { startDaemon } from "./daemon.js";
import { ENGINE_USER, isolate, isolatedEngineUnit } from "./isolate.js";
import { guardExisting, isolatedMarker, runSetup, systemSetupDeps } from "./setup.js";
import { serveSetup } from "./setup-web.js";
import { serveBotBroker } from "./managed-bot.js";
import type { Runner } from "./setup.js";

const HELP = `fren: self-hosted on-chain trading agent backend

  fren init [--network testnet|mainnet] [--notify whatsapp:+15551234567]
            [--telegram-token T --telegram-chat ID]
      Create wallets, an API token and a config in $FREN_HOME (default ~/.fren).
      --notify sends codes and alerts to you on any channel OpenClaw is connected
      to (whatsapp, telegram, signal, discord...); repeat it for a fallback.
  fren setup [--server]
      Guided setup: your AI model, Telegram or WhatsApp, wallets, the OpenClaw
      plugin and a background service. Safe to run again. --server is for the
      VPS installer, which sets up the services itself.
  fren setup --web --token T [--port 7421] [--done-file F]
      The same setup as a page in the browser (for a VPS), on 127.0.0.1,
      for whoever has the token. Writes F when the owner finishes.
      With FREN_BOT_BROKER set, the owner makes their Telegram bot in one tap.
  fren bot-broker [--port 7430]
      The shared manager bot behind one-tap Telegram bots. Needs
      FREN_MANAGER_BOT_TOKEN (bot management on in @BotFather). Run by Fren, not owners.
  fren start
      Run the engine: signer process, local API for OpenClaw and the watcher.
  fren guard
      Put the loop guard on an existing install (setup does it for new ones):
      no background AI turns, a time limit per answer, loop detection, groups
      off, then restart the OpenClaw gateway. Caps per message, minute and day
      live in agentGuard in config.json (see the README).
  fren wallet
      Print wallet addresses.
  fren status
      Ask the running engine for positions and watched conditions.
  sudo fren isolate [--agent-user U] [--service] [--undo]
      Linux: move the keystore, passphrase, database and config to a separate
      system user (fren-engine) that the AI agent's user can't read; the agent
      keeps only a copy of the API token. --service runs the engine as that
      user under systemd. --undo moves the files back (to run setup again).
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const paths = frenPaths();

  switch (cmd) {
    case "init": {
      const { values } = parseArgs({
        args: rest,
        options: {
          network: { type: "string", default: "testnet" },
          "telegram-token": { type: "string" },
          "telegram-chat": { type: "string" },
          notify: { type: "string", multiple: true },
          "solana-rpc": { type: "string" },
        },
      });
      const notify = (values.notify ?? []).map(parseNotify);
      const { config, addresses: a } = initFren(paths, {
        network: values.network as "mainnet" | "testnet",
        solanaRpcUrl: values["solana-rpc"],
        notify,
        telegram:
          values["telegram-token"] && values["telegram-chat"]
            ? { botToken: values["telegram-token"], ownerChatId: values["telegram-chat"] }
            : undefined,
      });
      console.log(`Fren is set up in ${paths.home} (${config.network}, paper mode until you switch it).

Solana wallet:      ${a.solana}
EVM / Hyperliquid:  ${a.evm}
Trading-only key:   ${a.hlAgent}

Next: \`fren start\`, then install the OpenClaw plugin (see README), or run \`fren setup\` for the guided version.`);
      const lines = [...(config.telegram ? ["Telegram (direct)"] : []), ...config.notify.map((n) => `${n.channel} ${n.to}`)];
      if (lines.length) {
        console.log(`\nCodes and alerts go to: ${lines.join(", then ")}.`);
      } else {
        console.log(`\nTip: add --notify whatsapp:+<your number> (or --telegram-token and --telegram-chat) so codes and alerts reach you directly, not through the agent.`);
      }
      return;
    }
    case "setup": {
      const { values } = parseArgs({
        args: rest,
        options: {
          server: { type: "boolean", default: false },
          web: { type: "boolean", default: false },
          token: { type: "string" },
          port: { type: "string" },
          "done-file": { type: "string" },
        },
      });
      if (values.web) {
        const token = values.token ?? process.env.FREN_SETUP_TOKEN;
        if (!token || token.length < 24) throw new Error("--web needs --token (24+ characters) or FREN_SETUP_TOKEN.");
        await serveSetup(systemSetupDeps(paths), {
          token,
          ...(values.port ? { port: Number(values.port) } : {}),
          ...(values["done-file"] ? { doneFile: values["done-file"] } : {}),
        });
        return;
      }
      await runSetup(systemSetupDeps(paths), { server: values.server ?? false });
      return;
    }
    case "bot-broker": {
      const { values } = parseArgs({ args: rest, options: { port: { type: "string" }, host: { type: "string" } } });
      const managerToken = process.env.FREN_MANAGER_BOT_TOKEN;
      if (!managerToken) throw new Error("Set FREN_MANAGER_BOT_TOKEN (the manager bot's token) in the environment.");
      await serveBotBroker({
        managerToken,
        fetchFn: fetch,
        ...(values.port ? { port: Number(values.port) } : {}),
        ...(values.host ? { host: values.host } : {}),
      });
      return;
    }
    case "start":
      await startDaemon(paths);
      return;
    case "isolate": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "agent-user": { type: "string" },
          "engine-user": { type: "string" },
          undo: { type: "boolean", default: false },
          service: { type: "boolean", default: false },
        },
      });
      const agentUser = values["agent-user"] ?? process.env.SUDO_USER ?? "fren";
      const agentHome = execFileSync("getent", ["passwd", agentUser], { encoding: "utf8" }).split(":")[5]!;
      const deps = systemSetupDeps(paths);
      const engineUser = values["engine-user"] ?? ENGINE_USER;
      const res = await isolate(
        { run: deps.run, say: (t) => console.log(t), uid: process.getuid?.() ?? -1, platform: process.platform },
        { agentUser, agentHome, engineUser, undo: values.undo ?? false },
      );
      if (values.service && !values.undo) await installIsolatedService(deps.run, agentUser, engineUser, res.engineFrenHome);
      return;
    }
    case "guard":
      await guardExisting(systemSetupDeps(paths), (t) => console.log(t));
      return;
    case "wallet": {
      if (isolatedMarker(paths)) {
        // The keystore is the engine user's now: ask the engine.
        console.log(await askEngine(paths, "/wallet"));
        return;
      }
      const a = readKeystoreAddresses(paths.keystore);
      console.log(`Solana: ${a.solana}\nEVM:    ${a.evm}\nAgent:  ${a.hlAgent}`);
      return;
    }
    case "status":
      console.log(await askEngine(paths, "/status"));
      return;
    default:
      console.log(HELP);
  }
}

async function askEngine(paths: ReturnType<typeof frenPaths>, route: string): Promise<string> {
  const cfg = loadConfig(paths); // after `fren isolate` there's no config here: defaults
  const token = readFileSync(paths.apiToken, "utf8").trim();
  const res = await fetch(`http://${cfg.api.host}:${cfg.api.port}${route}`, { headers: { authorization: `Bearer ${token}` } });
  return ((await res.json()) as { text: string }).text;
}

/**
 * Root-owned code only: the engine must not run a node or a Fren that the
 * agent's user can rewrite, or that user gets the keys anyway. A runtime that
 * isn't root-owned all the way up is copied to /opt/fren first.
 */
async function installIsolatedService(run: Runner, agentUser: string, engineUser: string, engineFrenHome: string) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  let node = process.execPath;
  let cli = join(appDir, "packages/engine/dist/cli.js");
  if (!rootOwned(node) || !rootOwned(appDir)) {
    // Staged next to it, then swapped: this node or app may be the old /opt/fren.
    await mustRun(run, "rm", ["-rf", "/opt/fren.new"]);
    await mustRun(run, "mkdir", ["-p", "/opt/fren.new/bin"]);
    await mustRun(run, "cp", [node, "/opt/fren.new/bin/node"]);
    await mustRun(run, "cp", ["-a", appDir, "/opt/fren.new/app"]);
    await mustRun(run, "chown", ["-R", "root:root", "/opt/fren.new"]);
    await mustRun(run, "chmod", ["-R", "go-w,a+rX", "/opt/fren.new"]);
    await mustRun(run, "rm", ["-rf", "/opt/fren"]);
    await mustRun(run, "mv", ["/opt/fren.new", "/opt/fren"]);
    node = "/opt/fren/bin/node";
    cli = "/opt/fren/app/packages/engine/dist/cli.js";
    console.log("✓ Copied Fren and Node to /opt/fren (root-owned: the agent's user can't change what the engine runs)");
  }
  // The engine sends WhatsApp and other gateway messages with `openclaw`; only a
  // root-owned one goes on its PATH (else the plugin delivers them instead).
  const dirs = [dirname(node)];
  const oc = whichRootOwned("openclaw");
  if (oc) dirs.push(dirname(oc));
  const pathEnv = [...dirs, "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  const engineHome = dirname(engineFrenHome);
  writeFileSync("/etc/systemd/system/fren.service", isolatedEngineUnit({ node, cli, pathEnv, engineUser, engineHome }));
  // A desktop install had the engine as a user service: that one stops for good.
  const uid = execFileSync("id", ["-u", agentUser], { encoding: "utf8" }).trim();
  await run("runuser", ["-u", agentUser, "--", "env", `XDG_RUNTIME_DIR=/run/user/${uid}`, "systemctl", "--user", "disable", "--now", "fren.service"]);
  await mustRun(run, "systemctl", ["daemon-reload"]);
  await mustRun(run, "systemctl", ["enable", "fren.service"]);
  await mustRun(run, "systemctl", ["restart", "fren.service"]);
  console.log(`✓ Fren engine runs as ${engineUser} (systemd: fren.service)`);
}

function whichRootOwned(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    try {
      const p = join(dir, bin);
      statSync(p);
      return rootOwned(p) && rootOwned(realpathSync(p)) ? p : null;
    } catch {
      /* not here */
    }
  }
  return null;
}

/** The path and every folder above it belong to root and only root can write them. */
function rootOwned(p: string): boolean {
  for (let cur = resolve(p); ; cur = dirname(cur)) {
    const st = statSync(cur);
    if (st.uid !== 0 || (st.mode & 0o022) !== 0) return false;
    if (cur === "/") return true;
  }
}

async function mustRun(run: Runner, file: string, args: string[]) {
  const r = await run(file, args);
  if (r.code !== 0) throw new Error(`${file} ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
