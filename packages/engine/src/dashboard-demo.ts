import { Dashboard } from "./dashboard.js";
import { MemoryChat } from "./dashboard-chat.js";
import { buildTestFren } from "./testing.js";

/**
 * The demo stand: the real dashboard on a practice engine with fake markets,
 * a pretend chat and pretend keys. For showing the page, never for money.
 *
 *   node packages/engine/dist/dashboard-demo.js [port]
 */

export async function startDemo(port: number, host = "0.0.0.0") {
  const t = buildTestFren();
  const { fren, store } = t;
  const sol = "So11111111111111111111111111111111111111112";
  const jup = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

  // A few things Fren did, from the owner's asks in the chat.
  store.setLimits({ ...store.getLimits(), autoApproveUsd: 300 });
  await fren.submit({ request: "buy $250 of SOL", steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: sol, amount: { type: "usd", usd: 250 } } }] });
  await fren.submit({ request: "put $100 into JUP", steps: [{ leg: { kind: "swap", venue: "jupiter", side: "buy", token: jup, amount: { type: "usd", usd: 100 } } }] });
  await fren.submit({ request: "long ETH with $120, 3x, stop at -20%", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "ETH", side: "long", sizing: { type: "margin", usd: 120 }, leverage: 3, stopLossPct: 20 } }] });
  // Prices moved a bit since.
  t.fake.main.find((m) => m.name === "ETH")!.mid = 4_150;
  t.fake.tokens.find((x) => x.symbol === "JUP")!.usdPrice = 1.08;
  store.setLimits({ ...store.getLimits(), autoApproveUsd: 25 });
  // One that waits for the owner's /ok, to show the "most you can lose" line.
  await fren.submit({ request: "short BTC with $200, 5x, stop at -10%", steps: [{ leg: { kind: "perp_open", venue: "hyperliquid", market: "BTC", side: "short", sizing: { type: "margin", usd: 200 }, leverage: 5, stopLossPct: 10 } }] });

  const start = Date.now() - 50 * 60_000;
  const answers: [RegExp, string][] = [
    [/hold|have|balance|money/i, "You hold about $250 of SOL, $108 of JUP and a long on ETH that's up a little. Everything is on practice money."],
    [/stop|pause/i, "To stop me, press Pause Fren in the dashboard or send /fren_stop here. It works at once."],
    [/buy|long|short|sell/i, "Before I do it I'll show you what I'd buy and the most you can lose. Then you reply /ok with the code."],
  ];
  const chat = new MemoryChat(async (text) => {
    await new Promise((r) => setTimeout(r, 2500));
    return answers.find(([re]) => re.test(text))?.[1] ?? "Got it. This is the demo, so I'm only pretending. On your own Fren this goes to the real me, and you'd see my answer in Telegram too.";
  });
  const seed: ["you" | "fren", string][] = [
    ["you", "hey, buy $250 of SOL"],
    ["fren", "Done ✅ Bought 1.25 SOL for $250 on Jupiter. Practice money, so nothing real moved."],
    ["you", "and long ETH with $120, 3x, stop at -20%"],
    ["fren", "Opened a long on ETH: $120 of yours, 3x. If ETH falls 20% the stop closes it.\n🧯 The most you can lose: $120. Your stop should cut it at about $24."],
    ["you", "short BTC with $200, 5x, stop at -10%"],
    ["fren", "That's over your auto-approve limit, so I need your OK.\n🧯 The most you can lose: $200, the money this puts in. Your stop should cut it at about $20.\nReply /ok and the code I sent you."],
  ];
  seed.forEach(([from, text], i) => chat.fromApp(from, text, start + i * 7 * 60_000));

  // Practice trades leave no public record. So the page shows what a real
  // one looks like, the demo points them at the real public pages.
  const history = fren.history.bind(fren);
  const demoLinks: Record<string, { label: string; url: string }[]> = {
    SOL: [{ label: "Solscan", url: `https://solscan.io/token/${sol}` }],
    JUP: [{ label: "Solscan", url: `https://solscan.io/token/${jup}` }],
    ETH: [{ label: "Hyperliquid explorer", url: "https://app.hyperliquid.xyz/explorer" }, { label: "Chart", url: "https://app.hyperliquid.xyz/trade/ETH" }],
  };
  fren.history = (limit?: number) => history(limit).map((h) => ({ ...h, links: h.links.length ? h.links : (Object.entries(demoLinks).find(([k]) => h.request.includes(k))?.[1] ?? []) }));

  // Pretend addresses (no signer in the demo), so the top-up card has something to copy.
  fren.wallet = async () => ({
    text: "",
    addresses: { solana: "7dEmoFrenWa11etXq3VbK9pZr2sTnL5uYhC8wJfG4mNx", evm: "0xD3m0F7e1A2b3C4d5E6f708192a3B4c5D6e7F8091", hlAgent: "0x0000000000000000000000000000000000000000" },
  });

  const dash: Dashboard = new Dashboard(fren, {
    publicUrl: `http://localhost:${port}`,
    chat,
    demo: true,
    mailer: {
      async send(_to, _subject, text) {
        const code = text.match(/\d{6}/)?.[0];
        dash.demoNote = `Demo: on a real install this goes to your inbox. Code: ${code}`;
        return true;
      },
    },
    keys: {
      async reveal() {
        return [
          { label: "Solana wallet key (demo, not real)", value: "4demoXk9qPfR2sVnT8bLmW3yZcA7hJdE5uGiN6oKpQxS1tB0vCrM" },
          { label: "EVM wallet key (demo, not real)", value: "0xdemo00000000000000000000000000000000000000000000000000000000beef" },
          { label: "Hyperliquid trading key (demo, not real)", value: "0xdemo11111111111111111111111111111111111111111111111111111111cafe" },
        ];
      },
    },
  });
  dash.auth.setEmail("you@example.com");
  const server = dash.server();
  await new Promise<void>((r) => server.listen(port, host, r));
  return { server, dash, t, chat };
}

if (process.argv[1]?.endsWith("dashboard-demo.js")) {
  const port = Number(process.argv[2] ?? 7431);
  startDemo(port).then(() => console.log(`Fren dashboard demo on :${port}`));
}
