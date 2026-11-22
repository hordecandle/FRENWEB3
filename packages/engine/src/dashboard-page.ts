/** The owner's dashboard page. Self-contained: no requests leave this server except fonts. All data goes in with textContent. */

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@300..700&family=Noto+Color+Emoji&display=swap">
<style>
:root{--bg:#f5f5f5;--card:#fff;--ink:#000;--ink-2:#2a2a2a;--muted:#5e5e5e;--faint:#cfcfcf;--line:#e3e3e3;--line-2:#ededed;--blue:#a5caff;--blue-2:#e9f1ff;--blue-3:#cfe0ff;--ok:#1f8a4c;--ok-2:#e4f4ea;--bad:#b42318;--bad-2:#fbe9e7;--bad-3:#f1cfc9;--warn:#7a5a00;--warn-2:#fff5d6;
--emoji:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji";
--font:"Geologica",system-ui,sans-serif,var(--emoji);--mono:ui-monospace,"SF Mono",Menlo,monospace;
--r:20px;--r-sm:12px;--sh-btn:2px 3px 0 var(--ink);--sh-float:0 24px 64px -12px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.06);--ease:cubic-bezier(.2,.8,.2,1);
--top:64px}
*,:before,:after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased;font-size:15px;line-height:1.45}
h1,h2,h3,p{margin:0}
button,input,select,textarea{font:inherit;color:inherit}
.ic{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lg{width:20px;height:20px;flex:none;display:block}
.top{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top__in{max-width:1280px;margin:0 auto;padding:0 28px;height:64px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}
.brand__logo{width:84px;height:20px;display:block;flex:none}
.brand small{font-weight:400;font-size:13px;color:var(--muted);letter-spacing:0;line-height:1;margin-top:3px}
.top__r{display:flex;align-items:center;gap:12px}
.demo{background:var(--blue-2);color:var(--ink);font-size:13px;padding:6px 16px;border-bottom:1px solid var(--blue-3);display:flex;align-items:center;justify-content:center;gap:8px}
.demo .ic{width:15px;height:15px}
.layout{max-width:1280px;margin:0 auto;padding:28px 28px 0;display:grid;gap:24px;grid-template-columns:minmax(0,1fr) 400px;align-items:start}
.col{display:grid;gap:24px;min-width:0}
.side{position:sticky;top:calc(var(--top) + 24px);height:calc(100dvh - var(--top) - 48px);min-height:420px}
@media (max-width:1060px){.layout{grid-template-columns:minmax(0,1fr)}.side{position:static;height:auto}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:28px;min-width:0}
.card--demo{background:var(--blue-2);border-color:var(--blue-3)}
.card--demo .ico{background:#fff}
.card__h{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.card__h>div{min-width:0}
.ico{width:44px;height:44px;flex:none;border-radius:14px;background:var(--bg);display:grid;place-items:center;color:var(--ink)}
.ico .ic{width:22px;height:22px}
.ico--blue{background:var(--blue-2)}.ico--ok{background:var(--ok-2);color:var(--ok)}.ico--bad{background:var(--bad-2);color:var(--bad)}.ico--warn{background:var(--warn-2);color:var(--warn)}
.kicker{font-size:13px;color:var(--muted);margin-bottom:3px}
h2{font-size:22px;font-weight:500;letter-spacing:-.025em;line-height:1.2}
.muted{color:var(--muted);font-size:14px;line-height:1.5}
.note{display:flex;align-items:flex-start;gap:10px;color:var(--muted);font-size:14px;line-height:1.5;margin-top:16px}
.note .ic{width:18px;height:18px;margin-top:2px}
.note b{color:var(--ink);font-weight:500}
.pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:0 12px 0 10px;height:36px;font-size:13px;font-weight:500;white-space:nowrap}
.pill i{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.pill.paper i{background:var(--blue)} .pill.stopped i{background:var(--bad)}
.total{font-size:60px;font-weight:500;letter-spacing:-.045em;line-height:1;margin-top:4px;font-variant-numeric:tabular-nums}
.sub{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;margin-top:14px;font-size:15px;font-weight:500}
.sub .muted{font-weight:400}
.up{color:var(--ok)}.down{color:var(--bad)}
.bar{height:6px;border-radius:99px;background:var(--line-2);overflow:hidden;margin-top:14px}.bar i{display:block;height:100%;background:var(--ink);border-radius:99px;transition:width .4s var(--ease)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 18px;border:1px solid var(--ink);border-radius:var(--r-sm);background:var(--blue);color:var(--ink);box-shadow:var(--sh-btn);font-size:15px;font-weight:500;line-height:1;letter-spacing:-.01em;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform .12s,box-shadow .12s,background .15s,border-color .15s}
.btn .ic{width:18px;height:18px}
.btn:hover{box-shadow:1px 1.5px 0 var(--ink);transform:translate(1px,1.5px)}
.btn:active{box-shadow:0 0 0 var(--ink);transform:translate(2px,3px)}
.btn--2{background:#fff;border-color:var(--line);box-shadow:none;transform:none}
.btn--2:hover{background:var(--bg);border-color:var(--faint);box-shadow:none;transform:none}
.btn--2:active{background:var(--line-2);box-shadow:none;transform:none}
.btn--bad{background:#fff;color:var(--bad);border-color:var(--bad-3);box-shadow:none;transform:none}
.btn--bad:hover{background:var(--bad-2);box-shadow:none;transform:none}
.btn--bad:active{background:#f6d9d4;box-shadow:none;transform:none}
.btn[disabled]{opacity:.4;pointer-events:none}
.btn--sm{height:36px;padding:0 13px;font-size:14px;border-radius:10px}
.btn--sm .ic{width:16px;height:16px}
.btn:focus-visible,.link:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.link{background:none;border:0;padding:0;font-size:14px;color:var(--muted);text-decoration:none;cursor:pointer;line-height:1}
.link:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
table{width:100%;border-collapse:collapse;margin-top:4px;font-size:14px;white-space:nowrap}
th{text-align:left;font-weight:400;font-size:13px;color:var(--muted);padding:0 10px 10px;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{padding-left:0}th:last-child,td:last-child{padding-right:0}
td{padding:13px 10px;border-bottom:1px solid var(--line-2);vertical-align:top}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.sym{font-weight:500}
.scroll{overflow-x:auto}
.lim{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px}
.lim label{display:block;font-size:13px;color:var(--muted)}
.lim input,.lim select,.field input,.chat__f textarea{width:100%;margin-top:6px;font-size:16px;height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff;transition:border-color .15s}
.lim input:hover,.lim select:hover,.field input:hover,.chat__f textarea:hover{border-color:var(--faint)}
.lim input:focus,.lim select:focus,.field input:focus,.chat__f textarea:focus{border-color:var(--ink);outline:none}
.addr{font-family:var(--mono);font-size:13px;line-height:1.5;word-break:break-all;background:#fff;border:1px solid var(--line);padding:11px 13px;border-radius:var(--r-sm);color:var(--ink-2)}
.lbl{display:flex;align-items:center;gap:8px;margin-top:20px;font-size:13px;color:var(--muted)}
.lbl .ic{width:16px;height:16px}
.ev{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px;max-height:340px;overflow:auto}
.ev li{font-size:14px;line-height:1.45;white-space:pre-wrap}.ev time{display:block;font-size:12px;color:var(--muted)}
.msg{margin-top:14px;font-size:14px;line-height:1.5;background:var(--bg);border-radius:var(--r-sm);padding:12px 14px;white-space:pre-wrap}
.msg:empty{display:none}
.center{max-width:520px;margin:12vh auto;padding:0 20px;text-align:center}
.center p{margin-top:12px}
.center .brand{justify-content:center}
[hidden]{display:none!important}
details summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:15px;font-weight:500;padding:16px 0;margin-top:20px;border-top:1px solid var(--line);user-select:none}
details summary::-webkit-details-marker{display:none}
details summary:after{content:"";flex:none;width:8px;height:8px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);margin:-4px 4px 0 0;transition:transform .2s var(--ease)}
details[open] summary:after{transform:rotate(-135deg);margin-top:4px}
details summary .n{font-weight:400;color:var(--muted);margin-left:auto;font-size:13px}
.where{margin-top:20px}
.where summary{margin-top:0;padding:16px 0 12px}
.where[open] summary{border-bottom:1px solid var(--line-2)}
.parts{list-style:none;margin:0;padding:0}
.parts li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:10px 0;border-bottom:1px solid var(--line-2);font-size:14px}
.parts li:last-child{border-bottom:0}
.parts .amt{color:var(--muted);font-size:12px}
.parts .usd{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.parts li.net{padding:14px 0 6px;border-bottom:0;font-weight:500;font-size:15px}
.parts li.coin{padding:6px 0 6px 16px;border-bottom:0;font-size:14px}
.parts li.coin .usd{font-weight:400}
.parts li.coin + li.net{border-top:1px solid var(--line-2);margin-top:8px}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;border-radius:99px;padding:3px 9px 3px 7px;margin-left:8px;vertical-align:1px;background:var(--line-2);color:var(--ink-2)}
.tag .ic{width:13px;height:13px;stroke-width:2.2}
.tag--ok{background:var(--ok-2);color:var(--ok)}.tag--bad{background:var(--bad-2);color:var(--bad)}.tag--wait{background:var(--warn-2);color:var(--warn)}
/* Top up: one block, two ways in (crypto | card), one network picker, one address, one Copy. Every row with a button is a grid with its content centred, so text and buttons share a line. */
.seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--bg);border-radius:14px}
.seg__b{display:flex;align-items:center;justify-content:center;gap:8px;height:40px;border:0;border-radius:11px;background:transparent;color:var(--muted);font-size:15px;font-weight:500;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s}
.seg__b .ic{width:18px;height:18px}
.seg__b.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--line)}
.seg__b:hover:not(.on){color:var(--ink)}
.pay{margin-top:20px}
.demo-warn{margin:0 0 16px}
.netpick{display:flex;flex-wrap:wrap;gap:8px}
.netb{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 10px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s}
.netb:hover{border-color:var(--faint)}
.netb.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.netb .lg{width:20px;height:20px}
.addr-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;margin-top:16px;background:var(--bg);border-radius:16px;padding:14px 14px 14px 16px}
.addr-row .ico{width:40px;height:40px;border-radius:12px;background:#fff}
.addr-row .ico .lg{width:22px;height:22px}
.addr-row b{display:block;font-size:15px;font-weight:500;line-height:1.3}
.addr-row .muted{font-size:13px;margin-top:2px}
.addr-row .btn{align-self:center}
.addr-row+.addr{margin-top:10px}
.camt{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;margin-top:16px}
.camt label{font-size:13px;color:var(--muted)}
.camt__in{display:flex;align-items:center;gap:6px;height:44px;padding:0 14px;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff;font-size:22px;font-weight:500;letter-spacing:-.02em;transition:border-color .15s}
.camt__in:focus-within{border-color:var(--ink)}
.camt__in span{color:var(--muted)}
.camt__in input{border:0;outline:0;width:100%;min-width:0;background:transparent;font-size:22px;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;padding:0}
.presets{display:flex;gap:6px}
.presets button{height:36px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:border-color .15s,background .15s}
.presets button:hover{border-color:var(--faint)}
.presets button.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.card-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center;margin-top:16px}
.card-row .state{font-size:13px;color:var(--muted);line-height:1.4}
.card-row .state.off{color:var(--warn)}
.path{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;font-size:14px;color:var(--muted)}
.path .step{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:999px;background:var(--bg);color:var(--ink);font-weight:500;font-size:13px}
.path .step .lg,.path .step .ic{width:16px;height:16px}
.path>.ic{width:14px;height:14px;transform:rotate(-90deg)}
@media (max-width:640px){.camt{grid-template-columns:1fr}.card-row{grid-template-columns:1fr}.addr-row{grid-template-columns:auto minmax(0,1fr)}.addr-row .btn{grid-column:1/-1;justify-self:start}}
/* Waiting for the owner's OK: the same request Fren sent to the chat, with Approve and Cancel right here. */
.wait{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;background:var(--warn-2);border-radius:16px;padding:16px 18px;margin-top:12px;font-size:14px;line-height:1.5}
.wait>.ic{width:18px;height:18px;flex:none;margin-top:3px;color:var(--warn)}
.wait p{margin-top:6px}.wait p:first-child{margin-top:0}
.wait .muted{color:var(--warn)}
.wait .lbl-l{font-size:15px;font-weight:500}
.wait .row{margin-top:14px;align-items:center}
.wait .row .muted{font-size:13px}
.wait .btn--ok{background:var(--ok);border-color:var(--ok);color:#fff;box-shadow:none;transform:none}
.wait .btn--ok:hover{background:#19743f;box-shadow:none;transform:none}
.loss{font-weight:500}
.hist-more{margin-top:12px;justify-content:center}
.hist{list-style:none;margin:0;padding:0;display:grid}
.hist li{padding:16px 0;border-bottom:1px solid var(--line-2);display:grid;gap:6px;min-width:0}
.hist li:first-child{padding-top:4px}
.hist li:last-child{border-bottom:0}
.hist .when{font-size:12px;color:var(--muted);display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.hist .ask{font-size:15px;font-weight:500;overflow-wrap:anywhere}
.hist .res{font-size:14px;color:var(--ink-2);white-space:pre-wrap;line-height:1.45;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;font-size:13px;font-weight:500;color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:99px;padding:0 12px;background:#fff;transition:background .15s,border-color .15s}
.chip:hover{background:var(--bg);border-color:var(--faint)}
.chip .ic{width:14px;height:14px;color:var(--muted)}
.chat{display:flex;flex-direction:column;height:100%;min-height:420px;padding:0;overflow:hidden}
@media (max-width:1060px){.chat{height:600px}}
.chat__h{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid var(--line)}
.chat__h .ico{width:40px;height:40px;border-radius:12px}
.chat__h h2{font-size:17px}
.chat__h .muted{font-size:13px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat__h>div{min-width:0}
.chat__list{flex:1;overflow-y:auto;padding:18px 16px 10px;display:flex;flex-direction:column;gap:12px;background:#fafafa}
.m{display:flex;flex-direction:column;max-width:100%}
.m--you{align-items:flex-end}.m--fren{align-items:flex-start}
.bub{max-width:86%;padding:10px 14px 11px;font-size:15px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;font-family:"Geologica",var(--emoji),system-ui,sans-serif}
.m--you .bub{background:var(--blue);border-radius:18px 18px 4px 18px}
.m--fren .bub{background:#fff;border:1px solid var(--line);border-radius:18px 18px 18px 4px}
.m time{font-size:11px;color:var(--muted);margin-top:5px;padding:0 4px}
.bub code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;padding:1px 5px;border-radius:5px;background:rgba(127,127,127,.14)}
.m--you .bub code{background:rgba(255,255,255,.22)}
.bub.typing{color:var(--muted);background:var(--line-2);border:0}
.typing .dots{display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle}
.typing .dots i{width:5px;height:5px;border-radius:50%;background:currentColor;animation:fren-dot 1.2s infinite ease-in-out}
.typing .dots i:nth-child(2){animation-delay:.15s}.typing .dots i:nth-child(3){animation-delay:.3s}
@keyframes fren-dot{0%,60%,100%{opacity:.25;transform:none}30%{opacity:1;transform:translateY(-2px)}}
.m--new{animation:fren-in .28s ease-out both}
@keyframes fren-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.m--mine:not(.m--failed) .bub{opacity:.7}
.m--failed time{color:var(--bad)}
.linkbtn{border:0;background:none;padding:0;font:inherit;color:var(--ink);text-decoration:underline;cursor:pointer}
.m__tip{font-size:12px;color:var(--muted);margin-top:4px;padding:0 4px}
@media (prefers-reduced-motion:reduce){.m--new,.typing .dots i{animation:none}}
.chat__f{display:flex;gap:8px;align-items:flex-end;padding:12px 14px 10px;border-top:1px solid var(--line);background:#fff}
.chat__f textarea{flex:1;resize:none;margin:0;height:auto;min-height:44px;max-height:140px;padding:11px 12px;line-height:1.35}
.chat__f .btn{padding:0 16px}
.chat__hint{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);padding:0 16px 12px;background:#fff;line-height:1.4}
.chat__hint .ic{width:14px;height:14px;flex:none}
.keys{display:grid;gap:8px}
.key{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;background:var(--bg);border-radius:var(--r-sm);padding:12px 14px}
.key .ic{color:var(--muted)}
.key b{display:block;font-size:13px;font-weight:500}
.key code{font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;color:var(--muted);letter-spacing:.04em}
.key.shown code{color:var(--ink);letter-spacing:0}
.key:not(.shown) code{display:block;white-space:nowrap;overflow:hidden}
.key__b{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.key__t{display:block;font-size:12px;color:var(--muted);margin-top:4px}
#km-word{text-transform:uppercase;letter-spacing:.08em}
@media (max-width:560px){.key{grid-template-columns:auto minmax(0,1fr)}.key__b{grid-column:1/-1;justify-content:flex-start}}
.key.shown .ic{color:var(--ok)}
.field{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center}
.field input{flex:1;min-width:0;width:auto;margin:0}
.modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.42);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
.modal[hidden]{display:none}
.modal__c{background:#fff;border-radius:var(--r);box-shadow:var(--sh-float);padding:28px;max-width:440px;width:100%}
.modal__c h3{font-size:20px;font-weight:500;letter-spacing:-.02em}
.modal__c p{margin-top:10px;font-size:15px;line-height:1.5}
.modal__c .ico{margin-bottom:16px}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:16px;font-size:14px;line-height:1.45}
.check input{width:20px;height:20px;margin:0;flex:none;accent-color:var(--ink)}
.tour-hole{position:fixed;z-index:60;border-radius:24px;box-shadow:0 0 0 9999px rgba(0,0,0,.45);outline:2px solid var(--blue);pointer-events:none;transition:all .3s var(--ease)}
.tour-tip{position:fixed;z-index:61;background:#fff;border-radius:18px;box-shadow:var(--sh-float);padding:20px;width:340px;max-width:calc(100vw - 24px)}
.tour-tip h3{font-size:18px;font-weight:500;letter-spacing:-.02em;margin-top:4px}
.tour-tip p{font-size:15px;line-height:1.5;margin-top:8px}
.tour-tip .try{display:flex;align-items:flex-start;gap:8px;background:var(--blue-2);border-radius:10px;padding:9px 12px;font-size:14px}
.tour-tip .try .ic{width:16px;height:16px;margin-top:2px;stroke-width:2.2}
.tour-tip .try.done{background:var(--ok-2);color:var(--ok)}
.tour-tip .row{margin-top:16px;justify-content:space-between;align-items:center}
.tour-tip .row>span{display:inline-flex;gap:8px;align-items:center}
.tour-n{font-size:12px;color:var(--muted)}
.signin{max-width:460px;margin:8vh auto;padding:0 20px}
.signin .card{margin-top:16px}
.signin h1{font-size:32px;font-weight:500;letter-spacing:-.03em;margin-top:6px;line-height:1.1}
.signin .card__h{margin-bottom:0}
.signin .card>.row,.signin .card>.field{margin-top:16px}
.foot{max-width:1280px;margin:0 auto;padding:24px 28px 40px;text-align:center;font-size:13px;color:var(--muted)}
@media (max-width:520px){.layout{padding:14px 14px 0;gap:14px}.foot{padding:20px 14px 32px}.col{gap:14px}.card{padding:20px;border-radius:16px}.card__h{gap:12px;margin-bottom:16px}.ico{width:38px;height:38px;border-radius:12px}.ico .ic{width:20px;height:20px}.total{font-size:44px;letter-spacing:-.04em}.top__in{padding:0 16px;height:58px}.brand small{display:none}
.top__r .pill{display:none}.top__r{gap:10px}.chat{height:480px;min-height:0}.chat__h{padding:14px 16px}.chat__list{padding:14px 12px 8px}.bub{max-width:90%}.side{min-height:0}
.tour-tip{left:12px!important;right:12px;width:auto;bottom:12px;top:auto!important;padding:16px}.tour-tip.at-top{top:12px!important;bottom:auto}.tour-tip p{font-size:14px;margin-top:6px}.tour-tip .row{margin-top:12px}}
</style>`;

/** Icons. UI: Lucide (ISC), 24x24 stroke icons, currentColor. Logos of networks and coins: web3icons branded set (MIT), in colour. Telegram: simple-icons. Inlined at build time: nothing is fetched at run time. No emoji outside the chat bubbles. */
const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M17 14h.01" /> <path d="M7 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14" /></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /> <path d="M8 12h8" /> <path d="M12 8v8" /></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /> <polyline points="12 6 12 12 16 14" /></symbol>
  <symbol id="i-chart" viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /> <polyline points="16 7 22 7 22 13" /></symbol>
  <symbol id="i-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" /> <path d="M12 7v5l4 2" /></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="m9 12 2 2 4-4" /></symbol>
  <symbol id="i-key" viewBox="0 0 24 24"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" /></symbol>
  <symbol id="i-login" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /> <polyline points="10 17 15 12 10 7" /> <line x1="15" x2="3" y1="12" y2="12" /></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path d="M15 3h6v6" /> <path d="M10 14 21 3" /> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /> <line x1="12" x2="12" y1="8" y2="12" /> <line x1="12" x2="12.01" y1="16" y2="16" /></symbol>
  <symbol id="i-compass" viewBox="0 0 24 24"><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" /> <circle cx="12" cy="12" r="10" /></symbol>
  <symbol id="i-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></symbol>
  <symbol id="i-card" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" /></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2" /> <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><rect x="14" y="4" width="4" height="16" rx="1" /> <rect x="6" y="4" width="4" height="16" rx="1" /></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3" /></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" /> <path d="M6 12h16" /></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" /></symbol>
  <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /> <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /> <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /> <path d="m2 2 20 20" /></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" /></symbol>
  <symbol id="i-stop" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18" /> <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /> <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /> <line x1="10" x2="10" y1="11" y2="17" /> <line x1="14" x2="14" y1="11" y2="17" /></symbol>
  <symbol id="i-flag" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /> <line x1="4" x2="4" y1="22" y2="15" /></symbol>
  <symbol id="i-coins" viewBox="0 0 24 24"><circle cx="8" cy="8" r="6" /> <path d="M18.09 10.37A6 6 0 1 1 10.34 18" /> <path d="M7 6h1v4" /> <path d="m16.71 13.88.7.71-2.82 2.82" /></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></symbol>
  <symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /> <path d="m4.9 4.9 14.2 14.2" /></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" /></symbol>
  <symbol id="i-up" viewBox="0 0 24 24"><path d="m18 15-6-6-6 6" /></symbol>
  <symbol id="i-tg" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></symbol>
  <symbol id="l-sol" viewBox="0 0 24 24"><path fill="url(#solana__a)" d="M18.413 7.902a.62.62 0 0 1-.411.163H3.58c-.512 0-.77-.585-.416-.928l2.369-2.284a.6.6 0 0 1 .41-.169H20.42c.517 0 .77.59.41.935z"/> <path fill="url(#solana__b)" d="M18.413 19.158a.62.62 0 0 1-.411.158H3.58c-.512 0-.77-.58-.416-.923l2.369-2.29a.6.6 0 0 1 .41-.163H20.42c.517 0 .77.586.41.928z"/> <path fill="url(#solana__c)" d="M18.413 10.473a.62.62 0 0 0-.411-.158H3.58c-.512 0-.77.58-.416.923l2.369 2.29c.111.103.257.16.41.163H20.42c.517 0 .77-.586.41-.928z"/> <defs> <linearGradient id="solana__a" x1="3.001" x2="21.459" y1="55.041" y2="54.871" gradientUnits="userSpaceOnUse"> <stop stop-color="#599DB0"/> <stop offset="1" stop-color="#47F8C3"/> </linearGradient> <linearGradient id="solana__b" x1="3.001" x2="21.341" y1="9.168" y2="9.027" gradientUnits="userSpaceOnUse"> <stop stop-color="#C44FE2"/> <stop offset="1" stop-color="#73B0D0"/> </linearGradient> <linearGradient id="solana__c" x1="4.036" x2="20.303" y1="12.003" y2="12.003" gradientUnits="userSpaceOnUse"> <stop stop-color="#778CBF"/> <stop offset="1" stop-color="#5DCDC9"/> </linearGradient> </defs></symbol>
  <symbol id="l-base" viewBox="0 0 24 24"><path fill="#00F" d="M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z"/></symbol>
  <symbol id="l-arb" viewBox="0 0 24 24"><path fill="#213147" d="M4.515 8.471v7.056c0 .45.245.867.64 1.092l6.205 3.529a1.3 1.3 0 0 0 1.28 0l6.203-3.53c.396-.224.64-.64.64-1.09V8.47c0-.45-.244-.867-.64-1.091L12.64 3.85a1.3 1.3 0 0 0-1.28 0L5.155 7.38a1.25 1.25 0 0 0-.639 1.091"/> <path fill="#12AAFF" d="m13.353 13.368-.885 2.39a.3.3 0 0 0 0 .205l1.523 4.112 1.76-1.001-2.113-5.706a.152.152 0 0 0-.285 0m1.774-4.019a.152.152 0 0 0-.285 0l-.885 2.39a.3.3 0 0 0 0 .205l2.494 6.732 1.761-1.001z"/> <path fill="#9DCCED" d="M11.998 4.115a.3.3 0 0 1 .126.033l6.715 3.818a.25.25 0 0 1 .126.214v7.635c0 .089-.048.17-.126.214l-6.715 3.819a.25.25 0 0 1-.126.032.3.3 0 0 1-.125-.032l-6.715-3.815a.25.25 0 0 1-.126-.215V8.182c0-.089.048-.17.126-.215l6.715-3.818a.26.26 0 0 1 .125-.034m0-1.115c-.238 0-.478.06-.692.183L4.593 7A1.36 1.36 0 0 0 3.9 8.182v7.635c0 .487.264.938.693 1.181l6.714 3.819a1.41 1.41 0 0 0 1.386 0l6.714-3.818a1.36 1.36 0 0 0 .693-1.182V8.182A1.36 1.36 0 0 0 19.407 7l-6.716-3.817A1.4 1.4 0 0 0 11.998 3"/> <path fill="#213147" d="m7.559 18.685.617-1.666 1.244 1.018-1.163 1.046z"/> <path fill="#fff" d="M11.433 7.635H9.731a.3.3 0 0 0-.285.197l-3.649 9.852 1.761 1.001 4.018-10.849a.15.15 0 0 0-.143-.2m2.979-.001h-1.703a.3.3 0 0 0-.284.197l-4.167 11.25 1.761 1 4.535-12.246a.15.15 0 0 0-.142-.2"/></symbol>
  <symbol id="l-matic" viewBox="0 0 24 24"><path fill="url(#polygon__a)" d="m16.364 15.217 4.27-2.435a.73.73 0 0 0 .366-.627V7.284a.72.72 0 0 0-.366-.627l-4.27-2.435a.74.74 0 0 0-.732 0l-4.27 2.435a.72.72 0 0 0-.366.627v8.704l-2.994 1.707-2.994-1.707v-3.415l2.994-1.707 1.974 1.127V9.702l-1.608-.918a.75.75 0 0 0-.732 0l-4.27 2.435a.72.72 0 0 0-.366.627v4.87c0 .258.14.498.366.627l4.27 2.436a.75.75 0 0 0 .732 0l4.27-2.436a.72.72 0 0 0 .366-.626V8.012l.053-.03 2.94-1.677 2.994 1.707v3.415l-2.994 1.707-1.972-1.124v2.291l1.606.916a.75.75 0 0 0 .732 0z"/> <defs> <linearGradient id="polygon__a" x1="2.942" x2="20.119" y1="17.194" y2="7.101" gradientUnits="userSpaceOnUse"> <stop stop-color="#A726C1"/> <stop offset=".88" stop-color="#803BDF"/> <stop offset="1" stop-color="#7B3FE4"/> </linearGradient> </defs></symbol>
  <symbol id="l-eth" viewBox="0 0 24 24"><path fill="#8FFCF3" d="M12 3v6.651l5.625 2.516z"/> <path fill="#CABCF8" d="m12 3-5.625 9.166L12 9.653z"/> <path fill="#CBA7F5" d="M12 16.478V21l5.625-7.784z"/> <path fill="#74A0F3" d="M12 21v-4.522l-5.625-3.262z"/> <path fill="#CBA7F5" d="m12 15.43 5.625-3.263L12 9.652z"/> <path fill="#74A0F3" d="M6.375 12.167 12 15.43V9.652z"/> <path fill="#202699" fill-rule="evenodd" d="m12 15.43-5.625-3.263L12 3l5.624 9.166zm-5.252-3.528 5.161-8.41v6.114zm-.077.229 5.238-2.327v5.364zm5.418-2.327v5.364l5.234-3.037zm0-.198 5.161 2.296-5.161-8.41z" clip-rule="evenodd"/> <path fill="#202699" fill-rule="evenodd" d="m12 16.406-5.625-3.195L12 21l5.624-7.79zm-4.995-2.633 4.904 2.79v4.005zm5.084 2.79v4.005l4.905-6.795z" clip-rule="evenodd"/></symbol>
  <symbol id="l-usdc" viewBox="0 0 24 24"><path fill="#0B53BF" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18"/> <path fill="#fff" d="M13.62 5.45v1.159a5.64 5.64 0 0 1 4.005 5.394 5.64 5.64 0 0 1-4.005 5.394v1.16a6.74 6.74 0 0 0 5.13-6.554 6.74 6.74 0 0 0-5.13-6.553m-7.245 6.553a5.64 5.64 0 0 1 4.005-5.394V5.45a6.74 6.74 0 0 0-5.13 6.553 6.74 6.74 0 0 0 5.13 6.553v-1.159a5.63 5.63 0 0 1-4.005-5.394"/> <path fill="#fff" d="M14.419 13.258c0-2.301-3.606-1.356-3.606-2.627 0-.456.366-.748 1.063-.748.833 0 1.12.405 1.21.95h1.147c-.102-1.024-.69-1.67-1.67-1.863v-.904h-1.125v.872c-1.075.137-1.75.762-1.75 1.693 0 2.312 3.611 1.445 3.611 2.694 0 .472-.455.787-1.226.787-1.007 0-1.339-.444-1.462-1.057H9.49c.073 1.122.764 1.823 1.947 1.999v.886h1.125v-.875c1.153-.149 1.856-.82 1.856-1.807"/></symbol>
</svg>`;

/** Official Fren logo (head + wordmark), same file as the site header: site/public/assets/fren-logo-black.svg. */
const BRAND = `<div class="brand"><svg class="brand__logo" viewBox="0 0 336 80" role="img" aria-label="Fren"><path fill="currentColor" d="M76 0C98.0914 0 116 17.9086 116 40C116 62.0914 98.0914 80 76 80H52C47.0684 80 42.5304 77.306 40.1689 72.9766L32 58H44C44 58 48 58 48 54C48 50 44 50 44 50H37.0586C31.4386 49.9998 26.2304 47.0506 23.3389 42.2314L16 30H44C44 30 48 30 48 26C48 22 44 22 44 22H21.498C15.6432 22 10.2559 18.802 7.45215 13.6621L0 0H76ZM84 24C75.1634 24 68 31.1634 68 40C68 48.8366 75.1634 56 84 56C92.8366 56 100 48.8366 100 40C100 31.1634 92.8366 24 84 24Z"/><circle cx="92" cy="40" r="8" fill="currentColor"/><path fill="currentColor" d="M254.516 22.8878C258.804 22.8878 262.628 23.6605 265.988 25.2045C269.348 26.7164 272.116 28.8394 274.292 31.5736C276.5 34.2757 278.021 37.4761 278.853 41.1754C279.685 44.8425 279.717 48.8316 278.949 53.142H242.179C242.211 55.0719 242.787 56.761 243.907 58.2084C245.027 59.6559 246.563 60.7972 248.515 61.6335C250.467 62.4376 252.739 62.8399 255.331 62.84C258.211 62.84 260.948 62.4705 263.54 61.7307C266.132 60.9587 268.612 59.7846 270.98 58.2084L275.925 68.9195C274.421 70.0775 272.468 71.1231 270.068 72.056C267.7 72.9566 265.172 73.6646 262.484 74.1793C259.828 74.7262 257.284 75 254.852 75C249.475 75 244.755 73.9216 240.691 71.7664C236.627 69.579 233.458 66.5396 231.186 62.6476C228.914 58.7231 227.778 54.1386 227.778 48.8953C227.778 45.0996 228.434 41.6092 229.746 38.4247C231.09 35.2402 232.946 32.4898 235.314 30.1738C237.714 27.8578 240.531 26.0722 243.763 24.8177C247.027 23.5311 250.612 22.8878 254.516 22.8878ZM184.259 20.6201H155.937V34.5648H181.283V48.6057H155.937V73.552H140V6H184.259V20.6201ZM222.44 22.7916C223.528 22.7916 224.504 22.8563 225.368 22.9849C226.232 23.1136 227.081 23.258 227.912 23.4188L226.04 39.6793C224.952 39.2934 223.8 38.9876 222.584 38.7624C221.368 38.5052 220.152 38.3766 218.936 38.3766C215.96 38.3766 213.496 39.2452 211.544 40.982C209.624 42.6869 208.663 45.1963 208.663 48.5095V73.552H192.919V24.3357H208.663V30.0776C210.135 27.5364 212.088 25.6872 214.52 24.5291C216.952 23.3711 219.592 22.7916 222.44 22.7916ZM315.887 22.8878C320.496 22.8878 324.288 23.8049 327.264 25.6384C330.24 27.4397 332.432 29.7881 333.84 32.6829C335.28 35.5458 336 38.5859 336 41.8027V73.552H320.255V46.7729C320.255 43.8136 319.471 41.4814 317.903 39.7765C316.367 38.0716 314.095 37.2192 311.086 37.2192C309.166 37.2193 307.486 37.6365 306.046 38.4728C304.638 39.3092 303.534 40.5002 302.734 42.0442C301.934 43.556 301.534 45.2928 301.534 47.2549V73.552H285.789V24.3357H301.534V29.5465C303.358 27.2305 305.519 25.5415 308.015 24.48C310.511 23.4186 313.135 22.8878 315.887 22.8878ZM254.083 34.3233C251.043 34.3234 248.515 35.0632 246.499 36.5429C244.515 38.0225 243.395 40.0013 243.139 42.4781H263.972C263.908 40.0012 262.996 38.0226 261.236 36.5429C259.476 35.0633 257.091 34.3233 254.083 34.3233Z"/></svg><small>dashboard</small></div>`;
const ic = (name: string) => `<svg class="ic"><use href="#${name}"/></svg>`;
const lg = (name: string) => `<svg class="lg"><use href="#${name}"/></svg>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const LOGIN_PAGE = (message: string) => `<!doctype html><html lang="en"><head>${HEAD}<title>Fren dashboard</title></head>
<body><div class="center">${BRAND}<p class="muted">${esc(message)}</p></div></body></html>`;

const COMMON_JS = `
  const $ = (id) => document.getElementById(id);
  const usd = (n) => { if (n == null || !isFinite(n)) return "–"; const a = Math.abs(n), d = 2; return (n < 0 ? "-$" : "$") + a.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }); };
  const signed = (n) => (n == null ? "–" : (n > 0 ? "+" : "") + usd(n));
  const px = (n) => (n == null ? "–" : "$" + Number(n).toLocaleString("en-US", { maximumSignificantDigits: 6 }));
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  /** An <svg><use> for one of the page's line icons. */
  function icon(name) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "ic"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + name); s.append(u); return s; }
  /** An <svg><use> for a network or coin logo (in colour). */
  function logo(name) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "lg"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + name); s.append(u); return s; }
  /** A button with an icon in front of its label. */
  function iconBtn(name, label, cls) { const b = el("button", cls || "btn btn--2 btn--sm"); b.type = "button"; b.append(icon(name), el("span", null, label)); return b; }
  function setBtn(b, name, label) { b.replaceChildren(icon(name), el("span", null, label)); }
  /** Bot text shown as part of the page (history, receipts) loses its emoji: the page has its own icons. The chat keeps them. */
  const plain = (s) => String(s == null ? "" : s).replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]/gu, "").replace(/^[ \\t]+/gm, "").replace(/[ \\t]{2,}/g, " ");
  /** A chat bubble: the bot writes Telegram-style **bold** and inline code in backticks; show them as bold and code here too, never as raw stars or backticks. Text still goes in with textContent. */
  function bubble(text) {
    const b = el("div", "bub"); const s = String(text == null ? "" : text);
    const re = /\\*\\*([^*\\n]+?)\\*\\*|\\u0060([^\\u0060\\n]+)\\u0060/g; let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) b.append(document.createTextNode(s.slice(last, m.index)));
      b.append(m[1] != null ? el("b", null, m[1]) : el("code", null, m[2]));
      last = re.lastIndex;
    }
    if (last < s.length) b.append(document.createTextNode(s.slice(last)));
    return b;
  }
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
${ICONS}
<header class="top"><div class="top__in">${BRAND}</div></header>
<main class="signin">
  <p class="kicker">Your Fren</p>
  <h1>Log in to your dashboard</h1>
  <p class="muted" style="margin-top:10px">Only you can get in. Logging in can't move money: anything risky still asks for your OK in the chat.</p>
  ${m.demo ? `<section class="card card--demo"><div class="card__h"><span class="ico ico--blue">${ic("i-flag")}</span><div><h2>This is a demo</h2><p class="muted">Pretend money, a pretend chat. Nothing here is real.</p></div></div><div class="row"><a class="btn btn--2" href="/demo-login" id="demo-in">${ic("i-play")}<span>Open the demo</span></a></div></section>` : ""}
  <section class="card">
    <div class="card__h"><span class="ico ico--blue">${ic("i-tg")}</span><div><h2>With Telegram</h2><p class="muted">Send <b>/fren_dashboard</b> to your Fren bot. The link works once, for 10 minutes.</p></div></div>
  </section>
  ${
    m.email
      ? `<section class="card" id="email-card">
    <div class="card__h"><span class="ico">${ic("i-mail")}</span><div><h2>With your email</h2><p class="muted">We email you a 6-digit code.</p></div></div>
    <div class="field"><input id="em" type="email" autocomplete="email" placeholder="you@example.com"><button class="btn" id="em-go">Send code</button></div>
    <div class="field" id="code-row" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code"><button class="btn" id="code-go">Log in</button></div>
    <div class="msg" id="em-msg"></div>
  </section>`
      : ""
  }
  ${
    m.wallet
      ? `<section class="card">
    <div class="card__h"><span class="ico">${ic("i-wallet")}</span><div><h2>With your wallet</h2><p class="muted">Sign a short message. It's free and can't move money.</p></div></div>
    <div class="row"><button class="btn btn--2" data-w="solana">${lg("l-sol")}<span>Phantom (Solana)</span></button><button class="btn btn--2" data-w="evm">${lg("l-eth")}<span>MetaMask (EVM)</span></button></div>
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
${ICONS}
<header class="top"><div class="top__in">${BRAND}
  <div class="top__r"><span class="pill" id="pill"><i></i><span id="pill-t">Loading…</span></span><button class="btn btn--2 btn--sm" id="tour-open" aria-label="Show me around">${ic("i-compass")}<span>Tour</span></button><button class="link" id="logout">Log out</button></div></div>
<div class="demo" id="demo-bar" hidden>${ic("i-flag")}<span>Demo: pretend money and a pretend chat. Nothing here is real.</span></div></header>
<main class="layout">
 <div class="col">
  <section class="card" data-tour="balance">
    <div class="card__h"><span class="ico ico--blue">${ic("i-wallet")}</span><div><p class="kicker">Balance</p><h2 id="bal-k">All your money</h2></div></div>
    <div class="total" id="total">…</div>
    <div class="sub"><span id="pnl"></span><span class="muted" id="bal-note"></span></div>
    <details class="where" id="where" data-tour="breakdown"><summary><span>Where it sits</span><span class="n" id="where-n"></span></summary><ul class="parts" id="parts"></ul></details>
  </section>

  <section class="card" data-tour="topup" id="topup">
    <div class="card__h"><span class="ico ico--ok">${ic("i-plus")}</span><div><p class="kicker">Add money</p><h2>Top up your Fren</h2></div></div>
    <div class="seg" role="tablist" aria-label="How to add money"><button class="seg__b on" type="button" role="tab" data-pay="crypto" aria-selected="true">${ic("i-coins")}<span>Send crypto</span></button><button class="seg__b" type="button" role="tab" data-pay="card" aria-selected="false">${ic("i-card")}<span>Pay by card</span></button></div>
    <div class="pay" id="pay-crypto" role="tabpanel">
      <p class="wait demo-warn" id="topup-demo" hidden>${ic("i-alert")}<span>Demo addresses: don't send anything here, it would be lost.</span></p>
      <div class="netpick" id="nets" aria-label="Network"></div>
      <div class="addr-row" id="addr-row"><span class="ico" id="addr-logo"></span><div><b id="addr-name"></b><div class="muted" id="addr-note"></div></div><button class="btn btn--2 btn--sm" type="button" id="addr-copy">${ic("i-copy")}<span>Copy</span></button></div>
      <div class="addr" id="addr"></div>
      <p class="note">${ic("i-alert")}<span id="addr-help"></span></p>
    </div>
    <div class="pay" id="pay-card" role="tabpanel" hidden>
      <p class="muted">Card to USDC on Solana, straight into your Fren wallet. Transak handles the card and the ID check; Fren never sees your card.</p>
      <div class="camt"><label for="card-amt">Amount</label><div class="camt__in"><span>$</span><input id="card-amt" inputmode="decimal" value="100" aria-label="Amount in dollars"></div><div class="presets" id="presets"></div></div>
      <div class="card-row"><a class="btn" id="card-btn" target="_blank" rel="noopener">${ic("i-card")}<span>Pay by card</span></a><p class="state" id="card-state"></p></div>
      <div class="path"><span class="step">${ic("i-card")}Your card</span>${ic("i-down")}<span class="step">${lg("l-usdc")}USDC</span>${ic("i-down")}<span class="step">${lg("l-sol")}Solana</span>${ic("i-down")}<span class="step">${ic("i-wallet")}Your Fren</span></div>
    </div>
  </section>

  <section class="card" id="wait-card" hidden>
    <div class="card__h"><span class="ico ico--warn" id="wait-ico">${ic("i-clock")}</span><div><p class="kicker" id="wait-kicker">Waiting for your OK</p><h2 id="wait-title">Fren wants to do this</h2></div></div>
    <div id="waits"></div>
    <div class="msg" id="wait-msg"></div>
  </section>

  <section class="card" id="pos-card">
    <div class="card__h"><span class="ico">${ic("i-chart")}</span><div><p class="kicker">Open now</p><h2 id="pos-t">What you hold</h2></div></div>
    <div class="scroll"><table><thead><tr><th>What</th><th>Where</th><th>Bet</th><th class="num">Amount</th><th class="num">Bought at</th><th class="num">Price now</th><th class="num">Worth</th><th class="num">Up / down</th></tr></thead><tbody id="pos"></tbody></table></div>
    <p class="muted" id="pos-empty" style="margin-top:4px"></p>
  </section>

  <section class="card" data-tour="history">
    <div class="card__h"><span class="ico">${ic("i-history")}</span><div><p class="kicker">History</p><h2>What Fren did</h2></div></div>
    <ul class="hist" id="hist"></ul>
    <p class="muted" id="hist-empty" style="margin-top:4px"></p>
    <div class="row hist-more" id="hist-more-row" hidden><button class="btn btn--2 btn--sm" type="button" id="hist-more">${ic("i-down")}<span>Show all</span></button></div>
    <details><summary>Everything else Fren noted</summary><ul class="ev" id="events"></ul></details>
  </section>

  <section class="card" data-tour="stop">
    <div class="card__h"><span class="ico">${ic("i-shield")}</span><div><p class="kicker">Safety</p><h2 id="mode-t">…</h2></div></div>
    <p class="muted" id="spent-of"></p>
    <div class="bar"><i id="spent-bar" style="width:0"></i></div>
    <div class="row">
      <button class="btn btn--bad" id="pause">${ic("i-pause")}<span>Pause Fren</span></button>
      <button class="btn" id="resume" hidden>${ic("i-play")}<span>Turn Fren back on</span></button>
      <button class="btn btn--2" id="closeall">${ic("i-stop")}<span>Close everything</span></button>
    </div>
    <p class="note">${ic("i-lock")}<span>Pause works at once. Turning back on, closing real trades and raising limits need your OK first: it appears in <b>Fren wants to do this</b> above, and in your Telegram chat.</span></p>
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
    <div class="row"><button class="btn btn--2" id="save">${ic("i-check")}<span>Save limits</span></button></div>
    <div class="msg" id="lim-msg"></div>
    </details>
  </section>

  <section class="card" data-tour="keys">
    <div class="card__h"><span class="ico">${ic("i-key")}</span><div><p class="kicker">Keys</p><h2>Your wallet keys</h2></div></div>
    <div class="keys" id="keys"></div>
    <p class="note">${ic("i-shield")}<span>A key is the password to a wallet. <b>Whoever has a key owns the money.</b> Keep a copy offline, never send it to anyone, Fren included. Each key shows for 30 seconds, and Fren tells you in Telegram every time one is shown or copied.</span></p>
    <div class="msg" id="keys-msg"></div>
  </section>

  <section class="card">
    <div class="card__h"><span class="ico">${ic("i-login")}</span><div><p class="kicker">Ways in</p><h2>Log in without Telegram</h2></div></div>
    <div class="lbl" style="margin-top:0">${ic("i-mail")}<span>Email</span></div>
    <div class="field"><input id="si-email" type="email" placeholder="you@example.com"><button class="btn btn--2" id="si-email-save">${ic("i-check")}<span>Save</span></button></div>
    <div class="lbl">${ic("i-wallet")}<span>Wallets you log in with</span></div>
    <div id="si-wallets" class="keys" style="margin-top:8px"></div>
    <div class="row"><button class="btn btn--2" data-link="solana">${lg("l-sol")}<span>Add Phantom (Solana)</span></button><button class="btn btn--2" data-link="evm">${lg("l-eth")}<span>Add MetaMask (EVM)</span></button></div>
    <div class="msg" id="si-msg"></div>
  </section>

 </div>

 <aside class="side">
  <section class="card chat" data-tour="chat" id="chat-card">
    <div class="chat__h"><span class="ico ico--blue">${ic("i-chat")}</span><div><h2>Talk to Fren</h2><p class="muted" id="chat-sub">The same chat as in Telegram.</p></div><p class="kicker" id="chat-k" hidden>Chat</p></div>
    <div class="chat__list" id="chat"></div>
    <form class="chat__f" id="chat-f"><textarea id="chat-in" rows="1" placeholder="Ask Fren anything"></textarea><button class="btn" id="chat-go">${ic("i-send")}<span>Send</span></button></form>
    <p class="chat__hint" id="chat-hint">${ic("i-tg")}<span id="chat-hint-t">Fren answers here and in Telegram. Approvals live in the “Fren wants to do this” box.</span></p>
  </section>
 </aside>
</main>
<footer class="foot">Fren is software you run yourself. Not financial advice.</footer>

<div class="modal" id="km" hidden><div class="modal__c">
  <span class="ico ico--bad">${ic("i-key")}</span>
  <h3 id="km-h">Show your key?</h3>
  <p>Anyone who sees a key can take the money in that wallet. Make sure nobody is looking at your screen and you're not sharing it.</p>
  <label class="check"><input type="checkbox" id="km-ok"><span>I understand. I'll keep the keys offline and never send them to anyone.</span></label>
  <div class="field" id="km-w"><input id="km-word" autocomplete="off" maxlength="8" placeholder="Type SHOW to go on"></div>
  <div id="km-code" hidden><p id="km-t"></p><div class="field"><input id="km-in" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="btn" id="km-go">Show</button></div></div>
  <div class="msg" id="km-msg"></div>
  <div class="row"><button class="btn btn--bad" id="km-next" disabled>${ic("i-tg")}<span>Send me a code</span></button><button class="btn btn--2" id="km-no">Cancel</button></div>
</div></div>

<div class="tour-hole" id="tour-hole" hidden></div>
<div class="tour-tip" id="tour-tip" hidden role="dialog" aria-live="polite">
  <span class="tour-n" id="tour-n"></span>
  <h3 id="tour-h"></h3>
  <p id="tour-p"></p>
  <p class="try" id="tour-try"></p>
  <div class="row"><button class="link" id="tour-skip">Skip</button><span><button class="btn btn--2 btn--sm" id="tour-back">Back</button><button class="btn btn--sm" id="tour-next">Next</button></span></div>
</div>

<script>
(() => {
  "use strict";
  ${COMMON_JS}
  let limits = null;
  let dirty = false;
  let D = null;
  // The header's height (demo line included) feeds the sticky chat column, so the chat always fits the screen.
  const fitTop = () => document.documentElement.style.setProperty("--top", document.querySelector(".top").offsetHeight + "px");
  addEventListener("resize", fitTop); fitTop();

  async function call(path, body, ms) {
    // A request never hangs the page: past ms it's dropped with a plain error.
    const ctl = ms ? new AbortController() : null; const tm = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
    let res;
    try { res = await fetch("/api/" + path, { ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-fren": "1" }, body: JSON.stringify(body) }), ...(ctl ? { signal: ctl.signal } : {}) }); }
    catch (e) { throw new Error(ctl && ctl.signal.aborted ? "Fren didn't answer in time. Try again." : "Can't reach Fren on this computer. Check that it's running, then try again."); }
    finally { clearTimeout(tm); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.reload(); throw new Error("logged out"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  const td = (text, cls) => el("td", cls, text);
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
  const tag = (text, cls, name) => { const t = el("span", "tag " + cls); if (name) t.append(icon(name)); t.append(el("span", null, text)); return t; };

  function renderBalance(d) {
    const b = d.balances;
    $("demo-bar").hidden = !d.demo; fitTop();
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
    const wn = $("where-n");
    if (wn) wn.textContent = nets.length ? nets.length + (nets.length === 1 ? " network" : " networks") : "";
  }

  // ---- top up: one block, crypto or card ------------------------------------
  // Every network Fren can receive USDC on. One Solana address; one EVM address shared by Base, Arbitrum and Polygon (same wallet on each).
  const NETS = [
    { k: "solana", name: "Solana", logo: "l-sol", a: "solana", note: "USDC or SOL. Fastest and cheapest.", help: "Send USDC on Solana. Same network on both sides, or the money gets lost. It shows up above in a minute or two." },
    { k: "base", name: "Base", logo: "l-base", a: "evm", note: "USDC.", help: "Send USDC on Base. The same address works on Arbitrum and Polygon too: it's one wallet. Same network on both sides, or the money gets lost." },
    { k: "arbitrum", name: "Arbitrum", logo: "l-arb", a: "evm", note: "USDC. Also the way into Hyperliquid.", help: "Send USDC on Arbitrum. Fren moves it to Hyperliquid itself when a trade needs it. Same network on both sides, or the money gets lost." },
    { k: "polygon", name: "Polygon", logo: "l-matic", a: "evm", note: "USDC.", help: "Send USDC on Polygon. The same address works on Base and Arbitrum too: it's one wallet. Same network on both sides, or the money gets lost." },
  ];
  let net = "solana";
  let pay = "crypto";
  const PRESETS = [50, 100, 250, 500];
  function showNet() {
    const a = (D && D.addresses) || {};
    const n = NETS.find((x) => x.k === net) || NETS[0];
    for (const b of $("nets").children) { const on = b.dataset.net === n.k; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    $("addr-logo").replaceChildren(logo(n.logo));
    $("addr-name").textContent = n.name + " address";
    $("addr-note").textContent = n.note;
    $("addr").textContent = a[n.a] || "";
    $("addr-help").textContent = n.help;
  }
  function renderTopUp(d) {
    const a = d.addresses;
    $("topup-demo").hidden = !d.demo;
    const nets = $("nets");
    if (!nets.dataset.done) {
      nets.replaceChildren();
      for (const n of NETS) {
        if (!a || !a[n.a]) continue;
        const b = el("button", "netb"); b.type = "button"; b.dataset.net = n.k; b.append(logo(n.logo), el("span", null, n.name));
        b.onclick = () => { net = n.k; showNet(); };
        nets.append(b);
      }
      if (!nets.children.length) { $("addr-row").hidden = $("addr").hidden = true; $("addr-help").textContent = "No wallets yet."; }
      else if (!nets.querySelector('[data-net="' + net + '"]')) net = nets.children[0].dataset.net;
      const ps = $("presets");
      for (const v of PRESETS) { const b = el("button", null, "$" + v); b.type = "button"; b.onclick = () => { $("card-amt").value = String(v); cardAmount(); }; ps.append(b); }
      $("card-amt").oninput = cardAmount;
      nets.dataset.done = "1";
    }
    if (nets.children.length) showNet();
    renderCard(d);
  }
  $("addr-copy").onclick = async () => {
    const v = $("addr").textContent;
    if (!v) return;
    const copy = $("addr-copy");
    try { await navigator.clipboard.writeText(v); } catch { const r = document.createRange(); r.selectNodeContents($("addr")); getSelection().removeAllRanges(); getSelection().addRange(r); }
    setBtn(copy, "i-check", "Copied"); setTimeout(() => setBtn(copy, "i-copy", "Copy"), 1500); tour.did("topup");
  };
  for (const b of document.querySelectorAll("[data-pay]")) b.onclick = () => {
    pay = b.dataset.pay;
    for (const x of document.querySelectorAll("[data-pay]")) { const on = x.dataset.pay === pay; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); }
    $("pay-crypto").hidden = pay !== "crypto";
    $("pay-card").hidden = pay !== "card";
  };
  /** The amount typed (or picked) goes into the Transak link as fiatAmount. */
  function cardAmount() {
    const c = D && D.card;
    const v = Math.max(0, Math.floor(Number(String($("card-amt").value).replace(/[^0-9.]/g, "")) || 0));
    for (const b of $("presets").children) b.classList.toggle("on", b.textContent === "$" + v);
    const btn = $("card-btn");
    if (!c || !c.url) { btn.removeAttribute("href"); return; }
    const u = new URL(c.url);
    if (v) u.searchParams.set("fiatAmount", String(v)); else u.searchParams.delete("fiatAmount");
    btn.href = u.toString();
  }
  function renderCard(d) {
    const c = d.card;
    const btn = $("card-btn"), st = $("card-state");
    const off = !c || c.mode === "off" || !c.url;
    btn.classList.toggle("is-off", off);
    btn.setAttribute("aria-disabled", String(off));
    if (off) btn.setAttribute("disabled", ""); else btn.removeAttribute("disabled");
    st.className = "state" + (off ? " off" : "");
    if (d.demo) st.textContent = "Demo: no real card payments here. In your own Fren this button opens " + ((c && c.provider) || "Transak") + ".";
    else if (off) st.textContent = "Card payments open after Bee adds the Transak key.";
    else if (c.mode === "sandbox") st.textContent = "Test mode: " + c.provider + " opens a practice checkout, no real card is charged.";
    else st.textContent = "Opens " + c.provider + " in a new tab. USDC lands on " + (c.network === "solana" ? "Solana" : "Base") + ", shown above in a minute or two.";
    cardAmount();
  }

  // ---- waiting for your OK: approve or cancel right here ----------------------
  function renderWaiting(d) {
    // After Approve or Cancel the request is gone, but its result stays on screen until the next page load.
    $("wait-card").hidden = !d.waiting.length && !$("wait-msg").textContent;
    // The header says what the card is now: a request to answer, or the answer's result.
    const done = !d.waiting.length;
    $("wait-ico").className = "ico " + (done ? "ico--ok" : "ico--warn");
    $("wait-ico").replaceChildren(icon(done ? "i-check" : "i-clock"));
    $("wait-kicker").textContent = done ? "Answered" : "Waiting for your OK";
    $("wait-title").textContent = done ? "Fren got your answer" : "Fren wants to do this";
    const w = $("waits");
    w.replaceChildren();
    for (const x of d.waiting) {
      const box = el("div", "wait");
      const body = el("div");
      body.append(el("p", "lbl-l", plain(x.label)));
      if (x.request) body.append(el("p", "muted", when(x.at) + " · you asked: " + plain(x.request)));
      for (const s of x.steps || []) if (plain(s) !== plain(x.label)) body.append(el("p", null, plain(s)));
      if (x.maxLoss) body.append(el("p", "loss", plain(x.maxLoss)));
      const row = el("div", "row");
      const ok = iconBtn("i-check", "Approve", "btn btn--ok");
      const no = iconBtn("i-x", "Cancel", "btn btn--2");
      const until = new Date(x.expiresAt);
      row.append(ok, no, el("span", "muted", isNaN(until) ? "" : "Waits until " + until.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) + ", then it's dropped."));
      ok.onclick = async () => {
        if (d.limits && d.limits.mode === "live" && !confirm("Approve with real money?\\n\\n" + plain(x.label))) return;
        ok.disabled = no.disabled = true;
        try { const r = await call("ok", { ref: x.ref, usd: x.usd }); $("wait-msg").textContent = plain(r.text); } catch (e) { $("wait-msg").textContent = plain(e.message); }
        await load();
      };
      no.onclick = async () => {
        ok.disabled = no.disabled = true;
        try { const r = await call("cancel", { ref: x.ref }); $("wait-msg").textContent = plain(r.text); } catch (e) { $("wait-msg").textContent = plain(e.message); }
        await load();
      };
      body.append(row);
      box.append(icon("i-clock"), body);
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
      tr.append(td(p.symbol, "sym"), td(venues[p.venue] || p.venue), td(side[p.side] || p.side), td(String(Number(p.size.toFixed(4))), "num"), td(px(p.entryPx), "num"), td(px(p.markPx), "num"), td(usd(p.valueUsd), "num"), td(signed(p.pnlUsd), "num " + (p.pnlUsd > 0 ? "up" : p.pnlUsd < 0 ? "down" : "")));
      body.append(tr);
    }
    $("pos-t").textContent = d.positions.length ? "What you hold (" + d.positions.length + ")" : "What you hold";
    $("pos-empty").textContent = d.positionsError ? "Couldn't load this just now: " + d.positionsError : d.positions.length ? "" : "Nothing open right now.";
  }

  // History shows the last few; "Show all" unfolds the rest.
  const HIST_SHORT = 3;
  let histAll = false;
  $("hist-more").onclick = () => { histAll = !histAll; if (D) renderHistory(D); };
  function renderHistory(d) {
    const ul = $("hist");
    ul.replaceChildren();
    const st = { done: ["Done", "tag--ok", "i-check"], failed: ["Didn't go through", "tag--bad", "i-x"], cancelled: ["Cancelled", "", "i-x"], active: ["Watching the price", "tag--wait", "i-clock"], rejected: ["Blocked by your limits", "tag--bad", "i-shield"] };
    const more = d.history.length - HIST_SHORT;
    $("hist-more-row").hidden = more <= 0;
    setBtn($("hist-more"), histAll ? "i-up" : "i-down", histAll ? "Show fewer" : "Show all " + d.history.length);
    for (const h of histAll ? d.history : d.history.slice(0, HIST_SHORT)) {
      const li = el("li");
      const top = el("div", "when", when(h.at) + (h.mode === "paper" ? " · practice" : " · real money"));
      const s = h.steps.some((x) => x.status === "failed") ? st.failed : st[h.status] || [h.status, "", null];
      top.append(tag(s[0], s[1], s[2]));
      li.append(top, el("div", "ask", plain(h.request)));
      if (h.result) li.append(el("div", "res", plain(h.result)));
      else for (const x of h.steps) li.append(el("div", "res", plain(x.text)));
      if (h.links.length) {
        const c = el("div", "chips");
        for (const l of h.links) { const a = el("a", "chip"); a.append(el("span", null, l.label), icon("i-ext")); a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer"; c.append(a); }
        li.append(c);
      } else if (h.mode === "paper") li.append(el("div", "when", "Practice trade: nothing goes on the public record."));
      ul.append(li);
    }
    $("hist-empty").textContent = d.history.length ? "" : "Nothing yet. Ask Fren in the chat, e.g. \\"buy $20 of SOL\\".";
    const ev = $("events");
    ev.replaceChildren();
    for (const e of d.events) { const li = el("li"); li.append(el("time", null, when(e.at)), document.createTextNode(plain(e.text))); ev.append(li); }
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

  // One key at a time, like Render: dots until the owner asks, then 30 s, then dots again.
  const KEY_ROWS = ["Solana wallet key", "EVM wallet key (Base, Arbitrum, Polygon)", "Hyperliquid trading key"];
  let keysShown = null; // { which, value, until }
  let hideTimer = 0;
  let tickTimer = 0;
  function copyText(v) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(v);
    const t = document.createElement("textarea"); t.value = v; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.append(t); t.select(); try { document.execCommand("copy"); } finally { t.remove(); }
    return Promise.resolve();
  }
  function renderKeys(d) {
    const w = $("keys");
    const labels = (d && d.keyLabels && d.keyLabels.length) ? d.keyLabels : KEY_ROWS;
    w.replaceChildren();
    labels.forEach((label, i) => {
      const shown = keysShown && keysShown.which === i;
      const r = el("div", "key" + (shown ? " shown" : ""));
      const t = el("div"); t.append(el("b", null, label), el("code", null, shown ? keysShown.value : "••••••••••••••••••••••••••••••••"));
      if (shown) t.append(el("span", "key__t", "Hides in " + Math.max(0, Math.ceil((keysShown.until - Date.now()) / 1000)) + " s"));
      const b = el("div", "key__b");
      if (shown) {
        const c = iconBtn("i-copy", "Copy"); c.onclick = () => copyText(keysShown.value).then(() => setBtn(c, "i-check", "Copied"));
        const h = iconBtn("i-eye-off", "Hide"); h.onclick = hideKeys;
        b.append(c, h);
      } else {
        const v = iconBtn("i-eye", "Reveal"); v.onclick = () => askKey(i, "show");
        const c = iconBtn("i-copy", "Copy"); c.onclick = () => askKey(i, "copy", c);
        b.append(v, c);
      }
      r.append(icon(shown ? "i-eye" : "i-lock"), t, b);
      w.append(r);
    });
  }
  function hideKeys() { keysShown = null; clearTimeout(hideTimer); clearInterval(tickTimer); renderKeys(D); $("keys-msg").textContent = ""; }

  function renderSignIn(d) {
    const s = d.signIn;
    if (document.activeElement !== $("si-email")) $("si-email").value = s.email || "";
    const w = $("si-wallets");
    w.replaceChildren();
    if (!s.wallets.length) w.append(el("p", "muted", "None yet."));
    for (const x of s.wallets) {
      const r = el("div", "key"); const t = el("div"); t.append(el("b", null, x.kind === "evm" ? "MetaMask (EVM)" : "Phantom (Solana)"), el("code", null, x.address));
      const rm = iconBtn("i-trash", "Remove");
      rm.onclick = () => call("sign-in/wallet/remove", x).then(load);
      r.append(logo(x.kind === "evm" ? "l-eth" : "l-sol"), t, rm); w.append(r);
    }
  }

  function render(d) {
    D = d;
    renderBalance(d); renderTopUp(d); renderWaiting(d); renderPositions(d); renderHistory(d); renderSafety(d); renderSignIn(d);
    if (!keysShown) renderKeys(d);
    $("chat-card").hidden = !d.chat;
    if (chatSeen) renderChat();
  }

  async function load() { try { render(await call("overview")); } catch (e) { if (e.message !== "logged out") $("act-msg").textContent = e.message; } }

  // ---- chat -------------------------------------------------------------
  // What was sent from this page shows at once (Telegram-style), before the history has it.
  // It stays until the history shows the same text, or is marked "Not sent" with Retry.
  let chatSig = "", chatSeen = null, chatState = { messages: [], thinking: false };
  const mine = [];
  let mineN = 0;
  /** Three dots while Fren writes, like Telegram. */
  function typingRow() {
    const w = el("div", "m m--fren m--typing"); const b = el("div", "bub typing");
    const dots = el("span", "dots"); dots.setAttribute("aria-hidden", "true"); dots.append(el("i"), el("i"), el("i"));
    b.append(el("span", null, "Fren is typing"), dots); w.append(b); return w;
  }
  function renderChat() {
    const s = chatState, list = $("chat");
    for (let i = mine.length - 1; i >= 0; i--) {
      const p = mine[i];
      if (p.state !== "failed" && s.messages.some((m) => m.from === "you" && m.text.trim() === p.text && m.at >= p.at - 120000)) mine.splice(i, 1);
    }
    const typing = s.thinking || mine.some((p) => p.state !== "failed");
    const sig = s.messages.map((m) => m.id).join() + "|" + mine.map((p) => p.id + p.state).join() + "|" + typing + "|" + Boolean(D && D.waiting && D.waiting.length);
    if (sig === chatSig) return;
    chatSig = sig;
    const first = chatSeen === null, seen = chatSeen || new Set();
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.replaceChildren();
    if (!s.messages.length && !mine.length) list.append(el("p", "muted", "No messages yet. Say hi."));
    // The last Fren line that asks for /ok gets a pointer to the buttons here, while something waits.
    let okAt = -1;
    if (D && D.waiting && D.waiting.length) s.messages.forEach((m, i) => { if (m.from === "fren" && /\\/ok\\b/i.test(m.text)) okAt = i; });
    s.messages.forEach((m, i) => {
      const w = el("div", "m m--" + m.from + (!first && !seen.has(m.id) ? " m--new" : ""));
      seen.add(m.id);
      w.append(bubble(m.text), el("time", null, (m.from === "you" ? "You · " : "Fren · ") + when(new Date(m.at).toISOString())));
      if (i === okAt && !s.messages.slice(i + 1).some((x) => x.from === "you")) w.append(el("p", "m__tip", "Here: press Approve in “Fren wants to do this” above, or type ok."));
      list.append(w);
    });
    for (const p of mine) {
      const w = el("div", "m m--you m--mine" + (p.state === "failed" ? " m--failed" : "") + (p.fresh ? " m--new" : ""));
      p.fresh = false;
      w.append(bubble(p.text));
      if (p.state === "failed") {
        const t = el("time", null, "Not sent. " + p.why + " ");
        const r = el("button", "linkbtn", "Retry"); r.type = "button"; r.onclick = () => { mine.splice(mine.indexOf(p), 1); sendChat(p.text); };
        t.append(r); w.append(t);
      } else w.append(el("time", null, "You · " + (p.state === "sending" ? "sending…" : "sent")));
      list.append(w);
    }
    if (typing) list.append(typingRow());
    chatSeen = seen;
    if (first || atEnd || mine.length) list.scrollTo({ top: list.scrollHeight, behavior: first ? "auto" : "smooth" });
  }
  async function loadChat() {
    if (D && !D.chat) return;
    let s;
    try { s = await call("chat", undefined, 25000); } catch (e) { $("chat-sub").textContent = e.message; return; }
    const ch = s.channel ? s.channel[0].toUpperCase() + s.channel.slice(1) : "your chat app";
    $("chat-sub").textContent = "The same chat as in " + ch + ". Write here or there.";
    chatState = s;
    renderChat();
  }
  const hint = (t) => { const e = $("chat-hint-t"); if (e) e.textContent = t; else $("chat-hint").textContent = t; };
  async function sendChat(t) {
    const p = { id: "p" + ++mineN, text: t, at: Date.now(), state: "sending", fresh: true };
    mine.push(p);
    renderChat();
    $("chat-go").disabled = true;
    try {
      const r = await call("chat", { text: t }, 30000);
      if (r.hint) { mine.splice(mine.indexOf(p), 1); hint(r.hint); if (!$("chat-in").value) $("chat-in").value = t; }
      else { p.state = "sent"; hint(r.answered ? "Done here. Telegram got a copy." : "Sent. The answer also lands in Telegram."); tour.did("chat"); if (r.answered) load(); }
    } catch (e) { p.state = "failed"; p.why = e.message; }
    $("chat-go").disabled = false;
    renderChat();
    loadChat();
  }
  $("chat-f").onsubmit = (ev) => {
    ev.preventDefault();
    const t = $("chat-in").value.trim();
    if (!t || $("chat-go").disabled) return;
    $("chat-in").value = "";
    sendChat(t);
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
  let keyAsk = null; // { which, purpose, btn }
  function closeKm() { km.hidden = true; $("km-ok").checked = false; $("km-word").value = ""; $("km-w").hidden = false; $("km-next").disabled = true; $("km-code").hidden = true; $("km-next").hidden = false; $("km-msg").textContent = ""; $("km-in").value = ""; }
  function kmReady() { $("km-next").disabled = !($("km-ok").checked && $("km-word").value.trim().toUpperCase() === "SHOW"); }
  function gotKey(r, purpose, btn) {
    tour.did("keys");
    if (purpose === "copy") {
      return copyText(r.key.value).then(() => {
        if (btn) setBtn(btn, "i-check", "Copied");
        $("keys-msg").textContent = "Copied. Paste it somewhere offline, then copy something else so it leaves your clipboard.";
      });
    }
    keysShown = { which: r.key.which, value: r.key.value, until: Date.now() + (r.showForMs || 30000) };
    renderKeys(D);
    $("keys-msg").textContent = "Shown for 30 seconds, then hidden again. Fren told you in Telegram.";
    clearTimeout(hideTimer); clearInterval(tickTimer);
    hideTimer = setTimeout(hideKeys, r.showForMs || 30000);
    tickTimer = setInterval(() => keysShown && renderKeys(D), 1000);
  }
  async function askKey(which, purpose, btn) {
    if (D && D.keysCanShow === false) {
      const r = await call("keys/request", {}).catch((e) => ({ text: e.message }));
      $("keys-msg").textContent = r.text; tour.did("keys"); return;
    }
    keyAsk = { which, purpose, btn };
    tour.did("keys");
    // Already unlocked in this browser for a couple of minutes: no new code.
    try { return await gotKey(await call("keys/reveal", { which, purpose }), purpose, btn); } catch {}
    $("km-h").textContent = purpose === "copy" ? "Copy your key?" : "Show your key?";
    km.hidden = false; $("km-ok").focus();
  }
  $("km-no").onclick = closeKm;
  $("km-ok").onchange = kmReady;
  $("km-word").oninput = kmReady;
  $("km-next").onclick = async () => {
    try {
      const r = await call("keys/request", { word: $("km-word").value });
      if (r.locked) { closeKm(); $("keys-msg").textContent = r.text; return; }
      $("km-t").textContent = r.text;
      $("km-msg").textContent = r.demoNote || "";
      $("km-code").hidden = false; $("km-next").hidden = true; $("km-w").hidden = true; $("km-in").focus();
    } catch (e) { $("km-msg").textContent = e.message; }
  };
  $("km-go").onclick = async () => {
    try {
      const a = keyAsk || { which: 0, purpose: "show" };
      const r = await call("keys/reveal", { code: $("km-in").value, which: a.which, purpose: a.purpose });
      closeKm(); await gotKey(r, a.purpose, a.btn);
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
    { k: "topup", h: "Add money here", p: "Pick a network, copy the address and send USDC to it from an exchange or your wallet. Same network on both sides. Or pay by card: it turns into USDC on Solana.", t: "Press Copy next to the address.", act: true },
    { k: "chat", bottom: true, h: "Talk to Fren", p: "This is your Telegram chat with Fren, right here. Ask what you hold or what to do; before any trade Fren says the most you can lose.", t: "Send Fren a message, e.g. \\"what do I hold?\\"", act: true },
    { k: "history", h: "Check every trade", p: "Everything Fren did, with a link to the public record. You don't have to trust us: click and see.", t: "Open one of the links." },
    { k: "stop", h: "Stop anytime", p: "Pause works at once and stops new trades. Turning back on needs the code from your chat, so nobody else can.", t: "You don't have to press it now. Just know it's here." },
    { k: "keys", h: "Your keys stay hidden", p: "A key is the password to a wallet. Here they stay as dots. Reveal shows one for 30 seconds after you type SHOW and the code Fren sends to your Telegram; the AI never sees them. Write them down offline, never send them to anyone.", t: "Press Reveal or Copy on a key to see how it works.", act: true },
  ];
  const tour = (() => {
    let i = -1;
    const done = new Set();
    const hole = $("tour-hole"), tip = $("tour-tip");
    const target = () => document.querySelector('[data-tour="' + STEPS[i].k + '"]');
    const tall = () => Boolean(STEPS[i].bottom) && target().getBoundingClientRect().height > innerHeight * 0.45;
    const tryLine = (s, ok) => { const t = $("tour-try"); t.className = "try" + (ok ? " done" : ""); t.replaceChildren(icon(ok ? "i-check" : "i-circle"), el("span", null, (ok ? "Done. " : "Try it: ") + s.t)); };
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
      tryLine(s, done.has(s.k));
      $("tour-back").disabled = i === 0;
      $("tour-next").textContent = i === STEPS.length - 1 ? "Finish" : "Next";
      if (s.k === "breakdown") $("where").open = true;
      const el = target();
      if (el.tagName === "DETAILS" && !el.open) { el.open = true; el.dataset.tourOpened = "1"; }
      // Phones: the tooltip sits at the bottom, over the page. A tall block
      // (the chat) goes to the bottom instead, with the tooltip on top, so its
      // send box stays free.
      const r = el.getBoundingClientRect();
      const phone = innerWidth <= 520;
      const y = phone && tall() ? scrollY + r.bottom - innerHeight + 16 : scrollY + r.top - (phone ? 76 : Math.max(76, (innerHeight - Math.min(r.height, innerHeight - 160)) / 2));
      scrollTo({ top: Math.max(0, y), behavior: "instant" });
      requestAnimationFrame(place);
    }
    function end() {
      i = -1; hole.hidden = tip.hidden = true;
      for (const d of document.querySelectorAll("details[data-tour-opened]")) { d.open = false; delete d.dataset.tourOpened; }
      try { localStorage.setItem("fren_tour_v1", "done"); } catch {}
    }
    $("tour-next").onclick = () => (i >= STEPS.length - 1 ? end() : show(i + 1));
    $("tour-back").onclick = () => i > 0 && show(i - 1);
    $("tour-skip").onclick = end;
    $("tour-open").onclick = () => show(0);
    addEventListener("resize", place);
    addEventListener("scroll", place, { passive: true });
    return {
      start: () => show(0),
      seen: () => { try { return localStorage.getItem("fren_tour_v1") === "done"; } catch { return true; } },
      did(k) { done.add(k); if (i >= 0 && STEPS[i].k === k) { tryLine(STEPS[i], true); if (k !== "keys") setTimeout(() => i >= 0 && STEPS[i].k === k && $("tour-next").click(), 900); } },
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
