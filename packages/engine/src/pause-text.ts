import type { PositionView } from "./venues/types.js";

/**
 * The text Fren sends when the owner pauses it. The engine has no model in this path
 * (/fren_stop skips the AI), so the three languages the owner team uses are written out
 * here; anything else gets English. The plugin detects the language from the owner's
 * last chat message (detectLang) and passes it along.
 */
export type Lang = "en" | "ru" | "uk";

export function detectLang(text: string): Lang | null {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return null;
  const cyr = letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length;
  if (cyr / letters.length < 0.5) return "en";
  return /[іїєґІЇЄҐ]/.test(text) ? "uk" : "ru";
}

export function asLang(v: unknown): Lang {
  return v === "ru" || v === "uk" ? v : "en";
}

const T = {
  en: {
    head: "🛑 Paused. No new trades, waiting entries are cancelled.",
    cancelled: (n: number) => `Cancelled ${n} waiting step(s).`,
    untouched: "Your open positions and their stop-loss / take-profit orders stay as they were.",
    none: "You have no open positions.",
    open: "Still open:",
    pnl: "PnL",
    closeAll: "To close the leveraged positions for good, send /close_all (in live it asks for a code: reply /ok).",
    closeOne: "To close just one, ask me, e.g. “close my BTC long” (also needs /ok).",
    spot: "Tokens you hold (not leveraged) are sold only when you ask me to, with /ok.",
    resume: "To turn trading back on, send /resume.",
    unavailable: "I couldn't load your positions right now. Send /positions to see them.",
  },
  ru: {
    head: "🛑 Пауза включена. Новых сделок нет, ожидающие входы отменены.",
    cancelled: (n: number) => `Отменено ожидающих шагов: ${n}.`,
    untouched: "Открытые позиции и их стоп-лосс / тейк-профит остаются как были.",
    none: "Открытых позиций нет.",
    open: "Пока открыто:",
    pnl: "PnL",
    closeAll: "Чтобы закрыть плечевые позиции окончательно, отправь /close_all (в live попросит код: ответь /ok).",
    closeOne: "Закрыть только одну: напиши мне, например «закрой мой лонг BTC» (тоже нужен /ok).",
    spot: "Обычные токены (без плеча) продаются только по твоей просьбе и с /ok.",
    resume: "Чтобы снова включить торговлю, отправь /resume.",
    unavailable: "Сейчас не смог загрузить позиции. Отправь /positions, чтобы посмотреть.",
  },
  uk: {
    head: "🛑 Пауза ввімкнена. Нових угод немає, очікувані входи скасовано.",
    cancelled: (n: number) => `Скасовано очікуваних кроків: ${n}.`,
    untouched: "Відкриті позиції та їхні стоп-лосс / тейк-профіт лишаються як були.",
    none: "Відкритих позицій немає.",
    open: "Поки відкрито:",
    pnl: "PnL",
    closeAll: "Щоб закрити позиції з плечем остаточно, надішли /close_all (у live попросить код: відповідай /ok).",
    closeOne: "Закрити лише одну: напиши мені, наприклад «закрий мій лонг BTC» (теж потрібен /ok).",
    spot: "Звичайні токени (без плеча) продаються лише на твій запит і з /ok.",
    resume: "Щоб знову ввімкнути торгівлю, надішли /resume.",
    unavailable: "Зараз не вдалося завантажити позиції. Надішли /positions, щоб побачити.",
  },
} as const;

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function row(p: PositionView, pnlLabel: string): string {
  const side = p.side === "hold" ? "" : ` ${p.side}`;
  const pnl = p.pnlUsd === null ? "" : `, ${pnlLabel} ${signed(p.pnlUsd)}`;
  return `• ${p.venue}: ${p.symbol}${side}, size ${+p.size.toPrecision(6)}, ${usd(p.valueUsd)}${pnl}`;
}

/** `positions` null = couldn't load them. */
export function pauseMessage(lang: Lang, cancelled: number, positions: PositionView[] | null): string {
  const t = T[lang];
  const out: string[] = [t.head];
  if (cancelled) out.push(t.cancelled(cancelled));
  out.push("");
  if (positions === null) {
    out.push(t.untouched, t.unavailable);
  } else if (positions.length === 0) {
    out.push(t.none);
  } else {
    out.push(t.untouched, "", t.open, ...positions.map((p) => row(p, t.pnl)), "");
    if (positions.some((p) => p.kind === "perp")) out.push(t.closeAll, t.closeOne);
    if (positions.some((p) => p.kind === "spot")) out.push(t.spot);
  }
  out.push("", t.resume);
  return out.join("\n");
}
