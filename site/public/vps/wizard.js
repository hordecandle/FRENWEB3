(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MOCK = params.has("mock");
  // v2 rail: 1 Server · 2 Pay · 3 Install · 4 AI brain · 5 Telegram → Live (FLOW_V2.md)
  const STEPS = ["plan", "pay", "build", "ready"];
  const RAIL = ["Server", "Pay", "Install", "AI brain", "Telegram"];
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
  const SCREENS = ["s-plan", "s-code", "s-pay", "s-build", "s-ready", "s-failed"];
  const FALLBACK_PLANS = [
    { slug: "micro-ip", name: "Micro", priceUsd: 10, vcpu: 2, ramGb: 2, recommended: true },
    { slug: "ai-agent-ip", name: "AI Agent", priceUsd: 15 },
    { slug: "small-ip", name: "Small", priceUsd: 16 },
  ];

  let id = params.get("id");
  let timer = null;
  let apiDown = false;
  const NOT_OPEN = "The VPS wizard isn't open yet. Check back very soon, or use the one-line install for now.";

  // ---- API (real, or a local mock when the page has ?mock) ----
  const mock = {
    key: "fren-vps-mock",
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
      if (path === "plans") return { plans: FALLBACK_PLANS };
      if (path === "start") {
        const nid = "mock_" + Math.random().toString(36).slice(2, 10);
        db[nid] = { plan: body.plan, t: Date.now(), needsCode: /existing/.test(body.email) };
        this.save(db);
        return db[nid].needsCode ? { id: nid, stage: "needs_code" } : this.view(nid, db[nid]);
      }
      if (path === "code") {
        if (body.code !== "123456") throw new Error("That code didn't match. Try again.");
        db[body.id].needsCode = false;
        db[body.id].t = Date.now();
        this.save(db);
        return this.view(body.id, db[body.id]);
      }
      if (path === "retry") {
        db[body.id].t = Date.now() - 14000;
        this.save(db);
        return this.view(body.id, db[body.id]);
      }
      if (path === "status") {
        if (!db[body.id]) throw new Error("not found");
        return this.view(body.id, db[body.id]);
      }
    },
    view(nid, r) {
      const s = (Date.now() - r.t) / 1000;
      const plan = FALLBACK_PLANS.find((p) => p.slug === r.plan) || FALLBACK_PLANS[0];
      const base = { id: nid, plan: r.plan, amountUsd: plan.priceUsd, checkoutUrl: "https://example.com/checkout/" + nid };
      if (s < 8) return { ...base, stage: "awaiting_payment" };
      if (s < 14) return { ...base, stage: "provisioning", progress: "Booting Ubuntu 24.04" };
      if (s < 22) return { ...base, stage: "installing", progress: "Installing Fren and starting the service" };
      return { ...base, stage: "ready", setupUrl: "https://203-0-113-7.sslip.io/setup?t=mocktoken" };
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
  function show(screen, step) {
    SCREENS.forEach((s) => ($(s).hidden = s !== screen));
    drawRail(STEPS.indexOf(step) + 1);
  }

  function remember(nid) {
    id = nid;
    const u = new URL(location.href);
    u.searchParams.set("id", nid);
    history.replaceState(null, "", u);
  }

  // One plan, sized for Fren: users shouldn't have to compare server specs.
  function renderPlans(plans) {
    const p = plans.find((x) => x.recommended) || plans[0];
    const box = $("plans");
    box.replaceChildren();
    const card = document.createElement("div");
    card.className = "plan";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "plan";
    input.value = p.slug;
    input.checked = true;
    input.hidden = true;
    const left = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = "Fren server";
    const spec = document.createElement("small");
    spec.textContent = p.vcpu ? `${p.vcpu} vCPU · ${p.ramGb} GB RAM · own IP · stop anytime` : "Own IP · stop anytime";
    left.append(name, spec);
    const price = document.createElement("div");
    price.className = "price";
    price.append(`$${p.priceUsd} `);
    const per = document.createElement("small");
    per.textContent = "/ month";
    price.append(per);
    card.append(input, left, price);
    box.append(card);
  }

  function renderStage(d) {
    if (d.id) remember(d.id);
    clearTimeout(timer);
    switch (d.stage) {
      case "needs_code":
        show("s-code", "plan");
        $("code").focus();
        return;
      case "awaiting_payment":
        show("s-pay", "pay");
        if (d.amountUsd != null) $("amount").textContent = `$${d.amountUsd}`;
        if (d.checkoutUrl) {
          $("checkout").href = d.checkoutUrl;
          drawQr(d.checkoutUrl);
        }
        break;
      case "provisioning":
      case "installing": {
        show("s-build", "build");
        const order = ["provisioning", "installing", "ready"];
        const at = order.indexOf(d.stage);
        document.querySelectorAll("#build li").forEach((li, i) => {
          li.classList.toggle("is-done", i < at);
          li.classList.toggle("is-now", i === at);
          li.querySelector(".dot").innerHTML = i < at ? CHECK : "";
        });
        $("bar").style.width = at === 0 ? "28%" : "62%";
        $("progress").textContent = d.progress ? `${d.progress}. Usually 3 to 5 minutes.` : "Usually 3 to 5 minutes.";
        break;
      }
      case "ready":
        show("s-ready", "ready");
        $("setup-link").href = d.setupUrl;
        try {
          $("ready-host").textContent = new URL(d.setupUrl).host;
        } catch {}
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
          $("fail-msg").textContent = d.error || "The server didn't finish setting up.";
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
          e.status === 400 ? e.message : "We couldn't find that setup. The link may be wrong or expired.";
        $("fail-title").textContent = "Something went wrong";
        ["retry", "fail-paid", "fail-contact", "fail-more"].forEach((x) => ($(x).hidden = true));
        $("start-again").hidden = false;
        return;
      }
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

  $("s-plan").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("email").value.trim();
    const plan = (document.querySelector('input[name="plan"]:checked') || {}).value;
    $("err-plan").textContent = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $("err-plan").textContent = "Enter a valid email address.";
      $("email").focus();
      return;
    }
    const btn = $("go");
    busy(btn, true, "Creating your order…");
    try {
      renderStage(await api("start", { email, plan }));
    } catch (e) {
      $("err-plan").textContent = apiDown ? NOT_OPEN : e.message;
    } finally {
      busy(btn, false, 'Continue to payment<svg class="ic"><use href="#i-arrow"/></svg>');
    }
  });

  $("s-code").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const code = $("code").value.replace(/\D/g, "");
    $("err-code").textContent = "";
    if (code.length !== 6) {
      $("err-code").textContent = "Enter the 6-digit code from your email.";
      return;
    }
    try {
      renderStage(await api("code", { id, code }));
    } catch (e) {
      $("err-code").textContent = e.message;
    }
  });

  async function copy(btn, text) {
    const label = btn.querySelector("span");
    const was = label.textContent;
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = "Copied";
    } catch {
      label.textContent = "Press ⌘C";
    }
    setTimeout(() => (label.textContent = was), 1800);
  }
  $("copy-link").addEventListener("click", () => copy($("copy-link"), $("setup-link").href));
  $("copy-detail").addEventListener("click", () => copy($("copy-detail"), $("fail-detail").textContent + "\n" + location.href));

  // ---- boot ----
  (async () => {
    renderPlans(FALLBACK_PLANS);
    show("s-plan", "plan");
    if (id) {
      poll();
      return;
    }
    try {
      const { plans } = await api("plans");
      if (Array.isArray(plans) && plans.length) renderPlans(plans);
    } catch {
      apiDown = true;
    }
  })();
})();
