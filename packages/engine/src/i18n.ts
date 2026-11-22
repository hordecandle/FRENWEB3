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

type L3 = (...g: string[]) => { en: string; ru: string; uk: string };
interface Refusal {
  re: RegExp;
  say: L3;
  /** True when the failure always happens before anything is sent, so the money is untouched. */
  safe: boolean;
}
const t = (en: string, ru: string, uk: string) => ({ en, ru, uk });

/**
 * What exchanges and networks say when they say no, in words, for every venue Fren
 * trades on. Matched against the raw error text (JSON and all); first hit wins.
 */
const REFUSALS: Refusal[] = [
  // Hyperliquid
  { re: /insufficient margin|not enough margin|Insufficient (?:spot )?balance/i, safe: true, say: () => t("Not enough money on Hyperliquid for this trade.", "На Hyperliquid не хватает денег для этой сделки.", "На Hyperliquid не вистачає грошей для цієї угоди.") },
  { re: /minimum value of \$?(\d+)|must have minimum value|below the smallest/i, safe: true, say: (m) => t("The trade is smaller than the exchange's minimum. Try a bigger amount.", "Сделка меньше минимума биржи. Попробуй сумму побольше.", "Угода менша за мінімум біржі. Спробуй більшу суму.") },
  { re: /price too far from (?:oracle|the oracle)|too far from the mark|oracle/i, safe: true, say: () => t("The price moved too far from the market price, so the exchange said no. Ask again for a fresh price.", "Цена ушла слишком далеко от рыночной, и биржа отказала. Попроси сделку заново по свежей цене.", "Ціна пішла надто далеко від ринкової, і біржа відмовила. Попроси угоду знову за свіжою ціною.") },
  { re: /could not immediately match|did not fill immediately|Nothing filled|Order could not|No liquidity/i, safe: true, say: () => t("Nobody took the other side at that price, so nothing was bought or sold. Try again in a moment.", "Никто не взял другую сторону по этой цене, поэтому ничего не куплено и не продано. Попробуй ещё раз чуть позже.", "Ніхто не взяв іншу сторону за цією ціною, тому нічого не куплено й не продано. Спробуй ще раз трохи згодом.") },
  { re: /reduce only|would increase position/i, safe: true, say: () => t("There's no open bet to close that way.", "Нет открытой ставки, которую так можно закрыть.", "Немає відкритої ставки, яку так можна закрити.") },
  { re: /User or API Wallet .* does not exist|does not exist.*(?:account|wallet)|deposit USDC to your Hyperliquid|Could not enable trading/i, safe: true, say: () => t("Your Hyperliquid account has no money yet. Say \"deposit $25 to Hyperliquid\" first.", "На твоём счёте Hyperliquid ещё нет денег. Сначала скажи «положи $25 на Hyperliquid».", "На твоєму рахунку Hyperliquid ще немає грошей. Спочатку скажи «поклади $25 на Hyperliquid».") },
  { re: /too many cumulative requests|rate.?limit|429|Too Many Requests/i, safe: true, say: () => t("The service is busy and asked us to slow down. Try again in a minute.", "Сервис перегружен и просит подождать. Попробуй через минуту.", "Сервіс перевантажений і просить зачекати. Спробуй за хвилину.") },
  { re: /isolated margin|cross margin|leverage.*(?:exceed|max)|max leverage/i, safe: true, say: () => t("That boost is higher than this market allows. Try a lower one.", "Такое усиление выше, чем разрешает этот рынок. Попробуй поменьше.", "Таке підсилення вище, ніж дозволяє цей ринок. Спробуй менше.") },
  // Derive
  { re: /Derive:.*(?:insufficient|not enough)|insufficient (?:collateral|funds) on derive/i, safe: true, say: () => t("Not enough money on Derive for this option. Say \"fund Derive with $X\" first.", "На Derive не хватает денег для этого опциона. Сначала скажи «пополни Derive на $X».", "На Derive не вистачає грошей для цього опціону. Спочатку скажи «поповни Derive на $X».") },
  { re: /Derive:.*(?:rate.?limit|too many)/i, safe: true, say: () => t("Derive is busy. Try again in a minute.", "Derive перегружен. Попробуй через минуту.", "Derive перевантажений. Спробуй за хвилину.") },
  { re: /Derive:.*(?:price|limit).*(?:bound|range|too)|Derive:.*(?:min|size)/i, safe: true, say: () => t("Derive turned the order down: the price or the size is outside what it allows for this option. Ask for a fresh quote.", "Derive отклонил заказ: цена или размер вне допустимого для этого опциона. Попроси свежую котировку.", "Derive відхилив замовлення: ціна або розмір поза допустимим для цього опціону. Попроси свіжу котирування.") },
  { re: /Derive:/i, safe: false, say: () => t("Derive didn't accept the order. Check your Derive balance before trying again.", "Derive не принял заказ. Проверь баланс на Derive, прежде чем пробовать снова.", "Derive не прийняв замовлення. Перевір баланс на Derive, перш ніж пробувати знову.") },
  // Polymarket
  { re: /not enough balance|insufficient (?:balance|allowance)|allowance/i, safe: true, say: () => t("Not enough money on Polymarket for this bet. Say \"fund Polymarket with $X\" first.", "На Polymarket не хватает денег для этой ставки. Сначала скажи «пополни Polymarket на $X».", "На Polymarket не вистачає грошей для цієї ставки. Спочатку скажи «поповни Polymarket на $X».") },
  { re: /(?:FOK|fill.or.kill).*(?:couldn't|could not|not).*fully filled|couldn't be fully filled|no match/i, safe: true, say: () => t("There weren't enough sellers at that price to fill the whole bet, so nothing happened.", "Не нашлось столько продавцов по этой цене, чтобы заполнить всю ставку, поэтому ничего не произошло.", "Не знайшлося стільки продавців за цією ціною, щоб виконати всю ставку, тому нічого не сталося.") },
  { re: /tick size|invalid price|minimum.*(?:size|order)|lower than the minimum/i, safe: true, say: () => t("The bet is smaller than Polymarket's minimum, or the price isn't allowed. Try a bigger amount.", "Ставка меньше минимума Polymarket или цена не подходит. Попробуй сумму побольше.", "Ставка менша за мінімум Polymarket або ціна не підходить. Спробуй більшу суму.") },
  { re: /not (?:available|allowed).*region|geoblock|restricted in your/i, safe: true, say: () => t("Polymarket isn't available where you are.", "Polymarket недоступен там, где ты находишься.", "Polymarket недоступний там, де ти перебуваєш.") },
  { re: /Polymarket refused/i, safe: false, say: () => t("Polymarket didn't accept the bet. Check your Polymarket balance before trying again.", "Polymarket не принял ставку. Проверь баланс на Polymarket, прежде чем пробовать снова.", "Polymarket не прийняв ставку. Перевір баланс на Polymarket, перш ніж пробувати знову.") },
  // Relay and EVM chains (Aave rides on these)
  { re: /No routes? found|no route|NO_SWAP_ROUTES|NO_QUOTES/i, safe: true, say: () => t("Relay found no way to make this swap right now. Try a different amount or try later.", "Relay сейчас не нашёл, как сделать этот обмен. Попробуй другую сумму или позже.", "Relay зараз не знайшов, як зробити цей обмін. Спробуй іншу суму або пізніше.") },
  { re: /insufficient funds for gas|gas required exceeds|intrinsic gas|insufficient funds for intrinsic/i, safe: true, say: () => t("Not enough ETH in the wallet to pay the network fee. Add a little ETH on that network.", "В кошельке не хватает ETH, чтобы оплатить комиссию сети. Добавь немного ETH в этой сети.", "У гаманці не вистачає ETH, щоб оплатити комісію мережі. Додай трохи ETH у цій мережі.") },
  { re: /insufficient funds|exceeds balance|transfer amount exceeds|ERC20: insufficient/i, safe: true, say: () => t("The wallet doesn't hold enough for this.", "В кошельке не хватает денег для этого.", "У гаманці не вистачає грошей для цього.") },
  { re: /slippage|price impact|Too little received|STF|INSUFFICIENT_OUTPUT/i, safe: true, say: () => t("The price moved too much while it was being sent, so it was cancelled. Try again.", "Цена слишком сдвинулась, пока шла сделка, поэтому её отменили. Попробуй ещё раз.", "Ціна надто зсунулася, поки йшла угода, тому її скасовано. Спробуй ще раз.") },
  { re: /supply cap|borrow cap|reserve.*frozen|RESERVE_FROZEN|SUPPLY_CAP_EXCEEDED/i, safe: true, say: () => t("The lending pool is full or paused right now, so it can't take more deposits.", "Пул, куда кладут под процент, сейчас переполнен или на паузе и не принимает вклады.", "Пул, куди кладуть під відсоток, зараз переповнений або на паузі й не приймає внески.") },
  { re: /execution reverted|Transaction reverted|reverted on/i, safe: false, say: () => t("The network rejected the transaction. The fee may have been used, but the amount itself didn't move. Check your balance before trying again.", "Сеть отклонила транзакцию. Комиссия могла списаться, а сама сумма не ушла. Проверь баланс, прежде чем пробовать снова.", "Мережа відхилила транзакцію. Комісія могла списатися, а сама сума не пішла. Перевір баланс, перш ніж пробувати знову.") },
  { re: /Relay can't (?:route|move)/i, safe: true, say: () => t("Relay can't move the money between networks right now. Try again in a few minutes.", "Relay сейчас не может перевести деньги между сетями. Попробуй через несколько минут.", "Relay зараз не може переказати гроші між мережами. Спробуй за кілька хвилин.") },
  // Jupiter, Solana, pump.fun, Kamino
  { re: /"Custom"\s*:\s*(?:6001|0x1771)|0x1771|SlippageToleranceExceeded/i, safe: true, say: () => t("The price moved too much while it was being sent, so it was cancelled. Nothing was spent.", "Цена слишком сдвинулась, пока шла сделка, поэтому её отменили. Ничего не потрачено.", "Ціна надто зсунулася, поки йшла угода, тому її скасовано. Нічого не витрачено.") },
  { re: /"Custom"\s*:\s*1\b|insufficient lamports|custom program error: 0x1\b|Attempt to debit an account/i, safe: true, say: () => t("The Solana wallet doesn't hold enough for this, or not enough SOL for the fee.", "В кошельке Solana не хватает денег для этого или не хватает SOL на комиссию.", "У гаманці Solana не вистачає грошей для цього або не вистачає SOL на комісію.") },
  { re: /Blockhash not found|block height exceeded|expired/i, safe: false, say: () => t("The Solana network was too slow and the transaction expired. Check your balance, then try again.", "Сеть Solana не успела, и транзакция истекла. Проверь баланс, потом попробуй снова.", "Мережа Solana не встигла, і транзакція прострочилась. Перевір баланс, потім спробуй знову.") },
  { re: /Transaction failed on-chain/i, safe: false, say: () => t("The Solana network rejected the transaction. Check your balance before trying again.", "Сеть Solana отклонила транзакцию. Проверь баланс, прежде чем пробовать снова.", "Мережа Solana відхилила транзакцію. Перевір баланс, перш ніж пробувати знову.") },
  { re: /Simulation failed/i, safe: true, say: () => t("the network refused it", "сеть отклонила операцию", "мережа відхилила операцію") },
  { re: /pump\.?fun|bonding curve|curve is complete|migrated/i, safe: true, say: () => t("This coin has just moved off pump.fun's first stage, so it can't be bought that way. Try again in a minute.", "Эта монета только что ушла с первого этапа pump.fun, так её уже не купить. Попробуй через минуту.", "Ця монета щойно пішла з першого етапу pump.fun, так її вже не купити. Спробуй за хвилину.") },
  { re: /Kamino|Jupiter Lend|reserve.*(?:limit|full)/i, safe: false, say: () => t("The lending service didn't accept it. Check your balance before trying again.", "Сервис, где деньги лежат под процент, не принял операцию. Проверь баланс, прежде чем пробовать снова.", "Сервіс, де гроші лежать під відсоток, не прийняв операцію. Перевір баланс, перш ніж пробувати знову.") },
  { re: /Jupiter isn't answering|Jupiter.*(?:5\d\d|timeout|unavailable)/i, safe: true, say: () => t("Jupiter isn't answering right now. Nothing was bought. Try again in a minute.", "Jupiter сейчас не отвечает. Ничего не куплено. Попробуй через минуту.", "Jupiter зараз не відповідає. Нічого не куплено. Спробуй за хвилину.") },
  // our own plain-words refusals, so a Russian or Ukrainian reader doesn't get English in the middle
  { re: /^Practice balance is (\$[\d.,]+)/, safe: true, say: (a) => t(`Your practice balance is ${a}.`, `Твой тренировочный баланс: ${a}.`, `Твій тренувальний баланс: ${a}.`) },
  { re: /Live trading needs wallets|Live Polymarket needs wallets/i, safe: true, say: () => t("Real trades need wallets. Run `fren init` first.", "Для настоящих сделок нужны кошельки. Сначала запусти `fren init`.", "Для справжніх угод потрібні гаманці. Спочатку запусти `fren init`.") },
  { re: /^Nobody is (selling|buying) /i, safe: true, say: (v) => t(`Nobody is ${v} that right now. Try another one, or try later.`, `Сейчас никто не ${v === "selling" ? "продаёт" : "покупает"} это. Попробуй другой вариант или позже.`, `Зараз ніхто не ${v === "selling" ? "продає" : "купує"} це. Спробуй інший варіант або пізніше.`) },
  { re: /isn't taking orders/i, safe: true, say: () => t("That market isn't taking orders right now.", "Этот рынок сейчас не принимает заказы.", "Цей ринок зараз не приймає замовлення.") },
  { re: /^Not enough USDC|no wallet has enough/i, safe: true, say: () => t("There isn't enough USDC in your wallets for this. Check your balance on the dashboard.", "В твоих кошельках не хватает USDC для этого. Баланс виден в дашборде.", "У твоїх гаманцях не вистачає USDC для цього. Баланс видно в дашборді.") },
  { re: /^No price for |couldn't confirm the price data/i, safe: true, say: () => t("Can't get a trustworthy price right now, so Fren isn't trading it. Try again in a minute.", "Сейчас нет надёжной цены, поэтому Fren не торгует этим. Попробуй через минуту.", "Зараз немає надійної ціни, тому Fren цим не торгує. Спробуй за хвилину.") },
  { re: /doesn't know the token/i, safe: true, say: () => t("That coin isn't known to the exchange yet, or isn't trading.", "Эта монета бирже пока не известна или ещё не торгуется.", "Ця монета біржі поки не відома або ще не торгується.") },
];

const looksRawText = (raw: string) => /\{\s*"|InstructionError|0x[0-9a-f]{8,}|Error:|\bat \w+\.\w+/i.test(raw);

/**
 * A failure as one plain sentence in the owner's language: what happened and, when it
 * failed before anything was sent, that the money is untouched. Known refusals from
 * every venue are matched; anything raw (JSON, codes, stack bits) that we don't know
 * becomes a generic line instead of leaking; messages that are already words pass through.
 */
export function humanError(raw: string, langIn: unknown): string {
  const lang = asLang(langIn);
  const code = /"Custom"\s*:\s*(\d+)/.exec(raw)?.[1];
  if (code && CUSTOM_CODES[code]) {
    const why = CUSTOM_CODES[code]![lang];
    const head = `${why[0]!.toUpperCase()}${why.slice(1)}.`;
    return /Simulation failed/i.test(raw) ? `${head} ${SAFE[lang]}` : head;
  }
  for (const r of REFUSALS) {
    const m = r.re.exec(raw);
    if (!m) continue;
    const head = r.say(...m.slice(1).map((x) => x ?? ""))[lang];
    const fromSim = /Simulation failed/i.test(raw);
    const sentence = /[.!?]$/.test(head) ? head : `${head[0]!.toUpperCase()}${head.slice(1)}.`;
    return fromSim && r.safe ? `${sentence} ${SAFE[lang]}` : sentence;
  }
  if (!looksRawText(raw) && !/Simulation failed/i.test(raw)) return raw;
  const why = WHY[lang];
  const head = `${why[0]!.toUpperCase()}${why.slice(1)}.`;
  return /Simulation failed/i.test(raw) ? `${head} ${SAFE[lang]}` : `${head} ${CHECK[lang]}`;
}

const CHECK = {
  en: "I can't tell if anything moved: check your balance before trying again.",
  ru: "Не могу сказать, ушло ли что-то: проверь баланс, прежде чем пробовать снова.",
  uk: "Не можу сказати, чи пішло щось: перевір баланс, перш ніж пробувати знову.",
};
