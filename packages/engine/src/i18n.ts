import type { Receipt, StepReceipt } from "./receipt.js";
import { asLang, type Lang } from "./pause-text.js";

/**
 * Everything Fren writes to the owner itself (plan confirmations, receipts, errors)
 * comes out of the engine in English, because the engine has no model. This turns
 * those lines into the owner's language (the plugin passes it with every request;
 * ru and uk, everything else stays English). One message, one language.
 *
 * Lines are matched by their template; a line no rule knows stays English, which is
 * safe, just less pretty. New owner-facing text in the engine: add its rule here.
 */

type Fn = (...g: string[]) => string;
interface Rule {
  re: RegExp;
  ru: Fn;
  uk: Fn;
}

const rules: Rule[] = [
  // approvals
  { re: /^Confirm this plan:$/, ru: () => "Подтверди план:", uk: () => "Підтверди план:" },
  { re: /^Loosen your limits to:$/, ru: () => "Ослабить лимиты до:", uk: () => "Послабити ліміти до:" },
  { re: /^Close (.+) now at market\? Spot tokens stay as they are\.$/, ru: (x) => `Закрыть ${x} сейчас по рынку? Обычные токены не трогаю.`, uk: (x) => `Закрити ${x} зараз за ринком? Звичайні токени не чіпаю.` },
  { re: /^Send (\$[\d.,]+) USDC from Arbitrum to your (.+) account at (\S+)\?$/, ru: (a, v, t) => `Отправить ${a} USDC из Arbitrum на твой счёт ${v} (${t})?`, uk: (a, v, t) => `Надіслати ${a} USDC з Arbitrum на твій рахунок ${v} (${t})?` },
  { re: /^Turn Fren back on\?$/, ru: () => "Снова включить Fren?", uk: () => "Знову ввімкнути Fren?" },
  { re: /^Reply \/ok (\S+) within (\d+) min\.$/, ru: (c, m) => `Ответь /ok ${c} в течение ${m} мин.`, uk: (c, m) => `Відповідай /ok ${c} протягом ${m} хв.` },
  { re: /^I sent you a confirmation code privately\. Reply \/ok <code> to go ahead\.$/, ru: () => "Код подтверждения я отправил тебе в личку. Ответь /ok <код>, чтобы продолжить.", uk: () => "Код підтвердження я надіслав тобі в особисті. Відповідай /ok <код>, щоб продовжити." },
  { re: /^Reply \/ok <code> with the code I just sent you to go ahead\.$/, ru: () => "Ответь /ok <код> с кодом, который я только что прислал.", uk: () => "Відповідай /ok <код> з кодом, який я щойно надіслав." },
  { re: /^That code is wrong or expired\.$/, ru: () => "Код неверный или просрочен.", uk: () => "Код неправильний або прострочений." },
  { re: /^Send \/ok followed by the code I sent you privately\.$/, ru: () => "Отправь /ok и код, который я прислал в личку.", uk: () => "Надішли /ok і код, який я надіслав в особисті." },
  { re: /^That plan is no longer waiting for approval\.$/, ru: () => "Этот план больше не ждёт подтверждения.", uk: () => "Цей план більше не чекає підтвердження." },
  { re: /^Not doing this:$/, ru: () => "Не буду это делать:", uk: () => "Не робитиму цього:" },
  { re: /^Not doing this after all:$/, ru: () => "Всё же не буду это делать:", uk: () => "Все ж не робитиму цього:" },
  { re: /^Couldn't run it after all:$/, ru: () => "Всё же не получилось выполнить:", uk: () => "Все ж не вдалося виконати:" },
  { re: /^Couldn't set that up:$/, ru: () => "Не получилось это подготовить:", uk: () => "Не вдалося це підготувати:" },
  { re: /^✅ Limits updated\.$/, ru: () => "✅ Лимиты обновлены.", uk: () => "✅ Ліміти оновлено." },
  { re: /^✅ Fren is back on\. The watcher is running again\.$/, ru: () => "✅ Fren снова включён. Наблюдение работает.", uk: () => "✅ Fren знову ввімкнено. Спостереження працює." },
  { re: /^📝 Paper mode$/, ru: () => "📝 Тестовый режим (paper)", uk: () => "📝 Тестовий режим (paper)" },
  // plan lines
  { re: /^📝 Practice mode, no real money$/, ru: () => "📝 Тренировка, настоящих денег нет", uk: () => "📝 Тренування, справжніх грошей немає" },
  { re: /^(\s*)🧯 The most you can lose: (\$[\d.,]+), the money this puts in\.(?: Your stop should cut it at about (\$[\d.,]+)\.)?( If the price crashes, other money you keep on Hyperliquid can be used to keep it open\.)?$/,
    ru: (s, a, st, b) => `${s}🧯 Максимум, что можно потерять: ${a}, это деньги, которые сделка вкладывает.${st ? ` Стоп должен остановить потерю примерно на ${st}.` : ""}${b ? " Если цена резко упадёт, остальные деньги на Hyperliquid могут пойти на удержание позиции." : ""}`,
    uk: (s, a, st, b) => `${s}🧯 Максимум, що можна втратити: ${a}, це гроші, які угода вкладає.${st ? ` Стоп має зупинити втрату приблизно на ${st}.` : ""}${b ? " Якщо ціна різко впаде, інші гроші на Hyperliquid можуть піти на утримання позиції." : ""}` },
  { re: /^(\s*)(🟡|🟢|❌) Bet (\$[\d.,]+) that (\S+) goes (up|down), (\d+)× boost on (.+?)(\. .*)?$/,
    ru: (s, i, a, m, d, lev, w, tail) => `${s}${i} Ставка ${a}, что ${m} ${d === "up" ? "вырастет" : "упадёт"}, усиление ×${lev} на ${w}${betExits(tail ?? "", "ru")}`,
    uk: (s, i, a, m, d, lev, w, tail) => `${s}${i} Ставка ${a}, що ${m} ${d === "up" ? "зросте" : "впаде"}, підсилення ×${lev} на ${w}${betExits(tail ?? "", "uk")}` },
  { re: /^(\s*)(🟡|🟢|❌) Lend (.+) of USDC on (.+)$/, ru: (s, i, a, w) => `${s}${i} Положить ${a} USDC в ${w}`, uk: (s, i, a, w) => `${s}${i} Покласти ${a} USDC у ${w}` },
  { re: /^(\s*)(🟡|🟢|❌) Withdraw (.+) from (.+)$/, ru: (s, i, a, w) => `${s}${i} Вывести ${a} из ${w}`, uk: (s, i, a, w) => `${s}${i} Вивести ${a} з ${w}` },
  { re: /^(\s*)(🟡|🟢|❌) Buy (\$[\d.,]+|\d+% of your USDC) of (.+) on (.+)$/, ru: (s, i, a, t, w) => `${s}${i} Купить ${t} на ${a.replace("% of your USDC", "% твоего USDC")} (${w})`, uk: (s, i, a, t, w) => `${s}${i} Купити ${t} на ${a.replace("% of your USDC", "% твого USDC")} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Sell (\d+)% of your (.+) on (.+)$/, ru: (s, i, p, t, w) => `${s}${i} Продать ${p}% твоих ${t} (${w})`, uk: (s, i, p, t, w) => `${s}${i} Продати ${p}% твоїх ${t} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Sell (\$[\d.,]+) of (.+) on (.+)$/, ru: (s, i, a, t, w) => `${s}${i} Продать ${t} на ${a} (${w})`, uk: (s, i, a, t, w) => `${s}${i} Продати ${t} на ${a} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Sell ([\d.,]+) (\S+) on (.+)$/, ru: (s, i, n, t, w) => `${s}${i} Продать ${n} ${t} (${w})`, uk: (s, i, n, t, w) => `${s}${i} Продати ${n} ${t} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) (Long|Short) (\S+) on (\S+): (.+) margin at (\d+x) \((.+) position\)(.*)$/, ru: (s, i, side, m, w, mg, lev, pos, tail) => `${s}${i} ${side === "Long" ? "Лонг" : "Шорт"} ${m} на ${w}: маржа ${mg}, плечо ${lev} (позиция ${pos})${exits(tail, "ru")}`, uk: (s, i, side, m, w, mg, lev, pos, tail) => `${s}${i} ${side === "Long" ? "Лонг" : "Шорт"} ${m} на ${w}: маржа ${mg}, плече ${lev} (позиція ${pos})${exits(tail, "uk")}` },
  { re: /^(\s*)(🟡|🟢|❌) Close (?:(\d+)% of )?your (\S+) position on (.+)$/, ru: (s, i, p, m, w) => `${s}${i} Закрыть ${p ? `${p}% ` : ""}позиции ${m} на ${w}`, uk: (s, i, p, m, w) => `${s}${i} Закрити ${p ? `${p}% ` : ""}позиції ${m} на ${w}` },
  // warnings
  {
    re: /^(\s*)⚠️ Earns about (.+) a year on (.+), variable\. You can take it back any time; Fren also takes it back on its own when a trade needs the cash\.$/,
    ru: (s, r, a) => `${s}⚠️ Доходность около ${r} годовых на ${a}, ставка переменная. Забрать можно в любой момент; Fren и сам заберёт деньги, если они понадобятся для сделки.`,
    uk: (s, r, a) => `${s}⚠️ Дохідність близько ${r} річних на ${a}, ставка змінна. Забрати можна будь-коли; Fren і сам забере гроші, якщо вони знадобляться для угоди.`,
  },
  // receipts
  { re: /^Bought ([\d.,]+) (\S+) for (\$[\d.,]+) at (\$[\d.,]+)$/, ru: (n, t, a, p) => `Куплено ${n} ${t} на ${a} по ${p}`, uk: (n, t, a, p) => `Куплено ${n} ${t} на ${a} за ${p}` },
  { re: /^Sold ([\d.,]+) (\S+) for (\$[\d.,]+) at (\$[\d.,]+)$/, ru: (n, t, a, p) => `Продано ${n} ${t} на ${a} по ${p}`, uk: (n, t, a, p) => `Продано ${n} ${t} на ${a} за ${p}` },
  { re: /^(Long|Short) (\S+) opened$/, ru: (side, m) => `${side === "Long" ? "Лонг" : "Шорт"} ${m} открыт`, uk: (side, m) => `${side === "Long" ? "Лонг" : "Шорт"} ${m} відкрито` },
  { re: /^(Long|Short) (\S+) closed$/, ru: (side, m) => `${side === "Long" ? "Лонг" : "Шорт"} ${m} закрыт`, uk: (side, m) => `${side === "Long" ? "Лонг" : "Шорт"} ${m} закрито` },
  { re: /^Lent (\$[\d.,]+) USDC on (.+?)(?: at ([\d.]+%) a year)?$/, ru: (a, w, r) => `Положено ${a} USDC в ${w}${r ? `, ${r} годовых` : ""}`, uk: (a, w, r) => `Покладено ${a} USDC у ${w}${r ? `, ${r} річних` : ""}` },
  { re: /^Took (\$[\d.,]+) USDC back from (.+)$/, ru: (a, w) => `Забрано ${a} USDC из ${w}`, uk: (a, w) => `Забрано ${a} USDC з ${w}` },
  { re: /^(Bought|Sold) ([\d.,]+) (\S+) on (.+?) for (\$[\d.,]+)(?: at (\$[\d.,]+))?$/, ru: (v, n, t, w, a, p) => `${v === "Bought" ? "Куплено" : "Продано"} ${n} ${t} на ${a}${p ? ` по ${p}` : ""} (${w})`, uk: (v, n, t, w, a, p) => `${v === "Bought" ? "Куплено" : "Продано"} ${n} ${t} на ${a}${p ? ` за ${p}` : ""} (${w})` },
  { re: /^Watching: (.+)$/, ru: (x) => `Слежу: ${x}`, uk: (x) => `Стежу: ${x}` },
  { re: /^Chart on (.+)$/, ru: (x) => `График на ${x}`, uk: (x) => `Графік на ${x}` },
];

function betExits(tail: string, lang: "ru" | "uk"): string {
  const ru = lang === "ru";
  return tail
    .replace(/\. Stop: if (\S+) (falls|rises) ~([\d.]+%), Fren closes it and you lose about (\$[\d.,]+)/g, (_m, mk, dir, pc, usd) => (ru ? `. Стоп: если ${mk} ${dir === "falls" ? "упадёт" : "вырастет"} примерно на ${pc}, Fren закроет, и вы потеряете около ${usd}` : `. Стоп: якщо ${mk} ${dir === "falls" ? "впаде" : "зросте"} приблизно на ${pc}, Fren закриє, і ви втратите близько ${usd}`))
    .replace(/\. Take profit: if (\S+) (rises|falls) ~([\d.]+%), Fren closes it and you win about (\$[\d.,]+)/g, (_m, mk, dir, pc, usd) => (ru ? `. Тейк-профит: если ${mk} ${dir === "rises" ? "вырастет" : "упадёт"} примерно на ${pc}, Fren закроет, и вы выиграете около ${usd}` : `. Тейк-профіт: якщо ${mk} ${dir === "rises" ? "зросте" : "впаде"} приблизно на ${pc}, Fren закриє, і ви виграєте близько ${usd}`))
    .replace(/\. No stop: nothing closes it for you/g, ru ? ". Без стопа: само не закроется" : ". Без стопу: саме не закриється");
}

function exits(tail: string, lang: "ru" | "uk"): string {
  const ru = lang === "ru";
  return tail
    .replace(/stop at -(\d+(?:\.\d+)?)% of margin, (-\$[\d.,]+) \(([\d.]+%) price move\)/g, (_m, p, usd, mv) => (ru ? `стоп на -${p}% от маржи, ${usd} (движение цены ${mv})` : `стоп на -${p}% від маржі, ${usd} (рух ціни ${mv})`))
    .replace(/stop at (\$[\d.,]+)/g, (_m, px) => (ru ? `стоп на ${px}` : `стоп на ${px}`))
    .replace(/take profit at \+(\d+(?:\.\d+)?)%, (\+\$[\d.,]+) \(([\d.]+%) price move\)/g, (_m, p, usd, mv) => (ru ? `тейк-профит на +${p}%, ${usd} (движение цены ${mv})` : `тейк-профіт на +${p}%, ${usd} (рух ціни ${mv})`))
    .replace(/take profit at (\$[\d.,]+)/g, (_m, px) => (ru ? `тейк-профит на ${px}` : `тейк-профіт на ${px}`));
}

/** Translate one line; unknown lines come back unchanged. */
function line(l: string, lang: "ru" | "uk"): string {
  const step = /^Step (\d+): (.+)$/.exec(l);
  if (step) return `${lang === "ru" ? "Шаг" : "Крок"} ${step[1]}: ${line(step[2]!, lang)}`;
  for (const r of rules) {
    const m = r.re.exec(l);
    if (m) return r[lang](...(m.slice(1) as string[]));
  }
  return l;
}

/** Translate a multi-line owner message into `lang` (en = unchanged). */
export function localize(text: string, langIn: unknown): string {
  const lang = asLang(langIn);
  if (lang === "en") return text;
  return text
    .split("\n")
    .map((l) => line(l, lang))
    .join("\n");
}

/** A step or whole receipt in the owner's language (titles, rows, header, footer). */
export function localizeStep(s: StepReceipt, lang: unknown): StepReceipt {
  if (asLang(lang) === "en") return s;
  return { ...s, title: localize(s.title, lang), rows: s.rows.map((r) => ({ ...r, text: localize(r.text, lang) })), links: s.links.map((l) => ({ ...l, label: localize(l.label, lang) })) };
}

export function localizeReceipt(r: Receipt, lang: unknown): Receipt {
  if (asLang(lang) === "en") return r;
  return {
    ...r,
    ...(r.header ? { header: localize(r.header, lang) } : {}),
    steps: r.steps.map((s) => localizeStep(s, lang)),
    ...(r.footer ? { footer: r.footer.map((f) => localize(f, lang)) } : {}),
  };
}

// -- errors ----------------------------------------------------------------------

/** Solana program error codes we've seen, in words. 3012 is Anchor's "account not initialized". */
const CUSTOM_CODES: Record<string, { en: string; ru: string; uk: string }> = {
  "3012": {
    en: "an account this service needs isn't set up in your wallet yet",
    ru: "в твоём кошельке ещё не создан служебный счёт, который нужен этому сервису",
    uk: "у твоєму гаманці ще не створено службовий рахунок, потрібний цьому сервісу",
  },
};

const SAFE = {
  en: "Nothing was sent, so your money is where it was.",
  ru: "Ничего не отправлено, твои деньги на месте.",
  uk: "Нічого не надіслано, твої гроші на місці.",
};
const WHY = { en: "the network refused it", ru: "сеть отклонила операцию", uk: "мережа відхилила операцію" };

/**
 * A raw failure (Solana simulation JSON, error codes) as one plain sentence: what
 * happened, and, when it failed before anything was sent, that the money is untouched.
 * Messages that are already words go through unchanged.
 */
export function humanError(raw: string, langIn: unknown): string {
  const lang = asLang(langIn);
  const sim = /Simulation failed/i.test(raw);
  const code = /"Custom"\s*:\s*(\d+)/.exec(raw)?.[1];
  const looksRaw = /\{\s*"/.test(raw) || /InstructionError/.test(raw);
  if (!sim && !looksRaw) return raw;
  const why = (code && CUSTOM_CODES[code]?.[lang]) || WHY[lang];
  const head = `${why[0]!.toUpperCase()}${why.slice(1)}.`;
  return sim ? `${head} ${SAFE[lang]}` : head;
}
