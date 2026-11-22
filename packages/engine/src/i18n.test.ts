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
    expect(humanError("Not enough USDC.", "ru")).toBe("Not enough USDC.");
  });
});

import { buildTestFren } from "./testing.js";

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
  it("a bad language value keeps the last good one", () => {
    const t = buildTestFren({ live: true });
    t.fren.setOwnerLang("ru");
    t.fren.setOwnerLang("de");
    t.fren.setOwnerLang(undefined);
    expect((t.fren as unknown as { ownerLang: string }).ownerLang).toBe("ru");
  });
});
