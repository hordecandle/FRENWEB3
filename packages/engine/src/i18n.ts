import type { ChartRequest, Receipt, StepReceipt } from "./receipt.js";
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

const stepRu = (p: string) => p.replace(/^Step (\d+): /, "Шаг $1: ");
const stepUk = (p: string) => p.replace(/^Step (\d+): /, "Крок $1: ");

const rules: Rule[] = [
  // approvals
  { re: /^Confirm this plan:$/, ru: () => "Подтверди план:", uk: () => "Підтверди план:" },
  { re: /^Loosen your limits to:$/, ru: () => "Ослабить лимиты до:", uk: () => "Послабити ліміти до:" },
  { re: /^Close (.+) now at market\? Spot tokens stay as they are\.$/, ru: (x) => `Закрыть ${x} сейчас по рынку? Обычные токены не трогаю.`, uk: (x) => `Закрити ${x} зараз за ринком? Звичайні токени не чіпаю.` },
  { re: /^Send (\$[\d.,]+) USDC from Arbitrum to your (.+) account at (\S+)\?$/, ru: (a, v, t) => `Отправить ${a} USDC из Arbitrum на твой счёт ${v} (${t})?`, uk: (a, v, t) => `Надіслати ${a} USDC з Arbitrum на твій рахунок ${v} (${t})?` },
  { re: /^Turn Fren back on\?$/, ru: () => "Снова включить Fren?", uk: () => "Знову ввімкнути Fren?" },
  { re: /^Reply \/ok (\S+) within (\d+) min\.$/, ru: (c, m) => `Ответь /ok ${c} в течение ${m} мин.`, uk: (c, m) => `Відповідай /ok ${c} протягом ${m} хв.` },
  { re: /^Reply \/ok within (\d+) min\.$/, ru: (m) => `Ответь /ok в течение ${m} мин.`, uk: (m) => `Відповідай /ok протягом ${m} хв.` },
  { re: /^Reply \/ok within (\d+) min\. (\d+) requests are waiting now: \/ok shows them all\.$/, ru: (m, n) => `Ответь /ok в течение ${m} мин. Сейчас ждут ${n} запроса: /ok покажет все.`, uk: (m, n) => `Відповідай /ok протягом ${m} хв. Зараз чекають ${n} запити: /ok покаже всі.` },
  { re: /^The plan is in my message just above\. Reply \/ok to go ahead\.$/, ru: () => "План в моём сообщении чуть выше. Ответь /ok, чтобы продолжить.", uk: () => "План у моєму повідомленні трохи вище. Відповідай /ok, щоб продовжити." },
  { re: /^Reply \/ok to go ahead\.$/, ru: () => "Ответь /ok, чтобы продолжить.", uk: () => "Відповідай /ok, щоб продовжити." },
  { re: /^That code is wrong or expired\.$/, ru: () => "Код неверный или просрочен.", uk: () => "Код неправильний або прострочений." },
  { re: /^Nothing is waiting for your OK: the last request already went through \((\d\d:\d\d)\):$/, ru: (t) => `Сейчас ничего не ждёт твоего ок: последний запрос уже выполнен (${t}):`, uk: (t) => `Зараз нічого не чекає твого ок: останній запит уже виконано (${t}):` },
  { re: /^Nothing is waiting for your OK: this request ran out at (\d\d:\d\d) \(requests last 10 minutes\) and wasn't done:$/, ru: (t) => `Сейчас ничего не ждёт твоего ок: этот запрос истёк в ${t} (запросы живут 10 минут) и не выполнен:`, uk: (t) => `Зараз нічого не чекає твого ок: цей запит сплив о ${t} (запити живуть 10 хвилин) і не виконаний:` },
  { re: /^Nothing is waiting for your OK: the last request didn't go through \((\d\d:\d\d)\):$/, ru: (t) => `Сейчас ничего не ждёт твоего ок: последний запрос не прошёл (${t}):`, uk: (t) => `Зараз нічого не чекає твого ок: останній запит не пройшов (${t}):` },
  { re: /^Nothing is waiting for your OK: the last request was cancelled \((\d\d:\d\d)\):$/, ru: (t) => `Сейчас ничего не ждёт твоего ок: последний запрос отменён (${t}):`, uk: (t) => `Зараз нічого не чекає твого ок: останній запит скасовано (${t}):` },
  { re: /^Want it again\? Ask me and I'll prepare it anew\.$/, ru: () => "Повторить? Напиши, и я подготовлю заново.", uk: () => "Повторити? Напиши, і я підготую знову." },
  { re: /^Nothing is waiting for your OK right now\.$/, ru: () => "Сейчас ничего не ждёт твоего ок.", uk: () => "Зараз нічого не чекає твого ок." },
  { re: /^Nothing is waiting for your OK now: that request ran out \(codes last 10 minutes\)\. Ask me again if you still want it\.$/, ru: () => "Сейчас ничего не ждёт твоего ок: запрос истёк (он живёт 10 минут). Если ещё нужно, попроси заново.", uk: () => "Зараз нічого не чекає твого ок: запит сплив (він живе 10 хвилин). Якщо ще треба, попроси знову." },
  { re: /^That request ran out \(codes last 10 minutes\)\. Ask me again if you still want it\.$/, ru: () => "Этот запрос истёк (он живёт 10 минут). Если ещё нужно, попроси заново.", uk: () => "Цей запит сплив (він живе 10 хвилин). Якщо ще треба, попроси знову." },
  { re: /^That request already ran out\. Ask me again if you still want it\.$/, ru: () => "Этот запрос уже истёк. Если ещё нужно, попроси заново.", uk: () => "Цей запит уже сплив. Якщо ще треба, попроси знову." },
  { re: /^That code is wrong or expired\. These are waiting for your OK:$/, ru: () => "Код неверный или просрочен. Твоего ок ждут:", uk: () => "Код неправильний або прострочений. Твого ок чекають:" },
  { re: /^That one already ran out\.$/, ru: () => "Этот уже истёк.", uk: () => "Цей уже сплив." },
  { re: /^That one already ran out\. These are still waiting for your OK:$/, ru: () => "Этот уже истёк. Твоего ок ещё ждут:", uk: () => "Цей уже сплив. Твого ок ще чекають:" },
  { re: /^Approve all (\d+)\? They are:$/, ru: (n) => `Подтвердить все (${n})? Вот они:`, uk: (n) => `Підтвердити всі (${n})? Ось вони:` },
  { re: /^(\d+) requests are waiting for your OK:$/, ru: (n) => `Твоего ок ждут запросов: ${n}`, uk: (n) => `Твого ок чекають запитів: ${n}` },
  { re: /^Money they put in or move: (\$[\d.,]+)$/, ru: (a) => `Всего денег в них: ${a}`, uk: (a) => `Усього грошей у них: ${a}` },
  { re: /^Send \/ok all again to go ahead with all of them\. Each one is checked against your limits again first\.$/, ru: () => "Отправь /ok all ещё раз, и я сделаю все. Каждый перед этим заново проверю по твоим лимитам.", uk: () => "Надішли /ok all ще раз, і я зроблю всі. Кожен перед цим знову перевірю за твоїми лімітами." },
  { re: /^Reply \/ok 1 for the first one, and so on, or \/ok all for all (\d+)\.$/, ru: (n) => `Ответь /ok 1 для первого и так далее, или /ok all для всех ${n}.`, uk: (n) => `Відповідай /ok 1 для першого і так далі, або /ok all для всіх ${n}.` },
  { re: /^❌ Ran out before its turn\.$/, ru: () => "❌ Истёк, пока ждал очереди.", uk: () => "❌ Сплив, поки чекав черги." },
  { re: /^Waiting for your OK \(reply \/ok\):$/, ru: () => "Ждёт твоего ок (ответь /ok):", uk: () => "Чекає твого ок (відповідай /ok):" },
  { re: /^Waiting for your OK \(\/ok shows them, \/ok all approves all (\d+)\):$/, ru: (n) => `Ждут твоего ок (/ok покажет, /ok all подтвердит все ${n}):`, uk: (n) => `Чекають твого ок (/ok покаже, /ok all підтвердить усі ${n}):` },
  // labels of waiting requests (the /ok list and /status)
  { re: /^Loosen your limits$/, ru: () => "Ослабить лимиты", uk: () => "Послабити ліміти" },
  { re: /^Turn Fren back on$/, ru: () => "Снова включить Fren", uk: () => "Знову ввімкнути Fren" },
  { re: /^Close (.+) at market$/, ru: (x) => `Закрыть ${x} по рынку`, uk: (x) => `Закрити ${x} за ринком` },
  { re: /^Send (\$[\d.,]+) USDC to your (.+) account$/, ru: (a, v) => `Отправить ${a} USDC на твой счёт ${v}`, uk: (a, v) => `Надіслати ${a} USDC на твій рахунок ${v}` },
  { re: /^Withdraw (\$[\d.,]+) USDC from Hyperliquid to your Arbitrum wallet$/, ru: (a) => `Вывести ${a} USDC из Hyperliquid на твой кошелёк Arbitrum`, uk: (a) => `Вивести ${a} USDC з Hyperliquid на твій гаманець Arbitrum` },
  { re: /^A trade plan$/, ru: () => "План сделки", uk: () => "План угоди" },
  { re: /^Send USDC to a trading account$/, ru: () => "Отправить USDC на торговый счёт", uk: () => "Надіслати USDC на торговий рахунок" },
  { re: /^Close every leveraged position$/, ru: () => "Закрыть все позиции с плечом", uk: () => "Закрити всі позиції з плечем" },
  { re: /^Withdraw USDC from Hyperliquid$/, ru: () => "Вывести USDC из Hyperliquid", uk: () => "Вивести USDC з Hyperliquid" },
  { re: /^⚠️ (\d+) wrong \/ok codes in a row\. To be safe I cancelled every request that was waiting for a code\. If that wasn't you, send \/fren_stop\.$/, ru: (n) => `⚠️ ${n} неверных кодов /ok подряд. На всякий случай я отменил все запросы, которые ждали кода. Если это был не ты, отправь /fren_stop.`, uk: (n) => `⚠️ ${n} неправильних кодів /ok поспіль. Про всяк випадок я скасував усі запити, що чекали коду. Якщо це був не ти, надішли /fren_stop.` },
  { re: /^Too many wrong codes\. Every request waiting for a code was cancelled; ask again for a new one\.$/, ru: () => "Слишком много неверных кодов. Все запросы, ждавшие кода, отменены; попроси заново, придёт новый код.", uk: () => "Забагато неправильних кодів. Усі запити, що чекали коду, скасовано; попроси знову, прийде новий код." },
  // dashboard
  { re: /^Sent you a login link for your dashboard in a separate message\. It works once, for 10 minutes\.$/, ru: () => "Ссылку на дашборд прислал отдельным сообщением. Она одноразовая и работает 10 минут.", uk: () => "Посилання на дашборд надіслав окремим повідомленням. Воно одноразове і працює 10 хвилин." },
  { re: /^Here's your dashboard login link\. It works once, for 10 minutes\. Don't share it\.$/, ru: () => "Вот ссылка на дашборд. Она одноразовая, работает 10 минут. Никому не пересылай.", uk: () => "Ось посилання на дашборд. Воно одноразове, працює 10 хвилин. Нікому не пересилай." },
  { re: /^🔑 Your Fren dashboard:$/, ru: () => "🔑 Твой дашборд Fren:", uk: () => "🔑 Твій дашборд Fren:" },
  { re: /^Works once, for 10 minutes\. Don't share it\.$/, ru: () => "Работает один раз, 10 минут. Никому не пересылай.", uk: () => "Працює один раз, 10 хвилин. Нікому не пересилай." },
  { re: /^🖥 Your Fren dashboard is ready: your balance in dollars, your history, and a short tour\.$/, ru: () => "🖥 Твой дашборд Fren готов: баланс в долларах, история и короткое обучение.", uk: () => "🖥 Твій дашборд Fren готовий: баланс у доларах, історія і коротке навчання." },
  { re: /^(Open it on this computer\. )?The link works once, for 10 minutes\. Later, send \/fren_dashboard for a new one\.$/, ru: (here) => `${here ? "Открой её на этом компьютере. " : ""}Ссылка одноразовая, работает 10 минут. Потом отправь /fren_dashboard, пришлю новую.`, uk: (here) => `${here ? "Відкрий його на цьому комп'ютері. " : ""}Посилання одноразове, працює 10 хвилин. Потім надішли /fren_dashboard, надішлю нове.` },
  { re: /^🖥 You, from the dashboard:$/, ru: () => "🖥 Ты, из дашборда:", uk: () => "🖥 Ти, з дашборда:" },
  { re: /^🖥 You approved it from the dashboard: (.+)$/, ru: (x) => `🖥 Ты одобрил из дашборда: ${x}`, uk: (x) => `🖥 Ти схвалив з дашборда: ${x}` },
  { re: /^🖥 You cancelled it from the dashboard: (.+)$/, ru: (x) => `🖥 Ты отменил из дашборда: ${x}`, uk: (x) => `🖥 Ти скасував з дашборда: ${x}` },
  { re: /^Opened your dashboard in the browser on this computer\.$/, ru: () => "Открыл дашборд в браузере на этом компьютере.", uk: () => "Відкрив дашборд у браузері на цьому комп'ютері." },
  { re: /^No browser here and no private chat line, so there's no safe place to show the link\. Send \/fren_dashboard to your bot\.$/, ru: () => "Здесь нет браузера и личного чата, поэтому ссылку негде безопасно показать. Отправь своему боту /fren_dashboard.", uk: () => "Тут немає браузера й особистого чату, тож посилання ніде безпечно показати. Надішли своєму боту /fren_dashboard." },
  { re: /^The dashboard isn't running on this machine\. Restart Fren, or set FREN_DASHBOARD=on\.$/, ru: () => "Дашборд на этом компьютере не запущен. Перезапусти Fren или включи его настройкой FREN_DASHBOARD=on.", uk: () => "Дашборд на цьому комп'ютері не запущено. Перезапусти Fren або ввімкни його налаштуванням FREN_DASHBOARD=on." },
  { re: /^That plan is no longer waiting for approval\.$/, ru: () => "Этот план больше не ждёт подтверждения.", uk: () => "Цей план більше не чекає підтвердження." },
  { re: /^Not doing this:$/, ru: () => "Не буду это делать:", uk: () => "Не робитиму цього:" },
  { re: /^Not doing this after all:$/, ru: () => "Всё же не буду это делать:", uk: () => "Все ж не робитиму цього:" },
  { re: /^Couldn't run it after all:$/, ru: () => "Всё же не получилось выполнить:", uk: () => "Все ж не вдалося виконати:" },
  { re: /^Couldn't set that up:$/, ru: () => "Не получилось это подготовить:", uk: () => "Не вдалося це підготувати:" },
  { re: /^✅ Limits updated\.$/, ru: () => "✅ Лимиты обновлены.", uk: () => "✅ Ліміти оновлено." },
  { re: /^✅ Fren is back on\. The watcher is running again\.$/, ru: () => "✅ Fren снова включён. Наблюдение работает.", uk: () => "✅ Fren знову ввімкнено. Спостереження працює." },
  { re: /^📝 Paper mode$/, ru: () => "📝 Тестовый режим (paper)", uk: () => "📝 Тестовий режим (paper)" },
  // Kamino: first deposit without SOL for rent (22.11)
  { re: /^((?:Step \d+: )?)Kamino's first deposit opens an account that needs about ([\d.]+) SOL for rent and fees; your Solana wallet has ([\d.]+) SOL\. Nothing was moved\. Add about ([\d.]+) SOL, or lend on Jupiter Lend instead\.$/,
    ru: (p, need, have, add) => `${stepRu(p)}Первый вклад в Kamino открывает счёт, на ренту и комиссии нужно около ${need} SOL, а на кошельке Solana ${have} SOL. Ничего не переведено. Докинь около ${add} SOL или положи в Jupiter Lend.`,
    uk: (p, need, have, add) => `${stepUk(p)}Перший внесок у Kamino відкриває рахунок, на ренту й комісії потрібно близько ${need} SOL, а на гаманці Solana ${have} SOL. Нічого не переказано. Докинь близько ${add} SOL або поклади в Jupiter Lend.` },
  // Hyperliquid: minimum order, money already there, withdrawals (22.11)
  { re: /^((?:Step \d+: )?)Hyperliquid's minimum order is (\$[\d.,]+)(?:, and this one comes to about (\$[\d.,]+))?( \(its stop counts too\))?\. Nothing was moved or opened\.(?: It goes through if you (?:put in (\$[\d.,]+) at (\d+)x)?(?:, or )?(?:keep (\$[\d.,]+) and use (\d+)x)?\.)?$/,
    ru: (p, min, now, st, m, ml, k, kl) => `${stepRu(p)}Минимальный заказ на Hyperliquid ${min}${now ? `, а этот выходит примерно на ${now}` : ""}${st ? " (стоп тоже считается)" : ""}. Ничего не переведено и не открыто.${m || k ? ` Пройдёт, если ${[m ? `вложить ${m} с плечом ${ml}x` : "", k ? `оставить ${k} и взять плечо ${kl}x` : ""].filter(Boolean).join(" или ")}.` : ""}`,
    uk: (p, min, now, st, m, ml, k, kl) => `${stepUk(p)}Мінімальне замовлення на Hyperliquid ${min}${now ? `, а це виходить приблизно на ${now}` : ""}${st ? " (стоп теж рахується)" : ""}. Нічого не переказано й не відкрито.${m || k ? ` Пройде, якщо ${[m ? `вкласти ${m} з плечем ${ml}x` : "", k ? `залишити ${k} і взяти плече ${kl}x` : ""].filter(Boolean).join(" або ")}.` : ""}` },
  { re: /^(\s*↪ )Paid from the (\$[\d.,]+) USDC already on your Hyperliquid account; nothing is moved in\.$/, ru: (p, a) => `${p}Платится из ${a} USDC, которые уже лежат на твоём счёте Hyperliquid; ничего не переводится.`, uk: (p, a) => `${p}Оплачується з ${a} USDC, що вже лежать на твоєму рахунку Hyperliquid; нічого не переказується.` },
  { re: /^(\s*↪ )To pay for it, Fren first moves (\$[\d.,]+) USDC from your Arbitrum wallet into your Hyperliquid account \(it takes about a minute\)\.$/, ru: (p, a) => `${p}Чтобы оплатить, Fren сначала переведёт ${a} USDC с твоего кошелька Arbitrum на счёт Hyperliquid (около минуты).`, uk: (p, a) => `${p}Щоб оплатити, Fren спершу переказує ${a} USDC з твого гаманця Arbitrum на рахунок Hyperliquid (близько хвилини).` },
  { re: /^Withdraw (everything free \((\$[\d.,]+)\)|\$[\d.,]+) USDC from Hyperliquid to your own Arbitrum wallet (\S+)\? Hyperliquid keeps (\$[\d.,]+), so about (\$[\d.,]+) arrives, usually within 5 minutes\.$/,
    ru: (w, all, to, fee, net) => `Вывести ${all ? `всё свободное (${all})` : w} USDC с Hyperliquid на твой кошелёк Arbitrum ${to}? Hyperliquid берёт ${fee}, придёт около ${net}, обычно за 5 минут.`,
    uk: (w, all, to, fee, net) => `Вивести ${all ? `усе вільне (${all})` : w} USDC з Hyperliquid на твій гаманець Arbitrum ${to}? Hyperliquid бере ${fee}, прийде близько ${net}, зазвичай за 5 хвилин.` },
  { re: /^✅ Withdrew (\$[\d.,]+) USDC from Hyperliquid to your Arbitrum wallet\. About (\$[\d.,]+) arrives within about 5 minutes \(Hyperliquid keeps \$1\)\. (\S+)$/, ru: (a, n, l) => `✅ Вывел ${a} USDC с Hyperliquid на твой кошелёк Arbitrum. Придёт около ${n} примерно за 5 минут (Hyperliquid берёт $1). ${l}`, uk: (a, n, l) => `✅ Вивів ${a} USDC з Hyperliquid на твій гаманець Arbitrum. Прийде близько ${n} приблизно за 5 хвилин (Hyperliquid бере $1). ${l}` },
  { re: /^There's (\$[\d.,]+) free on your Hyperliquid account; a withdrawal has to be more than Hyperliquid's (\$[\d.,]+) fee\.$/, ru: (a, f) => `На счёте Hyperliquid свободно ${a}; вывод должен быть больше комиссии Hyperliquid ${f}.`, uk: (a, f) => `На рахунку Hyperliquid вільно ${a}; виведення має бути більшим за комісію Hyperliquid ${f}.` },
  { re: /^Only (\$[\d.,]+) is free on your Hyperliquid account \(money held by open bets can't leave\)\. Withdraw that, or close a bet first\.$/, ru: (a) => `На счёте Hyperliquid свободно только ${a} (деньги под открытыми ставками вывести нельзя). Выведи столько или сначала закрой ставку.`, uk: (a) => `На рахунку Hyperliquid вільно лише ${a} (гроші під відкритими ставками вивести не можна). Виведи стільки або спершу закрий ставку.` },
  { re: /^❌ Only (\$[\d.,]+) is free on Hyperliquid now, not more than its (\$[\d.,]+) fee\. Nothing was withdrawn\.$/, ru: (a, f) => `❌ Сейчас на Hyperliquid свободно только ${a}, не больше комиссии ${f}. Ничего не выведено.`, uk: (a, f) => `❌ Зараз на Hyperliquid вільно лише ${a}, не більше за комісію ${f}. Нічого не виведено.` },
  { re: /^Practice mode has nothing on Hyperliquid to withdraw\. Switch to live first\.$/, ru: () => "В тренировке на Hyperliquid нечего выводить. Сначала включи режим live.", uk: () => "У тренуванні на Hyperliquid нічого виводити. Спершу ввімкни режим live." },
  { re: /^Can't read your Hyperliquid balance right now\. Try again in a minute\.$/, ru: () => "Сейчас не получается прочитать баланс Hyperliquid. Попробуй через минуту.", uk: () => "Зараз не вдається прочитати баланс Hyperliquid. Спробуй за хвилину." },
  // plan lines
  { re: /^📝 Practice mode, no real money$/, ru: () => "📝 Тренировка, настоящих денег нет", uk: () => "📝 Тренування, справжніх грошей немає" },
  { re: /^(\s*)🧯 The most you can lose: (\$[\d.,]+), the money this puts in\.(?: Your stop should cut it at about (\$[\d.,]+)\.)?( If the price crashes, other money you keep on Hyperliquid can be used to keep it open\.)?$/,
    ru: (s, a, st, b) => `${s}🧯 Максимум, что можно потерять: ${a}, это деньги, которые сделка вкладывает.${st ? ` Стоп должен остановить потерю примерно на ${st}.` : ""}${b ? " Если цена резко упадёт, остальные деньги на Hyperliquid могут пойти на удержание позиции." : ""}`,
    uk: (s, a, st, b) => `${s}🧯 Максимум, що можна втратити: ${a}, це гроші, які угода вкладає.${st ? ` Стоп має зупинити втрату приблизно на ${st}.` : ""}${b ? " Якщо ціна різко впаде, інші гроші на Hyperliquid можуть піти на утримання позиції." : ""}` },
  { re: /^(\s*)(🟡|🟢|❌) Bet (\$[\d.,]+) that (\S+) goes (up|down), (\d+)× boost on (.+?)(\. .*)?$/,
    ru: (s, i, a, m, d, lev, w, tail) => `${s}${i} Ставка ${a}, что ${m} ${d === "up" ? "вырастет" : "упадёт"}, усиление ×${lev} на ${w}${betExits(tail ?? "", "ru")}`,
    uk: (s, i, a, m, d, lev, w, tail) => `${s}${i} Ставка ${a}, що ${m} ${d === "up" ? "зросте" : "впаде"}, підсилення ×${lev} на ${w}${betExits(tail ?? "", "uk")}` },
  { re: /^(\s*)(🟡|🟢|❌) Lend (.+?) on (.+)$/, ru: (s, i, a, w) => `${s}${i} Положить ${amtT(a, "ru")} ${whereT(w, "ru", "in")}`, uk: (s, i, a, w) => `${s}${i} Покласти ${amtT(a, "uk")} ${whereT(w, "uk", "in")}` },
  { re: /^(\s*)(🟡|🟢|❌) Withdraw (.+?) from (.+)$/, ru: (s, i, a, w) => `${s}${i} Вывести ${amtT(a, "ru")} ${whereT(w, "ru", "from")}`, uk: (s, i, a, w) => `${s}${i} Вивести ${amtT(a, "uk")} ${whereT(w, "uk", "from")}` },
  // options (Derive) and Polymarket, before the plain Buy and Sell
  { re: /^(\s*)(🟡|🟢|❌) Buy (.+?) of the (.+) on Derive$/, ru: (s, i, a, o) => `${s}${i} Купить опцион ${optT(o, "ru")} на ${amtT(a, "ru")} (Derive)`, uk: (s, i, a, o) => `${s}${i} Купити опціон ${optT(o, "uk")} на ${amtT(a, "uk")} (Derive)` },
  { re: /^(\s*)(🟡|🟢|❌) Sell (?:(\d+)% of your|(\$[\d.,]+) of your) (.+) on Derive$/, ru: (s, i, p, a, o) => `${s}${i} Продать ${p ? `${p}% ` : `на ${a} `}опциона ${optT(o, "ru")} (Derive)`, uk: (s, i, p, a, o) => `${s}${i} Продати ${p ? `${p}% ` : `на ${a} `}опціону ${optT(o, "uk")} (Derive)` },
  { re: /^(\s*)(🟡|🟢|❌) Bet (.+?) on "(.+)" for "(.+)" on Polymarket(?: at up to (\d+)¢ a share)?$/,
    ru: (s, i, a, o, m, c) => `${s}${i} Ставка ${amtT(a, "ru")} на «${o}» в «${m}» (Polymarket)${c ? `, не дороже ${c}¢ за долю` : ""}`,
    uk: (s, i, a, o, m, c) => `${s}${i} Ставка ${amtT(a, "uk")} на «${o}» у «${m}» (Polymarket)${c ? `, не дорожче ${c}¢ за частку` : ""}` },
  { re: /^(\s*)(🟡|🟢|❌) Sell (?:(\d+)% of your|(\$[\d.,]+) of your) "(.+)" shares in "(.+)" on Polymarket$/,
    ru: (s, i, p, a, o, m) => `${s}${i} Продать ${p ? `${p}% долей` : `доли на ${a}`} «${o}» в «${m}» (Polymarket)`,
    uk: (s, i, p, a, o, m) => `${s}${i} Продати ${p ? `${p}% часток` : `частки на ${a}`} «${o}» у «${m}» (Polymarket)` },
  { re: /^(\s*)(🟡|🟢|❌) Buy (\$[\d.,]+|\d+% of your USDC) of (.+) on (.+)$/, ru: (s, i, a, t, w) => `${s}${i} Купить ${t} на ${amtT(a, "ru")} (${w})`, uk: (s, i, a, t, w) => `${s}${i} Купити ${t} на ${amtT(a, "uk")} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Buy ([\d.,]+) of (.+) on (.+)$/, ru: (s, i, n, t, w) => `${s}${i} Купить ${n} ${t} (${w})`, uk: (s, i, n, t, w) => `${s}${i} Купити ${n} ${t} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Sell (\d+)% of your (.+) on (.+)$/, ru: (s, i, p, t, w) => `${s}${i} Продать ${p}% твоих ${t} (${w})`, uk: (s, i, p, t, w) => `${s}${i} Продати ${p}% твоїх ${t} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Sell (\$[\d.,]+) of (.+) on (.+)$/, ru: (s, i, a, t, w) => `${s}${i} Продать ${t} на ${a} (${w})`, uk: (s, i, a, t, w) => `${s}${i} Продати ${t} на ${a} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) Sell ([\d.,]+) (\S+) on (.+)$/, ru: (s, i, n, t, w) => `${s}${i} Продать ${n} ${t} (${w})`, uk: (s, i, n, t, w) => `${s}${i} Продати ${n} ${t} (${w})` },
  { re: /^(\s*)(🟡|🟢|❌) (Long|Short) (\S+) on (\S+): (.+) margin at (\d+x) \((.+) position\)(.*)$/, ru: (s, i, side, m, w, mg, lev, pos, tail) => `${s}${i} ${side === "Long" ? "Лонг" : "Шорт"} ${m} на ${w}: маржа ${mg}, плечо ${lev} (позиция ${pos})${exits(tail, "ru")}`, uk: (s, i, side, m, w, mg, lev, pos, tail) => `${s}${i} ${side === "Long" ? "Лонг" : "Шорт"} ${m} на ${w}: маржа ${mg}, плече ${lev} (позиція ${pos})${exits(tail, "uk")}` },
  { re: /^(\s*)(🟡|🟢|❌) Close (?:(\d+)% of )?your (\S+) (?:position|bet) on (.+)$/, ru: (s, i, p, m, w) => `${s}${i} Закрыть ${p ? `${p}% ставки` : "ставку"} на ${m} (${w})`, uk: (s, i, p, m, w) => `${s}${i} Закрити ${p ? `${p}% ставки` : "ставку"} на ${m} (${w})` },
  // waiting conditions (/status): "✅ BTC price < $90,000 (now $91,000)"
  { re: /^(\s*)(✅|⏳) ((?:\S+ price [<>=]|\S+ funding [<>=]|\S+ starts trading|after \w{3}, ).*?)(?: \((no data yet|now .+|[^()]+)\))?$/, ru: (sp, i, c, n) => `${sp}${i} ${condsT(c, "ru")}${n ? ` (${nowT(n, "ru")})` : ""}`, uk: (sp, i, c, n) => `${sp}${i} ${condsT(c, "uk")}${n ? ` (${nowT(n, "uk")})` : ""}` },
  // /status
  { re: /^🛑 Stopped \(send \/resume to turn back on\)$/, ru: () => "🛑 Остановлен (отправь /resume, чтобы включить)", uk: () => "🛑 Зупинено (надішли /resume, щоб увімкнути)" },
  { re: /^🟢 Live$/, ru: () => "🟢 Работает с настоящими деньгами", uk: () => "🟢 Працює зі справжніми грошима" },
  { re: /^Couldn't load positions: (.+)$/, ru: (e) => `Не получилось загрузить позиции: ${e}`, uk: (e) => `Не вдалося завантажити позиції: ${e}` },
  { re: /^Practice USDC: (\$[\d.,]+)$/, ru: (a) => `Тренировочные USDC: ${a}`, uk: (a) => `Тренувальні USDC: ${a}` },
  { re: /^Positions:$/, ru: () => "Позиции:", uk: () => "Позиції:" },
  { re: /^No open positions\.$/, ru: () => "Открытых позиций нет.", uk: () => "Відкритих позицій немає." },
  { re: /^Watching:$/, ru: () => "Слежу:", uk: () => "Стежу:" },
  { re: /^Spent today: (\$[\d.,]+) of (\$[\d.,]+)$/, ru: (a, b) => `Потрачено сегодня: ${a} из ${b}`, uk: (a, b) => `Витрачено сьогодні: ${a} з ${b}` },
  { re: /^(long|short) ([\d.]+) (\S+) @ (\S+)(?: \(now (\S+)\))?(?:, PnL (\S+))?(?:, liq (\S+))?$/,
    ru: (sd, n, m, e, now, pnl, liq) => `${sd === "long" ? "Лонг" : "Шорт"} ${n} ${m} по ${e}${now ? ` (сейчас ${now})` : ""}${pnl ? `, прибыль ${pnl}` : ""}${liq ? `, ликвидация ${liq}` : ""}`,
    uk: (sd, n, m, e, now, pnl, liq) => `${sd === "long" ? "Лонг" : "Шорт"} ${n} ${m} за ${e}${now ? ` (зараз ${now})` : ""}${pnl ? `, прибуток ${pnl}` : ""}${liq ? `, ліквідація ${liq}` : ""}` },
  { re: /^([\d.]+) contracts of the (\S+) worth (\$[\d.,]+)(?:, PnL (\S+))?$/, ru: (n, o, v, p) => `${n} контрактов ${o} на ${v}${p ? `, прибыль ${p}` : ""}`, uk: (n, o, v, p) => `${n} контрактів ${o} на ${v}${p ? `, прибуток ${p}` : ""}` },
  { re: /^([\d.]+) shares of (.+) worth (\$[\d.,]+)(?:, PnL (\S+))?$/, ru: (n, m, v, p) => `${n} долей «${m}» на ${v}${p ? `, прибыль ${p}` : ""}`, uk: (n, m, v, p) => `${n} часток «${m}» на ${v}${p ? `, прибуток ${p}` : ""}` },
  { re: /^(\$[\d.,]+) USDC lent on (.+?)(?: \(\+(\$[\d.,]+) interest\))?$/, ru: (a, w, i) => `${a} USDC под процентом в ${w}${i ? ` (+${i} процентов)` : ""}`, uk: (a, w, i) => `${a} USDC під відсотком у ${w}${i ? ` (+${i} відсотків)` : ""}` },
  { re: /^([\d.,]+) (\S+) worth (\$[\d.,]+)(?:, PnL (\S+))?$/, ru: (n, t, v, p) => `${n} ${t} на ${v}${p ? `, прибыль ${p}` : ""}`, uk: (n, t, v, p) => `${n} ${t} на ${v}${p ? `, прибуток ${p}` : ""}` },
  { re: /^\[(\S+)\] (.+)$/, ru: (id, x) => `[${id}] ${planLine(x, "ru")}`, uk: (id, x) => `[${id}] ${planLine(x, "uk")}` },
  // /wallet
  { re: /^No wallets yet\. Run `fren init` on the machine Fren runs on\.$/, ru: () => "Кошельков пока нет. Запусти `fren init` на компьютере, где работает Fren.", uk: () => "Гаманців поки немає. Запусти `fren init` на комп'ютері, де працює Fren." },
  { re: /^Your Fren wallets\. Only this machine holds the keys\.$/, ru: () => "Твои кошельки Fren. Ключи есть только на этом компьютере.", uk: () => "Твої гаманці Fren. Ключі є лише на цьому комп'ютері." },
  { re: /^Fund either one: any trade is paid from whichever wallet has the money, and Fren moves it between your own wallets itself\.$/, ru: () => "Пополни любой: сделка оплачивается из того кошелька, где есть деньги, а между твоими кошельками Fren переводит сам.", uk: () => "Поповни будь-який: угода оплачується з того гаманця, де є гроші, а між твоїми гаманцями Fren переказує сам." },
  { re: /^ {2}USDC or SOL, plus about ([\d.]+) SOL for fees\.(?: Balance: (\$[\d.,]+) USDC\.)?(?: SOL: ([\d.]+)\.)?$/,
    ru: (f, b, sol) => `  USDC или SOL, плюс около ${f} SOL на комиссии.${b ? ` Баланс: ${b} USDC.` : ""}${sol ? ` SOL: ${sol}.` : ""}`,
    uk: (f, b, sol) => `  USDC або SOL, плюс близько ${f} SOL на комісії.${b ? ` Баланс: ${b} USDC.` : ""}${sol ? ` SOL: ${sol}.` : ""}` },
  { re: /^ {2}USDC or ETH on Arbitrum or Base, plus about \$1 of ETH for gas\. A long or short moves the USDC into Hyperliquid by itself\.(?: Hyperliquid account value: (\$[\d.,]+)\.)?$/,
    ru: (v) => `  USDC или ETH в Arbitrum или Base, плюс ETH примерно на $1 для комиссий сети. Для лонга или шорта Fren сам переведёт USDC на Hyperliquid.${v ? ` На счёте Hyperliquid: ${v}.` : ""}`,
    uk: (v) => `  USDC або ETH в Arbitrum чи Base, плюс ETH приблизно на $1 для комісій мережі. Для лонга чи шорта Fren сам переказує USDC на Hyperliquid.${v ? ` На рахунку Hyperliquid: ${v}.` : ""}` },
  { re: /^ {2}The same address holds tokens on Base and Robinhood Chain\.(?: USDC: (.+?)\.)?(?: ETH: (.+?)\.)?$/,
    ru: (u, e) => `  На этом же адресе лежат токены в Base и Robinhood Chain.${u ? ` USDC: ${u.replace(/ on /g, " в ")}.` : ""}${e ? ` ETH: ${e.replace(/ on /g, " в ")}.` : ""}`,
    uk: (u, e) => `  На цій самій адресі лежать токени в Base і Robinhood Chain.${u ? ` USDC: ${u.replace(/ on /g, " в ")}.` : ""}${e ? ` ETH: ${e.replace(/ on /g, " в ")}.` : ""}` },
  { re: /^Trading key on Hyperliquid: (\S+) \(can trade, cannot withdraw\)\.$/, ru: (k) => `Торговый ключ на Hyperliquid: ${k} (может торговать, вывести не может).`, uk: (k) => `Торговий ключ на Hyperliquid: ${k} (може торгувати, вивести не може).` },
  { re: /^Trading key on Derive: (\S+) \(option orders only, cannot withdraw\)\.$/, ru: (k) => `Торговый ключ на Derive: ${k} (только заказы на опционы, вывести не может).`, uk: (k) => `Торговий ключ на Derive: ${k} (лише замовлення на опціони, вивести не може).` },
  { re: /^Options \(Derive\) and bets \(Polymarket\) use the same EVM address\. Say "fund Derive with \$500" or "fund Polymarket with \$500" to move USDC there from Arbitrum\.$/,
    ru: () => "Опционы (Derive) и ставки (Polymarket) на том же EVM-адресе. Скажи «пополни Derive на $500» или «пополни Polymarket на $500», и я переведу туда USDC из Arbitrum.",
    uk: () => "Опціони (Derive) і ставки (Polymarket) на тій самій EVM-адресі. Скажи «поповни Derive на $500» або «поповни Polymarket на $500», і я перекажу туди USDC з Arbitrum." },
  // /limits and /fren_images
  { re: /^Mode: (paper|live)( \(stopped\))?$/, ru: (m, st) => `Режим: ${m === "paper" ? "тренировка" : "настоящие деньги"}${st ? " (остановлен)" : ""}`, uk: (m, st) => `Режим: ${m === "paper" ? "тренування" : "справжні гроші"}${st ? " (зупинено)" : ""}` },
  { re: /^Per trade: (\$[\d.,]+) · Per day: (\$[\d.,]+)$/, ru: (a, b) => `На сделку: ${a} · В день: ${b}`, uk: (a, b) => `На угоду: ${a} · На день: ${b}` },
  { re: /^Max leverage: (\d+)x · Max open positions: (\d+)$/, ru: (a, b) => `Плечо до: ${a}x · Открытых позиций до: ${b}`, uk: (a, b) => `Плече до: ${a}x · Відкритих позицій до: ${b}` },
  { re: /^Auto-approve up to: (\$[\d.,]+)$/, ru: (a) => `Без подтверждения до: ${a}`, uk: (a) => `Без підтвердження до: ${a}` },
  { re: /^Venues: (.+)$/, ru: (v) => `Площадки: ${venuesT(v, "ru")}`, uk: (v) => `Майданчики: ${venuesT(v, "uk")}` },
  { re: /^Automatic stop on bets: -(\d+)% of what you put in$/, ru: (p) => `Автостоп на ставках: -${p}% от вложенного`, uk: (p) => `Автостоп на ставках: -${p}% від вкладеного` },
  { re: /^Chart snapshots on trade receipts: (on|off)\. Turn them (?:off with \/fren_images off|on with \/fren_images on)\.$/,
    ru: (o) => (o === "on" ? "Картинки графиков в чеках: включены. Выключить: /fren_images off." : "Картинки графиков в чеках: выключены. Включить: /fren_images on."),
    uk: (o) => (o === "on" ? "Картинки графіків у чеках: увімкнено. Вимкнути: /fren_images off." : "Картинки графіків у чеках: вимкнено. Увімкнути: /fren_images on.") },
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
  { re: /^Moved (\$[\d.,]+) USDC from your Solana wallet into Hyperliquid through Relay(?: \(about (\$[\d.,]+) after Relay's fee\))?$/,
    ru: (a, b) => `Переведено ${a} USDC из кошелька Solana на Hyperliquid через Relay${b ? ` (дойдёт около ${b} после комиссии Relay)` : ""}`,
    uk: (a, b) => `Переведено ${a} USDC з гаманця Solana на Hyperliquid через Relay${b ? ` (дійде близько ${b} після комісії Relay)` : ""}` },
  { re: /^Moved (\$[\d.,]+) USDC from Arbitrum into Hyperliquid$/, ru: (a) => `Переведено ${a} USDC из Arbitrum на Hyperliquid`, uk: (a) => `Переведено ${a} USDC з Arbitrum на Hyperliquid` },
  { re: /^Moved (\$[\d.,]+) USDC to Hyperliquid's (\S+) market$/, ru: (a, d) => `Переведено ${a} USDC на рынок ${d} Hyperliquid`, uk: (a, d) => `Переведено ${a} USDC на ринок ${d} Hyperliquid` },
  { re: /^Bet on (\S+) going (up|down)(?:: ([\d.,]+) \S+ at (\$[\d.,]+) \(moves like (\$[\d.,]+) of \S+\)(.*))?$/,
    ru: (n, d, sz, px, usd, tail) => `Ставка, что ${n} ${d === "up" ? "вырастет" : "упадёт"}${sz ? `: ${sz} ${n} по ${px} (движется как ${usd} в ${n})${exits(tail ?? "", "ru")}` : ""}`,
    uk: (n, d, sz, px, usd, tail) => `Ставка, що ${n} ${d === "up" ? "зросте" : "впаде"}${sz ? `: ${sz} ${n} за ${px} (рухається як ${usd} у ${n})${exits(tail ?? "", "uk")}` : ""}` },
  { re: /^Watching: (.+)$/, ru: (x) => `Слежу: ${x}`, uk: (x) => `Стежу: ${x}` },
  { re: /^Chart on (.+)$/, ru: (x) => `График на ${x}`, uk: (x) => `Графік на ${x}` },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");
/** "Dec 25, 2026" or "Tue, 01 Dec 2026 10:00:00 GMT" → "25.12.2026", "01.12.2026 10:00 UTC". */
function dateT(x: string): string {
  return x
    .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d\d) (\w{3}) (\d{4}) (\d\d:\d\d):\d\d GMT\b/g, (m, d, mo, y, hm) => (MONTHS.includes(mo) ? `${d}.${two(MONTHS.indexOf(mo) + 1)}.${y} ${hm} UTC` : m))
    .replace(/\b(\w{3}) (\d{1,2}), (\d{4})\b/g, (m, mo, d, y) => (MONTHS.includes(mo) ? `${two(Number(d))}.${two(MONTHS.indexOf(mo) + 1)}.${y}` : m));
}

/** An amount from a plan step: "$5.00", "$2.00 of USDC", "all your USDC", "30% of your USDC". */
function amtT(a: string, lang: "ru" | "uk"): string {
  const ru = lang === "ru";
  let m: RegExpExecArray | null;
  if (a === "all your USDC") return ru ? "весь твой USDC" : "весь твій USDC";
  if ((m = /^(\$[\d.,]+) of USDC$/.exec(a))) return `${m[1]} USDC`;
  if ((m = /^(\d+)% of your USDC$/.exec(a))) return ru ? `${m[1]}% твоего USDC` : `${m[1]}% твого USDC`;
  return a;
}

/** Where money is lent or taken from: "the best USDC rate", "your yield", "Aave on Base", "Kamino (Solana)". */
function whereT(w: string, lang: "ru" | "uk", dir: "in" | "from"): string {
  const ru = lang === "ru";
  if (w === "the best USDC rate") return ru ? "туда, где сейчас лучший процент" : "туди, де зараз найкращий відсоток";
  if (w === "your yield") return ru ? "из вкладов под процент" : "з вкладів під відсоток";
  const name = w.replace(/^Aave on (\w+)$/, "Aave ($1)");
  return dir === "in" ? `${ru ? "в" : "у"} ${name}` : `${ru ? "из" : "з"} ${name}`;
}

/** "ETH $4,000 call expiring Dec 25, 2026" → "колл ETH по $4,000, до 25.12.2026". */
function optT(o: string, lang: "ru" | "uk"): string {
  const m = /^(\S+) (\$[\d.,]+) (call|put) expiring (.+)$/.exec(o);
  if (!m) return o;
  const ru = lang === "ru";
  const kind = m[3] === "call" ? (ru ? "колл" : "кол") : ru ? "пут" : "пут";
  return `${kind} ${m[1]} ${ru ? "по" : "за"} ${m[2]}, ${ru ? "до" : "до"} ${dateT(m[4]!)}`;
}

/** One condition of a plan step, from describeCondition. */
function condT(c: string, lang: "ru" | "uk"): string {
  const ru = lang === "ru";
  let m: RegExpExecArray | null;
  if ((m = /^(\S+) price (\S+) (\$[\d.,]+)$/.exec(c))) return `${ru ? "цена" : "ціна"} ${m[1]} ${m[2]} ${m[3]}`;
  if ((m = /^(\S+) funding (\S+) (\S+)%\/h$/.exec(c))) return `${ru ? "фандинг" : "фандинг"} ${m[1]} ${m[2]} ${m[3]}%/${ru ? "ч" : "год"}`;
  if ((m = /^(\S+) starts trading(?: on (.+))?$/.exec(c))) return `${m[1]} ${ru ? "начнёт торговаться" : "почне торгуватися"}${m[2] ? ` (${m[2]})` : ""}`;
  if ((m = /^after (.+)$/.exec(c))) return `${ru ? "после" : "після"} ${dateT(m[1]!)}`;
  return c;
}
const VENUE: Record<string, string> = { hyperliquid: "Hyperliquid", jupiter: "Jupiter", relay: "Relay", derive: "Derive", polymarket: "Polymarket" };
const venuesT = (v: string, lang: "ru" | "uk") => v.split(", ").map((x) => VENUE[x] ?? (x === "yield" ? (lang === "ru" ? "вклады под процент" : "вклади під відсоток") : x)).join(", ");
const condsT = (c: string, lang: "ru" | "uk") => c.split(" and ").map((x) => condT(x, lang)).join(lang === "ru" ? " и " : " і ");
function nowT(n: string, lang: "ru" | "uk"): string {
  const ru = lang === "ru";
  if (n === "no data yet") return ru ? "данных пока нет" : "даних поки немає";
  if (n === "not yet") return ru ? "пока нет" : "поки ні";
  const m = /^now (.+)$/.exec(n);
  if (m) return `${ru ? "сейчас" : "зараз"} ${m[1]!.replace(/%\/h$/, ru ? "%/ч" : "%/год")}`;
  return n;
}

function betExits(tail: string, lang: "ru" | "uk"): string {
  const ru = lang === "ru";
  return tail
    .replace(/\. Stop: if (\S+) (falls|rises) ~([\d.]+%), Fren closes it and you lose about (\$[\d.,]+)(?: \(-([\d.]+)% of what you put in\))?/g, (_m, mk, dir, pc, usd, roe) => (ru ? `. Стоп: если ${mk} ${dir === "falls" ? "упадёт" : "вырастет"} примерно на ${pc}, Fren закроет, и ты потеряешь около ${usd}${roe ? ` (−${roe}% от вложенного)` : ""}` : `. Стоп: якщо ${mk} ${dir === "falls" ? "впаде" : "зросте"} приблизно на ${pc}, Fren закриє, і ти втратиш близько ${usd}${roe ? ` (−${roe}% від вкладеного)` : ""}`))
    .replace(/\. Take profit: if (\S+) (rises|falls) ~([\d.]+%), Fren closes it and you win about (\$[\d.,]+)/g, (_m, mk, dir, pc, usd) => (ru ? `. Тейк-профит: если ${mk} ${dir === "rises" ? "вырастет" : "упадёт"} примерно на ${pc}, Fren закроет, и ты выиграешь около ${usd}` : `. Тейк-профіт: якщо ${mk} ${dir === "rises" ? "зросте" : "впаде"} приблизно на ${pc}, Fren закриє, і ти виграєте близько ${usd}`))
    .replace(/\. Stop: Fren closes it once you're down about (\$[\d.,]+)/g, (_m, usd) => (ru ? `. Стоп: Fren закроет, когда минус дойдёт примерно до ${usd}` : `. Стоп: Fren закриє, коли мінус дійде приблизно до ${usd}`))
    .replace(/\. Take profit: Fren closes it once you're up about (\$[\d.,]+)/g, (_m, usd) => (ru ? `. Тейк-профит: Fren закроет, когда плюс дойдёт примерно до ${usd}` : `. Тейк-профіт: Fren закриє, коли плюс дійде приблизно до ${usd}`))
    .replace(/\. Stop: if (\S+) reaches (\$[\d.,]+), Fren closes it/g, (_m, mk, px) => (ru ? `. Стоп: если ${mk} дойдёт до ${px}, Fren закроет` : `. Стоп: якщо ${mk} дійде до ${px}, Fren закриє`))
    .replace(/\. Take profit: if (\S+) reaches (\$[\d.,]+), Fren closes it/g, (_m, mk, px) => (ru ? `. Тейк-профит: если ${mk} дойдёт до ${px}, Fren закроет` : `. Тейк-профіт: якщо ${mk} дійде до ${px}, Fren закриє`))
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
/** A plan step without its icon: the step rules expect the "🟡 " the confirmation puts in front. */
function planLine(x: string, lang: "ru" | "uk"): string {
  const plain = line(x, lang);
  if (plain !== x) return plain;
  const icon = "🟡 ";
  const t = line(icon + x, lang);
  return t !== icon + x && t.startsWith(icon) ? t.slice(icon.length) : x;
}

function line(l: string, lang: "ru" | "uk"): string {
  // A waiting request in the /ok list ("2. Buy $3.00 of JUP on Jupiter + …") or in /status ("• …").
  const item = /^(\d{1,2}\. |• )(.+)$/.exec(l);
  if (item) return item[1] + item[2]!.split(" + ").map((x) => planLine(x, lang)).join(" + ");
  const step = /^Step (\d+): (.+)$/.exec(l);
  if (step) return `${lang === "ru" ? "Шаг" : "Крок"} ${step[1]}: ${line(step[2]!, lang)}`;
  // A failed step: "❌ <what>: <why>". The why is already in the owner's language
  // (humanError); translate the what on its own, so it doesn't swallow the why.
  if (/^\s*❌ /u.test(l))
    for (let i = l.indexOf(": "); i > 0; i = l.indexOf(": ", i + 2)) {
      const what = l.slice(0, i);
      if (/(?:Stop|Take profit|No stop)$/.test(what)) continue; // "Stop: if BTC falls…" is part of the what
      const done = line(what, lang);
      if (done !== what) return `${done}: ${l.slice(i + 2)}`;
    }
  // A step with a condition: "Buy $3.00 of JUP on Jupiter, when BTC price < $90,000"; a bet keeps
  // its stop and target after it. Translate the step without it, then put the condition back.
  const cond = /^(\s*(?:🟡|🟢|❌) .*?), when (.+?)((?:\. (?:Stop|Take profit|No stop)\b.*)?)$/u.exec(l);
  if (cond) {
    const [, head, c, tail] = cond as unknown as string[];
    const full = line(head! + tail!, lang);
    const h = line(head!, lang);
    if (full !== head! + tail! && h !== head) {
      const at = full.startsWith(h) ? h.length : full.length;
      return `${full.slice(0, at)}, ${lang === "ru" ? "когда" : "коли"} ${condsT(c!, lang)}${full.slice(at)}`;
    }
  }
  for (const r of rules) {
    const m = r.re.exec(l);
    if (m) return r[lang](...(m.slice(1) as string[]));
  }
  // A result line wraps a known one: "✅ Lent $5.00 USDC on … · https://solscan.io/tx/…".
  const wrapped = /^(\s*)(✅ |❌ |⚡ |👀 |⏳ |📝 Practice: )(.+?)((?: · https?:\/\/\S+)*)$/u.exec(l);
  if (wrapped) {
    const [, pad, icon, core, links] = wrapped as unknown as string[];
    const inner = line(core!, lang);
    if (inner !== core) return `${pad}${icon === "📝 Practice: " ? (lang === "ru" ? "📝 Тренировка: " : "📝 Тренування: ") : icon}${inner}${links}`;
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
  return {
    ...s,
    title: localize(s.title, lang),
    rows: s.rows.map((r) => ({ ...r, text: localize(r.text, lang) })),
    links: s.links.map((l) => ({ ...l, label: localize(l.label, lang) })),
    ...(s.chart ? { chart: localizeChart(s.chart, lang) } : {}),
  };
}

const CHART_WORDS: [RegExp, string, string][] = [
  [/^ENTRY$/, "ВХОД", "ВХІД"],
  [/^EXIT$/, "ВЫХОД", "ВИХІД"],
  [/^STOP$/, "СТОП", "СТОП"],
  [/^TARGET$/, "ЦЕЛЬ", "ЦІЛЬ"],
  [/^LIQ$/, "ЛИКВ", "ЛІКВ"],
  [/^BUY$/, "ПОКУПКА", "КУПІВЛЯ"],
  [/^SELL$/, "ПРОДАЖА", "ПРОДАЖ"],
  [/\bliquidated$/, "ликвидирована", "ліквідована"],
  [/\bstop hit$/, "сработал стоп", "спрацював стоп"],
  [/\btarget hit$/, "достигнута цель", "досягнуто ціль"],
  [/\bclosed on Hyperliquid$/, "закрыта", "закрита"],
  [/\bclosed$/, "закрыта", "закрита"],
  [/^Bought\b/, "Куплено", "Куплено"],
  [/^Sold\b/, "Продано", "Продано"],
  [/^long\b/, "Лонг", "Лонг"],
  [/^short\b/, "Шорт", "Шорт"],
  [/ long /, " лонг ", " лонг "],
  [/ short /, " шорт ", " шорт "],
  [/^Result /, "Итог ", "Підсумок "],
  [/ · entry /, " · вход ", " · вхід "],
  [/ · exit /, " · выход ", " · вихід "],
  [/ in · /, " внесено · ", " внесено · "],
  [/× boost · moves like (\S+) of (\S+)$/, "× плечо · как $1 в $2", "× плече · як $1 у $2"],
  [/(\d)h on (\w+)$/, "$1 ч, $2", "$1 год, $2"],
  [/^(\d+)h · /, "$1 ч · ", "$1 год · "],
  [/^(\d+)d · /, "$1 дн · ", "$1 дн · "],
  [/Hyperliquid perp/, "Hyperliquid, бессрочный", "Hyperliquid, безстроковий"],
  [/ · your (лонг|шорт|long|short) /, " · твой $1 ", " · твій $1 "],
  [/, PnL /, ", итог ", ", підсумок "],
  [/ \(paper\)$/, " (учебно)", " (навчально)"],
  [/ for (\$[\d.,]+)/, " за $1", " за $1"],
  [/ at (\$[\d.,]+)/, " по $1", " по $1"],
];

/** A chart's own words (title, subtitle, level tags) in the owner's language; the pixel font has Cyrillic capitals. */
export function localizeChart(c: ChartRequest, lang: unknown): ChartRequest {
  const l = asLang(lang);
  if (l === "en") return c;
  const tr = (t: string) => CHART_WORDS.reduce((acc, [re, ru, uk]) => acc.replace(re, l === "ru" ? ru : uk), t);
  return { ...c, title: tr(c.title), ...(c.subtitle ? { subtitle: tr(c.subtitle) } : {}), levels: c.levels.map((v) => ({ ...v, label: tr(v.label) })) };
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
  { re: /minimum value(?: of \$?(\d+))?|below the smallest/i, safe: true, say: (n) => (n ? t(`The trade is smaller than the exchange's $${n} minimum. Try $${n} or more.`, `Сделка меньше минимума биржи в $${n}. Попробуй от $${n}.`, `Угода менша за мінімум біржі в $${n}. Спробуй від $${n}.`) : t("The trade is smaller than the exchange's minimum. Try a bigger amount.", "Сделка меньше минимума биржи. Попробуй сумму побольше.", "Угода менша за мінімум біржі. Спробуй більшу суму.")) },
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

// Exchange and network wording counts as raw too: a tx hash, "Order must have minimum value … asset=0", "Transaction reverted".
const looksRawText = (raw: string) => /\{\s*"|InstructionError|^\w*Error: |\bat \w+\.\w+\s*\(|\basset=\d|Order must have|reverted/i.test(raw);

/**
 * A failure as one plain sentence in the owner's language: what happened and, when it
 * failed before anything was sent, that the money is untouched. Known refusals from
 * every venue are matched; anything raw (JSON, codes, stack bits) that we don't know
 * becomes a generic line instead of leaking; messages that are already words pass through.
 */
export function humanError(raw: string, langIn: unknown): string {
  const lang = asLang(langIn);
  if (!looksRawText(raw) && !/Simulation failed/i.test(raw)) return raw;
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
  const why = WHY[lang];
  const head = `${why[0]!.toUpperCase()}${why.slice(1)}.`;
  return /Simulation failed/i.test(raw) ? `${head} ${SAFE[lang]}` : `${head} ${CHECK[lang]}`;
}

const CHECK = {
  en: "I can't tell if anything moved: check your balance before trying again.",
  ru: "Не могу сказать, ушло ли что-то: проверь баланс, прежде чем пробовать снова.",
  uk: "Не можу сказати, чи пішло щось: перевір баланс, перш ніж пробувати знову.",
};
