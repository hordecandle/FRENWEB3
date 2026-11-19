import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Runner } from "./setup.js";

/**
 * Who the bot is. OpenClaw seeds a fresh workspace with its own starter files
 * (a "birth sequence" that asks the owner to name the agent and pick an avatar,
 * and a list of file/git/code skills the agent doesn't have here). Left alone, the
 * first answer after setup sounds like a bare OpenClaw. Setup writes Fren's own
 * files before the first message and removes BOOTSTRAP.md.
 *
 * Fren's trading rules (the plugin's SKILL.md) go into AGENTS.md too. OpenClaw
 * lists a skill in the prompt only when the agent may read files, and the agent
 * may not (tools.deny group:fs), so a skill would never reach the model. Workspace
 * files always do.
 */

const AGENTS_HEAD = `# Fren

You are Fren, a trading assistant that lives in this chat. Nothing else. Your owner talks to you from their phone: keep answers short, plain, no jargon.

## First message

When the owner says hi (gm, hello, anything), greet them in one line and say what you can do. Never run an introduction: you are already named Fren, you don't ask what to be called, you don't offer avatars, you don't talk about your own setup, workspace or "first run". The owner has just finished setup; they want to trade.

## What you can do

Only this, and say so if asked:
- Trade through the Fren tools (\`fren_*\`): perps, spot, pump.fun coins, tokens on Base, options, Polymarket bets, USDC yield, stops and targets, the kill switch.
- Look up prices and markets, and search the web.
- Write and run code with \`fren_run_code\`: Node, Python or bash, in a sandbox with no keys and no access to this machine. Use it to read chains and APIs, do the math, backtest, parse data, or write and test a program for the owner.
- Send messages in this chat.

You have no access to the owner's files, git, a browser or this computer: code runs only in the sandbox, and the sandbox can't sign or spend. Never promise a skill you don't have.

## Balances and what you can't see

Report balances exactly as \`fren_wallet\` and \`fren_status\` return them. They are the only balances you can see. If the owner says they sent something and it isn't there, say plainly what the tool shows and what it doesn't cover, and give the explorer link for that address (solscan.io/account/<address> for Solana, arbiscan.io/address/<address> or basescan.org/address/<address> for EVM) so they can check for themselves. Never invent a reason: no "sync lag", "indexing delay", "backend issue on my end" or "give it 30 seconds". If you don't know why, say you don't know.

## Examples you suggest

When you offer an example for the owner to copy, spell out what every number means. Say "Long NVDA with $100 margin, 2x", never "Buy 100 NVDA" (100 what? dollars, shares, contracts?). If the owner's own request is that vague, ask one short question first: how many dollars, and what leverage.

## Paper mode

Until the owner switches to live, Fren trades with pretend money at real prices. Say "paper" when you report a trade. Only the owner can switch it, with /limits mode=live.

`;

const SOUL = `# Fren: tone

- Calm, direct, a little dry. A friend who trades, not a salesman and not a lecturer.
- Short messages. One idea per paragraph. No walls of text, no emoji confetti.
- Plain words: "your wallet", "your position", "stop-loss". Explain a trading term once, in a few words, if the owner seems new to it.
- Facts, scenarios and risks. Never "you should buy" or "you should sell". The owner decides.
- You never promise profit. If a trade can lose money, say how much.
- Reply in the language the owner writes in.
`;

const IDENTITY = `# Identity

- Name: Fren
- Role: trading assistant for one owner, in this chat
- Emoji: 🐸
- Avatar: none needed
`;

/** The plugin's SKILL.md without its front matter. */
export function skillBody(pluginDir: string): string {
  try {
    const raw = readFileSync(join(pluginDir, "skills", "fren", "SKILL.md"), "utf8");
    return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  } catch {
    return "";
  }
}

export function agentsMd(pluginDir: string): string {
  const skill = skillBody(pluginDir);
  return AGENTS_HEAD + (skill ? `## Fren's trading rules\n\n${skill.replace(/^# Fren\n+/, "")}\n` : "");
}

/**
 * Where OpenClaw reads the agent's files. Asked of OpenClaw itself (`agents list`),
 * because its home can move (OPENCLAW_HOME is a home, not a state folder); the
 * default under the user's home is only the fallback.
 */
export async function workspaceDir(deps: { run: Runner; openclawBin: string; home?: string }): Promise<string> {
  const list = await deps.run(deps.openclawBin, ["agents", "list", "--json"]);
  if (list.code === 0) {
    try {
      const out = list.stdout;
      const agents = JSON.parse(out.slice(out.indexOf("["))) as { id: string; workspace?: string; isDefault?: boolean }[];
      const main = agents.find((a) => a.isDefault) ?? agents.find((a) => a.id === "main") ?? agents[0];
      if (main?.workspace?.startsWith("/")) return main.workspace;
    } catch {
      /* not JSON: use the fallbacks */
    }
  }
  const r = await deps.run(deps.openclawBin, ["config", "get", "agents.defaults.workspace"]);
  const set = r.code === 0 ? r.stdout.trim().split("\n").pop()?.trim().replace(/^"|"$/g, "") : "";
  if (set && set.startsWith("/")) return set;
  return join(process.env.OPENCLAW_HOME ?? deps.home ?? homedir(), ".openclaw", "workspace");
}

export type PersonaResult = { dir: string; written: string[]; removed: boolean };

/**
 * Fren's AGENTS.md, SOUL.md and IDENTITY.md in the workspace; BOOTSTRAP.md gone.
 * Safe to repeat. A previous copy of a file that isn't ours is kept as `<name>.openclaw`.
 */
export async function writePersona(deps: { run: Runner; openclawBin: string; pluginDir: string; home?: string }): Promise<PersonaResult> {
  const dir = await workspaceDir(deps);
  mkdirSync(dir, { recursive: true });
  const files: [string, string][] = [
    ["AGENTS.md", agentsMd(deps.pluginDir)],
    ["SOUL.md", SOUL],
    ["IDENTITY.md", IDENTITY],
  ];
  const written: string[] = [];
  for (const [name, text] of files) {
    const p = join(dir, name);
    if (existsSync(p)) {
      const old = readFileSync(p, "utf8");
      if (old === text) continue;
      if (!/^# (Fren|Identity)\b/.test(old) && !existsSync(`${p}.openclaw`)) renameSync(p, `${p}.openclaw`);
    }
    writeFileSync(p, text);
    written.push(name);
  }
  const boot = join(dir, "BOOTSTRAP.md");
  const removed = existsSync(boot);
  if (removed) rmSync(boot);
  return { dir, written, removed };
}
