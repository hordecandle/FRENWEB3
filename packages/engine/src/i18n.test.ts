import { describe, expect, it } from "vitest";
import { humanError, localize, localizeReceipt } from "./i18n.js";

const plan = "Confirm this plan:\n🟡 Lend $3.00 of USDC on Jupiter Lend (Solana)\n   ⚠️ Earns about 4.05% a year on $3.00, variable. You can take it back any time; Fren also takes it back on its own when a trade needs the cash.";

describe("localize", () => {
  it("leaves English alone", () => {
    expect(localize(plan, "en")).toBe(plan);
    expect(localize(plan, undefined)).toBe(plan);
  });
  it("turns a confirmation into one Russian message", () => {
    const out = localize(`${plan}\n\nReply /ok 5ZER39 within 10 min.`, "ru");
    expect(out).toContain("Подтверди план:");
    expect(out).toContain("Положить $3.00 USDC в Jupiter Lend (Solana)");
    expect(out).toContain("Ответь /ok 5ZER39 в течение 10 мин.");
    expect(out).not.toMatch(/Confirm|Lend \$|Reply/);
  });
  it("buy, sell, long lines", () => {
    expect(localize("🟡 Buy $3.00 of JUP on Jupiter", "ru")).toBe("🟡 Купить JUP на $3.00 (Jupiter)");
    expect(localize("🟡 Sell 100% of your JUP on Jupiter", "uk")).toBe("🟡 Продати 100% твоїх JUP (Jupiter)");
    expect(localize("🟡 Long ETH on Hyperliquid: $50 margin at 10x ($500 position), stop at -20% of margin, -$10.00 (2.0% price move)", "ru")).toBe(
      "🟡 Лонг ETH на Hyperliquid: маржа $50, плечо 10x (позиция $500), стоп на -20% от маржи, -$10.00 (движение цены 2.0%)",
    );
  });
  it("receipts: title, rows, header", () => {
    const r = localizeReceipt({ header: "📝 Paper mode", steps: [{ icon: "✅", title: "Bought 13.877 JUP for $3.00 at $0.2162", rows: [], links: [{ label: "Chart on DexScreener", url: "https://x.y" }] }] }, "ru");
    expect(r.steps[0]!.title).toBe("Куплено 13.877 JUP на $3.00 по $0.2162");
    expect(r.steps[0]!.links[0]!.label).toBe("График на DexScreener");
    expect(r.header).toContain("Тестовый режим");
  });
});

describe("humanError", () => {
  const raw = 'Simulation failed: {"InstructionError":[0,{"Custom":3012}]}';
  it("no JSON, says money is untouched, in each language", () => {
    expect(humanError(raw, "en")).toBe("An account this service needs isn't set up in your wallet yet. Nothing was sent, so your money is where it was.");
    expect(humanError(raw, "ru")).toBe("В твоём кошельке ещё не создан служебный счёт, который нужен этому сервису. Ничего не отправлено, твои деньги на месте.");
    expect(humanError(raw, "ru")).not.toMatch(/[{}]|3012/);
  });
  it("unknown codes and plain words", () => {
    expect(humanError('Simulation failed: {"InstructionError":[1,{"Custom":9}]}', "en")).toContain("The network refused it");
    expect(humanError("Some already plain sentence.", "ru")).toBe("Some already plain sentence.");
  });
  it("every venue's refusals come out as plain words in the owner's language", () => {
    const cases: [string, RegExp][] = [
      ['Hyperliquid refused: {"status":"err","response":"Insufficient margin to place order"}', /Hyperliquid не хватает/],
      ['Hyperliquid refused: {"status":"ok","response":{"data":{"statuses":[{"error":"Order could not immediately match against any resting orders."}]}}}', /Никто не взял/],
      ['Derive: {"code":11000,"message":"Insufficient collateral"}', /Derive не хватает денег/],
      ['Polymarket refused: {"error":"not enough balance / allowance"}', /Polymarket не хватает/],
      ['Relay: {"message":"No routes found","errorCode":"NO_SWAP_ROUTES"}', /Relay сейчас не нашёл/],
      ["Error: Transaction failed on-chain: execution reverted", /отклонила транзакцию/],
      ["Error: insufficient funds for gas * price + value", /комиссию сети/],
      ['Simulation failed: {"InstructionError":[2,{"Custom":6001}]}', /Цена слишком сдвинулась/],
      ['Kamino: {"error":"reserve full"}', /под процент/],
    ];
    for (const [raw, re] of cases) {
      const out = humanError(raw, "ru");
      expect(out).toMatch(re);
      expect(out).not.toMatch(/[{}]|InstructionError/);
      expect(humanError(raw, "en")).not.toMatch(/[{}]|InstructionError|[а-яё]/i);
      expect(humanError(raw, "uk")).not.toMatch(/[{}]|[ыэё]/);
    }
  });
  it("unknown raw text never leaks JSON", () => {
    const out = humanError('Weird: {"x":1} 0xdeadbeefcafe', "ru");
    expect(out).not.toMatch(/[{}]/);
    expect(out).toMatch(/проверь баланс/);
  });
});

import { buildTestFren } from "./testing.js";

describe("what the owner saw in English on 22.11", () => {
  it("result lines with links, practice lines and the /ok plan text come out in Russian", () => {
    const ru = localize("✅ Moved $20.00 USDC from your Solana wallet into Hyperliquid through Relay · https://solscan.io/tx/abc", "ru");
    expect(ru).toMatch(/^✅ /);
    expect(ru).toContain("https://solscan.io/tx/abc");
    expect(ru).not.toMatch(/Moved|wallet/);
    expect(localize("The plan and its code are in my message just above. Reply /ok <code> to go ahead.", "ru")).toMatch(/^План и код/);
    expect(localize("More than one request is waiting for your OK, so add its code: /ok <code> from the message with that plan.", "ru")).toMatch(/^Подтверждения ждут/);
    expect(localize("Sent you a login link for your dashboard in a separate message. It works once, for 10 minutes.", "ru")).toMatch(/^Ссылку на дашборд/);
    expect(localize("The dashboard isn't running on this machine. Restart Fren, or set FREN_DASHBOARD=on.", "uk")).toMatch(/^Дашборд/);
  });

  it("venue errors: a reverted tx, the Hyperliquid $10 minimum, Solana 3012", () => {
    const rev = humanError("Transaction reverted: 0x5f2a9c0b1d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0", "ru");
    expect(rev).toMatch(/^Сеть отклонила транзакцию/);
    const min = humanError("Order must have minimum value of $10. asset=0", "ru");
    expect(min).toMatch(/\$10/);
    expect(min).not.toMatch(/asset=|Order must/);
    const c = humanError('Simulation failed: {"InstructionError":[2,{"Custom":3012}]}', "ru");
    expect(c).not.toMatch(/3012|Custom|\{/);
  });

  it("a signer refusal that names a contract stays as it is", () => {
    const own = "The contract 0x1111111111111111111111111111111111111111 is not on the signer's allow list.";
    expect(humanError(own, "en")).toBe(own);
  });
});

describe("the owner's language through the engine", () => {
  const lend = { request: "lend", steps: [{ leg: { kind: "earn", venue: "yield", action: "deposit", amount: { type: "usd", usd: 5 } } }] };
  it("the confirmation message is entirely Russian for a Russian owner, English otherwise", async () => {
    const ru = buildTestFren({ live: true });
    ru.fren.setOwnerLang("ru");
    ru.fake.solanaUsdc = 50;
    ru.store.setLimits({ ...ru.fren.limits(), autoApproveUsd: 0 });
    await ru.fren.submit(lend);
    const sent = ru.notifier.sent.at(-1) ?? "";
    expect(sent).toContain("Подтверди план:");
    expect(sent).toMatch(/Ответь \/ok [A-Z0-9]{6} в течение 10 мин\./);
    expect(sent).not.toMatch(/Confirm|Reply|Earns about/);
    const en = buildTestFren({ live: true });
    en.fake.solanaUsdc = 50;
    en.store.setLimits({ ...en.fren.limits(), autoApproveUsd: 0 });
    await en.fren.submit(lend);
    expect(en.notifier.sent.at(-1)).toMatch(/Confirm this plan:[\s\S]*Reply \/ok/);
  });
  it("a failed step says why in plain words, with no raw JSON and no yield line", async () => {
    for (const [lang, want] of [["ru", "Ничего не отправлено"], ["en", "Nothing was sent"]] as const) {
      const t = buildTestFren({ live: true });
      t.fake.solanaUsdc = 50;
      t.store.setLimits({ ...t.fren.limits(), autoApproveUsd: 0 });
      t.fren.setOwnerLang(lang);
      await t.fren.submit(lend);
      const venues = (t.fren as unknown as { venues: { jupiter: { execute: unknown }; yield: { execute: unknown } } }).venues;
      venues.yield.execute = async () => {
        throw new Error('Simulation failed: {"InstructionError":[0,{"Custom":3012}]}');
      };
      const code = /\/ok ([A-Z0-9]{6})/.exec(t.notifier.sent.at(-1) ?? "")![1]!;
      const res = await t.fren.approveWithReceipt(code);
      const all = [res.text, ...t.notifier.sent.slice(1)].join("\n");
      expect(all).toContain(want);
      expect(all).not.toMatch(/InstructionError|3012|Earns about|Доходность/);
    }
  });
  it("the language survives a restart: it lives in the store, not in memory", () => {
    const t = buildTestFren();
    t.fren.setOwnerLang("ru");
    expect(t.store.getKv("owner_lang")).toBe("ru");
    expect(t.fren.localize("🔑 Your Fren dashboard:")).toBe("🔑 Твой дашборд Fren:");
  });
  it("a bad language value keeps the last good one", () => {
    const t = buildTestFren({ live: true });
    t.fren.setOwnerLang("ru");
    t.fren.setOwnerLang("de");
    t.fren.setOwnerLang(undefined);
    expect((t.fren as unknown as { ownerLang: string }).ownerLang).toBe("ru");
  });
});
