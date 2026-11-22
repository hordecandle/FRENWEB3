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
.ic{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.top{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top__in{max-width:1280px;margin:0 auto;padding:0 28px;height:64px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{display:flex;align-items:baseline;gap:9px;font-weight:600;font-size:21px;letter-spacing:-.03em}
.brand small{font-weight:400;font-size:13px;color:var(--muted);letter-spacing:0}
.top__r{display:flex;align-items:center;gap:12px}
.demo{background:var(--blue-2);color:var(--ink);font-size:13px;padding:6px 16px;border-bottom:1px solid var(--blue-3);display:flex;align-items:center;justify-content:center;gap:8px}
.demo .ic{width:15px;height:15px}
.layout{max-width:1280px;margin:0 auto;padding:28px 28px 72px;display:grid;gap:24px;grid-template-columns:minmax(0,1fr) 400px;align-items:start}
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
.addrs{display:grid;gap:14px;grid-template-columns:1fr 1fr;align-items:stretch}
@media (max-width:760px){.addrs{grid-template-columns:1fr}}
.demo-warn{grid-column:1/-1;margin:0}
.addr-box{background:var(--bg);border-radius:16px;padding:18px;min-width:0;display:grid;grid-template-rows:auto auto 1fr;gap:4px}
.addr-box__t{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.addr-box h3{font-size:15px;font-weight:500;display:flex;align-items:center;gap:8px;min-width:0;min-height:36px;line-height:1.35}
.addr-box h3 .ic{width:18px;height:18px}
.addr-box .muted{font-size:13px}
.addr-box .addr{margin-top:8px;align-self:start}
.wait{display:flex;gap:12px;align-items:flex-start;background:var(--warn-2);border-radius:16px;padding:16px 18px;margin-top:12px;font-size:14px;line-height:1.5}
.wait .ic{width:18px;height:18px;flex:none;margin-top:3px;color:var(--warn)}
.wait p{margin-top:6px}.wait p:first-child{margin-top:0}
.wait .muted{color:var(--warn)}
.loss{font-weight:500}
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
.bub.typing{color:var(--muted);background:var(--line-2);border:0}
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
.foot{text-align:center;font-size:13px;color:var(--muted)}
@media (max-width:520px){.layout{padding:14px 14px 48px;gap:14px}.col{gap:14px}.card{padding:20px;border-radius:16px}.card__h{gap:12px;margin-bottom:16px}.ico{width:38px;height:38px;border-radius:12px}.ico .ic{width:20px;height:20px}.total{font-size:44px;letter-spacing:-.04em}.top__in{padding:0 16px;height:58px}.brand small{display:none}
.top__r .pill{display:none}.top__r{gap:10px}.chat{height:480px;min-height:0}.chat__h{padding:14px 16px}.chat__list{padding:14px 12px 8px}.bub{max-width:90%}.side{min-height:0}
.tour-tip{left:12px!important;right:12px;width:auto;bottom:12px;top:auto!important;padding:16px}.tour-tip.at-top{top:12px!important;bottom:auto}.tour-tip p{font-size:14px;margin-top:6px}.tour-tip .row{margin-top:12px}}
</style>`;

/** Line icons, 24x24, stroke 1.8, currentColor. The only pictures in the interface: no emoji outside the chat bubbles. */
const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M15.5 13.5h4.5"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></symbol>
  <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 18.5 9.5 12l3.5 3.5 7-8"/><path d="M15.5 7.5H20v4.5"/></symbol>
  <symbol id="i-history" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4.5H9"/><path d="M12 8.5V12l2.5 1.5"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></symbol>
  <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/></symbol>
  <symbol id="i-login" viewBox="0 0 24 24"><path d="M13 4.5h4.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H13"/><path d="M4 12h9M9.5 8.5 13 12l-3.5 3.5"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6l-4.5 3.5V16H7a2.5 2.5 0 0 1-2.5-2.5z"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></symbol>
  <symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8"/><path d="M17 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H10"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></symbol>
  <symbol id="i-target" viewBox="0 0 24 24"><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-card" viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M3.5 10h17M7 14.5h3"/></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M9 7v10M15 7v10"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 6.5v11l9-5.5z"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M20 4 4 10.5l7 2.5 2.5 7z"/><path d="m11 13 9-9"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/></symbol>
  <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M4 4l16 16"/><path d="M10 6.3A9.7 9.7 0 0 1 12 6c5.5 0 9 6 9 6a15 15 0 0 1-3 3.6M6.4 7.9A15 15 0 0 0 3 12s3.5 6 9 6c1.4 0 2.6-.3 3.7-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>
  <symbol id="i-tg" viewBox="0 0 24 24"><path d="M21.2 4.1 2.9 11.2c-.8.3-.8 1.4 0 1.7l4.5 1.6 1.8 5.4c.2.7 1.1.9 1.6.4l2.6-2.5 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15.2c.2-.9-.7-1.6-1.5-1.3Z"/><path d="m7.4 14.5 10.4-7-7.6 8.1-.4 4"/></symbol>
  <symbol id="i-sol" viewBox="0 0 24 24"><path d="M6.5 7h12l-3 3h-12zM6.5 11h12l-3 3h-12zM6.5 15h12l-3 3h-12z"/></symbol>
  <symbol id="i-eth" viewBox="0 0 24 24"><path d="M12 3.5 6 12.5l6 3.5 6-3.5z"/><path d="m6 13.5 6 7 6-7-6 3.5z"/></symbol>
  <symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M5 7h14M9.5 7V5h5v2M8 7l.8 12h6.4L16 7"/></symbol>
  <symbol id="i-flag" viewBox="0 0 24 24"><path d="M5.5 20V4.5h11l-2.5 4 2.5 4h-11"/></symbol>
</svg>`;

const ic = (name: string) => `<svg class="ic"><use href="#${name}"/></svg>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const LOGIN_PAGE = (message: string) => `<!doctype html><html lang="en"><head>${HEAD}<title>Fren dashboard</title></head>
<body><div class="center"><div class="brand">Fren<small>dashboard</small></div><p class="muted">${esc(message)}</p></div></body></html>`;

const COMMON_JS = `
  const $ = (id) => document.getElementById(id);
  const usd = (n) => { if (n == null || !isFinite(n)) return "–"; const a = Math.abs(n), d = 2; return (n < 0 ? "-$" : "$") + a.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }); };
  const signed = (n) => (n == null ? "–" : (n > 0 ? "+" : "") + usd(n));
  const px = (n) => (n == null ? "–" : "$" + Number(n).toLocaleString("en-US", { maximumSignificantDigits: 6 }));
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  /** An <svg><use> for one of the page's line icons. */
  function icon(name) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "ic"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + name); s.append(u); return s; }
  /** A button with an icon in front of its label. */
  function iconBtn(name, label, cls) { const b = el("button", cls || "btn btn--2 btn--sm"); b.type = "button"; b.append(icon(name), el("span", null, label)); return b; }
  function setBtn(b, name, label) { b.replaceChildren(icon(name), el("span", null, label)); }
  /** Bot text shown as part of the page (history, receipts) loses its emoji: the page has its own icons. The chat keeps them. */
  const plain = (s) => String(s == null ? "" : s).replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]/gu, "").replace(/^[ \\t]+/gm, "").replace(/[ \\t]{2,}/g, " ");
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
<header class="top"><div class="top__in"><div class="brand">Fren<small>dashboard</small></div></div></header>
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
    <div class="row"><button class="btn btn--2" data-w="solana">${ic("i-sol")}<span>Phantom (Solana)</span></button><button class="btn btn--2" data-w="evm">${ic("i-eth")}<span>MetaMask (EVM)</span></button></div>
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
<header class="top"><div class="top__in"><div class="brand">Fren<small>dashboard</small></div>
  <div class="top__r"><span class="pill" id="pill"><i></i><span id="pill-t">Loading…</span></span><button class="btn btn--2 btn--sm" id="tour-open" aria-label="Show me around">${ic("i-target")}<span>Tour</span></button><button class="link" id="logout">Log out</button></div></div>
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
    <div class="addrs" id="addrs"></div>
    <p class="note">${ic("i-alert")}<span>Send <b>USDC</b> from an exchange or your own wallet. <b>Same network on both sides</b>, or the money gets lost. It shows up above in a minute or two.</span></p>
    <div id="card-box" hidden><div class="lbl">${ic("i-card")}<span>Or pay by card</span></div><p class="muted" id="card-note" style="margin-top:6px"></p><div class="row"><a class="btn" id="card-btn" target="_blank" rel="noopener">${ic("i-card")}<span>Pay by card</span></a></div></div>
  </section>

  <section class="card" id="wait-card" hidden>
    <div class="card__h"><span class="ico ico--warn">${ic("i-clock")}</span><div><p class="kicker">Waiting for your OK</p><h2>Fren wants to do this</h2></div></div>
    <div id="waits"></div>
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
    <p class="note">${ic("i-lock")}<span>Pause works at once. Turning back on, closing real trades and raising limits need the code from your chat: reply <b>/ok CODE</b> there.</span></p>
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
    <div class="row"><button class="btn btn--2" id="keys-show">${ic("i-eye")}<span>Show keys</span></button><button class="btn btn--2" id="keys-hide" hidden>${ic("i-eye-off")}<span>Hide</span></button></div>
    <p class="note">${ic("i-shield")}<span>A key is the password to a wallet. <b>Whoever has a key owns the money.</b> Keep a copy offline, never send it to anyone, Fren included.</span></p>
    <div class="msg" id="keys-msg"></div>
  </section>

  <section class="card">
    <div class="card__h"><span class="ico">${ic("i-login")}</span><div><p class="kicker">Ways in</p><h2>Log in without Telegram</h2></div></div>
    <div class="lbl" style="margin-top:0">${ic("i-mail")}<span>Email</span></div>
    <div class="field"><input id="si-email" type="email" placeholder="you@example.com"><button class="btn btn--2" id="si-email-save">${ic("i-check")}<span>Save</span></button></div>
    <div class="lbl">${ic("i-wallet")}<span>Wallets you log in with</span></div>
    <div id="si-wallets" class="keys" style="margin-top:8px"></div>
    <div class="row"><button class="btn btn--2" data-link="solana">${ic("i-sol")}<span>Add Phantom (Solana)</span></button><button class="btn btn--2" data-link="evm">${ic("i-eth")}<span>Add MetaMask (EVM)</span></button></div>
    <div class="msg" id="si-msg"></div>
  </section>

  <p class="foot">Fren is software you run yourself. Not financial advice.</p>
 </div>

 <aside class="side">
  <section class="card chat" data-tour="chat" id="chat-card">
    <div class="chat__h"><span class="ico ico--blue">${ic("i-chat")}</span><div><h2>Talk to Fren</h2><p class="muted" id="chat-sub">The same chat as in Telegram.</p></div><p class="kicker" id="chat-k" hidden>Chat</p></div>
    <div class="chat__list" id="chat"></div>
    <form class="chat__f" id="chat-f"><textarea id="chat-in" rows="1" placeholder="Ask Fren anything"></textarea><button class="btn" id="chat-go">${ic("i-send")}<span>Send</span></button></form>
    <p class="chat__hint" id="chat-hint">${ic("i-tg")}<span id="chat-hint-t">Codes like /ok go in Telegram, where the code arrives.</span></p>
  </section>
 </aside>
</main>

<div class="modal" id="km" hidden><div class="modal__c">
  <span class="ico ico--bad">${ic("i-key")}</span>
  <h3>Show your keys?</h3>
  <p>Anyone who sees a key can take the money in that wallet. Make sure nobody is looking at your screen and you're not sharing it.</p>
  <label class="check"><input type="checkbox" id="km-ok"><span>I understand. I'll keep the keys offline and never send them to anyone.</span></label>
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

  async function call(path, body) {
    const res = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-fren": "1" }, body: JSON.stringify(body) });
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

  function renderTopUp(d) {
    const w = $("addrs");
    if (w.dataset.done) return;
    w.replaceChildren();
    const a = d.addresses;
    if (!a) { w.append(el("p", "muted", "No wallets yet.")); return; }
    if (d.demo) { const dw = el("p", "wait demo-warn"); dw.append(icon("i-alert"), el("span", null, "Demo addresses: don't send anything here, it would be lost.")); w.append(dw); }
    for (const [name, v, note, ico] of [["Solana", a.solana, "USDC or SOL.", "i-sol"], ["Base, Arbitrum, Polygon or Hyperliquid", a.evm, "USDC. One address for all of them.", "i-eth"]]) {
      if (!v) continue;
      const box = el("div", "addr-box");
      const copy = iconBtn("i-copy", "Copy");
      copy.onclick = async () => { try { await navigator.clipboard.writeText(v); } catch { const r = document.createRange(); r.selectNodeContents(box.querySelector(".addr")); getSelection().removeAllRanges(); getSelection().addRange(r); } setBtn(copy, "i-check", "Copied"); setTimeout(() => setBtn(copy, "i-copy", "Copy"), 1500); tour.did("topup"); };
      const top = el("div", "addr-box__t");
      const h = el("h3"); h.append(icon(ico), el("span", null, name));
      top.append(h, copy);
      box.append(top, el("p", "muted", note), el("div", "addr", v));
      w.append(box);
    }
    w.dataset.done = "1";
  }

  function renderCard(d) {
    const c = d.card;
    $("card-box").hidden = !c;
    if (!c) return;
    $("card-btn").href = c.url;
    $("card-note").textContent = "Test mode: " + c.provider + " opens a practice checkout, no real card is charged. USDC lands in your Base wallet, shown above in a minute or two.";
  }

  function renderWaiting(d) {
    $("wait-card").hidden = !d.waiting.length;
    const w = $("waits");
    w.replaceChildren();
    for (const x of d.waiting) {
      const box = el("div", "wait");
      const body = el("div");
      body.append(el("p", "muted", when(x.at) + " · you asked: " + plain(x.request)));
      for (const s of x.steps) body.append(el("p", null, plain(s)));
      if (x.maxLoss) body.append(el("p", "loss", plain(x.maxLoss)));
      const p = el("p", "muted"); p.append("To go ahead, reply in Telegram with "); p.append(el("b", null, "/ok") ); p.append(" and the code Fren sent you there. Ignore it and nothing happens.");
      body.append(p);
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

  function renderHistory(d) {
    const ul = $("hist");
    ul.replaceChildren();
    const st = { done: ["Done", "tag--ok", "i-check"], failed: ["Didn't go through", "tag--bad", "i-x"], cancelled: ["Cancelled", "", "i-x"], active: ["Watching the price", "tag--wait", "i-clock"], rejected: ["Blocked by your limits", "tag--bad", "i-shield"] };
    for (const h of d.history) {
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

  let keysShown = null;
  let hideTimer = 0;
  function renderKeys(d) {
    const w = $("keys");
    const rows = keysShown || [{ label: "Solana wallet key", value: null }, { label: "EVM wallet key (Base, Arbitrum, Polygon)", value: null }, { label: "Hyperliquid trading key", value: null }];
    w.replaceChildren();
    for (const k of rows) {
      const r = el("div", "key" + (k.value ? " shown" : ""));
      const t = el("div"); t.append(el("b", null, k.label), el("code", null, k.value || "••••••••••••••••••••••••••••••••"));
      r.append(icon(k.value ? "i-eye" : "i-lock"), t);
      if (k.value) { const c = iconBtn("i-copy", "Copy"); c.onclick = () => navigator.clipboard.writeText(k.value).then(() => setBtn(c, "i-check", "Copied")); r.append(c); }
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
      const rm = iconBtn("i-trash", "Remove");
      rm.onclick = () => call("sign-in/wallet/remove", x).then(load);
      r.append(icon(x.kind === "evm" ? "i-eth" : "i-sol"), t, rm); w.append(r);
    }
  }

  function render(d) {
    D = d;
    renderBalance(d); renderTopUp(d); renderCard(d); renderWaiting(d); renderPositions(d); renderHistory(d); renderSafety(d); renderSignIn(d);
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
  const hint = (t) => { const e = $("chat-hint-t"); if (e) e.textContent = t; else $("chat-hint").textContent = t; };
  $("chat-f").onsubmit = async (ev) => {
    ev.preventDefault();
    const t = $("chat-in").value.trim();
    if (!t) return;
    $("chat-go").disabled = true;
    try {
      const r = await call("chat", { text: t });
      if (r.hint) hint(r.hint);
      else { $("chat-in").value = ""; hint("Sent. The answer also lands in Telegram."); tour.did("chat"); }
      await loadChat();
      $("chat").scrollTop = $("chat").scrollHeight;
    } catch (e) { hint(e.message); }
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
    { k: "keys", h: "Your keys stay hidden", p: "A key is the password to a wallet. Fren keeps them locked away where neither this page nor the AI can read them. To see them yourself, open Terminal on the computer Fren runs on and type: fren keys", t: "Press Show keys to see where to look.", act: true },
  ];
  const tour = (() => {
    let i = -1;
    const done = new Set();
    const hole = $("tour-hole"), tip = $("tour-tip");
    const target = () => document.querySelector('[data-tour="' + STEPS[i].k + '"]');
    const tall = () => Boolean(STEPS[i].bottom) && target().getBoundingClientRect().height > innerHeight * 0.45;
    const tryLine = (s, ok) => { const t = $("tour-try"); t.className = "try" + (ok ? " done" : ""); t.replaceChildren(icon(ok ? "i-check" : "i-target"), el("span", null, (ok ? "Done. " : "Try it: ") + s.t)); };
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
