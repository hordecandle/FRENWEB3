// The /vps wizard's state machine:
//   1. the buyer picks a network and gets an exact USDC amount and Fren's address;
//   2. we watch the chain for that transfer (or check a pasted transaction hash);
//   3. only then Fren orders the server from its EQVPS reseller balance;
//   4. a one-time SSH session installs Fren and hands over the private setup page,
//      where the owner adds an AI key and connects their Telegram bot.
// Pure logic: the chain, EQVPS, storage and the install trigger are passed in,
// so it runs the same in Netlify Functions and in tests.

import { randomBytes, randomInt } from "node:crypto";
import { fromUnits, isTxHash, NETWORKS, toUnits, walletUri } from "./chain.mjs";

const OS_NAME = "Ubuntu 24.04";
/** How long the page asks the buyer to pay within. */
export const PAY_WINDOW_MS = 60 * 60_000;
/** How long an exact amount stays reserved for one order (late payments still match). */
const RESERVE_MS = 24 * 60 * 60_000;
/** Don't hit the RPC on every poll. */
const CHECK_EVERY_MS = 8_000;
/** A pasted transaction may be a little older than the order (clock skew, fast payers). */
const TX_SLACK_MS = 10 * 60_000;
// A Netlify background function lives 15 minutes at most, so an install that is
// still "running" after that has been killed: give up on it a little later.
const INSTALL_TIMEOUT_MS = 17 * 60_000;
const SERVER_BOOT_TIMEOUT_MS = 30 * 60_000;
const AUTO_RETRIES = 1;
/** After a reinstall the server keeps answering as "active" for a while: wait before trusting it. */
export const REINSTALL_SETTLE_MS = 3 * 60_000;
const ORDER_TRIES = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const NOT_OPEN = "Server setup isn't open yet. Please check back soon.";

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} deps
 * @param {{ priceUsd: number, addresses: { base?: string, solana?: string }, planId?: string|number, contact?: string }} deps.config
 * @param {ReturnType<import("./chain.mjs").chainClient>} deps.chain
 * @param {ReturnType<import("./reseller.mjs").resellerClient> | null} deps.reseller
 * @param {{ get(id: string): Promise<any>, set(id: string, v: any): Promise<void> }} deps.store
 * @param {(id: string) => Promise<void>} deps.triggerInstall
 * @param {() => number} [deps.now]
 */
export function createWizard(deps) {
  const now = deps.now ?? Date.now;
  const cfg = deps.config;
  const contact = (cfg.contact ?? "").trim();
  const networks = Object.keys(NETWORKS).filter((n) => cfg.addresses?.[n]);
  const isOpen = () => Boolean(deps.reseller && cfg.planId && networks.length && cfg.priceUsd > 0);
  const priceUnits = () => toUnits(cfg.priceUsd);

  async function plans() {
    return {
      open: isOpen(),
      priceUsd: cfg.priceUsd,
      networks: networks.map((id) => ({ id, label: NETWORKS[id].label, token: NETWORKS[id].token })),
    };
  }

  async function start(email, network) {
    if (!isOpen()) throw new UserError(NOT_OPEN, 503);
    email = String(email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) throw new UserError("That email doesn't look right.");
    if (!networks.includes(network)) throw new UserError("Pick Base or Solana.");
    const rec = {
      id: randomBytes(24).toString("base64url"),
      email,
      network,
      address: cfg.addresses[network],
      stage: "awaiting_payment",
      createdAt: now(),
      expiresAt: now() + PAY_WINDOW_MS,
      cursor: await deps.chain[network].cursor(cfg.addresses[network]),
    };
    rec.units = (await reserveAmount(rec)).toString();
    await save(rec);
    return view(rec);
  }

  /**
   * The price plus 0.0001 to 0.0999 USDC, unique among open orders on that
   * network, so a transfer of exactly this amount identifies the order.
   */
  async function reserveAmount(rec) {
    for (let i = 0; i < 40; i++) {
      const units = priceUnits() + BigInt(randomInt(1, 1000)) * 100n;
      const key = amountKey(rec.network, units);
      const held = await deps.store.get(key);
      if (held && held.until > now() && held.id !== rec.id) continue;
      await deps.store.set(key, { id: rec.id, until: now() + RESERVE_MS });
      return units;
    }
    throw new UserError("Too many open orders right now. Try again in a minute.", 503);
  }

  /** Called by the page every few seconds; moves things along. */
  async function status(id) {
    const rec = await load(id);
    if (rec.stage === "awaiting_payment" || rec.stage === "expired") await watchPayment(rec);
    if (rec.stage === "paid" || rec.stage === "provisioning") await provision(rec);
    else if (rec.stage === "installing" && now() - rec.installStartedAt > INSTALL_TIMEOUT_MS) await fail(rec, "Installing took longer than expected.", "timeout");
    return view(rec);
  }

  async function watchPayment(rec) {
    if (rec.lastCheckAt && now() - rec.lastCheckAt < CHECK_EVERY_MS) return;
    rec.lastCheckAt = now();
    if (now() - rec.createdAt > RESERVE_MS) {
      rec.stage = "expired";
      await save(rec);
      return;
    }
    try {
      const { transfers, next } = await deps.chain[rec.network].transfersTo(rec.address, rec.cursor);
      rec.cursor = next;
      const hit = transfers.find((t) => t.units === BigInt(rec.units) && (t.at == null || t.at >= rec.createdAt - 2 * 60_000));
      if (hit && (await markPaid(rec, hit))) return;
    } catch (err) {
      // An RPC hiccup only delays the check; never treat it as paid or failed.
      console.error("payment check", err.message);
    }
    if (rec.stage === "awaiting_payment" && now() > rec.expiresAt) rec.stage = "expired";
    await save(rec);
  }

  /** "I've paid": the buyer pastes the transaction, e.g. when an exchange changed the amount. */
  async function submitTx(id, txIn) {
    const rec = await load(id);
    if (rec.stage !== "awaiting_payment" && rec.stage !== "expired") return view(rec);
    const tx = String(txIn ?? "").trim();
    if (!isTxHash(rec.network, tx)) throw new UserError(`That doesn't look like a ${NETWORKS[rec.network].label} transaction ID.`);
    const t = await deps.chain[rec.network].transferInTx(rec.address, tx);
    if (!t || t.pending) throw new UserError("We can see that transaction isn't confirmed yet. Give it a minute; this page moves on by itself.");
    if (t.failed) throw new UserError("That transaction failed on-chain, so nothing was sent.");
    if (t.units === 0n) throw new UserError(`That transaction didn't send ${NETWORKS[rec.network].token} on ${NETWORKS[rec.network].label} to the address on this page.`);
    if (t.units < priceUnits()) throw new UserError(`That transaction sent ${fromUnits(t.units)} USDC. The server is ${fromUnits(priceUnits())} USDC.`);
    if (t.at != null && t.at < rec.createdAt - TX_SLACK_MS) throw new UserError("That transaction is from before this order was made.");
    if (t.units !== BigInt(rec.units)) {
      // Another open order's exact amount belongs to that order.
      const held = await deps.store.get(amountKey(rec.network, t.units));
      if (held && held.id !== rec.id && held.until > now()) throw new UserError("That transaction matches a different order.");
    }
    if (!(await markPaid(rec, t))) throw new UserError("That transaction was already used for another order.");
    return view(rec);
  }

  /** One transaction pays for one order, ever. */
  async function markPaid(rec, t) {
    const key = `tx-${rec.network}-${t.tx.toLowerCase()}`;
    const used = await deps.store.get(key);
    if (used && used.id !== rec.id) return false;
    await deps.store.set(key, { id: rec.id, at: now() });
    rec.stage = "paid";
    rec.paidTx = t.tx;
    rec.paidUnits = t.units.toString();
    rec.paidAt = now();
    rec.progress = "Payment confirmed. Ordering your server…";
    await deps.store.set(amountKey(rec.network, BigInt(rec.units)), { id: rec.id, until: 0 });
    await save(rec);
    return true;
  }

  /** After payment: order the server once, wait for it to boot, then install. */
  async function provision(rec) {
    if (rec.stage === "paid") {
      if (rec.orderingAt && now() - rec.orderingAt < 60_000) return;
      rec.orderingAt = now();
      await save(rec);
      try {
        const hostname = hostnameFor(rec);
        let serviceId = await deps.reseller.findByHostname(hostname);
        if (!serviceId) {
          const clientId = await deps.reseller.client(rec.email);
          const osId = await deps.reseller.osId(OS_NAME).catch(() => null);
          serviceId = await deps.reseller.order({ clientId, planId: cfg.planId, osId, hostname });
        }
        rec.serviceId = serviceId;
        rec.stage = "provisioning";
        rec.provisionStartedAt = now();
        rec.progress = "Payment confirmed. Starting your server…";
        // The buyer paid for one month; Fren's balance shouldn't renew it silently.
        await deps.reseller.setAutorenew(serviceId, false).catch((e) => console.error("autorenew", e.message));
      } catch (err) {
        console.error("order", err.message);
        rec.orderingAt = null;
        rec.orderErrors = (rec.orderErrors ?? 0) + 1;
        if (rec.orderErrors >= ORDER_TRIES) {
          rec.stage = "failed";
          rec.retryable = false;
          rec.error = "We got your payment, but the server host didn't accept the order." + supportLine();
          rec.detail = err.message;
        }
        await save(rec);
        return;
      }
      await save(rec);
      return;
    }

    // provisioning
    if (rec.bootAfter && now() < rec.bootAfter) return;
    const svc = await deps.reseller.service(rec.serviceId);
    if ((svc.status === "active" || svc.status === "running") && svc.host) {
      // EQVPS shows the root password only once. If it's gone, ask for a new
      // one, at most every 90 s (EQVPS refuses resets closer together), and
      // read it on a later poll if the reset's answer didn't include it.
      let password = rec.password ?? svc.password;
      if (!password) {
        if (!rec.resetAt || now() - rec.resetAt > 90_000) {
          rec.resetAt = now();
          await save(rec);
          password = await deps.reseller.resetPassword(rec.serviceId).catch((e) => (console.error("reset password", e.message), null));
        }
        if (!password && now() - rec.provisionStartedAt <= SERVER_BOOT_TIMEOUT_MS) return save(rec);
        if (!password) {
          rec.stage = "failed";
          rec.retryable = false;
          rec.error = "Your server is up, but its host never gave us the login to install Fren." + supportLine();
          rec.detail = `server ${rec.serviceId}: no root password from EQVPS`;
          return save(rec);
        }
      }
      rec.host = svc.host;
      rec.port = svc.port || 22;
      rec.password = password;
      rec.stage = "installing";
      rec.progress = "Server is up. Installing Fren…";
      rec.installStartedAt = now();
      await save(rec);
      await deps.triggerInstall(rec.id);
      return;
    }
    if (now() - rec.provisionStartedAt > SERVER_BOOT_TIMEOUT_MS) {
      rec.stage = "failed";
      rec.retryable = false;
      rec.error = "Your payment arrived, but the server is taking far longer than usual to start." + supportLine();
      rec.detail = `server ${rec.serviceId} status: ${svc.status || "unknown"}`;
    }
    await save(rec);
  }

  function supportLine() {
    return contact ? ` Write to ${contact} and include this page's link; we'll sort it out.` : " Keep this page's link: it shows your order and payment.";
  }

  /**
   * An install went wrong. The server is paid for: retry once on our own, then
   * offer a button. Never a second order.
   */
  async function fail(rec, why, detail) {
    rec.attempts = rec.attempts ?? 0;
    if (rec.attempts < AUTO_RETRIES && rec.password && rec.host) return restart(rec);
    rec.stage = "failed";
    rec.retryable = Boolean(rec.password && rec.host);
    rec.error = rec.retryable
      ? `${why} Your server is paid for and nothing is lost. Press "Try again".` + (contact ? ` If it keeps failing, write to ${contact} and include this page's link.` : "")
      : `${why} Your server is paid for.` + supportLine();
    rec.detail = detail;
    await save(rec);
  }

  async function restart(rec) {
    rec.attempts = (rec.attempts ?? 0) + 1;
    rec.stage = "installing";
    rec.installClaimed = false;
    rec.retryable = false;
    delete rec.detail;
    rec.error = undefined;
    rec.progress = rec.attempts > 1 ? "Trying the install again…" : "Hit a snag, trying again automatically…";
    rec.installStartedAt = now();
    await save(rec);
    await deps.triggerInstall(rec.id);
    return rec;
  }

  async function retry(id) {
    const rec = await load(id);
    if (rec.stage !== "failed" || !rec.retryable) throw new UserError("There's nothing to retry for this setup.");
    await restart(rec);
    return view(rec);
  }

  /**
   * Operator only (see vps-admin.mjs): wipe this order's server, put a fresh OS
   * on it and install Fren again. Same order, same server, no new charge.
   */
  async function reinstall(id) {
    const rec = await load(id);
    if (!rec.serviceId || (rec.stage !== "ready" && rec.stage !== "failed")) {
      throw new UserError("This setup has no finished server to reinstall.");
    }
    const osId = await deps.reseller.osId(OS_NAME);
    if (!osId) throw new UserError(`EQVPS has no ${OS_NAME} image to reinstall with.`);
    const r = await deps.reseller.reinstall(rec.serviceId, osId);
    for (const k of ["setupUrl", "host", "detail", "error", "installClaimed", "installStartedAt", "password"]) delete rec[k];
    if (r.password) rec.password = r.password;
    rec.stage = "provisioning";
    rec.provisionStartedAt = now();
    rec.bootAfter = now() + REINSTALL_SETTLE_MS;
    rec.attempts = 0;
    rec.retryable = false;
    rec.reinstalls = (rec.reinstalls ?? 0) + 1;
    rec.progress = "Reinstalling your server with the latest Fren…";
    await save(rec);
    return view(rec);
  }

  /**
   * The background function's job: SSH in, run the installer, keep the newest
   * progress line, and finish with the setup link.
   * @param {(o: { host: string, port: number, password: string, command: string, onLine(l: string): void }) => Promise<{ code: number, output: string }>} ssh
   * @param {string} command  the install command to run on the server
   */
  async function install(id, ssh, command) {
    const rec = await load(id);
    if (rec.stage !== "installing" || rec.installClaimed) return;
    rec.installClaimed = true;
    await save(rec);
    let last = 0;
    const onLine = async (line) => {
      const step = line.match(/==>\s*(.+)$/)?.[1];
      if (step && now() - last > 2000) {
        last = now();
        rec.progress = friendly(step);
        await save(rec);
      }
    };
    try {
      const r = await ssh({ host: rec.host, port: rec.port, password: rec.password, command, onLine });
      const url = r.output.match(/FREN_SETUP_URL=(https:\/\/\S+)/)?.[1];
      if (r.code === 0 && url) {
        rec.stage = "ready";
        rec.setupUrl = url;
        rec.progress = "Done";
      } else {
        await fail(rec, "The install stopped before it finished.", tail(r.output));
        return;
      }
    } catch (err) {
      await fail(rec, "We couldn't reach your server.", err.message);
      return;
    }
    delete rec.password; // the installer locked root's password; we never need it again
    await save(rec);
  }

  async function load(id) {
    const rec = typeof id === "string" && id.length >= 20 && /^[\w-]+$/.test(id) ? await deps.store.get(id) : null;
    if (!rec) throw new UserError("We couldn't find that setup. Start again from the VPS page.", 404);
    return rec;
  }

  async function save(rec) {
    rec.updatedAt = now();
    await deps.store.set(rec.id, rec);
  }

  /** What the page sees: never passwords. */
  function view(rec) {
    const v = { id: rec.id, stage: rec.stage, now: now() };
    if (rec.network) {
      v.network = rec.network;
      v.networkLabel = NETWORKS[rec.network].label;
      v.token = NETWORKS[rec.network].token;
    }
    if (rec.units && (rec.stage === "awaiting_payment" || rec.stage === "expired")) {
      v.amount = fromUnits(rec.units);
      v.address = rec.address;
      v.walletUri = walletUri(rec.network, rec.address, rec.units);
      v.expiresAt = rec.expiresAt;
    }
    if (rec.paidTx) {
      v.paidTx = rec.paidTx;
      v.paidTxUrl = NETWORKS[rec.network].explorer(rec.paidTx);
      v.paidAmount = fromUnits(rec.paidUnits);
    }
    for (const k of ["progress", "setupUrl", "error", "detail", "retryable"]) if (rec[k] !== undefined) v[k] = rec[k];
    if (rec.stage === "failed" && contact) v.contact = contact;
    return v;
  }

  /** The Fren source is only handed out to a server while its install runs. */
  async function mayDownload(id) {
    const rec = await load(id);
    return rec.stage === "installing";
  }

  return { plans, start, status, submitTx, install, retry, reinstall, view, mayDownload };
}

const amountKey = (network, units) => `amt-${network}-${units}`;

/** A hostname EQVPS accepts, unique per order. */
export const hostnameFor = (rec) => "fren-" + rec.id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);

function friendly(step) {
  if (/basics/i.test(step)) return "Preparing the server…";
  if (/node|openclaw/i.test(step)) return "Installing Fren…";
  if (/download/i.test(step)) return "Downloading Fren…";
  if (/build/i.test(step)) return "Building Fren (a couple of minutes)…";
  if (/https/i.test(step)) return "Securing your setup page…";
  return step;
}

function tail(output) {
  return (
    output
      .replace(/\x1b\[[0-9;]*m/g, "")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .slice(-3)
      .join(" ")
      .slice(0, 400) || "no output"
  );
}
