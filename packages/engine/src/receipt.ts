import type { ChartLevel, ChartMark } from "./chart.js";

/**
 * One receipt for everything Fren does: a perp opened or closed, a buy, a
 * sale, a swap, a bridge, a deposit. The same shape for every venue, so the
 * owner always reads it the same way:
 *
 *   ✅ Long ANT opened
 *   Size: 5.66 ANT, $500 at 10x ($50 margin)
 *   Entry: $88.27
 *   ...
 *   ↪ Moved $50.75 USDC from Arbitrum into Hyperliquid · Arbiscan
 *   🔗 Track PnL on Hyperdash · Hyperliquid explorer
 *
 * Proof links are hyperlinks with a name, never pasted URLs.
 */

export interface Link {
  label: string;
  url: string;
}

/** A line of the receipt. Its links go at the end of the line, as names. */
export interface Row {
  text: string;
  links?: Link[];
}

/** What a chart snapshot of this trade needs. Prices are filled in by whoever draws it. */
export interface ChartRequest {
  /** Hyperliquid perp (coin name as Hyperliquid spells it), or a token on a chain. */
  source: { kind: "hyperliquid"; coin: string } | { kind: "token"; network: "solana" | "base" | "arbitrum"; address: string };
  title: string;
  subtitle?: string;
  levels: ChartLevel[];
  marks: ChartMark[];
}

export interface StepReceipt {
  /** ✅ done, 📝 paper, ❌ failed, ⏳ waiting for a token to trade, 👀 armed for later, ⚡ a watched condition fired. */
  icon: string;
  title: string;
  rows: Row[];
  /** Links for following the trade afterwards: position tracker, chart, explorer. */
  links: Link[];
  chart?: ChartRequest;
}

export interface Receipt {
  /** A line above every step, e.g. "📝 Paper mode" or "⚡ Your condition was met". */
  header?: string;
  steps: StepReceipt[];
  /** Lines under the steps (warnings, the code to approve, what's watched). */
  footer?: string[];
}

const URL_RE = /https?:\/\/[^\s)]+/g;

/** A short name for a link, from where it points. */
export function linkLabel(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const tx = /\/tx\//.test(path);
  const names: [RegExp, string][] = [
    [/solscan\.io$/, "Solscan"],
    [/(^|\.)arbiscan\.io$/, "Arbiscan"],
    [/(^|\.)basescan\.org$/, "Basescan"],
    [/(^|\.)polygonscan\.com$/, "Polygonscan"],
    [/(^|\.)etherscan\.io$/, "Etherscan"],
    [/robinhood/, "Robinhood explorer"],
    [/relay\.link$/, "Relay"],
    [/hyperdash\.com$/, "Hyperdash"],
    [/hyperliquid(-testnet)?\.xyz$/, path.startsWith("/explorer") ? "Hyperliquid explorer" : "Hyperliquid"],
    [/dexscreener\.com$/, "DexScreener"],
    [/polymarket\.com$/, "Polymarket"],
    [/derive\.xyz$/, "Derive"],
  ];
  for (const [re, name] of names) if (re.test(host)) return tx && !/Hyperliquid|Relay/.test(name) ? `${name} tx` : name;
  return host;
}

/**
 * Turn a venue's plain line into a receipt row: the URLs come out of the text
 * and become named links ("… · https://solscan.io/tx/…" → "…" + Solscan tx).
 */
export function rowFromText(line: string): Row {
  const urls = line.match(URL_RE) ?? [];
  if (!urls.length) return { text: line.trim() };
  let text = line;
  for (const u of urls) text = text.replace(u, "");
  text = text
    .replace(/\(\s*\)/g, "")
    .replace(/\s*·\s*$/g, "")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s·]+$/, "")
    .trim();
  return { text, links: urls.map((url) => ({ label: linkLabel(url), url: url.replace(/[.,]+$/, "") })) };
}

/** A step's result text (one or more lines) as a receipt, for venues without their own. */
export function receiptFromText(text: string): StepReceipt {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const main = lines.findLast((l) => /^(✅|📝|❌|⏳|👀)/.test(l)) ?? lines.at(-1) ?? "";
  const icon = /^(✅|📝|❌|⏳|👀)/.exec(main)?.[1] ?? "✅";
  const rows = lines.filter((l) => l !== main).map((l) => rowFromText(l.replace(/^(✅|↪)\s*/, "↪ ")));
  const head = rowFromText(main.replace(/^(✅|📝|❌|⏳|👀)\s*(Paper:?\s*)?/, ""));
  return { icon, title: head.text, rows, links: head.links ?? [] };
}

// -- rendering -----------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const anchor = (l: Link) => `<a href="${escapeHtml(l.url).replace(/"/g, "&quot;")}">${escapeHtml(l.label)}</a>`;

/** Telegram HTML: bold titles and named links. */
export function receiptHtml(r: Receipt): string {
  const out: string[] = [];
  if (r.header) out.push(`<b>${escapeHtml(r.header)}</b>`);
  r.steps.forEach((s, i) => {
    if (i > 0 || r.header) out.push("");
    out.push(`${s.icon} <b>${escapeHtml(s.title)}</b>`);
    for (const row of s.rows) out.push(escapeHtml(row.text) + (row.links?.length ? ` · ${row.links.map(anchor).join(" · ")}` : ""));
    if (s.links.length) out.push(`🔗 ${s.links.map(anchor).join(" · ")}`);
  });
  if (r.footer?.length) out.push("", ...r.footer.map(escapeHtml));
  return out.join("\n");
}

/** Plain text for lines without links (WhatsApp, the event log): each link as "Name: url". */
export function receiptPlain(r: Receipt): string {
  const out: string[] = [];
  if (r.header) out.push(r.header);
  r.steps.forEach((s, i) => {
    if (i > 0 || r.header) out.push("");
    out.push(`${s.icon} ${s.title}`);
    for (const row of s.rows) out.push(row.text + (row.links?.length ? ` · ${row.links.map((l) => `${l.label}: ${l.url}`).join(" · ")}` : ""));
    if (s.links.length) out.push(...s.links.map((l) => `🔗 ${l.label}: ${l.url}`));
  });
  if (r.footer?.length) out.push("", ...r.footer);
  return out.join("\n");
}

/** Visible length of Telegram HTML (what its caption limit counts). */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot);/g, "x").length;
}
