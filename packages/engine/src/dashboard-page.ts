/** The owner's dashboard page. Self-contained: no requests leave this server except fonts. All data goes in with textContent. */

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@300..700&family=Noto+Color+Emoji&display=swap">
<style>
:root{--bg:#fff;--soft:#f5f5f5;--ink:#000;--ink-2:#2a2a2a;--muted:#5e5e5e;--faint:#cfcfcf;--line:#e3e3e3;--blue:#a5caff;--ok:#1f8a4c;--bad:#b42318;
--font:"Geologica",system-ui,sans-serif,"Noto Color Emoji";--mono:ui-monospace,"SF Mono",Menlo,monospace;--sh-btn:2px 3px 0 var(--ink);--sh-card:4px 5px 0 var(--ink)}
*,:before,:after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased;font-size:16px}
h1,h2,h3,p{margin:0}
.top{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line)}
.top__in{max-width:1040px;margin:0 auto;padding:0 20px;height:60px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-weight:700;font-size:22px;letter-spacing:-.03em}
.brand small{font-weight:500;font-size:12px;color:var(--muted);margin-left:8px;letter-spacing:0}
.page{max-width:1040px;margin:0 auto;padding:24px 20px 64px;display:grid;gap:20px;grid-template-columns:1fr 1fr}
@media (max-width:760px){.page{grid-template-columns:1fr}}
.card{border:1px solid var(--ink);border-radius:20px;box-shadow:var(--sh-card);padding:22px;min-width:0}
.card--wide{grid-column:1/-1}
.kicker{font-size:13px;font-weight:500;color:var(--muted);margin-bottom:8px}
h2{font-size:22px;letter-spacing:-.02em}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ink);border-radius:999px;padding:4px 12px;font-size:14px;font-weight:500}
.pill i{width:9px;height:9px;border-radius:50%;background:var(--ok)}
.pill.paper i{background:var(--blue)} .pill.stopped i{background:var(--bad)}
.big{font-size:34px;font-weight:600;letter-spacing:-.03em;margin-top:6px}
.muted{color:var(--muted);font-weight:300;font-size:14px;line-height:1.5}
.bar{height:8px;border-radius:99px;background:var(--soft);overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;background:var(--ink)}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:9px 18px;border:1px solid var(--ink);border-radius:12px;background:var(--blue);color:var(--ink);box-shadow:var(--sh-btn);font:inherit;font-size:15px;font-weight:500;cursor:pointer}
.btn--2{background:#fff}.btn--bad{background:#ffd9d4}
.btn[disabled]{opacity:.45;pointer-events:none}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;white-space:nowrap}
th{text-align:left;font-weight:500;color:var(--muted);padding:8px 6px;border-bottom:1px solid var(--line)}
td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:top}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.up{color:var(--ok)}.down{color:var(--bad)}
.scroll{overflow-x:auto}
.lim{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.lim label{display:block;font-size:13px;color:var(--muted)}
.lim input,.lim select{width:100%;margin-top:6px;font:inherit;font-size:16px;padding:9px 11px;border:1px solid var(--ink);border-radius:10px;background:#fff}
.addr{font-family:var(--mono);font-size:13px;word-break:break-all;background:var(--soft);padding:9px 11px;border-radius:10px;margin-top:6px}
.lbl{display:block;margin-top:14px;font-size:13px;font-weight:500}
.ev{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px;max-height:340px;overflow:auto}
.ev li{font-size:14px;line-height:1.45;white-space:pre-wrap}.ev time{display:block;font-size:12px;color:var(--muted)}
.msg{margin-top:14px;font-size:14px;line-height:1.5;background:var(--soft);border-radius:12px;padding:12px 14px;white-space:pre-wrap}
.msg:empty{display:none}
.link{background:none;border:0;padding:0;font:inherit;font-size:14px;color:var(--muted);text-decoration:underline;cursor:pointer}
.center{max-width:520px;margin:12vh auto;padding:0 20px;text-align:center}
.center p{margin-top:12px}
[hidden]{display:none!important}
.btn--sm{min-height:36px;padding:6px 12px;font-size:14px;border-radius:10px}
.top__r{display:flex;align-items:center;gap:10px}
.demo{background:var(--blue);border-bottom:1px solid var(--ink);font-size:14px;text-align:center;padding:8px 16px}
.layout{max-width:1240px;margin:0 auto;padding:24px 20px 64px;display:grid;gap:20px;grid-template-columns:minmax(0,1fr) 400px;align-items:start}
.col{display:grid;gap:20px;min-width:0}
.side{position:sticky;top:80px}
@media (max-width:1060px){.layout{grid-template-columns:minmax(0,1fr)}.side{position:static}}
@media (max-width:520px){.layout{padding:16px 14px 48px;gap:16px}.col{gap:16px}.card{padding:18px;border-radius:16px;box-shadow:3px 4px 0 var(--ink)}.big{font-size:40px}.top__in{padding:0 14px}.brand small{display:none}}
.total{font-size:52px;font-weight:600;letter-spacing:-.04em;line-height:1.05;margin-top:6px;font-variant-numeric:tabular-nums}
.sub{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:15px}
.parts{list-style:none;margin:18px 0 0;padding:0;border-top:1px solid var(--line)}
.parts li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:15px}
.parts .amt{color:var(--muted);font-size:13px;font-weight:300}
.parts .usd{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.parts li.net{padding:13px 0 6px;border-bottom:0;font-weight:600;font-size:16px}
.parts li.net .usd{font-weight:600}
.parts li.coin{padding:6px 0 6px 14px;border-bottom:0;font-size:14px}
.parts li.coin + li.net{border-top:1px solid var(--line);margin-top:6px}
.tag{display:inline-block;font-size:12px;font-weight:500;border:1px solid var(--ink);border-radius:99px;padding:1px 8px;margin-left:6px;vertical-align:1px;background:#fff}
.tag--ok{background:#d9f2e3}.tag--bad{background:#ffd9d4}.tag--wait{background:#fff3c4}
.addrs{display:grid;gap:14px;margin-top:14px;grid-template-columns:1fr 1fr}
@media (max-width:760px){.addrs{grid-template-columns:1fr}}
.demo-warn{grid-column:1/-1;margin:0}
.addr-box{border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}
.addr-box h3{font-size:15px;font-weight:600}
.addr-box .row{margin-top:10px}
.wait{border:1px solid var(--ink);border-radius:14px;padding:14px;background:#fffbea;margin-top:12px}
.wait p{font-size:14px;line-height:1.5;margin-top:6px}
.loss{font-weight:600}
.hist{list-style:none;margin:12px 0 0;padding:0;display:grid}
.hist li{padding:14px 0;border-bottom:1px solid var(--line);display:grid;gap:6px;min-width:0}
.hist .when{font-size:12px;color:var(--muted)}
.hist .ask{font-size:15px;font-weight:500;overflow-wrap:anywhere}
.hist .res{font-size:14px;color:var(--ink-2);white-space:pre-wrap;line-height:1.45;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--ink);text-decoration:none;border:1px solid var(--ink);border-radius:99px;padding:4px 11px;background:#fff;box-shadow:1px 2px 0 var(--ink)}
.chip:after{content:"↗";font-size:12px}
.chat{display:flex;flex-direction:column;height:calc(100vh - 104px);min-height:520px;padding:0;overflow:hidden}
@media (max-width:1060px){.chat{height:600px}}
.chat__h{padding:18px 20px 14px;border-bottom:1px solid var(--line)}
.chat__list{flex:1;overflow-y:auto;padding:16px 16px 8px;display:flex;flex-direction:column;gap:10px;background:#fff}
.m{display:flex;flex-direction:column;max-width:100%}
.m--you{align-items:flex-end}.m--fren{align-items:flex-start}
.bub{border:1px solid var(--ink);max-width:88%;padding:9px 13px 10px;font-size:15px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}
.m--you .bub{background:var(--blue);box-shadow:1.5px 2px 0 var(--ink);border-radius:18px 18px 4px 18px}
.m--fren .bub{background:var(--ink);color:#fff;box-shadow:2px 3px 0 var(--blue);border-radius:18px 18px 18px 4px}
.m time{font-size:11px;color:var(--muted);margin-top:4px}
.bub.typing{background:var(--voice,#efefef);color:var(--ink);box-shadow:1.5px 2px 0 var(--ink)}
.chat__f{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line);background:#fff}
.chat__f textarea{flex:1;resize:none;font:inherit;font-size:16px;line-height:1.35;padding:10px 12px;border:1px solid var(--ink);border-radius:12px;min-height:46px;max-height:140px}
.chat__hint{font-size:12px;color:var(--muted);padding:0 14px 12px;background:#fff}
.keys{display:grid;gap:10px;margin-top:14px}
.key{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.key b{display:block;font-size:13px;font-weight:500}
.key code{font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;color:var(--muted)}
.key.shown code{color:var(--ink)}
.field{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.field input{flex:1;min-width:0;font:inherit;font-size:16px;padding:9px 11px;border:1px solid var(--ink);border-radius:10px;background:#fff}
.modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.modal[hidden]{display:none}
.modal__c{background:#fff;border:1px solid var(--ink);border-radius:20px;box-shadow:var(--sh-card);padding:22px;max-width:440px;width:100%}
.modal__c h3{font-size:20px;letter-spacing:-.02em}
.modal__c p{margin-top:10px;font-size:15px;line-height:1.5}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:14px;line-height:1.45}
.check input{width:20px;height:20px;margin:0;flex:none}
details summary{cursor:pointer;font-weight:500;font-size:15px;margin-top:16px}
.tour-hole{position:fixed;z-index:60;border-radius:22px;box-shadow:0 0 0 9999px rgba(0,0,0,.5);outline:3px solid var(--blue);pointer-events:none;transition:all .3s cubic-bezier(.2,.8,.2,1)}
.tour-tip{position:fixed;z-index:61;background:#fff;border:1px solid var(--ink);border-radius:18px;box-shadow:var(--sh-card);padding:18px;width:340px;max-width:calc(100vw - 24px)}
.tour-tip h3{font-size:18px;letter-spacing:-.02em;margin-top:4px}
.tour-tip p{font-size:15px;line-height:1.5;margin-top:8px}
.tour-tip .try{background:#fff3c4;border-radius:10px;padding:8px 10px;font-size:14px}
.tour-tip .try.done{background:#d9f2e3}
.tour-tip .row{margin-top:14px;justify-content:space-between;align-items:center}
.tour-n{font-size:13px;color:var(--muted)}
@media (max-width:520px){.tour-tip{left:12px!important;right:12px;width:auto;bottom:12px;top:auto!important;padding:14px}.tour-tip.at-top{top:12px!important;bottom:auto}.tour-tip p{font-size:14px;margin-top:6px}.tour-tip .row{margin-top:10px}
.top__r .pill{display:none}.top__r{gap:12px}.btn{white-space:nowrap}.chat{height:480px;min-height:0}}
.signin{max-width:460px;margin:8vh auto;padding:0 20px}
.signin .card{margin-top:18px}
.signin h1{font-size:30px;letter-spacing:-.03em;margin-top:8px}
.or{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;margin:18px 0 0}
.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
</style>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const LOGIN_PAGE = (message: string) => `<!doctype html><html lang="en"><head>${HEAD}<title>Fren dashboard</title></head>
<body><div class="center"><div class="brand">Fren<small>dashboard</small></div><p class="muted">${esc(message)}</p></div></body></html>`;


/** Shared bits of the page script: calls, money, small DOM helpers. */
const COMMON_JS = `
  const $ = (id) => document.getElementById(id);
  const usd = (n) => { if (n == null || !isFinite(n)) return "–"; const a = Math.abs(n), d = 2; return (n < 0 ? "-$" : "$") + a.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }); };
  const signed = (n) => (n == null ? "–" : (n > 0 ? "+" : "") + usd(n));
  const px = (n) => (n == null ? "–" : "$" + Number(n).toLocaleString("en-US", { maximumSignificantDigits: 6 }));
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-fren": "1" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  function b64(bytes) { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); }
  /** Asks Phantom (Solana) or MetaMask (EVM) to sign a text. Returns { address, signature }. */
  async function walletSign(kind, getMessage) {
    if (kind === "solana") {
      const p = (window.phantom && window.phantom.solana) || window.solana;
      if (!p) throw new Error("No Solana wallet in this browser. Install Phantom, or open this page inside it.");
      const r = await p.connect();
      const address = (r.publicKey || p.publicKey).toString();
      const message = await getMessage(address);
      const s = await p.signMessage(new TextEncoder().encode(message), "utf8");
      return { address, signature: b64(s.signature || s) };
    }
    const e = window.ethereum;
    if (!e) throw new Error("No EVM wallet in this browser. Install MetaMask, or open this page inside it.");
    const [address] = await e.request({ method: "eth_requestAccounts" });
    const message = await getMessage(address);
    const hex = "0x" + Array.from(new TextEncoder().encode(message), (x) => x.toString(16).padStart(2, "0")).join("");
    const signature = await e.request({ method: "personal_sign", params: [hex, address] });
    return { address, signature };
  }
`;

export interface SignInMethods {
  email: boolean;
  wallet: boolean;
  demo?: boolean;
}

/** The page a logged-out visitor sees: the Telegram link, plus email and wallet if the owner added them. */
export const SIGNIN_PAGE = (m: SignInMethods) => `<!doctype html><html lang="en"><head>${HEAD}<title>Log in · Fren</title></head>
<body>
<header class="top"><div class="top__in"><div class="brand">Fren<small>dashboard</small></div></div></header>
<main class="signin">
  <p class="kicker">Your Fren</p>
  <h1>Log in to your dashboard</h1>
  <p class="muted" style="margin-top:10px">Only you can get in. Logging in can't move money: anything risky still asks for your OK in the chat.</p>
  ${m.demo ? `<section class="card" style="background:var(--blue)"><h2>This is a demo</h2><p class="muted" style="color:var(--ink);margin-top:8px">Pretend money, a pretend chat. Nothing here is real.</p><div class="row"><a class="btn btn--2" href="/demo-login" id="demo-in">Open the demo</a></div></section>` : ""}
  <section class="card">
    <h2>With Telegram</h2>
    <p class="muted" style="margin-top:8px">Send <b>/fren_dashboard</b> to your Fren bot. It sends you a link that works once, for 10 minutes.</p>
  </section>
  ${
    m.email
      ? `<section class="card" id="email-card">
    <h2>With your email</h2>
    <p class="muted" style="margin-top:8px">We email you a 6-digit code.</p>
    <div class="field"><input id="em" type="email" autocomplete="email" placeholder="you@example.com"><button class="btn" id="em-go">Send code</button></div>
    <div class="field" id="code-row" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"><button class="btn" id="code-go">Log in</button></div>
    <div class="msg" id="em-msg"></div>
  </section>`
      : ""
  }
  ${
    m.wallet
      ? `<section class="card">
    <h2>With your wallet</h2>
    <p class="muted" style="margin-top:8px">Sign a short message. It's free and can't move money.</p>
    <div class="row"><button class="btn btn--2" data-w="solana">Phantom (Solana)</button><button class="btn btn--2" data-w="evm">MetaMask (EVM)</button></div>
    <div class="msg" id="w-msg"></div>
  </section>`
      : ""
  }
</main>
<script>
(() => {
  "use strict";
  ${COMMON_JS}
  const say = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  const em = $("em");
  if (em) {
    $("em-go").onclick = async () => {
      try {
        const r = await post("/auth/email/start", { email: em.value });
        say("em-msg", r.text + (r.demoNote ? "\\n\\n" + r.demoNote : ""));
        $("code-row").hidden = false;
        $("code").focus();
      } catch (e) { say("em-msg", e.message); }
    };
    $("code-go").onclick = async () => {
      try { await post("/auth/email/check", { email: em.value, code: $("code").value }); location.href = "/"; }
      catch (e) { say("em-msg", e.message); }
    };
  }
  for (const b of document.querySelectorAll("[data-w]")) b.onclick = async () => {
    const kind = b.dataset.w;
    try {
      let id = "";
      const s = await walletSign(kind, async (address) => { const c = await post("/auth/wallet/challenge", { kind, address }); id = c.id; return c.message; });
      await post("/auth/wallet/check", { kind, id, address: s.address, signature: s.signature });
      location.href = "/";
    } catch (e) { say("w-msg", e.message); }
  };
})();
</script>
</body></html>`;

export const DASHBOARD_PAGE = `<!doctype html><html lang="en"><head>${HEAD}<title>Fren dashboard</title></head>
<body>
<div class="demo" id="demo-bar" hidden>Demo: pretend money and a pretend chat. Nothing here is real.</div>
<header class="top"><div class="top__in"><div class="brand">Fren<small>dashboard</small></div>
  <div class="top__r"><span class="pill" id="pill"><i></i><span id="pill-t">Loading…</span></span><button class="btn btn--2 btn--sm" id="tour-open" aria-label="Show me around">Tour</button><button class="link" id="logout">Log out</button></div></div></header>
<main class="layout">
 <div class="col">
  <section class="card" data-tour="balance">
    <p class="kicker" id="bal-k">All your money</p>
    <div class="total" id="total">…</div>
    <div class="sub"><span id="pnl"></span><span class="muted" id="bal-note"></span></div>
    <ul class="parts" id="parts" data-tour="breakdown"></ul>
  </section>

  <section class="card" data-tour="topup" id="topup">
    <p class="kicker">Add money</p>
    <h2>Top up your Fren</h2>
    <p class="muted" style="margin-top:6px">Send USDC to one of these addresses from an exchange or your own wallet. Pick the same network on both sides, or the money gets lost. It shows up above in a minute or two.</p>
    <div class="addrs" id="addrs"></div>
  </section>

  <section class="card" id="wait-card" hidden>
    <p class="kicker">Waiting for your OK</p>
    <h2>Fren wants to do this</h2>
    <div id="waits"></div>
  </section>

  <section class="card" id="pos-card">
    <p class="kicker">Open now</p>
    <h2 id="pos-t">What you hold</h2>
    <div class="scroll"><table><thead><tr><th>What</th><th>Where</th><th>Bet</th><th class="num">Amount</th><th class="num">Bought at</th><th class="num">Price now</th><th class="num">Worth</th><th class="num">Up / down</th></tr></thead><tbody id="pos"></tbody></table></div>
    <p class="muted" id="pos-empty" style="margin-top:12px"></p>
  </section>

  <section class="card" data-tour="history">
    <p class="kicker">History</p>
    <h2>What Fren did</h2>
    <p class="muted" style="margin-top:6px">Every trade with a link to the public record, so you can check it yourself.</p>
    <ul class="hist" id="hist"></ul>
    <p class="muted" id="hist-empty" style="margin-top:12px"></p>
    <details><summary>Everything else Fren noted</summary><ul class="ev" id="events"></ul></details>
  </section>

  <section class="card" data-tour="stop">
    <p class="kicker">Safety</p>
    <h2 id="mode-t">…</h2>
    <p class="muted" style="margin-top:6px" id="spent-of"></p>
    <div class="bar"><i id="spent-bar" style="width:0"></i></div>
    <div class="row">
      <button class="btn btn--bad" id="pause">Pause Fren</button>
      <button class="btn" id="resume" hidden>Turn Fren back on</button>
      <button class="btn btn--2" id="closeall">Close everything</button>
    </div>
    <p class="muted" style="margin-top:12px">Pause works at once. Turning back on, closing real trades and raising limits need the code Fren sends to your chat: reply <b>/ok CODE</b> there.</p>
    <div class="msg" id="act-msg"></div>
    <details><summary>Limits: what Fren may do on its own</summary>
    <div class="lim">
      <label>Most per trade ($)<input id="l-maxTradeUsd" inputmode="decimal"></label>
      <label>Most per day ($)<input id="l-maxDailyUsd" inputmode="decimal"></label>
      <label>Most borrowing (x)<input id="l-maxLeverage" inputmode="numeric"></label>
      <label>Trades this small skip your OK ($)<input id="l-autoApproveUsd" inputmode="decimal"></label>
      <label>Most open at once<input id="l-maxOpenPositions" inputmode="numeric"></label>
      <label>Money<select id="l-mode"><option value="paper">Practice money</option><option value="live">Real money</option></select></label>
    </div>
    <div class="row"><button class="btn btn--2" id="save">Save limits</button></div>
    <div class="msg" id="lim-msg"></div>
    </details>
  </section>

  <section class="card" data-tour="keys">
    <p class="kicker">Keys</p>
    <h2>Your wallet keys</h2>
    <p class="muted" style="margin-top:6px">A key is the password to a wallet. Whoever has it owns the money. Keep a copy offline, never send it to anyone, Fren included.</p>
    <div class="keys" id="keys"></div>
    <div class="row"><button class="btn btn--2" id="keys-show">Show keys</button><button class="btn btn--2" id="keys-hide" hidden>Hide</button></div>
    <div class="msg" id="keys-msg"></div>
  </section>

  <section class="card">
    <p class="kicker">Ways in</p>
    <h2>Log in without Telegram</h2>
    <p class="muted" style="margin-top:6px">Add your email or your own wallet, and log in with it next time.</p>
    <span class="lbl">Email</span>
    <div class="field"><input id="si-email" type="email" placeholder="you@example.com"><button class="btn btn--2" id="si-email-save">Save</button></div>
    <span class="lbl">Wallets you log in with</span>
    <div id="si-wallets"></div>
    <div class="row"><button class="btn btn--2" data-link="solana">Add Phantom (Solana)</button><button class="btn btn--2" data-link="evm">Add MetaMask (EVM)</button></div>
    <div class="msg" id="si-msg"></div>
  </section>

  <p class="muted" style="text-align:center">Fren is software you run yourself. Not financial advice.</p>
 </div>

 <aside class="side">
  <section class="card chat" data-tour="chat" id="chat-card">
    <div class="chat__h"><p class="kicker" id="chat-k">Chat</p><h2>Talk to Fren</h2><p class="muted" id="chat-sub" style="margin-top:4px">The same chat as in Telegram.</p></div>
    <div class="chat__list" id="chat"></div>
    <form class="chat__f" id="chat-f"><textarea id="chat-in" rows="1" placeholder="Ask Fren anything"></textarea><button class="btn" id="chat-go">Send</button></form>
    <p class="chat__hint" id="chat-hint">Codes like /ok go in Telegram, where the code arrives.</p>
  </section>
 </aside>
</main>

<div class="modal" id="km" hidden><div class="modal__c">
  <h3>Show your keys?</h3>
  <p>Anyone who sees a key can take the money in that wallet. Make sure nobody is looking at your screen and you're not sharing it.</p>
  <label class="check"><input type="checkbox" id="km-ok"><span>I understand. I'll keep the keys offline and never send them to anyone.</span></label>
  <div id="km-code" hidden><p id="km-t"></p><div class="field"><input id="km-in" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="btn" id="km-go">Show</button></div></div>
  <div class="msg" id="km-msg"></div>
  <div class="row"><button class="btn btn--bad" id="km-next" disabled>Send me a code</button><button class="btn btn--2" id="km-no">Cancel</button></div>
</div></div>

<div class="tour-hole" id="tour-hole" hidden></div>
<div class="tour-tip" id="tour-tip" hidden role="dialog" aria-live="polite">
  <span class="tour-n" id="tour-n"></span>
  <h3 id="tour-h"></h3>
  <p id="tour-p"></p>
  <p class="try" id="tour-try"></p>
  <div class="row"><button class="link" id="tour-skip">Skip</button><span><button class="btn btn--2 btn--sm" id="tour-back">Back</button> <button class="btn btn--sm" id="tour-next">Next</button></span></div>
</div>

<script>
(() => {
  "use strict";
  ${COMMON_JS}
  let limits = null;
  let dirty = false;
  let D = null;

  async function call(path, body) {
    const res = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-fren": "1" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.reload(); throw new Error("logged out"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  const td = (text, cls) => el("td", cls, text);
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

  function renderBalance(d) {
    const b = d.balances;
    $("demo-bar").hidden = !d.demo;
    if (!b) { $("total").textContent = "–"; $("bal-note").textContent = "Couldn't read your balance just now."; return; }
    $("bal-k").textContent = b.mode === "live" ? "All your money" : "All your practice money";
    $("total").textContent = usd(b.totalUsd);
    const p = $("pnl");
    p.className = b.openPnlUsd > 0 ? "up" : b.openPnlUsd < 0 ? "down" : "muted";
    p.textContent = (b.openPnlUsd ? signed(b.openPnlUsd) : "$0.00") + " on what's open now";
    $("bal-note").textContent = (b.startUsd != null ? "Started with " + usd(b.startUsd) + ". " : "") + (b.complete ? "" : "Some places didn't answer, so this may be short.");
    const ul = $("parts");
    ul.replaceChildren();
    // One group per network, its total first, the coins inside under it.
    const nets = [];
    for (const x of b.parts) {
      const k = x.network || x.place;
      let g = nets.find((n) => n.k === k);
      if (!g) nets.push((g = { k, items: [], usd: 0, unknown: false }));
      g.items.push(x);
      if (x.usd == null) g.unknown = true; else g.usd += x.usd;
    }
    for (const g of nets) {
      const h = el("li", "net");
      h.append(el("div", null, g.k), el("div", "usd", g.unknown && !g.usd ? "didn't answer" : usd(g.usd)));
      ul.append(h);
      for (const x of g.items) {
        const li = el("li", "coin");
        const l = el("div");
        const what = x.place && x.place !== g.k ? x.place : x.asset;
        l.append(el("span", null, what));
        if (x.amount != null) l.append(el("div", "amt", Number(x.amount.toFixed(6)).toLocaleString("en-US") + " " + x.asset));
        li.append(l, el("div", "usd", x.usd == null ? "didn't answer" : usd(x.usd)));
        ul.append(li);
      }
    }
    if (!b.parts.length) ul.append(el("li", "muted", "Nothing here yet. Top up below to start."));
  }

  function renderTopUp(d) {
    const w = $("addrs");
    if (w.dataset.done) return;
    w.replaceChildren();
    const a = d.addresses;
    if (!a) { w.append(el("p", "muted", "No wallets yet.")); return; }
    if (d.demo) w.append(el("p", "wait demo-warn", "Demo addresses: don't send anything here, it would be lost."));
    for (const [name, v, note] of [["Solana", a.solana, "USDC or SOL on the Solana network."], ["Base, Arbitrum, Polygon or Hyperliquid", a.evm, "USDC on Base, Arbitrum or Polygon. The same address on all of them."]]) {
      if (!v) continue;
      const box = el("div", "addr-box");
      const copy = el("button", "btn btn--2 btn--sm", "Copy");
      copy.onclick = async () => { try { await navigator.clipboard.writeText(v); } catch { const r = document.createRange(); r.selectNodeContents(box.querySelector(".addr")); getSelection().removeAllRanges(); getSelection().addRange(r); } copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1500); tour.did("topup"); };
      const row = el("div", "row"); row.append(copy);
      box.append(el("h3", null, name), el("p", "muted", note), el("div", "addr", v), row);
      w.append(box);
    }
    w.dataset.done = "1";
  }

  function renderWaiting(d) {
    $("wait-card").hidden = !d.waiting.length;
    const w = $("waits");
    w.replaceChildren();
    for (const x of d.waiting) {
      const box = el("div", "wait");
      box.append(el("p", "muted", when(x.at) + " · you asked: " + x.request));
      for (const s of x.steps) box.append(el("p", null, s));
      if (x.maxLoss) box.append(el("p", "loss", x.maxLoss));
      const p = el("p", "muted"); p.append("To go ahead, reply in Telegram with "); p.append(el("b", null, "/ok") ); p.append(" and the code Fren sent you there. Ignore it and nothing happens.");
      box.append(p);
      w.append(box);
    }
  }

  function renderPositions(d) {
    const body = $("pos");
    body.replaceChildren();
    const venues = { jupiter: "Jupiter", hyperliquid: "Hyperliquid", relay: "Relay", derive: "Derive", polymarket: "Polymarket", yield: "Savings" };
    const side = { long: "Price goes up", short: "Price goes down", hold: "Holding" };
    for (const p of d.positions) {
      const tr = el("tr");
      tr.append(td(p.symbol), td(venues[p.venue] || p.venue), td(side[p.side] || p.side), td(String(Number(p.size.toFixed(4))), "num"), td(px(p.entryPx), "num"), td(px(p.markPx), "num"), td(usd(p.valueUsd), "num"), td(signed(p.pnlUsd), "num " + (p.pnlUsd > 0 ? "up" : p.pnlUsd < 0 ? "down" : "")));
      body.append(tr);
    }
    $("pos-t").textContent = d.positions.length ? "What you hold (" + d.positions.length + ")" : "What you hold";
    $("pos-empty").textContent = d.positionsError ? "Couldn't load this just now: " + d.positionsError : d.positions.length ? "" : "Nothing open right now.";
  }

  function renderHistory(d) {
    const ul = $("hist");
    ul.replaceChildren();
    const st = { done: ["Done", "tag--ok"], failed: ["Didn't go through", "tag--bad"], cancelled: ["Cancelled", ""], active: ["Watching the price", "tag--wait"], rejected: ["Blocked by your limits", "tag--bad"] };
    for (const h of d.history) {
      const li = el("li");
      const top = el("div", "when", when(h.at) + (h.mode === "paper" ? " · practice" : " · real money"));
      const s = h.steps.some((x) => x.status === "failed") ? st.failed : st[h.status] || [h.status, ""];
      top.append(el("span", "tag " + s[1], s[0]));
      li.append(top, el("div", "ask", h.request));
      if (h.result) li.append(el("div", "res", h.result));
      else for (const x of h.steps) li.append(el("div", "res", x.text));
      if (h.links.length) {
        const c = el("div", "chips");
        for (const l of h.links) { const a = el("a", "chip", l.label); a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer"; c.append(a); }
        li.append(c);
      } else if (h.mode === "paper") li.append(el("div", "when", "Practice trade: nothing goes on the public record."));
      ul.append(li);
    }
    $("hist-empty").textContent = d.history.length ? "" : "Nothing yet. Ask Fren in the chat, e.g. \\"buy $20 of SOL\\".";
    const ev = $("events");
    ev.replaceChildren();
    for (const e of d.events) { const li = el("li"); li.append(el("time", null, when(e.at)), document.createTextNode(e.text)); ev.append(li); }
  }

  function renderSafety(d) {
    limits = d.limits;
    const l = d.limits;
    const state = l.paused ? "stopped" : l.mode;
    $("pill").className = "pill " + state;
    $("pill-t").textContent = l.paused ? "Paused" : l.mode === "live" ? "Real money" : "Practice money";
    $("mode-t").textContent = l.paused ? "Fren is paused" : l.mode === "live" ? "Fren trades with real money" : "Fren trades with practice money";
    $("spent-of").textContent = usd(d.spentTodayUsd) + " spent today, of " + usd(l.maxDailyUsd) + " allowed. Trades over " + usd(l.autoApproveUsd) + " wait for your OK.";
    $("spent-bar").style.width = Math.min(100, (100 * d.spentTodayUsd) / Math.max(1, l.maxDailyUsd)) + "%";
    $("pause").hidden = l.paused;
    $("resume").hidden = !l.paused;
    if (!dirty) {
      for (const k of ["maxTradeUsd", "maxDailyUsd", "maxLeverage", "autoApproveUsd", "maxOpenPositions"]) $("l-" + k).value = l[k];
      $("l-mode").value = l.mode;
    }
  }

  let keysShown = null;
  let hideTimer = 0;
  function renderKeys(d) {
    const w = $("keys");
    const rows = keysShown || [{ label: "Solana wallet key", value: null }, { label: "EVM wallet key (Base, Arbitrum, Polygon)", value: null }, { label: "Hyperliquid trading key", value: null }];
    w.replaceChildren();
    for (const k of rows) {
      const r = el("div", "key" + (k.value ? " shown" : ""));
      const t = el("div"); t.append(el("b", null, k.label), el("code", null, k.value || "••••••••••••••••••••••••••••••••"));
      r.append(t);
      if (k.value) { const c = el("button", "btn btn--2 btn--sm", "Copy"); c.onclick = () => navigator.clipboard.writeText(k.value).then(() => (c.textContent = "Copied")); r.append(c); }
      w.append(r);
    }
    $("keys-hide").hidden = !keysShown;
    $("keys-show").hidden = Boolean(keysShown);
  }
  function hideKeys() { keysShown = null; clearTimeout(hideTimer); renderKeys(D); $("keys-msg").textContent = ""; }

  function renderSignIn(d) {
    const s = d.signIn;
    if (document.activeElement !== $("si-email")) $("si-email").value = s.email || "";
    const w = $("si-wallets");
    w.replaceChildren();
    if (!s.wallets.length) w.append(el("p", "muted", "None yet."));
    for (const x of s.wallets) {
      const r = el("div", "key"); const t = el("div"); t.append(el("b", null, x.kind === "evm" ? "MetaMask (EVM)" : "Phantom (Solana)"), el("code", null, x.address));
      const rm = el("button", "btn btn--2 btn--sm", "Remove");
      rm.onclick = () => call("sign-in/wallet/remove", x).then(load);
      r.append(t, rm); w.append(r);
    }
  }

  function render(d) {
    D = d;
    renderBalance(d); renderTopUp(d); renderWaiting(d); renderPositions(d); renderHistory(d); renderSafety(d); renderSignIn(d);
    if (!keysShown) renderKeys(d);
    $("chat-card").hidden = !d.chat;
  }

  async function load() { try { render(await call("overview")); } catch (e) { if (e.message !== "logged out") $("act-msg").textContent = e.message; } }

  // ---- chat -------------------------------------------------------------
  let chatSig = "";
  async function loadChat() {
    if (D && !D.chat) return;
    let s;
    try { s = await call("chat"); } catch (e) { $("chat-sub").textContent = e.message; return; }
    const ch = s.channel ? s.channel[0].toUpperCase() + s.channel.slice(1) : "your chat app";
    $("chat-sub").textContent = "The same chat as in " + ch + ". Write here or there.";
    const sig = s.messages.map((m) => m.id).join() + s.thinking;
    if (sig === chatSig) return;
    chatSig = sig;
    const list = $("chat");
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.replaceChildren();
    if (!s.messages.length) list.append(el("p", "muted", "No messages yet. Say hi."));
    for (const m of s.messages) {
      const w = el("div", "m m--" + m.from);
      w.append(el("div", "bub", m.text), el("time", null, (m.from === "you" ? "You · " : "Fren · ") + when(new Date(m.at).toISOString())));
      list.append(w);
    }
    if (s.thinking) { const w = el("div", "m m--fren"); w.append(el("div", "bub typing", "Fren is thinking…")); list.append(w); }
    if (atEnd || s.thinking) list.scrollTop = list.scrollHeight;
  }
  $("chat-f").onsubmit = async (ev) => {
    ev.preventDefault();
    const t = $("chat-in").value.trim();
    if (!t) return;
    $("chat-go").disabled = true;
    try {
      const r = await call("chat", { text: t });
      if (r.hint) $("chat-hint").textContent = r.hint;
      else { $("chat-in").value = ""; $("chat-hint").textContent = "Sent. The answer also lands in Telegram."; tour.did("chat"); }
      await loadChat();
      $("chat").scrollTop = $("chat").scrollHeight;
    } catch (e) { $("chat-hint").textContent = e.message; }
    $("chat-go").disabled = false;
  };
  $("chat-in").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chat-f").requestSubmit(); } };

  // ---- safety -------------------------------------------------------------
  const act = async (path, body) => { try { const r = await call(path, body); $("act-msg").textContent = r.text; await load(); } catch (e) { $("act-msg").textContent = e.message; } };
  $("pause").onclick = () => { tour.did("stop"); act("pause"); };
  $("resume").onclick = () => act("resume");
  $("closeall").onclick = () => { if (confirm("Close everything Fren holds? It sells at today's price.")) act("close_all"); };
  for (const k of ["maxTradeUsd", "maxDailyUsd", "maxLeverage", "autoApproveUsd", "maxOpenPositions", "mode"]) $("l-" + k).oninput = () => (dirty = true);
  $("save").onclick = async () => {
    const map = { maxTradeUsd: "max_trade", maxDailyUsd: "max_daily", maxLeverage: "max_leverage", autoApproveUsd: "auto_approve", maxOpenPositions: "max_positions", mode: "mode" };
    const parts = [];
    for (const [k, name] of Object.entries(map)) { const v = $("l-" + k).value.trim(); if (String(limits[k]) !== v) parts.push(name + "=" + v); }
    if (!parts.length) { $("lim-msg").textContent = "Nothing changed."; return; }
    try { const r = await call("limits", { args: parts.join(" ") }); $("lim-msg").textContent = r.text; dirty = false; await load(); } catch (e) { $("lim-msg").textContent = e.message; }
  };
  $("logout").onclick = async () => { await call("logout", {}).catch(() => null); location.reload(); };

  // ---- keys ---------------------------------------------------------------
  const km = $("km");
  function closeKm() { km.hidden = true; $("km-ok").checked = false; $("km-next").disabled = true; $("km-code").hidden = true; $("km-next").hidden = false; $("km-msg").textContent = ""; $("km-in").value = ""; }
  $("keys-show").onclick = () => { km.hidden = false; tour.did("keys"); };
  $("keys-hide").onclick = hideKeys;
  $("km-no").onclick = closeKm;
  $("km-ok").onchange = () => ($("km-next").disabled = !$("km-ok").checked);
  $("km-next").onclick = async () => {
    try {
      const r = await call("keys/request", {});
      if (r.locked) { closeKm(); $("keys-msg").textContent = r.text; return; }
      $("km-t").textContent = r.text;
      $("km-msg").textContent = r.demoNote || "";
      $("km-code").hidden = false; $("km-next").hidden = true; $("km-in").focus();
    } catch (e) { $("km-msg").textContent = e.message; }
  };
  $("km-go").onclick = async () => {
    try {
      const r = await call("keys/reveal", { code: $("km-in").value });
      keysShown = r.keys; closeKm(); renderKeys(D);
      $("keys-msg").textContent = "Shown for 60 seconds, then hidden again.";
      clearTimeout(hideTimer); hideTimer = setTimeout(hideKeys, 60_000);
    } catch (e) { $("km-msg").textContent = e.message; }
  };

  // ---- sign-in methods ------------------------------------------------------
  $("si-email-save").onclick = async () => {
    try { const r = await call("sign-in/email", { email: $("si-email").value }); $("si-msg").textContent = r.email ? "Saved. Next time you can log in with a code sent to " + r.email + "." : "Email login is off."; }
    catch (e) { $("si-msg").textContent = e.message; }
  };
  for (const b of document.querySelectorAll("[data-link]")) b.onclick = async () => {
    const kind = b.dataset.link;
    try {
      let id = "";
      const s = await walletSign(kind, async (address) => { const c = await call("sign-in/wallet/challenge", { kind, address }); id = c.id; return c.message; });
      await call("sign-in/wallet/link", { kind, id, address: s.address, signature: s.signature });
      $("si-msg").textContent = "Added. Next time you can log in with this wallet.";
      await load();
    } catch (e) { $("si-msg").textContent = e.message; }
  };

  // ---- the tour -------------------------------------------------------------
  const STEPS = [
    { k: "balance", h: "This is all your money", p: "One number for everything Fren holds for you, in dollars, wherever it sits.", t: "Look: is it the amount you expect?" },
    { k: "breakdown", h: "Where it sits", p: "The same money, split by network and wallet. If something's missing, it's usually on a network you didn't expect.", t: "Find the biggest line." },
    { k: "topup", h: "Add money here", p: "Copy an address and send USDC to it from an exchange or your wallet. Same network on both sides.", t: "Press Copy on one of the addresses.", act: true },
    { k: "chat", bottom: true, h: "Talk to Fren", p: "This is your Telegram chat with Fren, right here. Ask what you hold or what to do; before any trade Fren says the most you can lose.", t: "Send Fren a message, e.g. \\"what do I hold?\\"", act: true },
    { k: "history", h: "Check every trade", p: "Everything Fren did, with a link to the public record. You don't have to trust us: click and see.", t: "Open one of the links." },
    { k: "stop", h: "Stop anytime", p: "Pause works at once and stops new trades. Turning back on needs the code from your chat, so nobody else can.", t: "You don't have to press it now. Just know it's here." },
    { k: "keys", h: "Your keys stay hidden", p: "A key is the password to a wallet. It's hidden; to see it you confirm twice, and it hides itself again.", t: "Press Show keys to see how it works.", act: true },
  ];
  const tour = (() => {
    let i = -1;
    const done = new Set();
    const hole = $("tour-hole"), tip = $("tour-tip");
    const target = () => document.querySelector('[data-tour="' + STEPS[i].k + '"]');
    const tall = () => Boolean(STEPS[i].bottom) && target().getBoundingClientRect().height > innerHeight * 0.45;
    function place() {
      if (i < 0) return;
      const t = target();
      if (!t) return;
      const r = t.getBoundingClientRect();
      const pad = 8;
      Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + 2 * pad + "px", height: r.height + 2 * pad + "px" });
      if (innerWidth <= 520) { tip.style.left = ""; tip.style.top = ""; tip.classList.toggle("at-top", tall()); return; }
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let left = r.right + 20, top = Math.max(12, r.top);
      if (left + w > innerWidth - 12) left = r.left - w - 20;
      if (left < 12) { left = Math.min(Math.max(12, r.left), innerWidth - w - 12); top = r.bottom + 16; if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 16); }
      top = Math.min(top, innerHeight - h - 12);
      tip.style.left = left + "px"; tip.style.top = top + "px";
    }
    function show(n) {
      i = n;
      const s = STEPS[i];
      hole.hidden = tip.hidden = false;
      $("tour-n").textContent = "Step " + (i + 1) + " of " + STEPS.length;
      $("tour-h").textContent = s.h; $("tour-p").textContent = s.p;
      const t = $("tour-try"); t.textContent = (done.has(s.k) ? "✓ Done. " : "Try it: ") + s.t; t.className = "try" + (done.has(s.k) ? " done" : "");
      $("tour-back").disabled = i === 0;
      $("tour-next").textContent = i === STEPS.length - 1 ? "Finish" : "Next";
      const el = target();
      // Phones: the tooltip sits at the bottom, over the page. A tall block
      // (the chat) goes to the bottom instead, with the tooltip on top, so its
      // send box stays free.
      const r = el.getBoundingClientRect();
      const phone = innerWidth <= 520;
      const y = phone && tall() ? scrollY + r.bottom - innerHeight + 16 : scrollY + r.top - (phone ? 76 : Math.max(76, (innerHeight - Math.min(r.height, innerHeight - 160)) / 2));
      scrollTo({ top: Math.max(0, y), behavior: "instant" });
      requestAnimationFrame(place);
    }
    function end() { i = -1; hole.hidden = tip.hidden = true; try { localStorage.setItem("fren_tour_v1", "done"); } catch {} }
    $("tour-next").onclick = () => (i >= STEPS.length - 1 ? end() : show(i + 1));
    $("tour-back").onclick = () => i > 0 && show(i - 1);
    $("tour-skip").onclick = end;
    $("tour-open").onclick = () => show(0);
    addEventListener("resize", place);
    addEventListener("scroll", place, { passive: true });
    return {
      start: () => show(0),
      seen: () => { try { return localStorage.getItem("fren_tour_v1") === "done"; } catch { return true; } },
      did(k) { done.add(k); if (i >= 0 && STEPS[i].k === k) { const t = $("tour-try"); t.textContent = "✓ Done. " + STEPS[i].t; t.className = "try done"; if (k !== "keys") setTimeout(() => i >= 0 && STEPS[i].k === k && $("tour-next").click(), 900); } },
      go: show,
    };
  })();
  window.__frenTour = tour;

  load().then(() => { if (!tour.seen() && !location.hash.includes("notour")) tour.start(); });
  loadChat();
  setInterval(load, 15_000);
  setInterval(loadChat, 4_000);
})();
</script>
</body></html>`;
