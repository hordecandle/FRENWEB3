import { Type, type TSchema } from "typebox";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { definePluginEntry, type OpenClawPluginApi, type OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { EngineClient, setClientLang, type OwnerResult } from "./client.js";
import { LoopGuard, type ToolContext, type TurnContext } from "./guard.js";
import planSchema from "./plan-schema.json" with { type: "json" };
import {
  SANDBOX_BUSY,
  sandboxMissing,
  SandboxBusy,
  SandboxUnavailable,
  formatRun,
  runWhenFree,
  screenshotCode,
  type RunCodeRequest,
  type RunCodeResult,
} from "./sandbox.js";

/**
 * Fren for OpenClaw. The agent gets tools that propose plans and read state;
 * the owner gets slash commands (which bypass the model) for anything that
 * approves, loosens or resumes. Keys stay in the Fren engine's signer process.
 */

export const TOOL_NAMES = [
  "fren_wallet",
  "fren_markets",
  "fren_trade",
  "fren_status",
  "fren_cancel",
  "fren_stop",
  "fren_close_all",
  "fren_limits",
  "fren_deposit_hyperliquid",
  "fren_withdraw_hyperliquid",
  "fren_bet_quote",
  "fren_fund",
  "fren_yield",
  "fren_run_code",
  "fren_settings",
  "fren_chart",
  "fren_screenshot",
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

interface ToolSpec {
  name: ToolName;
  label: string;
  description: string;
  parameters: TSchema;
  run(params: Record<string, unknown>, ctx: OpenClawPluginToolContext): Promise<string>;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: { text: t } });

/**
 * Fren sends the owner each trade's receipt itself (key numbers, named proof
 * links, a chart), straight into the chat. The model keeps the facts but
 * must not post the same thing again.
 */
export const RECEIPT_NOTE =
  "(Fren already sent the owner this result as a receipt in the chat, with the numbers, proof links and a chart when images are on. Don't repeat it or paste any links: reply in one short line, or answer only what they asked.)";

/** The plan and its code are already in the chat as Fren's own message; the model must not retell them. */
export const CODE_NOTE =
  "(The confirmation message, with the plan and the code, is already in the owner's chat. Don't repeat the plan or the code: add at most one short line, entirely in the language the owner writes in.)";

export function withReceiptNote(res: { text: string; receiptSent?: boolean; codeSentPrivately?: boolean }): string {
  if (res.codeSentPrivately) return `${res.text}\n\n${CODE_NOTE}`;
  return res.receiptSent ? `${res.text}\n\n${RECEIPT_NOTE}` : res.text;
}

/** After a picture went to the chat: the model shouldn't say it can't send images, or paste the link again. */
export const PICTURE_NOTE = "It is already in their chat with the link under it: reply in one short line at most, and don't paste links.";

export const SCREENSHOT_MISSING =
  "Fren's browser isn't installed on this server yet. Tell the owner in one line that /fren_update installs it, and use fren_chart for price charts meanwhile.";

/** The browser runs in the sandbox, and the sandbox is Linux-only. */
export const SCREENSHOT_NOT_HERE =
  "Screenshots of web pages aren't possible on this computer: Fren's browser lives in the code sandbox, which only exists on a Linux server. Tell the owner in one line, don't suggest /fren_update, and use fren_chart for price charts.";
const screenshotMissing = () => (process.platform === "linux" ? SCREENSHOT_MISSING : SCREENSHOT_NOT_HERE);

/** Pictures a sandbox run saved in $FREN_OUT, sent to the owner's chat. Returns a line for the model. */
async function sendImages(client: EngineClient, r: RunCodeResult): Promise<string> {
  if (!r.images?.length) return "";
  let ok = 0;
  const problems: string[] = [];
  for (const img of r.images) {
    try {
      const res = await client.call<{ sent: boolean; text: string }>("POST", "/owner/image", { imageBase64: img.base64, name: img.name });
      if (res.sent) ok++;
      else problems.push(res.text);
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  const sent = ok ? `\n(Sent ${ok} picture${ok > 1 ? "s" : ""} from $FREN_OUT to the owner's chat. ${PICTURE_NOTE})` : "";
  return sent + (problems.length ? `\n(Pictures not sent: ${problems[0]})` : "");
}

/**
 * When the engine has no private line to the owner it hands back the code. Send
 * it straight to the conversation and keep it out of the model's tool result.
 */
async function deliverOwnerCode(res: OwnerResult, ctx: OpenClawPluginToolContext): Promise<string> {
  if (!res.ownerCode) return withReceiptNote(res);
  const send = ctx.delivery?.send;
  if (send) {
    await send({ text: `🔐 Fren is waiting for your OK. Reply /ok to approve (code ${res.ownerCode}, never share it).` });
    return `${res.text}\n(The code was sent to the user directly; you do not have it and cannot approve on their behalf.)`;
  }
  return `${res.text}\nNo private channel is set up, so ask the user to run /fren_code to see the code.`;
}

/**
 * Language of the last plain chat message (Cyrillic → ru, or uk with і/ї/є/ґ, else en).
 * /fren_stop skips the model, so the engine needs it to write the pause message in the
 * owner's language. Null until the owner has written something.
 */
type Lang = "en" | "ru" | "uk";
/** Kept next to the engine's token, so a gateway restart doesn't switch a Russian owner to English. */
const langFile = () => join(process.env.FREN_HOME ?? join(homedir(), ".fren"), "owner-lang");
// Tests (vitest) never touch the real owner's file.
const keepLang = !process.env.VITEST;
function savedLang(): Lang | null {
  if (!keepLang) return null;
  try {
    const l = readFileSync(langFile(), "utf8").trim();
    return l === "en" || l === "ru" || l === "uk" ? l : null;
  } catch {
    return null;
  }
}
let lastLang: Lang | null = savedLang();
setClientLang(lastLang);
export function noteLang(body: unknown) {
  const text = typeof body === "string" ? body : "";
  if (text.trim().startsWith("/")) return;
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return;
  const cyr = letters.filter((c) => /[\u0400-\u04FF]/.test(c)).length;
  const l: Lang = cyr / letters.length < 0.5 ? "en" : /[іїєґІЇЄҐ]/.test(text) ? "uk" : "ru";
  if (l !== lastLang && keepLang)
    try {
      writeFileSync(langFile(), l, { mode: 0o600 });
    } catch {
      /* the next message tries again */
    }
  lastLang = l;
  setClientLang(lastLang);
}
/** Under what was done after /ok, when the receipt with the details is already in the chat. */
const OK_NOTE = { en: "Details and links are in the receipt I sent just before this.", ru: "Детали и ссылки в чеке, который я прислал перед этим сообщением.", uk: "Деталі й посилання в чеку, який я надіслав перед цим повідомленням." };
const APPROVED = { en: "✅ Done.", ru: "✅ Готово.", uk: "✅ Готово." };
/**
 * The reply to /ok: what was done, with the sum and the link (the result lines of the
 * engine's text, already in the owner's language), then where the details are. Never just
 * "receipt above": the owner must see from this message alone what happened.
 */
export function approvedReply(text: string, lang: Lang | null): string {
  const done = text
    .split("\n")
    .filter((l) => /^\s*(?:✅|❌|📝|⚡|👀|⏳)/u.test(l))
    .slice(0, 4)
    .map((l) => l.trim());
  return `${done.length ? done.join("\n") : APPROVED[lang ?? "en"]}\n${OK_NOTE[lang ?? "en"]}`;
}
const langBody = () => (lastLang ? { lang: lastLang } : {});
const localizeDashboardHint = () =>
  lastLang === "ru" ? "Отправь /fren_dashboard, пришлю ссылку на дашборд." : lastLang === "uk" ? "Надішли /fren_dashboard, надішлю посилання на дашборд." : "Send /fren_dashboard and I'll send you the dashboard link.";

export function toolSpecs(client: EngineClient, opts: { sandboxSocket?: string; screenshotHelper?: string } = {}): ToolSpec[] {
  return [
    {
      name: "fren_wallet",
      label: "Fren wallet",
      description: "Show the user's Fren wallet addresses, balances, and how to fund them.",
      parameters: Type.Object({}),
      run: async () => (await client.call<{ text: string }>("GET", "/wallet")).text,
    },
    {
      name: "fren_markets",
      label: "Find a market",
      description:
        "Search Hyperliquid perps (crypto, gold, stocks, indices), Solana tokens (pump.fun included), tokens on Base, Robinhood Chain and Arbitrum, and Polymarket bets on events (\"Fed December\", \"bitcoin November\", elections). Call this before fren_trade whenever you are not sure of the exact symbol, mint, contract address or Polymarket slug. When the user asks for Polymarket, use a Polymarket market from here; never swap in a Derive option.",
      parameters: Type.Object({
        query: Type.String({ description: 'What the user called it: "gold", "nasdaq", "BTC", "bonk", a contract address, or event words like "Fed December".' }),
        betUsd: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "For Polymarket: quote what this many dollars buys on Yes in the top markets." })),
      }),
      run: async (p) => {
        const bet = typeof p.betUsd === "number" && p.betUsd > 0 ? `&bet=${p.betUsd}` : "";
        return (await client.call<{ text: string }>("GET", `/markets?q=${encodeURIComponent(String(p.query))}${bet}`)).text;
      },
    },
    {
      name: "fren_trade",
      label: "Trade",
      description: [
        "Propose a trading plan built from the user's request. Fren checks it against the user's limits, then either executes it,",
        "asks the user for a confirmation code, or refuses with reasons. Relay the returned text to the user as-is, including its \"📝 Practice mode, no real money\" or live marker: never drop it, the user must always see whether money is real.",
        "If you add a word of your own, describe a stop exactly as the returned plan does (how far the price moves, the dollars lost, the % of what was put in), never in other terms like \"of margin\", so the owner reads one explanation.",
        "One plan can hold several legs; legs with `when` conditions wait for the watcher.",
        'To snipe a launch, add when: [{type:"tradable", venue, chain, token}] with the same contract address.',
        "Never invent token addresses: use one the user gave or one fren_markets returned.",
        "Fren finds the chain of a 0x contract, pays from whichever of the user's wallets has the money (USDC, SOL or ETH, bridging between chains), and asks for a code only above the user's auto-approve amount: just send the trade.",
      ].join(" "),
      parameters: Type.Object({ plan: Type.Unsafe<Record<string, unknown>>(planSchema) }),
      run: async (p, ctx) => deliverOwnerCode(await client.call<OwnerResult>("POST", "/plans", { plan: p.plan }), ctx),
    },
    {
      name: "fren_status",
      label: "Positions",
      description: "Show open positions, watched conditions with live values, pending approvals and today's spend.",
      parameters: Type.Object({}),
      run: async () => (await client.call<{ text: string }>("GET", "/status")).text,
    },
    {
      name: "fren_cancel",
      label: "Cancel plan",
      description: "Cancel a waiting or unconfirmed plan by its id (shown in fren_status).",
      parameters: Type.Object({ planId: Type.String() }),
      run: async (p) => (await client.call<{ text: string }>("POST", "/cancel", { planId: p.planId })).text,
    },
    {
      name: "fren_stop",
      label: "Kill switch",
      description: 'Kill switch for "stop everything": pauses Fren and cancels waiting entries. Open positions and their stops stay as they are. To close them use fren_close_all.',
      parameters: Type.Object({}),
      run: async () => (await client.call<{ text: string }>("POST", "/stop", langBody())).text,
    },
    {
      name: "fren_close_all",
      label: "Close all leveraged positions",
      description: "Close every open leveraged position at market. Only when the owner asks for it; in live mode the owner approves with a code. Spot tokens are not touched.",
      parameters: Type.Object({}),
      run: async () => {
        const res = await client.call<OwnerResult>("POST", "/close_all");
        return res.ownerCode ? ownerReply(res) : withReceiptNote(res);
      },
    },
    {
      name: "fren_limits",
      label: "Limits",
      description:
        "Change the user's trading limits with key=value pairs: maxTradeUsd, maxDailyUsd, maxLeverage, maxOpenPositions, autoApproveUsd, mode (paper|live). Tightening applies at once; loosening sends the user a code. Pass an empty string to read the current limits.",
      parameters: Type.Object({ args: Type.String({ description: 'e.g. "maxTradeUsd=2000 maxLeverage=40"' }) }),
      run: async (p, ctx) => {
        const args = String(p.args ?? "").trim();
        if (!args) return (await client.call<{ text: string }>("GET", "/limits")).text;
        return deliverOwnerCode(await client.call<OwnerResult>("POST", "/limits", { args }), ctx);
      },
    },
    {
      name: "fren_deposit_hyperliquid",
      label: "Fund Hyperliquid",
      description:
        "Move USDC into the user's own Hyperliquid account: from their Arbitrum address when it has the USDC, otherwise straight from their Solana USDC. Not needed before a long or short: fren_trade moves the margin into Hyperliquid by itself. Use this only when the user asks to deposit, and never tell them to deposit first.",
      parameters: Type.Object({ amountUsd: Type.Number({ minimum: 5 }) }),
      run: async (p) => withReceiptNote(await client.call<OwnerResult>("POST", "/deposit/hyperliquid", { amountUsd: p.amountUsd })),
    },
    {
      name: "fren_withdraw_hyperliquid",
      label: "Withdraw from Hyperliquid",
      description:
        "Move USDC out of the user's Hyperliquid account back to their own Arbitrum address (the only place it can go). Leave amountUsd out to take everything that is free. Hyperliquid keeps 1 USDC as its fee and pays out in a few minutes. The owner always approves it with a code. Use it when they ask to withdraw, take money back, or get it off Hyperliquid; never tell them to do it by hand.",
      parameters: Type.Object({ amountUsd: Type.Optional(Type.Number({ exclusiveMinimum: 1, description: "Dollars to withdraw; leave out for everything free." })) }),
      run: async (p, ctx) => deliverOwnerCode(await client.call<OwnerResult>("POST", "/withdraw/hyperliquid", p.amountUsd === undefined ? {} : { amountUsd: p.amountUsd }), ctx),
    },
    {
      name: "fren_bet_quote",
      label: "Quote a price bet",
      description: [
        'Quote a bet on a price target, e.g. "ETH hits $4,000 by December, use $1,000": the best matching call (or put) option on Derive',
        "and the best matching Polymarket market, side by side. Places nothing. Show the owner the comparison as-is; when they pick one,",
        "call fren_trade with the matching plan below the comparison, unchanged.",
      ].join(" "),
      parameters: Type.Object({
        asset: Type.String({ description: 'Underlying ticker, e.g. "ETH", "BTC", "SOL".' }),
        target: Type.Number({ description: "Target price in USD, e.g. 4000." }),
        direction: Type.Union([Type.Literal("above"), Type.Literal("below")], { description: '"above" for hits/reaches/over, "below" for drops/falls/under.' }),
        by: Type.String({ description: 'ISO date the bet is decided by. "By December" means the end of December: 2026-12-31.' }),
        budgetUsd: Type.Number({ minimum: 1, description: "How much the owner wants to put in, in USD." }),
        request: Type.Optional(Type.String({ description: "The owner's message, word for word." })),
      }),
      run: async (p) => {
        const q = await client.call<{ text: string; plans: Record<string, unknown> }>("POST", "/bets/quote", p);
        const plans = Object.entries(q.plans ?? {});
        if (!plans.length) return q.text;
        return `${q.text}\n\n(For you, not the owner: the plan for each choice, to pass to fren_trade as-is.)\n${plans.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}`;
      },
    },
    {
      name: "fren_yield",
      label: "USDC yield",
      description:
        "Show current USDC lending rates on Jupiter Lend, Kamino (Solana) and Aave (Arbitrum, Base), and what the owner has lent where. Read-only; deposits and withdrawals go through fren_trade with an earn leg.",
      parameters: Type.Object({}),
      run: async () => (await client.call<{ text: string }>("GET", "/yield")).text,
    },
    {
      name: "fren_fund",
      label: "Fund options or bets",
      description:
        "Move USDC from the owner's Arbitrum (or Base) address to their own Derive account (options) or Polymarket wallet (bets). Live mode only. Always sends the owner a code to approve.",
      parameters: Type.Object({
        venue: Type.Union([Type.Literal("derive"), Type.Literal("polymarket")]),
        amountUsd: Type.Number({ minimum: 10 }),
      }),
      run: async (p, ctx) => deliverOwnerCode(await client.call<OwnerResult>("POST", "/fund", { venue: p.venue, amountUsd: p.amountUsd }), ctx),
    },
    {
      name: "fren_settings",
      label: "Receipt settings",
      description:
        'Read or change how Fren\'s trade receipts look. images: true or false turns the chart snapshot on receipts on or off ("turn off images", "no more snapshots"). Leave it out to read the current setting.',
      parameters: Type.Object({ images: Type.Optional(Type.Boolean({ description: "Chart snapshots on trade receipts." })) }),
      run: async (p) =>
        typeof p.images === "boolean"
          ? (await client.call<{ text: string }>("POST", "/settings", { images: p.images })).text
          : (await client.call<{ text: string }>("GET", "/settings")).text,
    },
    {
      name: "fren_chart",
      label: "Send a chart",
      description: [
        "Draw a price chart and send it to the owner's chat as a picture, with links to follow it.",
        'Use it whenever they ask to see a chart or "a screenshot of the chart" of a coin: a Hyperliquid perp (market, e.g. "BTC", "xyz:ANT"),',
        "with their open position's entry and liquidation drawn in, or a token on Solana, Base or Arbitrum (token address and chain).",
        "Fren draws it itself from the exchange's candles, so it's fast and always readable. For a picture of a whole web page use fren_screenshot.",
      ].join(" "),
      parameters: Type.Object({
        market: Type.Optional(Type.String({ description: "Hyperliquid market, as fren_markets names it." })),
        token: Type.Optional(Type.String({ description: "Token address (mint on Solana)." })),
        chain: Type.Optional(Type.Union([Type.Literal("solana"), Type.Literal("base"), Type.Literal("arbitrum")])),
        hours: Type.Optional(Type.Number({ minimum: 1, maximum: 720, description: "How far back. Default 6; 24 for a day, 168 for a week." })),
      }),
      run: async (p) => {
        const r = await client.call<{ sent: boolean; text: string }>("POST", "/chart", p);
        return r.sent ? `${r.text} ${PICTURE_NOTE}` : r.text;
      },
    },
    {
      name: "fren_screenshot",
      label: "Screenshot a web page",
      description: [
        "Open a web page in Fren's headless browser and send the owner a screenshot of it, with the link.",
        "Use it when they ask to see a page: their positions and PnL on Hyperdash (https://hyperdash.com/address/<their EVM address>),",
        "a token or a project's site, an explorer page, a tweet, any public https page. The browser runs in the sandbox: no keys, no logins,",
        "nothing on this machine. Sites behind a bot check (DexScreener, some exchanges) may only show that check, and pages that ask you to",
        "accept terms show the popup: say so in one line and offer fren_chart instead. For a price chart, fren_chart is better.",
      ].join(" "),
      parameters: Type.Object({
        url: Type.String({ description: "The page, https://…" }),
        caption: Type.Optional(Type.String({ description: "One short line under the picture." })),
        fullPage: Type.Optional(Type.Boolean({ description: "The whole scrolling page, not just the first screen." })),
        waitSec: Type.Optional(Type.Number({ minimum: 0, maximum: 20, description: "Extra seconds for the page to fill in. Default 6." })),
        mobile: Type.Optional(Type.Boolean({ description: "A phone-sized screen (430 wide) instead of a desktop one." })),
      }),
      run: async (p) => {
        let url: URL;
        try {
          url = new URL(String(p.url ?? ""));
        } catch {
          return "That isn't a web address. Give a full https:// link.";
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http and https pages can be screenshotted.";
        const code = screenshotCode({
          url: url.href,
          ...(p.mobile === true ? { width: 430, height: 932 } : {}),
          ...(typeof p.waitSec === "number" ? { waitSec: p.waitSec } : {}),
          ...(p.fullPage === true ? { fullPage: true } : {}),
        }, opts.screenshotHelper);
        let r: RunCodeResult;
        try {
          r = await runWhenFree({ lang: "node", code, timeoutSec: 90 }, opts.sandboxSocket ? { socket: opts.sandboxSocket } : {});
        } catch (err) {
          if (err instanceof SandboxUnavailable) return screenshotMissing();
          if (err instanceof SandboxBusy) return SANDBOX_BUSY;
          throw err;
        }
        const line = /^SHOT (.+)$/m.exec(r.output ?? "")?.[1];
        const info = line ? (JSON.parse(line) as { ok: boolean; title?: string; finalUrl?: string; error?: string }) : null;
        const image = r.images?.[0];
        if (!info?.ok || !image) {
          if (/No browser is installed|Cannot find module|ERR_MODULE_NOT_FOUND/.test(`${info?.error ?? ""}\n${r.output ?? ""}`)) return SCREENSHOT_MISSING;
          const lastLines = (r.output ?? "").trim().split("\n").filter((l) => !/^Node\.js v/.test(l)).slice(-2).join(" ");
          const why = info?.error ?? r.error ?? (r.timedOut ? "the page took too long" : lastLines);
          return `The screenshot didn't work: ${why.slice(0, 300)}. Tell the owner in one line, and offer fren_chart for a price chart.`;
        }
        const finalUrl = info.finalUrl || url.href;
        const title = (info.title ?? "").trim().slice(0, 120);
        const caption = typeof p.caption === "string" && p.caption.trim() ? p.caption.trim() : `📸 ${title || new URL(finalUrl).hostname}`;
        const sent = await client.call<{ sent: boolean; text: string }>("POST", "/owner/image", {
          imageBase64: image.base64,
          caption,
          links: [{ url: finalUrl }],
          name: "fren-screenshot",
        });
        if (!sent.sent) return sent.text;
        return `Sent the owner a screenshot of "${title || finalUrl}" (${finalUrl}). ${PICTURE_NOTE}`;
      },
    },
    {
      name: "fren_run_code",
      label: "Run code",
      description: [
        "Write a script and run it in Fren's sandbox, and get back what it printed.",
        "The sandbox is a locked-down user of its own: no wallet keys, no Fren engine, nothing on this machine, but the internet is open.",
        "Use it whenever code gets a better answer than guessing: reading chain data from public RPCs and explorers, calling APIs, math, backtests,",
        "parsing data, checking a contract, or writing and testing a program for the owner.",
        "node runs as an ES module (import, top-level await); python3 and bash too. Files stay in the working folder between runs,",
        "so install packages once (npm i viem; python3 -m venv .venv && .venv/bin/pip install pandas) and reuse them. Up to 150 s and 768 MB per run.",
        "It can't sign or spend: anything that moves money still goes through fren_trade.",
        "To show the owner a picture (a chart you plotted, a table as an image), save it as PNG or JPEG in the folder $FREN_OUT",
        "(process.env.FREN_OUT in node, os.environ['FREN_OUT'] in python): up to 4 pictures go straight to their chat when the run ends.",
      ].join(" "),
      parameters: Type.Object({
        language: Type.Union([Type.Literal("node"), Type.Literal("python"), Type.Literal("bash")]),
        code: Type.String({ description: "The whole script. Print what you need to see; long output is cut." }),
        timeoutSec: Type.Optional(Type.Number({ minimum: 1, maximum: 150, description: "Default 60." })),
        reset: Type.Optional(Type.Boolean({ description: "Empty the working folder first (installed packages and saved files go too)." })),
      }),
      run: async (p) => {
        const req: RunCodeRequest = { lang: p.language as RunCodeRequest["lang"], code: String(p.code ?? "") };
        if (typeof p.timeoutSec === "number") req.timeoutSec = p.timeoutSec;
        if (p.reset === true) req.reset = true;
        try {
          const r = await runWhenFree(req, opts.sandboxSocket ? { socket: opts.sandboxSocket } : {});
          const sent = await sendImages(client, r);
          return formatRun(r) + sent;
        } catch (err) {
          if (err instanceof SandboxUnavailable) return sandboxMissing();
          if (err instanceof SandboxBusy) return SANDBOX_BUSY;
          throw err;
        }
      },
    },
  ];
}

function registerTools(api: OpenClawPluginApi, client: EngineClient, opts: { sandboxSocket?: string; screenshotHelper?: string }) {
  for (const spec of toolSpecs(client, opts)) {
    api.registerTool(
      (ctx) => {
        // Only the owner trades. Other people in a group chat never see these tools.
        if (ctx.senderIsOwner === false) return null;
        return {
          name: spec.name,
          label: spec.label,
          description: spec.description,
          parameters: spec.parameters,
          async execute(_id: string, params: Record<string, unknown>) {
            try {
              return text(await spec.run(params ?? {}, ctx));
            } catch (err) {
              return text(`Fren error: ${(err as Error).message}`);
            }
          },
        };
      },
      { name: spec.name },
    );
  }
}

/** The last code handed back when there was no private line, for /fren_code. Command replies never pass through the model. */
let lastOwnerCode: { code: string; at: number } | null = null;

function ownerReply(res: OwnerResult): string {
  if (!res.ownerCode) return res.text;
  lastOwnerCode = { code: res.ownerCode, at: Date.now() };
  return `${res.text}\n\n🔐 Code: ${res.ownerCode} (send /ok ${res.ownerCode})`;
}

/** Channel ids (Telegram user id, WhatsApp number) compared as digits: "telegram:777", "+44 77…", "4477…@s.whatsapp.net". */
const idDigits = (s: unknown) => (typeof s === "string" ? s.replace(/@.*$/, "").replace(/\D/g, "") : "");

/**
 * OpenClaw ≥2026.11 only tells bundled plugins whether the sender is the owner
 * (ctx.senderIsOwner stays undefined for us), so when it's missing we check the
 * allowlisted sender against commands.ownerAllowFrom, which Fren setup writes.
 */
export function isOwner(ctx: { senderIsOwner?: boolean; isAuthorizedSender?: boolean; channel?: string; senderId?: string; from?: string; config?: unknown }): boolean {
  if (typeof ctx.senderIsOwner === "boolean") return ctx.senderIsOwner;
  if (ctx.isAuthorizedSender !== true) return false;
  const owners = (ctx.config as { commands?: { ownerAllowFrom?: unknown } } | undefined)?.commands?.ownerAllowFrom;
  if (!Array.isArray(owners)) return false;
  const channel = (ctx.channel ?? "").toLowerCase();
  const sender = idDigits(ctx.senderId) || idDigits(ctx.from);
  if (!sender) return false;
  return owners.some((o) => {
    if (typeof o !== "string") return false;
    const m = o.match(/^([a-z]+):(.+)$/i);
    if (m && m[1]!.toLowerCase() !== channel) return false;
    return idDigits(m ? m[2] : o) === sender;
  });
}

function registerCommands(api: OpenClawPluginApi, client: EngineClient) {
  const ownerOnly = "Only the owner of this Fren can do that.";
  const guard = async (isOwner: boolean | undefined, run: () => Promise<string>) => {
    if (isOwner !== true) return { text: ownerOnly };
    try {
      return { text: await run() };
    } catch (err) {
      return { text: `Fren error: ${(err as Error).message}` };
    }
  };

  api.registerCommand({
    name: "ok",
    description: "Approve what Fren asked you about. Several waiting: /ok lists them, /ok 2 picks one, /ok all approves all.",
    acceptsArgs: true,
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) =>
      guard(isOwner(ctx), async () => {
        const code = (ctx.args ?? "").trim();
        const res = await client.call<OwnerResult>("POST", "/approve", { code });
        // The receipt with the numbers and links is already in the chat; this reply still says what was done.
        return res.receiptSent ? approvedReply(res.text, lastLang) : res.text;
      }),
  });

  // OpenClaw reserves /stop for itself since 2026.11 (it only aborts the current
  // reply), so the kill switch is /fren_stop; /stop still works on older OpenClaw.
  for (const name of ["fren_stop", "stop"]) {
    api.registerCommand({
      name,
      description: "Kill switch: pause Fren and cancel waiting entries. Open positions and their stops stay. Close them with /close_all.",
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: (ctx) => guard(isOwner(ctx), async () => (await client.call<{ text: string }>("POST", "/stop", langBody())).text),
    });
  }

  api.registerCommand({
    name: "fren_update",
    description: "Update Fren to the latest version. Wallets and settings stay; Fren is offline for a few minutes.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) => guard(isOwner(ctx), async () => (await client.call<{ text: string }>("POST", "/update")).text),
  });

  api.registerCommand({
    name: "close_all",
    description: "Close every leveraged position at market (live: needs the code Fren sends you). Also works while paused.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) => guard(isOwner(ctx), async () => ownerReply(await client.call<OwnerResult>("POST", "/close_all"))),
  });

  api.registerCommand({
    name: "resume",
    description: "Turn Fren back on after /fren_stop.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) => guard(isOwner(ctx), async () => ownerReply(await client.call<OwnerResult>("POST", "/resume"))),
  });

  api.registerCommand({
    name: "limits",
    description: "Show or change Fren limits, e.g. /limits maxTradeUsd=2000 maxLeverage=40 mode=live",
    acceptsArgs: true,
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) =>
      guard(isOwner(ctx), async () => {
        const args = (ctx.args ?? "").trim();
        if (!args) return (await client.call<{ text: string }>("GET", "/limits")).text;
        return ownerReply(await client.call<OwnerResult>("POST", "/limits", { args }));
      }),
  });

  // /fren_images on|off: chart snapshots on trade receipts. Changing it needs no code: it moves no money.
  for (const name of ["fren_images", "fren_snapshots"]) {
    api.registerCommand({
      name,
      description: "Chart snapshots on trade receipts: /fren_images on or /fren_images off. No argument shows the setting.",
      acceptsArgs: true,
      requireAuth: true,
      exposeSenderIsOwner: true,
      handler: (ctx) =>
        guard(isOwner(ctx), async () => {
          const arg = (ctx.args ?? "").trim().toLowerCase();
          if (!arg) return (await client.call<{ text: string }>("GET", "/settings")).text;
          return (await client.call<{ text: string }>("POST", "/settings", { images: arg })).text;
        }),
    });
  }

  api.registerCommand({
    name: "fren_dashboard",
    description: "Get a private one-time login link to your Fren web dashboard.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) =>
      guard(isOwner(ctx), async () => {
        const r = await client.call<{ text: string; link?: string }>("POST", "/dashboard/link", langBody());
        return r.link ? `${r.text}\n${r.link}` : r.text;
      }),
  });

  api.registerCommand({
    name: "positions",
    description: "Fren positions and watched conditions.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) => guard(isOwner(ctx), async () => (await client.call<{ text: string }>("GET", "/status")).text),
  });

  api.registerCommand({
    name: "wallet",
    description: "Fren wallet addresses and how to fund them.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) => guard(isOwner(ctx), async () => (await client.call<{ text: string }>("GET", "/wallet")).text),
  });

  api.registerCommand({
    name: "fren_code",
    description: "Show the latest Fren approval code when no private channel is configured.",
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: (ctx) =>
      guard(isOwner(ctx), async () => {
        if (!lastOwnerCode || Date.now() - lastOwnerCode.at > 10 * 60_000) return "No recent code.";
        return `🔐 Code: ${lastOwnerCode.code} (send /ok ${lastOwnerCode.code})`;
      }),
  });
}

/**
 * OpenClaw's own /dashboard (it sits in the Telegram menu and can't be switched off)
 * asks the AI to build a "session dashboard" with its control-ui skill. The owner means
 * Fren's dashboard, so that turn gets the Fren login link instead, with no AI call.
 */
export function isDashboardRequest(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const b = body.trim();
  if (/^\/dashboard(?:@\w+)?\s*$/i.test(b)) return true;
  return /Create a dashboard for this session\./.test(b) && /control[-_]ui/i.test(b);
}

/** Caps on agent turns and tool calls, see guard.ts. Older hosts without api.on just don't get them. */
export function registerLoopGuard(api: Pick<OpenClawPluginApi, "on">, guard: LoopGuard, client?: Pick<EngineClient, "call">) {
  if (typeof api.on !== "function") return;
  // A hook that throws would let the turn through (claim hooks fail open), so decide inside.
  api.on("before_agent_reply", async (event, ctx) => {
    const body = (event as { cleanedBody?: string }).cleanedBody;
    const turn = ctx as TurnContext;
    if (client && isDashboardRequest(body) && (!turn.trigger || turn.trigger === "user")) {
      const gate = await guard.beforeReply(turn);
      if (gate) return gate;
      try {
        // The link itself goes to the owner's private line; the chat only hears where it is.
        const r = await client.call<{ text: string; link?: string }>("POST", "/dashboard/link", langBody());
        return { handled: true as const, reply: { text: r.link ? localizeDashboardHint() : r.text }, reason: "fren: /dashboard is the Fren dashboard" };
      } catch (err) {
        return { handled: true as const, reply: { text: `Fren error: ${(err as Error).message}` }, reason: "fren: /dashboard failed" };
      }
    }
    noteLang(body);
    return guard.beforeReply(turn);
  }, { priority: 100 });
  api.on("before_tool_call", async (event, ctx) => guard.beforeTool({ ...(ctx as ToolContext), toolName: event.toolName, runId: event.runId ?? ctx.runId }), { priority: 100 });
  api.on("agent_end", async (_event, ctx) => guard.endRun(ctx));
}

/**
 * Before every answer the model gets the engine's live state: what waits for /ok and how
 * the last request ended. Its memory of the chat goes stale (the dashboard's Approve button
 * and expiry happen outside the chat), and it used to say a request "still waits" after it
 * had run. Best effort: a slow or missing engine just leaves the turn as it was.
 */
export function registerStateContext(api: Pick<OpenClawPluginApi, "on">, client: Pick<EngineClient, "call">, waitMs = 3000) {
  if (typeof api.on !== "function") return;
  api.on("before_prompt_build", async () => {
    try {
      const r = await Promise.race([
        client.call<{ text?: string }>("GET", "/agent/context"),
        new Promise<null>((res) => setTimeout(() => res(null), waitMs).unref?.()),
      ]);
      return r?.text ? { prependContext: r.text } : undefined;
    } catch {
      return undefined;
    }
  });
}

/**
 * Tells the engine the gateway is up, so the setup page says "live" only when
 * the bot can answer. The engine may still be starting, so try for a minute.
 */
export function registerReadySignal(api: Pick<OpenClawPluginApi, "on">, client: Pick<EngineClient, "call">, waitMs = 5000, tries = 12) {
  if (typeof api.on !== "function") return;
  api.on("gateway_start", async () => {
    void (async () => {
      for (let i = 0; i < tries; i++) {
        try {
          await client.call("POST", "/gateway/up");
          return;
        } catch {
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    })();
  });
}

export default definePluginEntry({
  id: "fren",
  name: "Fren",
  description: "Trade perps, spot, options and prediction markets from chat. Keys stay in the local Fren engine.",
  register(api) {
    const cfg = (api.pluginConfig ?? {}) as { apiUrl?: string; tokenFile?: string; sandboxSocket?: string; screenshotHelper?: string };
    const client = new EngineClient({
      ...(cfg.apiUrl ? { apiUrl: cfg.apiUrl } : {}),
      ...(cfg.tokenFile ? { tokenFile: cfg.tokenFile } : {}),
    });
    registerTools(api, client, {
      ...(cfg.sandboxSocket ? { sandboxSocket: cfg.sandboxSocket } : {}),
      ...(cfg.screenshotHelper ? { screenshotHelper: cfg.screenshotHelper } : {}),
    });
    const mode = api.registrationMode;
    if (mode !== "cli-metadata" && mode !== "setup-only" && mode !== "tool-discovery") {
      registerCommands(api, client);
      registerLoopGuard(api, new LoopGuard(client), client);
      registerReadySignal(api, client);
      registerStateContext(api, client);
    }
  },
});
