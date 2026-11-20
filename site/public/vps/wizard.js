(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MOCK = params.has("mock");
  // v2 rail: 1 Server · 2 Pay · 3 Install · 4 AI brain · 5 Chat → Live (FLOW_V2.md)
  const STEPS = ["plan", "pay", "build", "ready"];
  const RAIL = ["Server", "Pay", "Install", "AI brain", "Chat"];
  const CHECK = '<svg class="ic" style="width:13px;height:13px;stroke-width:2.6"><use href="#i-check"/></svg>';
  function drawRail(now) {
    let h = "";
    RAIL.forEach((name, i) => {
      const n = i + 1;
      const st = n < now ? "done" : n === now ? "now" : "";
      h += `<li class="${st}"><span class="n"><i>${n < now ? CHECK : n}</i><span>${name}</span></span><span class="bar"></span></li>`;
    });
    h += `<li class="live"><span class="n"><i><svg viewBox="0 0 116 80" style="width:13px;fill:currentColor"><use href="#mark"/></svg></i><span>Live</span></span></li>`;
    $("rail").innerHTML = h;
    $("rail").setAttribute("aria-label", `Step ${now} of 5`);
    $("top-step").innerHTML = `Step <b>${now}</b> of 5`;
  }
  const SCREENS = ["s-plan", "s-pay", "s-build", "s-ready", "s-failed"];
  const FALLBACK = { open: true, priceUsd: 10, networks: [{ id: "base", label: "Base", token: "USDC" }, { id: "solana", label: "Solana", token: "USDC" }] };
  const MOCK_ADDR = { base: "0x1111111111111111111111111111111111111111", solana: "FrenPay1111111111111111111111111111111111" };

  let id = params.get("id");
  let timer = null;
  let apiDown = false;
  let network = "base";
  const NOT_OPEN = "Server setup isn't open yet. Please check back soon.";

  // ---- API (real, or a local mock when the page has ?mock; ?mock&paid=1 pays after 8 s) ----
  const mock = {
    key: "fren-vps-mock2",
    load() {
      try {
        return JSON.parse(sessionStorage.getItem(this.key)) || {};
      } catch {
        return {};
      }
    },
    save(v) {
      try {
        sessionStorage.setItem(this.key, JSON.stringify(v));
      } catch {}
    },
    run(path, body) {
      const db = this.load();
      if (path === "plans") return FALLBACK;
      if (path === "start") {
        const nid = "mock_" + Math.random().toString(36).slice(2, 12) + "xxxxxxxxxxxx";
        db[nid] = { network: body.network, t: Date.now(), amount: (10 + Math.floor(Math.random() * 999 + 1) / 10000).toFixed(4), paidAt: params.has("paid") ? Date.now() + 8000 : null };
        this.save(db);
        return this.view(nid, db[nid]);
      }
      if (path === "tx") {
        if (!/^0x[0-9a-f]{64}$|^[1-9A-HJ-NP-Za-km-z]{64,90}$/i.test(body.tx)) throw new Error("That doesn't look like a transaction ID.");
        db[body.id].paidAt = Date.now();
        this.save(db);
        return this.view(body.id, db[body.id]);
      }
      if (path === "retry") return this.view(body.id, db[body.id]);
      if (path === "status") {
        if (!db[body.id]) throw new Error("not found");
        return this.view(body.id, db[body.id]);
      }
    },
    view(nid, r) {
      const n = FALLBACK.networks.find((x) => x.id === r.network);
      const base = { id: nid, network: r.network, networkLabel: n.label, token: "USDC", now: Date.now() };
      if (!r.paidAt || Date.now() < r.paidAt) {
        const addr = MOCK_ADDR[r.network];
        return { ...base, stage: "awaiting_payment", amount: r.amount, address: addr, expiresAt: r.t + 3600e3, walletUri: r.network === "base" ? `ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=${addr}&uint256=${Math.round(r.amount * 1e6)}` : `solana:${addr}?amount=${r.amount}&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` };
      }
      const s = (Date.now() - r.paidAt) / 1000;
      const paid = { ...base, paidTx: "0xabc", paidTxUrl: "https://basescan.org/", paidAmount: r.amount };
      if (s < 6) return { ...paid, stage: "provisioning", progress: "Starting your server…" };
      if (s < 14) return { ...paid, stage: "installing", progress: "Installing Fren…" };
      return { ...paid, stage: "ready", setupUrl: "https://51-75-123-45.sslip.io/setup?t=mocktoken", polymarket: { blocked: false, country: "FI" } };
    },
  };

  async function api(path, body) {
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 350));
      return mock.run(path, body || {});
    }
    const url =
      path === "status" ? `/api/vps/status?id=${encodeURIComponent(body.id)}` : `/api/vps/${path}`;
    const res = await fetch(url, {
      method: path === "plans" || path === "status" ? "GET" : "POST",
      headers: path === "plans" || path === "status" ? {} : { "Content-Type": "application/json" },
      body: path === "plans" || path === "status" ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      const e = new Error(
        (data && data.error) ||
          (res.status === 404 || apiDown ? NOT_OPEN : "Something went wrong. Please try again."),
      );
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // ---- UI ----
  function countryName(code) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
    } catch {
      return code;
    }
  }

  function show(screen, step) {
    if (screen !== "s-pay") clearInterval(countdown);
    SCREENS.forEach((s) => ($(s).hidden = s !== screen));
    // On the result screens one action is enough: no FAQ or footer under the card.
    const quiet = screen === "s-ready" || screen === "s-failed";
    $("faq").hidden = quiet;
    document.querySelector(".foot").hidden = quiet;
    drawRail(STEPS.indexOf(step) + 1);
  }

  function remember(nid) {
    id = nid;
    const u = new URL(location.href);
    u.searchParams.set("id", nid);
    history.replaceState(null, "", u);
  }

  // One plan, sized for Fren: users shouldn't have to compare server specs.
  function renderPlans(info) {
    const p = { priceUsd: info.priceUsd };
    // Only the networks Fren has an address for.
    document.querySelectorAll("#networks .tile").forEach((t) => {
      t.hidden = !info.networks.some((n) => n.id === t.dataset.network);
    });
    if (!info.networks.some((n) => n.id === network) && info.networks[0]) pickNetwork(info.networks[0].id);
    const box = $("plans");
    box.replaceChildren();
    const card = document.createElement("div");
    card.className = "plan";
    const left = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = "Fren server";
    const spec = document.createElement("small");
    spec.textContent = "2 CPUs · 2 GB · its own\u00a0address · first month included";
    left.append(name, spec);
    const price = document.createElement("div");
    price.className = "price";
    price.append(`$${p.priceUsd} `);
    const per = document.createElement("small");
    per.textContent = "USDC / month";
    price.append(per);
    card.append(left, price);
    box.append(card);
  }

  function renderStage(d) {
    if (d.id) remember(d.id);
    clearTimeout(timer);
    switch (d.stage) {
      case "awaiting_payment":
      case "expired":
        show("s-pay", "pay");
        renderPay(d);
        break;
      case "paid":
      case "provisioning":
      case "installing": {
        show("s-build", "build");
        const order = ["provisioning", "installing", "ready"];
        const at = d.stage === "paid" ? 0 : order.indexOf(d.stage);
        document.querySelectorAll("#build li[data-stage]").forEach((li, i) => {
          li.classList.toggle("is-done", i < at);
          li.classList.toggle("is-now", i === at);
          li.querySelector(".dot").innerHTML = i < at ? CHECK : "";
        });
        $("bar").style.width = at === 0 ? "28%" : "62%";
        $("progress").textContent = d.progress || "Usually 3 to 5 minutes.";
        $("paid-line").replaceChildren();
        if (d.paidAmount) {
          $("paid-line").append(`: ${d.paidAmount} ${d.token || "USDC"} on ${d.networkLabel || ""} (`);
          const a = document.createElement("a");
          a.className = "textlink";
          a.href = d.paidTxUrl;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "see transaction";
          $("paid-line").append(a, ")");
        }
        break;
      }
      case "ready":
        show("s-ready", "ready");
        $("setup-link").href = d.setupUrl;
        try {
          $("ready-host").textContent = new URL(d.setupUrl).host;
        } catch {}
        // Polymarket's own check, asked from the new server after the install.
        if (d.polymarket) {
          const where = d.polymarket.country ? countryName(d.polymarket.country) : "its country";
          const el = $("poly-check");
          el.textContent = d.polymarket.blocked
            ? "Polymarket says it doesn't take new bets from this server's location (" + where + "). Other venues work. Contact support to move it."
            : "Checked with Polymarket: bets work from this server (" + where + ").";
          el.className = "msg " + (d.polymarket.blocked ? "msg--bad" : "msg--ok");
          el.hidden = false;
        }
        return;
      case "failed":
        show("s-failed", "build");
        // After payment the fix is a retry on the same server, never a new order.
        if (d.retryable) {
          $("fail-title").textContent = "The install got stuck";
          $("fail-msg").innerHTML =
            "Your server is fine and already paid for. Fren just didn't finish installing. Try again on the same server: <b>you won't be charged twice.</b>";
        } else {
          $("fail-title").textContent = "Something went wrong";
          $("fail-msg").textContent = d.error || "The server didn't finish setting up. Press Start again to try once more.";
        }
        $("retry").hidden = !d.retryable;
        $("fail-paid").hidden = !d.retryable;
        $("start-again").hidden = Boolean(d.retryable);
        // Support line only when a contact is configured: no contact, no line.
        $("fail-contact").hidden = !d.contact;
        $("fail-contact").textContent = d.contact ? `Still stuck? Write to ${d.contact} and include this page's link.` : "";
        {
          const log = [d.retryable ? d.error : "", d.detail].filter(Boolean).join("\n\n");
          $("fail-more").hidden = !log;
          $("fail-more").open = false;
          $("fail-detail").textContent = log;
        }
        return;
    }
    timer = setTimeout(poll, 5000);
  }

  let countdown = null;
  function renderPay(d) {
    const amount = d.amount + " " + d.token;
    $("pay-title").textContent = amount;
    $("pay-amount").textContent = d.amount;
    $("pay-token").textContent = d.token;
    $("pay-net").textContent = d.networkLabel;
    $("pay-net-lead").textContent = d.networkLabel;
    $("pay-net-warn").textContent = d.networkLabel;
    $("pay-addr").textContent = d.address;
    $("open-wallet").href = d.walletUri;
    $("tx").placeholder = d.network === "base" ? "0x…" : "Solana transaction signature";
    drawQr(d.walletUri);
    const expired = d.stage === "expired";
    $("pay-restart").hidden = !expired;
    if (expired) $("tx-box").open = true;
    clearInterval(countdown);
    const skew = Date.now() - (d.now || Date.now());
    const tick = () => {
      const left = d.expiresAt - (Date.now() - skew);
      if (expired || left <= 0) {
        $("pay-wait").textContent = "We haven't seen this payment yet. Sent it late? We'll still pick it up here, or paste the transaction ID below.";
        return;
      }
      const m = Math.floor(left / 60000);
      const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
      $("pay-wait").textContent = `Waiting for your payment. We're watching the blockchain, so this page moves on by itself. Please pay within ${m}:${s}.`;
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  let qrFor = null;
  function drawQr(url) {
    if (qrFor === url || typeof qrcode !== "function") return;
    qrFor = url;
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    $("qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  async function poll() {
    try {
      renderStage(await api("status", { id }));
    } catch (e) {
      if (e.status === 400 || e.status === 404 || e.message === "not found") {
        show("s-failed", "plan");
        $("fail-msg").textContent =
          e.status === 400 ? e.message : "We couldn't find that setup. The link may be wrong or expired. Press Start again for a new one.";
        $("fail-title").textContent = "Something went wrong";
        ["retry", "fail-paid", "fail-contact", "fail-more"].forEach((x) => ($(x).hidden = true));
        $("start-again").hidden = false;
        return;
      }
      if (!$("s-build").hidden) $("progress").textContent = "Can't reach Fren right now. Trying again…";
      timer = setTimeout(poll, 8000); // network blip: keep trying
    }
  }

  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) btn.innerHTML = label;
  }

  $("retry").addEventListener("click", async () => {
    busy($("retry"), true);
    try {
      renderStage(await api("retry", { id }));
    } catch (e) {
      $("fail-msg").textContent = e.message;
    } finally {
      busy($("retry"), false);
    }
  });

  function pickNetwork(n) {
    network = n;
    document.querySelectorAll("#networks .tile").forEach((t) => {
      const on = t.dataset.network === n;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-checked", String(on));
    });
  }
  document.querySelectorAll("#networks .tile").forEach((t) => t.addEventListener("click", () => pickNetwork(t.dataset.network)));

  $("s-plan").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("email").value.trim();
    $("err-plan").textContent = "";
    if (apiDown) {
      $("err-plan").textContent = NOT_OPEN;
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $("err-plan").textContent = "Enter a valid email address.";
      $("email").focus();
      return;
    }
    const btn = $("go");
    busy(btn, true, "Getting your payment details…");
    try {
      renderStage(await api("start", { email, network }));
    } catch (e) {
      $("err-plan").textContent = e.message;
    } finally {
      busy(btn, false, 'Show payment details<svg class="ic"><use href="#i-arrow"/></svg>');
    }
  });

  $("tx-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const tx = $("tx").value.trim();
    $("err-tx").textContent = "";
    if (!tx) {
      $("err-tx").textContent = "Paste the transaction ID first.";
      return;
    }
    busy($("tx-go"), true, "Checking…");
    try {
      renderStage(await api("tx", { id, tx }));
    } catch (e) {
      $("err-tx").textContent = e.message;
    } finally {
      busy($("tx-go"), false, "Check payment");
    }
  });

  // http по IP (стенд) не даёт navigator.clipboard, поэтому запасной путь через выделение и execCommand
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
  async function copy(btn, text) {
    const label = btn.querySelector("span");
    const was = label.dataset.was || label.textContent;
    label.dataset.was = was;
    label.textContent = (await copyText(text)) ? "Copied" : "Select and copy";
    clearTimeout(btn._t);
    btn._t = setTimeout(() => (label.textContent = was), 2000);
  }
  $("copy-link").addEventListener("click", () => copy($("copy-link"), $("setup-link").href));
  $("copy-amount").addEventListener("click", () => copy($("copy-amount"), $("pay-amount").textContent));
  $("copy-addr").addEventListener("click", () => copy($("copy-addr"), $("pay-addr").textContent));
  $("copy-detail").addEventListener("click", () => copy($("copy-detail"), $("fail-detail").textContent + "\n" + location.href));

  // ---- boot ----
  (async () => {
    renderPlans(FALLBACK);
    if (id) {
      // An existing order: never flash the "buy a server" screen while it loads.
      show("s-build", "build");
      $("progress").textContent = "Loading your order…";
      poll();
      return;
    }
    show("s-plan", "plan");
    try {
      const info = await api("plans");
      if (!info.open || !info.networks?.length) {
        apiDown = true;
        $("err-plan").textContent = NOT_OPEN;
        return;
      }
      renderPlans(info);
    } catch {
      apiDown = true;
    }
  })();
})();
