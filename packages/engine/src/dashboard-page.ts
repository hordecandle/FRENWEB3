/** The owner's dashboard page. Self-contained: no requests leave this server except fonts. All data goes in with textContent. */

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@300..700&display=swap">
<style>
:root{--bg:#fff;--soft:#f5f5f5;--ink:#000;--ink-2:#2a2a2a;--muted:#5e5e5e;--faint:#cfcfcf;--line:#e3e3e3;--blue:#a5caff;--ok:#1f8a4c;--bad:#b42318;
--font:"Geologica",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;--sh-btn:2px 3px 0 var(--ink);--sh-card:4px 5px 0 var(--ink)}
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
</style>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const LOGIN_PAGE = (message: string) => `<!doctype html><html lang="en"><head>${HEAD}<title>Fren dashboard</title></head>
<body><div class="center"><div class="brand">Fren<small>dashboard</small></div><p class="muted">${esc(message)}</p></div></body></html>`;

export const DASHBOARD_PAGE = `<!doctype html><html lang="en"><head>${HEAD}<title>Fren dashboard</title></head>
<body>
<header class="top"><div class="top__in"><div class="brand">Fren<small>dashboard</small></div><span class="pill" id="pill"><i></i><span id="pill-t">Loading…</span></span></div></header>
<main class="page">
  <section class="card">
    <p class="kicker">Today</p>
    <h2 id="mode-t">…</h2>
    <div class="big" id="spent">$0</div>
    <p class="muted" id="spent-of">spent today</p>
    <div class="bar"><i id="spent-bar" style="width:0"></i></div>
    <p class="muted" id="paper" style="margin-top:12px"></p>
    <div class="row">
      <button class="btn btn--bad" id="pause">Pause Fren</button>
      <button class="btn" id="resume" hidden>Turn Fren back on</button>
      <button class="btn btn--2" id="closeall">Close all positions</button>
    </div>
    <p class="muted" style="margin-top:12px">Pausing works at once. Turning back on, closing live positions and raising limits need the code Fren sends to your chat: reply <b>/ok CODE</b> there.</p>
    <div class="msg" id="act-msg"></div>
  </section>

  <section class="card">
    <p class="kicker">Limits</p>
    <h2>What Fren may do</h2>
    <div class="lim">
      <label>Per trade ($)<input id="l-maxTradeUsd" inputmode="decimal"></label>
      <label>Per day ($)<input id="l-maxDailyUsd" inputmode="decimal"></label>
      <label>Max leverage (x)<input id="l-maxLeverage" inputmode="numeric"></label>
      <label>Auto-approve up to ($)<input id="l-autoApproveUsd" inputmode="decimal"></label>
      <label>Max open positions<input id="l-maxOpenPositions" inputmode="numeric"></label>
      <label>Mode<select id="l-mode"><option value="paper">Paper</option><option value="live">Live (real money)</option></select></label>
    </div>
    <div class="row"><button class="btn btn--2" id="save">Save limits</button></div>
    <div class="msg" id="lim-msg"></div>
  </section>

  <section class="card card--wide">
    <p class="kicker">Positions</p>
    <h2 id="pos-t">Open positions</h2>
    <div class="scroll"><table><thead><tr><th>Market</th><th>Venue</th><th>Side</th><th class="num">Size</th><th class="num">Entry</th><th class="num">Now</th><th class="num">Value</th><th class="num">PnL</th></tr></thead><tbody id="pos"></tbody></table></div>
    <p class="muted" id="pos-empty" style="margin-top:12px"></p>
  </section>

  <section class="card">
    <p class="kicker">Wallets</p>
    <h2>Your addresses</h2>
    <p class="muted" style="margin-top:6px">The keys live only on this server. Send funds here.</p>
    <div id="wallets"></div>
  </section>

  <section class="card">
    <p class="kicker">Activity</p>
    <h2>What Fren did lately</h2>
    <ul class="ev" id="events"></ul>
    <p class="muted" id="ev-empty"></p>
  </section>

  <p class="muted card--wide" style="text-align:center">Fren is software you run yourself. Not financial advice. <button class="link" id="logout">Log out</button></p>
</main>
<script>
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const usd = (n) => (n == null || !isFinite(n) ? "–" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(n) < 1000 ? 2 : 0 }));
  const px = (n) => (n == null ? "–" : "$" + Number(n).toLocaleString("en-US", { maximumSignificantDigits: 6 }));
  let limits = null;
  let dirty = false;

  async function call(path, body) {
    const res = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-fren": "1" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.reload(); throw new Error("logged out"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function td(text, cls) { const el = document.createElement("td"); el.textContent = text; if (cls) el.className = cls; return el; }

  function render(d) {
    limits = d.limits;
    const l = d.limits;
    const state = l.paused ? "stopped" : l.mode;
    $("pill").className = "pill " + state;
    $("pill-t").textContent = l.paused ? "Paused" : l.mode === "live" ? "Live" : "Paper mode";
    $("mode-t").textContent = l.paused ? "Fren is paused" : l.mode === "live" ? "Trading with real money" : "Paper mode: pretend money";
    $("spent").textContent = usd(d.spentTodayUsd);
    $("spent-of").textContent = "spent today, of " + usd(l.maxDailyUsd) + " allowed";
    $("spent-bar").style.width = Math.min(100, (100 * d.spentTodayUsd) / Math.max(1, l.maxDailyUsd)) + "%";
    $("paper").textContent = d.paperUsdc != null ? "Paper balance: " + usd(d.paperUsdc) : "";
    $("pause").hidden = l.paused;
    $("resume").hidden = !l.paused;

    if (!dirty) {
      for (const k of ["maxTradeUsd", "maxDailyUsd", "maxLeverage", "autoApproveUsd", "maxOpenPositions"]) $("l-" + k).value = l[k];
      $("l-mode").value = l.mode;
    }

    const body = $("pos");
    body.replaceChildren();
    for (const p of d.positions) {
      const tr = document.createElement("tr");
      const pnlCls = "num " + (p.pnlUsd > 0 ? "up" : p.pnlUsd < 0 ? "down" : "");
      tr.append(td(p.symbol), td(p.venue), td(p.side), td(String(Number(p.size.toFixed(4))), "num"), td(px(p.entryPx), "num"), td(px(p.markPx), "num"), td(usd(p.valueUsd), "num"), td(p.pnlUsd == null ? "–" : (p.pnlUsd > 0 ? "+" : "") + usd(p.pnlUsd), pnlCls));
      body.append(tr);
    }
    $("pos-t").textContent = d.positions.length ? "Open positions (" + d.positions.length + ")" : "Open positions";
    $("pos-empty").textContent = d.positionsError ? "Couldn't load positions: " + d.positionsError : d.positions.length ? "" : "Nothing open right now." + (d.waitingForCode.length ? " Waiting for your /ok code: " + d.waitingForCode.join(", ") : "");

    const w = $("wallets");
    w.replaceChildren();
    const a = d.addresses;
    if (!a) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "No wallets yet."; w.append(p); }
    else for (const [name, v] of [["Solana", a.solana], ["EVM (Hyperliquid, Base, Arbitrum, Polygon)", a.evm]]) {
      if (!v) continue;
      const l1 = document.createElement("span"); l1.className = "lbl"; l1.textContent = name;
      const l2 = document.createElement("div"); l2.className = "addr"; l2.textContent = v;
      w.append(l1, l2);
    }

    const ev = $("events");
    ev.replaceChildren();
    for (const e of d.events) {
      const li = document.createElement("li");
      const t = document.createElement("time"); t.textContent = new Date(e.at.replace(" ", "T") + (/[zZ+]/.test(e.at) ? "" : "Z")).toLocaleString();
      li.append(t, document.createTextNode(e.text));
      ev.append(li);
    }
    $("ev-empty").textContent = d.events.length ? "" : "Nothing yet. Trades, alerts and fills show up here.";
  }

  async function refresh() {
    try { render(await call("overview")); } catch (e) { if (e.message !== "logged out") $("act-msg").textContent = e.message; }
  }

  async function act(btn, path, body, out) {
    btn.disabled = true;
    try { const r = await call(path, body || {}); $(out).textContent = r.text; await refresh(); }
    catch (e) { $(out).textContent = e.message; }
    finally { btn.disabled = false; }
  }

  $("pause").onclick = () => act($("pause"), "pause", {}, "act-msg");
  $("resume").onclick = () => act($("resume"), "resume", {}, "act-msg");
  $("closeall").onclick = () => act($("closeall"), "close_all", {}, "act-msg");
  document.querySelectorAll(".lim input,.lim select").forEach((el) => el.addEventListener("input", () => (dirty = true)));
  $("save").onclick = () => {
    if (!limits) return;
    const parts = [];
    for (const k of ["maxTradeUsd", "maxDailyUsd", "maxLeverage", "autoApproveUsd", "maxOpenPositions"]) {
      const v = $("l-" + k).value.trim();
      if (v !== "" && Number(v) !== limits[k]) parts.push(k + "=" + v);
    }
    if ($("l-mode").value !== limits.mode) parts.push("mode=" + $("l-mode").value);
    if (!parts.length) { $("lim-msg").textContent = "Nothing changed."; return; }
    dirty = false;
    act($("save"), "limits", { args: parts.join(" ") }, "lim-msg");
  };
  $("logout").onclick = async () => { await call("logout", {}).catch(() => {}); location.reload(); };

  refresh();
  setInterval(refresh, 15000);
})();
</script>
</body></html>`;
