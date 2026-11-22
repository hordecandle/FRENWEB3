/** The browser setup page served by `fren setup --web`. Self-contained: no requests leave this server except fonts. */
export const SETUP_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<title>Set up your Fren</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@300..700&display=swap">
<style>

/* ===== Tokens (из site/public/styles.css лендинга, без изменений цвета) ===== */
:root{
  --bg:#fff; --soft:#f5f5f5; --ink:#000; --ink-2:#2a2a2a; --muted:#5e5e5e; --faint:#cfcfcf; --line:#e3e3e3;
  --blue:#a5caff; --ok:#1f8a4c; --bad:#b42318; --cta-gap:40px; --cap-gap:24px;
  --font:"Geologica",system-ui,sans-serif; --mono:ui-monospace,"SF Mono",Menlo,monospace;
  --r-btn:12px; --r-field:12px; --r-card:22px; --r-note:14px; --r-chip:999px;
  --sh-btn:2px 3px 0 var(--ink); --sh-btn-sm:1.5px 2px 0 var(--ink); --sh-card:4px 5px 0 var(--ink);
  --ease:cubic-bezier(.2,.8,.2,1);
  --header:64px; --page:640px; --wide:1120px;
}
*,:before,:after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased;font-size:16px}
h1,h2,h3,p{margin:0} a{color:inherit}
.ic{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ic--s{width:16px;height:16px}

/* ===== Header ===== */
.top{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--line)}
.top__in{max-width:var(--wide);margin:0 auto;padding:0 24px;height:var(--header);display:flex;align-items:center;justify-content:space-between}
.logo{width:84px;height:20px;display:block}
.logo-a{display:flex;align-items:center;gap:8px}
.beta{color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 7px;font-size:10px;font-weight:500;letter-spacing:.06em;line-height:1.3;text-transform:uppercase}
.top__step{font-size:14px;font-weight:500;color:var(--muted)}
.top__step b{color:var(--ink);font-weight:500}

/* ===== Trust strip (только setup на сервере) ===== */
.trust{background:var(--soft);border-bottom:1px solid var(--line);font-size:13px;color:var(--ink-2)}
.trust__in{max-width:var(--wide);margin:0 auto;padding:9px 24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.trust__in .ic{width:16px;height:16px;color:var(--ok)}
.trust__ip{font-family:var(--mono);font-size:12.5px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.trust__dot{color:var(--faint)}
@media (max-width:720px){.trust .t-wide{display:none}.trust__in{padding:8px 20px;flex-wrap:nowrap}}

/* ===== Rail: полоса шагов ===== */
.rail{list-style:none;margin:0 auto;padding:28px 24px 0;max-width:var(--page);display:flex;align-items:center;gap:0}
.rail li{display:flex;align-items:center;flex:1 1 auto;min-width:0}
.rail li:last-child{flex:0 0 auto}
.rail .n{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px 0 3px;border-radius:var(--r-chip);font-size:13px;font-weight:500;color:var(--muted);white-space:nowrap}
.rail .n i{font-style:normal;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:1px solid var(--faint);background:var(--bg);font-size:12px;font-weight:600}
.rail .bar{flex:1 1 auto;height:1px;background:var(--line);margin:0 4px;min-width:8px}
.rail .done .n{color:var(--ink)}
.rail .done .n i{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.rail .done .bar{background:var(--ink)}
.rail .now .n{background:var(--blue);color:var(--ink);box-shadow:0 0 0 1px var(--ink),var(--sh-btn-sm)}
.rail .now .n i{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.rail .live .n i{border-style:dashed}
.rail .live.now .n i, .rail .live.done .n i{border-style:solid}
@media (max-width:720px){
  .rail{padding:20px 20px 0}
  .rail li:not(.now) .n{padding:0}
  .rail li:not(.now) .n span{display:none}
  .rail .n{height:28px}
}

/* ===== Page + card ===== */
.page{max-width:var(--page);margin:0 auto;padding:24px 24px 72px}
.card{border:1px solid var(--ink);border-radius:var(--r-card);box-shadow:var(--sh-card);background:var(--bg);padding:clamp(22px,3.4vw,36px)}
.kicker{font-size:13px;font-weight:500;color:var(--muted);letter-spacing:.01em;margin-bottom:10px}
.card h2{font-size:clamp(26px,3vw,34px);font-weight:500;letter-spacing:-.03em;line-height:1.08}
.lead{color:var(--muted);margin-top:10px;font-size:17px;font-weight:300;line-height:1.5}
.lead b{color:var(--ink);font-weight:500}
.plq{background:var(--blue);border-radius:.22em;padding:0 .22em .06em;display:inline-block;line-height:1.05}

/* ===== Buttons ===== */
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:var(--cta-gap)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;padding:11px 22px;border:1px solid var(--ink);border-radius:var(--r-btn);background:var(--blue);color:var(--ink);box-shadow:var(--sh-btn);font:inherit;font-size:16px;font-weight:500;letter-spacing:-.01em;text-decoration:none;cursor:pointer;transition:transform .12s,box-shadow .12s}
.btn:hover{transform:translate(1px,1.5px);box-shadow:1px 1.5px 0 var(--ink)}
.btn:active{transform:translate(2px,3px);box-shadow:0 0 0 var(--ink)}
.btn:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.btn--2{background:var(--bg)}
.btn--sm{min-height:36px;padding:7px 14px;font-size:14px;box-shadow:var(--sh-btn-sm)}
.btn--xl{min-height:60px;padding:14px 30px;font-size:19px;border-radius:14px;box-shadow:3px 4px 0 var(--ink)}
.btn[disabled]{opacity:.45;pointer-events:none}
.waitbox{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:var(--muted);font-weight:300}
.waitbox[hidden]{display:none}
.link{background:none;border:0;padding:0;font:inherit;font-size:14px;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
@media (max-width:520px){.actions .btn:not(.btn--sm){width:100%}}

/* ===== Fields ===== */
.field{display:block;margin-top:22px}
.field>span{display:block;font-size:14px;font-weight:500;margin-bottom:8px}
.field input,.field select{width:100%;font:inherit;font-size:17px;padding:12px 14px;border:1px solid var(--ink);border-radius:var(--r-field);background:var(--bg);color:var(--ink);appearance:none}
.field select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:40px}
.field input:focus,.field select:focus{outline:2px solid var(--blue);outline-offset:1px}
.field small{display:block;margin-top:7px;color:var(--muted);font-size:13px;font-weight:300;line-height:1.45}
.field--bad input{border-color:var(--bad)}
.msg{display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:14px;line-height:1.45}
.msg .ic{width:18px;height:18px;margin-top:1px}
.msg--bad{color:var(--bad)} .msg--ok{color:var(--ok)}

/* ===== Note (мягкая плашка) ===== */
.note{margin-top:20px;background:var(--soft);border-radius:var(--r-note);padding:14px 16px;font-size:14px;font-weight:300;line-height:1.5;display:flex;gap:12px;align-items:flex-start}
.note .ic{margin-top:1px}
.note b{font-weight:500}
.note code,.mono{font-family:var(--mono);font-size:.92em;white-space:nowrap}

/* ===== Plan, pay, build ===== */
.plan{margin-top:22px;border:1px solid var(--ink);border-radius:16px;box-shadow:var(--sh-btn);padding:16px 18px;display:flex;justify-content:space-between;gap:16px;align-items:flex-end;flex-wrap:wrap}
.plan b{font-size:16px;font-weight:500}
.plan small{display:block;margin-top:4px;color:var(--muted);font-size:13px;font-weight:300}
.price{font-size:30px;font-weight:600;letter-spacing:-.02em}
.price small{display:inline;font-size:14px;color:var(--muted);font-weight:300;letter-spacing:0}
.pay{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:start;margin-top:20px}
.pay__amount{font-size:48px;font-weight:600;letter-spacing:-.035em;line-height:1}
.pay__amount small{font-size:16px;font-weight:300;color:var(--muted);letter-spacing:0}
.qr{border:1px solid var(--line);border-radius:16px;padding:10px;line-height:0}
.qr svg{width:148px;height:148px}
@media (max-width:520px){.pay{grid-template-columns:1fr}.qr{display:none}}
.wait{display:flex;align-items:center;gap:12px;margin-top:22px;font-size:15px;color:var(--muted)}
.wait svg{width:36px;flex:none}
.build{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:12px}
.build li{display:flex;align-items:center;gap:12px;font-size:16px;color:var(--muted)}
.build .dot{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--faint);flex:none;display:grid;place-items:center}
.build .is-now{color:var(--ink);font-weight:500}
.build .is-now .dot{border-color:var(--ink);border-top-color:transparent;animation:spin .9s linear infinite}
.build .is-done{color:var(--ink)}
.build .is-done .dot{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.build .is-done .dot .ic{width:13px;height:13px;stroke-width:2.6}
@keyframes spin{to{transform:rotate(360deg)}}
.progress{margin-top:16px;height:6px;border-radius:99px;background:var(--soft);overflow:hidden}
.progress i{display:block;height:100%;width:62%;background:var(--ink);border-radius:99px}
.hint{margin-top:10px;font-size:13px;color:var(--muted);font-weight:300}
/* round 8: caption under a button = 16px, caption lines 8px apart */
.actions + .hint,.actions + .msg,.actions + .err{margin-top:var(--cap-gap)}
.hint + .hint{margin-top:12px}
.hint{line-height:1.6}
@media (width<480px){:root{--cta-gap:32px}}

/* ===== Error details ===== */
.details{margin-top:20px;border-top:1px solid var(--line);padding-top:14px}
.details summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:500;color:var(--muted)}
.details summary::-webkit-details-marker{display:none}
.details summary .ic{width:16px;height:16px;transition:transform .2s var(--ease)}
.details[open] summary .ic{transform:rotate(180deg)}
.details pre{margin:12px 0 0;max-height:180px;overflow:auto;background:var(--soft);border-radius:10px;padding:12px 14px;font-family:var(--mono);font-size:12px;line-height:1.55;color:var(--ink-2);white-space:pre-wrap}
.details .btn{margin-top:var(--cta-gap)}

/* ===== Ready mark ===== */
.badge-ok{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--blue);border:1px solid var(--ink);box-shadow:var(--sh-btn-sm);margin-bottom:18px}
.badge-ok .ic{width:26px;height:26px;stroke-width:2.2}
.copyrow{display:flex;gap:8px;margin-top:var(--cta-gap);align-items:stretch}
.copyrow .url{flex:1;min-width:0;font-family:var(--mono);font-size:13px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ===== Choice tiles (provider, chat) ===== */
.how{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:8px;counter-reset:h}
.how li{counter-increment:h;display:flex;gap:10px;font-size:14px;font-weight:300;line-height:1.45;color:var(--ink-2)}
.how li:before{content:counter(h);flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--soft);font-size:12px;font-weight:600;color:var(--ink)}
.rec{display:inline-flex;align-items:center;gap:6px;margin-left:6px;background:var(--blue);border:1px solid var(--ink);border-radius:var(--r-chip);padding:1px 8px;font-size:11px;font-weight:500;vertical-align:middle}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}
@media (max-width:520px){.tiles{grid-template-columns:1fr}}
.tile{text-align:left;border:1px solid var(--line);border-radius:16px;padding:16px;background:var(--bg);font:inherit;cursor:pointer}
.tile.is-on{border-color:var(--ink);box-shadow:var(--sh-btn)}
.tile b{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:500}
.tile small{display:block;margin-top:6px;color:var(--muted);font-size:13px;font-weight:300;line-height:1.45}
.botchip{display:flex;align-items:center;gap:12px;margin-top:20px;border:1px solid var(--ink);border-radius:16px;padding:12px 14px;box-shadow:var(--sh-btn-sm)}
.botchip .av{width:40px;height:40px;border-radius:50%;background:var(--ink);display:grid;place-items:center;flex:none}
.botchip .av svg{width:24px;fill:#fff}
.botchip b{font-size:17px;font-weight:600;letter-spacing:-.01em;display:block}
.botchip small{color:var(--muted);font-size:13px;font-weight:300}
.botchip .ok{margin-left:auto;color:var(--ok)}
.addr{font-family:var(--mono);font-size:13px;word-break:break-all;background:var(--soft);padding:10px 12px;border-radius:10px;margin-top:6px}
.lbl{display:block;margin-top:16px;font-size:14px;font-weight:500}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-size:15px;line-height:1.4;cursor:pointer}
.check .box{width:22px;height:22px;border:1px solid var(--ink);border-radius:6px;flex:none;display:grid;place-items:center;background:var(--blue)}
.check .box .ic{width:14px;height:14px;stroke-width:2.6}

/* ===== Final ===== */
.final{max-width:880px;margin:0 auto;padding:clamp(48px,9vh,96px) 24px 64px;text-align:center}
.final h1{white-space:nowrap;font-size:clamp(34px,7vw,80px);font-weight:500;letter-spacing:-.045em;line-height:1}
.final .lead{max-width:30em;margin:16px auto 0}
.handle{display:inline-flex;align-items:center;gap:12px;margin-top:36px;border:1px solid var(--ink);border-radius:var(--r-chip);padding:8px 20px 8px 8px;box-shadow:var(--sh-btn)}
.handle .av{width:44px;height:44px;border-radius:50%;background:var(--ink);display:grid;place-items:center}
.handle .av svg{width:26px;fill:#fff}
.handle b{font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-.02em}
.final .actions{justify-content:center}
.say{margin:40px auto 0;max-width:420px;text-align:left}
.say h3{font-size:14px;font-weight:500;text-align:center;margin-top:26px;color:var(--muted)}
.say h3:first-child{margin-top:0}
.tries{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:12px}
.tries span{border:1px solid var(--ink);border-radius:var(--r-chip);padding:6px 12px;font-size:14px}
.bubbles{display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.bub{border:1px solid var(--ink);border-radius:18px 18px 4px 18px;box-shadow:1.5px 2px 0 var(--ink);background:var(--blue);padding:9px 14px;font-size:15px}
.bub--fren{align-self:flex-start;background:var(--soft);border-radius:18px 18px 18px 4px}
.paper{display:inline-flex;align-items:center;gap:8px;margin-top:36px;font-size:14px;color:var(--ink-2);background:var(--soft);border-radius:var(--r-chip);padding:8px 14px}
.paper .ic{width:16px;height:16px}
.closed{margin-top:40px;font-size:12px;color:var(--muted);font-weight:300}


/* setup page extras */
.err{color:var(--bad);font-size:14px;margin-top:var(--cap-gap);line-height:1.45}
.err:empty{display:none}
.hidden{display:none!important}
.spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px}
pre.qr{font-family:var(--mono);line-height:1;font-size:7px;letter-spacing:0;background:#fff;color:#000;padding:12px;border:1px solid var(--line);border-radius:12px;display:inline-block;margin:8px 0}
@media (min-width:500px){pre.qr{font-size:9px}}
.details ol{margin:12px 0 0;padding-left:20px;line-height:1.6;font-size:14px}
.details .field{margin-top:14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px}
.row input{flex:1 1 200px;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--ink);border-radius:var(--r-field)}
.cand{margin-top:10px;font-size:15px}
.check input{position:absolute;opacity:0;width:1px;height:1px}
.check .box .ic{visibility:hidden}
.check input:checked+.box .ic{visibility:visible}
.check input:focus-visible+.box{outline:2px solid var(--ink);outline-offset:2px}
.check .box{background:var(--bg)}
.check input:checked+.box{background:var(--blue)}
.botchip small{display:block}
.tile b small{display:inline}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="logo" viewBox="0 0 336 80"><path d="M76 0C98.0914 0 116 17.9086 116 40C116 62.0914 98.0914 80 76 80H52C47.0684 80 42.5304 77.306 40.1689 72.9766L32 58H44C44 58 48 58 48 54C48 50 44 50 44 50H37.0586C31.4386 49.9998 26.2304 47.0506 23.3389 42.2314L16 30H44C44 30 48 30 48 26C48 22 44 22 44 22H21.498C15.6432 22 10.2559 18.802 7.45215 13.6621L0 0H76ZM84 24C75.1634 24 68 31.1634 68 40C68 48.8366 75.1634 56 84 56C92.8366 56 100 48.8366 100 40C100 31.1634 92.8366 24 84 24Z"/><circle cx="92" cy="40" r="8"/><path d="M254.516 22.8878C258.804 22.8878 262.628 23.6605 265.988 25.2045C269.348 26.7164 272.116 28.8394 274.292 31.5736C276.5 34.2757 278.021 37.4761 278.853 41.1754C279.685 44.8425 279.717 48.8316 278.949 53.142H242.179C242.211 55.0719 242.787 56.761 243.907 58.2084C245.027 59.6559 246.563 60.7972 248.515 61.6335C250.467 62.4376 252.739 62.8399 255.331 62.84C258.211 62.84 260.948 62.4705 263.54 61.7307C266.132 60.9587 268.612 59.7846 270.98 58.2084L275.925 68.9195C274.421 70.0775 272.468 71.1231 270.068 72.056C267.7 72.9566 265.172 73.6646 262.484 74.1793C259.828 74.7262 257.284 75 254.852 75C249.475 75 244.755 73.9216 240.691 71.7664C236.627 69.579 233.458 66.5396 231.186 62.6476C228.914 58.7231 227.778 54.1386 227.778 48.8953C227.778 45.0996 228.434 41.6092 229.746 38.4247C231.09 35.2402 232.946 32.4898 235.314 30.1738C237.714 27.8578 240.531 26.0722 243.763 24.8177C247.027 23.5311 250.612 22.8878 254.516 22.8878ZM184.259 20.6201H155.937V34.5648H181.283V48.6057H155.937V73.552H140V6H184.259V20.6201ZM222.44 22.7916C223.528 22.7916 224.504 22.8563 225.368 22.9849C226.232 23.1136 227.081 23.258 227.912 23.4188L226.04 39.6793C224.952 39.2934 223.8 38.9876 222.584 38.7624C221.368 38.5052 220.152 38.3766 218.936 38.3766C215.96 38.3766 213.496 39.2452 211.544 40.982C209.624 42.6869 208.663 45.1963 208.663 48.5095V73.552H192.919V24.3357H208.663V30.0776C210.135 27.5364 212.088 25.6872 214.52 24.5291C216.952 23.3711 219.592 22.7916 222.44 22.7916ZM315.887 22.8878C320.496 22.8878 324.288 23.8049 327.264 25.6384C330.24 27.4397 332.432 29.7881 333.84 32.6829C335.28 35.5458 336 38.5859 336 41.8027V73.552H320.255V46.7729C320.255 43.8136 319.471 41.4814 317.903 39.7765C316.367 38.0716 314.095 37.2192 311.086 37.2192C309.166 37.2193 307.486 37.6365 306.046 38.4728C304.638 39.3092 303.534 40.5002 302.734 42.0442C301.934 43.556 301.534 45.2928 301.534 47.2549V73.552H285.789V24.3357H301.534V29.5465C303.358 27.2305 305.519 25.5415 308.015 24.48C310.511 23.4186 313.135 22.8878 315.887 22.8878ZM254.083 34.3233C251.043 34.3234 248.515 35.0632 246.499 36.5429C244.515 38.0225 243.395 40.0013 243.139 42.4781H263.972C263.908 40.0012 262.996 38.0226 261.236 36.5429C259.476 35.0633 257.091 34.3233 254.083 34.3233Z"/></symbol>
  <symbol id="mark" viewBox="0 0 116 80"><path d="M76 0C98.0914 0 116 17.9086 116 40C116 62.0914 98.0914 80 76 80H52C47.0684 80 42.5304 77.306 40.1689 72.9766L32 58H44C44 58 48 58 48 54C48 50 44 50 44 50H37.0586C31.4386 49.9998 26.2304 47.0506 23.3389 42.2314L16 30H44C44 30 48 30 48 26C48 22 44 22 44 22H21.498C15.6432 22 10.2559 18.802 7.45215 13.6621L0 0H76ZM84 24C75.1634 24 68 31.1634 68 40C68 48.8366 75.1634 56 84 56C92.8366 56 100 48.8366 100 40C100 31.1634 92.8366 24 84 24Z"/><circle cx="92" cy="40" r="8"/></symbol>
  <!-- Иконки: 24×24, линия 1.8, currentColor. Telegram и WhatsApp взяты с лендинга. -->
  <symbol id="i-tg" viewBox="0 0 24 24"><path d="M21.2 4.1 2.9 11.2c-.8.3-.8 1.4 0 1.7l4.5 1.6 1.8 5.4c.2.7 1.1.9 1.6.4l2.6-2.5 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15.2c.2-.9-.7-1.6-1.5-1.3Z"/><path d="m7.4 14.5 10.4-7-7.6 8.1-.4 4"/></symbol>
  <symbol id="i-wa" viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"/><path d="M9.1 7.9c.3-.3.7-.3 1-.1l.9 1.9c.1.3 0 .6-.2.8l-.6.6a6.2 6.2 0 0 0 2.9 2.9l.6-.6c.2-.2.5-.3.8-.2l1.9.9c.2.3.2.7-.1 1-.9.9-2.2 1.1-3.3.5a9.4 9.4 0 0 1-4.4-4.4c-.6-1.1-.4-2.4.5-3.3Z" fill="currentColor" stroke="none"/></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8"/><path d="M17 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H10"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></symbol>
  <symbol id="i-retry" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3"/><path d="M4.5 18v-4.5H9"/></symbol>
  <symbol id="i-tab" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17M8 5v4"/></symbol>
  <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/></symbol>
  <symbol id="i-paper" viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 13h6M9 16.5h4"/></symbol>
  <symbol id="i-dl" viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></symbol>
</svg>

<div class="trust"><div class="trust__in"><svg class="ic"><use href="#i-lock"/></svg><span>Your server</span><span class="trust__ip" id="trust-ip">this server</span><span class="trust__dot">·</span><span>Private link</span><span class="trust__dot t-wide">·</span><span class="t-wide">Nothing here goes through Fren's website</span></div></div>
<header class="top"><div class="top__in"><span class="logo-a"><svg class="logo" role="img" aria-label="Fren"><use href="#logo"/></svg><span class="beta">Beta</span></span><span class="top__step" id="top-step">Step <b>4</b> of 5</span></div></header>
<ol class="rail" id="rail"></ol>
<main class="page" id="page" aria-live="polite">
  <div class="card">
    <section id="s-model">
      <p class="kicker">AI brain</p>
      <h2>Give Fren a brain</h2>
      <p class="lead">Fren thinks with an AI model. You add your own AI key, so you pay the AI company directly for what you use and nobody in between sees your chats.</p>
      <label class="field"><span>AI company</span><select id="provider"></select></label>
      <ol class="how" id="how"></ol>
      <div class="actions"><a class="btn btn--2 btn--sm" id="keylink" target="_blank" rel="noopener"><svg class="ic ic--s"><use href="#i-key"/></svg><span id="keylink-text">Get a key</span><svg class="ic ic--s"><use href="#i-ext"/></svg></a></div>
      <label class="field" id="key-field"><span>AI key</span><input id="apikey" type="password" autocomplete="off" placeholder="Paste it here"><small>Stays on your server. We check it works with one tiny request.</small></label>
      <p class="msg msg--bad hidden" id="model-bad"><svg class="ic"><use href="#i-alert"/></svg><span id="model-err"></span></p>
      <div class="actions"><button class="btn" id="model-save">Check and save<svg class="ic"><use href="#i-arrow"/></svg></button></div>
    </section>

    <section id="s-chat" class="hidden">
      <p class="kicker" id="chat-kicker">Chat</p>
      <h2 id="chat-title">Make your own bot</h2>
      <p class="lead" id="chat-lead">One tap. Telegram asks you to press <b>Create</b>, then come back to this tab. No BotFather, nothing to copy.</p>
      <div class="tiles" id="chat-pick">
        <button class="tile is-on" data-pick="telegram"><b><svg class="ic"><use href="#i-tg"/></svg>Telegram <span class="rec">Recommended</span> <span class="beta">Beta</span></b><small>Confirm codes come on a separate line the AI never sees.</small></button>
        <button class="tile" data-pick="whatsapp"><b><svg class="ic"><use href="#i-wa"/></svg>WhatsApp <span class="beta">Beta</span></b><small>Needs a spare number for Fren.</small></button>
      </div>

      <div id="tg">
        <div id="tg-one" class="hidden">
          <div class="actions"><a class="btn" id="tg-new" target="_blank" rel="noopener"><svg class="ic"><use href="#i-tg"/></svg>Create my bot in Telegram</a></div>
          <div class="wait hidden" id="tg-new-wait"><svg viewBox="0 0 116 80"><use href="#mark"/></svg><span>Waiting for Telegram… press <b style="color:var(--ink);font-weight:500">Create</b> there, then come back here.</span></div>
          <p class="hint hidden" id="tg-new-alt">Changed the bot's username in Telegram? <a id="tg-new-fallback" target="_blank" rel="noopener">Open this instead</a> and press the button there.</p>
          <p class="err" id="tg-new-err"></p>
        </div>
        <details class="details" id="tg-by-hand" open>
          <summary class="hidden" id="tg-by-hand-sum">Rather make the bot yourself with @BotFather<svg class="ic"><use href="#i-down"/></svg></summary>
          <ol>
            <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> in Telegram and send <b>/newbot</b>.</li>
            <li>Pick a name, then a username that ends in "bot".</li>
            <li>Copy the token it sends you and paste it here.</li>
          </ol>
          <label class="field"><span>Bot token</span><input id="tgtoken" autocomplete="off" placeholder="123456789:AA..."></label>
          <div class="actions"><button class="btn btn--2" id="tg-save">Connect bot</button></div>
          <div id="tg-find" class="hidden">
            <p class="lead">Now open your bot and press <b>Start</b>, so Fren knows it's you.</p>
            <div class="actions"><a class="btn" id="tg-open" target="_blank" rel="noopener">Open @bot</a></div>
            <p class="hint" id="tg-wait"><span class="spin"></span> Waiting for your message…</p>
            <div id="tg-cands"></div>
            <p class="hint">Not working? Message <a href="https://t.me/userinfobot" target="_blank" rel="noopener">@userinfobot</a>, copy the Id it shows, and paste it here:</p>
            <div class="row"><input id="tg-manual" inputmode="numeric" placeholder="Your Telegram ID"><button class="btn btn--2 btn--sm" id="tg-manual-save">Use this id</button></div>
          </div>
          <p class="err" id="tg-err"></p>
        </details>
      </div>

      <div id="wa" class="hidden">
        <label class="field"><span>Your usual WhatsApp number (the one you'll text Fren from), with country code</span><input id="wanum" inputmode="tel" placeholder="+447700900123"><small>The first time can take about a minute.</small></label>
        <div class="actions"><button class="btn" id="wa-start">Show the QR code</button></div>
        <div id="wa-qr" class="hidden">
          <p class="lead">On the spare phone (Fren's WhatsApp): <b>Settings → Linked devices → Link a device</b>, then scan:</p>
          <pre class="qr" id="wa-code">Loading…</pre>
          <p class="hint">The code refreshes by itself every few seconds.</p>
        </div>
        <p class="err" id="wa-err"></p>
      </div>
    </section>

    <section id="s-connected" class="hidden">
      <p class="kicker" id="conn-kicker">Chat</p>
      <h2 id="conn-title">Your bot is connected</h2>
      <div class="botchip"><span class="av"><svg viewBox="0 0 116 80"><use href="#mark"/></svg></span><div><b id="conn-bot">@your_bot</b><small id="conn-sub">Your own bot. Only you can talk to it.</small></div><svg class="ic ok"><use href="#i-check"/></svg></div>
      <p class="lead" style="margin-top:18px">Last thing: Fren makes two wallets for you, right here on your server.</p>
      <div class="field" id="region-q" style="margin-top:22px"><span>Do you live in a country where Polymarket is restricted?</span>
        <small id="region-list">United States, United Kingdom, France, Germany and others.</small>
        <div class="tiles" id="region-pick" style="margin-top:12px">
          <button class="tile" data-region="no"><b>No</b><small>I don't live in any of these. Full access.</small></button>
          <button class="tile" data-region="yes"><b>Yes</b><small>Polymarket stays close-only for me: Fren can close bets there but won't open new ones. Everything else works.</small></button>
        </div>
      </div>
      <div id="w-form">
        <div class="actions"><button class="btn" id="w-make">Make my wallets<svg class="ic"><use href="#i-arrow"/></svg></button></div>
        <p class="hint">Moving from another Fren server? <label class="textlink" for="restore-file" style="cursor:pointer">Use my wallet backup instead</label><input type="file" id="restore-file" accept=".json,application/json" hidden></p>
        <details class="details">
          <summary>Advanced<svg class="ic"><use href="#i-down"/></svg></summary>
          <label class="field"><span>Network</span><select id="network"><option value="mainnet">Mainnet (recommended)</option><option value="testnet">Testnet</option></select><small>Recommended: real prices, pretend money until you switch to live. Testnet is a practice network for developers.</small></label>
          <label class="field"><span>Jupiter key (optional)</span><input id="jup" autocomplete="off" placeholder="Leave empty to skip"><small>Makes fast buys of brand-new Solana coins more reliable. Free at portal.jup.ag.</small></label>
        </details>
      </div>
      <p class="err" id="w-err0"></p>
    </section>

    <section id="s-wallet" class="hidden">
      <p class="kicker">Wallets</p>
      <h2>Your wallets are ready</h2>
      <p class="msg msg--ok" style="margin-top:12px"><svg class="ic"><use href="#i-check"/></svg>Fren starts in paper mode: real prices, pretend money. No real money moves until you say so.</p>
      <span class="lbl">Solana · spot, memes, yield</span><div class="addr" id="a-sol"></div>
      <span class="lbl">Arbitrum and Base · perps, bets and coins on these chains</span><div class="addr" id="a-evm"></div>
      <p class="hint">To trade for real later: send USDC here, plus a little SOL and a little ETH (on Arbitrum or Base) to pay network fees.</p>
      <div class="note"><svg class="ic"><use href="#i-dl"/></svg><span><b>Download your backup.</b> It's the only copy of your keys off this server. Lose the server without it, and the money in these wallets is gone.</span></div>
      <div class="actions"><a class="btn btn--2 btn--sm" href="/api/backup" id="backup"><svg class="ic ic--s"><use href="#i-dl"/></svg>Download wallet backup</a></div>
      <label class="check"><input type="checkbox" id="saved"><span class="box"><svg class="ic"><use href="#i-check"/></svg></span>I saved my backup somewhere safe and offline.</label>
      <div class="actions"><button class="btn" id="go" disabled>Start Fren<svg class="ic"><use href="#i-arrow"/></svg></button><span class="waitbox" id="go-hint"><svg class="ic ic--s"><use href="#i-check"/></svg>Tick the box above to continue</span></div>
      <p class="err" id="w-err"></p>
    </section>
  </div>
</main>

<section class="final hidden" id="final">
  <h1 id="final-h">Starting your Fren<span class="plq">…</span></h1>
  <p class="lead" id="final-wait">Your bot comes online in a minute or two. This page switches to the Telegram button as soon as it can answer you.</p>
  <p class="lead hidden" id="final-text"></p>
  <div class="handle" id="final-handle"><span class="av"><svg viewBox="0 0 116 80"><use href="#mark"/></svg></span><b id="final-bot">@your_bot</b></div>
  <div class="actions"><a class="btn btn--xl" id="final-open" target="_blank" rel="noopener"><svg class="ic"><use href="#i-tg"/></svg><span id="final-open-text">Open in Telegram</span></a></div>
  <div class="say" id="final-say">
    <h3>Say gm. Then try:</h3>
    <div class="tries"><span>what's my wallet</span><span>long BTC 5x with $20</span><span>stop everything</span></div>
    <p class="muted" style="margin-top:14px">Your dashboard is ready too: your balance in dollars, your history and a short tour. The login link arrives in the chat as soon as Fren comes online. Later, send /fren_dashboard.</p>
  </div>
  <p class="paper"><svg class="ic"><use href="#i-paper"/></svg>Paper mode: real prices, pretend money, until you switch to live.</p>
  <p class="closed">This setup page is now closed for good. Your Fren keeps running on your server.</p>
</section>
<script>
const $ = (id) => document.getElementById(id);
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ error: "No answer from your server." }));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
async function busy(btn, errEl, fn) {
  btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> ' + label;
  errEl.textContent = "";
  try { await fn(); } catch (e) { errEl.textContent = e.message; } finally { btn.disabled = false; btn.innerHTML = label; }
}

// Trust strip: the address bar of this page is the owner's own server.
(() => {
  const h = location.hostname;
  const m = h.match(/^(\\d+)-(\\d+)-(\\d+)-(\\d+)\\.sslip\\.io$/);
  $("trust-ip").textContent = m ? m.slice(1).join(".") : h;
})();

// Rail: 1 Server · 2 Pay · 3 Install · 4 AI brain · 5 Chat → Live. now 6 = Live is current, 7 = all done.
const RAIL = ["Server", "Pay", "Install", "AI brain", "Chat"];
const CHECK = '<svg class="ic" style="width:13px;height:13px;stroke-width:2.6"><use href="#i-check"/></svg>';
function rail(now) {
  let h = "";
  RAIL.forEach((name, i) => {
    const n = i + 1, st = n < now ? "done" : n === now ? "now" : "";
    h += '<li class="' + st + '"><span class="n"><i>' + (n < now ? CHECK : n) + '</i><span>' + name + '</span></span><span class="bar"></span></li>';
  });
  const ls = now > 6 ? "done" : "";
  h += '<li class="live ' + ls + '"><span class="n"><i>' + (now > 6 ? CHECK : '<svg viewBox="0 0 116 80" style="width:13px;fill:currentColor"><use href="#mark"/></svg>') + '</i><span>Live</span></span></li>';
  $("rail").innerHTML = h;
  $("rail").setAttribute("aria-label", "Step " + Math.min(now, 5) + " of 5");
  $("top-step").innerHTML = now <= 5 ? "Step <b>" + now + "</b> of 5" : now === 6 ? "Almost <b>live</b>" : "<b>Live</b>";
}
const SCREENS = { model: 4, chat: 5, connected: 5, wallet: 6 };
function screen(name) {
  Object.keys(SCREENS).forEach((k) => $("s-" + k).classList.toggle("hidden", k !== name));
  rail(SCREENS[name]);
  scrollTo(0, 0);
}

let providers = [];
let chat = null;
let bot = null;
let oneTap = false;

async function load() {
  const s = await api("GET", "/api/state");
  // OpenRouter first: one key, any model, sign in with Google or email.
  providers = s.providers.slice().sort((a, b) => (b.id === "openrouter") - (a.id === "openrouter"));
  oneTap = !!s.oneTapBot;
  bot = s.telegramBot;
  chat = s.channel || null; // a reload keeps the chat that was really connected
  if (s.restrictedCountries) $("region-list").textContent = "Restricted: " + s.restrictedCountries + ".";
  $("provider").innerHTML = providers.map((p) => '<option value="' + p.id + '">' + esc(p.label.replace(/ [(]any model[)]$/, "")) + (p.id === "openrouter" ? " (recommended)" : "") + "</option>").join("");
  syncKeyLink();
  if (s.done) return showFinal();
  if (s.finished) return showWallets(s.finished);
  if (s.channel) return showConnected();
  if (s.modelReady) return showChat();
  screen("model");
}
function syncKeyLink() {
  const p = providers.find((x) => x.id === $("provider").value);
  if (!p) return;
  const name = esc(p.label.replace(/ [(]any model[)]$/, ""));
  $("keylink").href = p.keyUrl;
  $("keylink-text").textContent = "Get a key on " + p.label.replace(/ [(]any model[)]$/, "");
  $("how").innerHTML = p.id === "openrouter"
    ? "<li>Open OpenRouter and sign in with Google or email.</li><li>Add a few dollars of credit.</li><li>Create a key and paste it below.</li>"
    : "<li>Open " + name + " and sign in.</li><li>Add a few dollars of credit or pick a plan.</li><li>Create a key and paste it below.</li>";
}
$("provider").onchange = syncKeyLink;
function modelErr(msg) {
  $("model-err").textContent = msg;
  $("model-bad").classList.toggle("hidden", !msg);
  $("key-field").classList.toggle("field--bad", !!msg);
}
$("apikey").oninput = () => modelErr("");
$("model-save").onclick = async () => {
  const btn = $("model-save");
  btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Checking…';
  modelErr("");
  try {
    await api("POST", "/api/model", { provider: $("provider").value, apiKey: $("apikey").value });
    $("apikey").value = "";
    showChat();
  } catch (e) { modelErr(e.message); } finally { btn.disabled = false; btn.innerHTML = label; }
};

function showChat() { screen("chat"); pick("telegram"); }
function pick(p) {
  document.querySelectorAll("[data-pick]").forEach((b) => b.classList.toggle("is-on", b.dataset.pick === p));
  $("tg").classList.toggle("hidden", p !== "telegram");
  $("wa").classList.toggle("hidden", p !== "whatsapp");
    $("chat-title").textContent = p === "telegram" ? "Make your own bot" : "Link Fren's WhatsApp";
  $("chat-lead").innerHTML = p === "telegram"
    ? (oneTap ? "One tap. Telegram asks you to press <b>Create</b>, then come back to this tab. No BotFather, nothing to copy." : "Make a bot with @BotFather in Telegram and paste its token here. It takes about a minute.")
    : "Fren needs its own WhatsApp: a spare number, like an old phone or a second SIM. You scan one QR code, then text Fren from your usual phone.";
  if (p === "telegram") prepareOneTap();
}
document.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => pick(b.dataset.pick));

// One tap: Telegram makes the owner's own bot, Fren's bot service hands its token to this page.
async function prepareOneTap() {
  if (!oneTap) return;
  $("tg-one").classList.remove("hidden");
  $("tg-by-hand").open = false;
  $("tg-by-hand-sum").classList.remove("hidden");
  if ($("tg-new").href) return;
  try {
    const r = await api("POST", "/api/telegram/new");
    $("tg-new").href = r.link;
    $("tg-new-fallback").href = r.fallback;
  } catch (e) { $("tg-new-err").textContent = e.message; }
}
let waitingNew = false;
$("tg-new").addEventListener("click", (ev) => {
  if (!$("tg-new").href) { ev.preventDefault(); return; }
  $("tg-new-wait").classList.remove("hidden");
  $("tg-new-alt").classList.remove("hidden");
  if (!waitingNew) waitNew();
});
async function waitNew() {
  waitingNew = true;
  while (waitingNew && !chat) {
    try {
      const r = await api("POST", "/api/telegram/new/wait");
      if (r.ready) {
        waitingNew = false; finding = false;
        chat = "telegram"; bot = r.bot;
        showConnected();
        return;
      }
      $("tg-new-err").textContent = "";
    } catch (e) {
      $("tg-new-err").textContent = e.message;
      if (/expired/i.test(e.message)) { waitingNew = false; $("tg-new").removeAttribute("href"); $("tg-new-wait").classList.add("hidden"); prepareOneTap(); return; }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

let finding = false;
let lastSeen = "[]";
$("tg-save").onclick = () => busy($("tg-save"), $("tg-err"), async () => {
  const r = await api("POST", "/api/telegram/token", { token: $("tgtoken").value });
  bot = r.bot;
  $("tg-open").href = "https://t.me/" + r.bot;
  $("tg-open").textContent = "Open @" + r.bot;
  $("tg-find").classList.remove("hidden");
  if (!finding) findLoop();
});
async function findLoop() {
  finding = true;
  while (finding) {
    try {
      const r = await api("POST", "/api/telegram/find");
      if (r.busy) { $("tg-wait").textContent = "Another app is already connected to this bot. Enter your Telegram ID below instead."; finding = false; break; }
      const seen = JSON.stringify(r.candidates);
      if (seen === lastSeen) continue;
      lastSeen = seen;
      $("tg-cands").innerHTML = r.candidates.map((c) => '<p class="cand">Got a message from <b>' + esc(c.name) + '</b>. <button class="btn btn--sm" data-id="' + c.id + '">That&#39;s me</button></p>').join("");
      $("tg-cands").querySelectorAll("button").forEach((b) => b.onclick = () => confirmTg(b.dataset.id, b));
    } catch (e) { $("tg-err").textContent = e.message; await new Promise((r) => setTimeout(r, 3000)); }
  }
}
function confirmTg(id, btn) {
  return busy(btn, $("tg-err"), async () => {
    await api("POST", "/api/telegram/confirm", { id });
    finding = false;
    chat = "telegram";
    showConnected();
  });
}
$("tg-manual-save").onclick = () => confirmTg($("tg-manual").value.trim(), $("tg-manual-save"));

let waTimer = null;
$("wa-start").onclick = () => busy($("wa-start"), $("wa-err"), async () => {
  await api("POST", "/api/whatsapp/start", { number: $("wanum").value });
  $("wa-qr").classList.remove("hidden");
  $("wa-start").textContent = "Try again";
  clearInterval(waTimer);
  waTimer = setInterval(pollQr, 2000);
});
async function pollQr() {
  try {
    const r = await api("GET", "/api/whatsapp/qr");
    if (r.qr) $("wa-code").textContent = r.qr;
    if (r.error) { $("wa-err").textContent = r.error; clearInterval(waTimer); }
    if (r.linked) { clearInterval(waTimer); chat = "whatsapp"; showConnected(); }
  } catch (e) { $("wa-err").textContent = e.message; }
}

function showConnected() {
  const tg = chat !== "whatsapp";
    $("conn-title").textContent = tg ? "Your bot is connected" : "WhatsApp is linked";
  $("conn-bot").textContent = tg ? (bot ? "@" + bot : "Your Telegram bot") : "Fren on WhatsApp";
  $("conn-sub").textContent = tg ? "Your own bot. Only you can talk to it." : "Only your own number can talk to it.";
  screen("connected");
}
// "Do you live in a country where Polymarket is restricted?" No default: one tap, yes or no.
let restricted = null;
document.querySelectorAll("#region-pick .tile").forEach((b) => {
  b.onclick = () => {
    restricted = b.dataset.region === "yes";
    document.querySelectorAll("#region-pick .tile").forEach((x) => x.classList.toggle("is-on", x === b));
    $("w-err0").textContent = "";
  };
});
function needRegion() {
  if (restricted === null) throw new Error("Answer the question about where you live first.");
}
const finishBody = () => ({ network: $("network").value, jupiterApiKey: $("jup").value, restricted });
$("restore-file").onchange = () => busy($("w-make"), $("w-err0"), async () => {
  const f = $("restore-file").files[0];
  $("restore-file").value = "";
  if (!f) return;
  needRegion();
  if (f.size > 64 * 1024) throw new Error("That isn't a Fren wallet backup file. It's called fren-wallet-backup.json.");
  await api("POST", "/api/restore", { backup: await f.text() });
  showWallets(await api("POST", "/api/finish", finishBody()));
});
$("w-make").onclick = () => busy($("w-make"), $("w-err0"), async () => {
  needRegion();
  showWallets(await api("POST", "/api/finish", finishBody()));
});
function showWallets(f) {
  $("a-sol").textContent = f.addresses.solana;
  $("a-evm").textContent = f.addresses.evm;
  screen("wallet");
}
$("saved").onchange = () => { $("go").disabled = !$("saved").checked; $("go-hint").hidden = $("saved").checked; };
$("go").onclick = () => busy($("go"), $("w-err"), async () => {
  await api("POST", "/api/done");
  showFinal();
});
function showFinal() {
  $("page").classList.add("hidden");
  $("rail").classList.add("hidden"); document.querySelector(".top__step").classList.add("hidden");
  const wa = chat === "whatsapp";
  if (wa) {
    // WhatsApp: no t.me anywhere, and no link that goes nowhere. Just say what to do.
    $("final-text").textContent = "It's waiting for you in WhatsApp. Open WhatsApp on your phone and say gm to Fren.";
    $("final-text").classList.remove("hidden");
    $("final-handle").classList.add("hidden");
    $("final-open").classList.add("hidden");
  } else if (bot) {
    $("final-bot").textContent = "@" + bot;
    $("final-open").href = "https://t.me/" + bot;
  } else {
    $("final-text").textContent = "Open your new bot in Telegram and say gm.";
    $("final-text").classList.remove("hidden");
    $("final-handle").classList.add("hidden");
    $("final-open").classList.add("hidden");
  }
  $("final").classList.remove("hidden");
  scrollTo(0, 0);
  waitUntilLive();
}
// After "Start Fren" this page's server shuts down and the dashboard takes the
// address. Its /ready turns true once the chat gateway has started with Fren.
const READY_GIVE_UP_MS = 8 * 60_000;
async function waitUntilLive() {
  const parts = ["final-handle", "final-open", "final-say", "final-text"].map($).filter((el) => el && !el.classList.contains("hidden"));
  parts.forEach((el) => el.classList.add("hidden"));
  const started = Date.now();
  for (;;) {
    let ready = false;
    try {
      const r = await fetch("/ready", { cache: "no-store" });
      ready = r.ok && (await r.json()).ready === true;
    } catch {}
    if (ready || Date.now() - started > READY_GIVE_UP_MS) {
      $("final-h").innerHTML = 'Your Fren is <span class="plq">live.</span>';
      $("final-wait").textContent = ready ? "" : "It's taking longer than usual to come online. Say gm in a few minutes; if it stays quiet, use the link to your order page to get help.";
      $("final-wait").classList.toggle("hidden", ready);
      parts.forEach((el) => el.classList.remove("hidden"));
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
load().catch((e) => { screen("model"); modelErr(e.message); });
</script>
</body>
</html>
`;
