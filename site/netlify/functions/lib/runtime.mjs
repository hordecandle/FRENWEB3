// Wires the wizard to Netlify: settings from environment variables, Blobs for
// state, public RPCs (or your own) for payments, ssh2 for the one-time install.
import { getStore } from "@netlify/blobs";
import ssh2 from "ssh2";
import { chainClient, isAddress } from "./chain.mjs";
import { resellerClient } from "./reseller.mjs";
import { createWizard, UserError } from "./wizard.mjs";

const env = (k) => (process.env[k] ?? "").trim();
const siteUrl = () => env("URL") || "https://getfren.netlify.app";

/**
 * Everything the wizard needs from Netlify's environment variables. Missing
 * settings keep the wizard closed ("isn't open yet") instead of half-working.
 */
export function config() {
  const addresses = {};
  if (isAddress("base", env("FREN_PAY_BASE_ADDRESS"))) addresses.base = env("FREN_PAY_BASE_ADDRESS");
  if (isAddress("solana", env("FREN_PAY_SOLANA_ADDRESS"))) addresses.solana = env("FREN_PAY_SOLANA_ADDRESS");
  return {
    priceUsd: Number(env("FREN_PRICE_USD") || 10),
    addresses,
    planId: env("EQVPS_RESELLER_PLAN_ID"),
    contact: env("FREN_SUPPORT_CONTACT"),
  };
}

export function wizard() {
  const blobs = getStore({ name: "fren-vps", consistency: "strong" });
  const token = env("EQVPS_RESELLER_TOKEN");
  return createWizard({
    config: config(),
    chain: chainClient({
      baseRpc: env("FREN_BASE_RPC") || "https://base-rpc.publicnode.com",
      solanaRpc: env("FREN_SOLANA_RPC") || "https://api.mainnet-beta.solana.com",
    }),
    reseller: token ? resellerClient({ token, ...(env("EQVPS_RESELLER_API") ? { base: env("EQVPS_RESELLER_API") } : {}) }) : null,
    store: {
      get: (id) => blobs.get(id, { type: "json" }),
      set: (id, v) => blobs.setJSON(id, v),
    },
    triggerInstall: async (id) => {
      // Background functions answer 202 at once and run for up to 15 minutes.
      const res = await fetch(`${siteUrl()}/.netlify/functions/vps-install-background`, { method: "POST", body: JSON.stringify({ id }) });
      if (res.status >= 400) throw new Error(`Couldn't start the install (${res.status}).`);
    },
  });
}

/** What runs on the new server, as root. */
export function installCommand(id, updateKey) {
  const url = env("FREN_INSTALL_URL") || `${siteUrl()}/install.sh`;
  const broker = env("FREN_BOT_BROKER");
  const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;
  // The repo is private, so the server gets Fren's code from this site instead
  // of GitHub, only while its own install runs (see vps-src.mjs).
  const tarball = `${siteUrl()}/api/vps/src?id=${encodeURIComponent(id)}`;
  // Kept on the server (root only) so /fren_update can fetch newer versions later.
  const updateSrc = updateKey ? `${tarball}&key=${encodeURIComponent(updateKey)}` : "";
  return (
    `curl -fsSL ${q(url)} | bash -s -- --server --web --lock-root --tarball ${q(tarball)}` +
    (updateSrc ? ` --update-src ${q(updateSrc)}` : "") +
    (broker ? ` --bot-broker ${q(broker)}` : "")
  );
}

/** Run one command over SSH, retrying the connection while the server boots. */
export async function sshRun({ host, port, password, command, onLine }, { tries = 30, waitMs = 10_000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await sshOnce({ host, port, password, command, onLine });
    } catch (err) {
      if (err.started) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function sshOnce({ host, port, password, command, onLine }) {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    let output = "";
    let partial = "";
    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return reject(Object.assign(err, { started: true }));
          const take = (d) => {
            const text = d.toString();
            output = (output + text).slice(-100_000);
            const lines = (partial + text).split("\n");
            partial = lines.pop() ?? "";
            for (const l of lines) onLine?.(l);
          };
          stream.on("data", take);
          stream.stderr.on("data", take);
          stream.on("close", (code) => {
            conn.end();
            resolve({ code: code ?? 1, output });
          });
        });
      })
      .on("error", reject)
      .connect({ host, port, username: "root", password, tryKeyboard: false, readyTimeout: 20_000, keepaliveInterval: 15_000 });
  });
}

export function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Turns thrown errors into { error } with a status the page can show. */
export async function handle(fn) {
  try {
    return json(200, await fn());
  } catch (err) {
    if (err instanceof UserError) return json(err.status ?? 400, { error: err.message });
    console.error(err);
    return json(502, { error: "Something on our side didn't answer. This page keeps trying." });
  }
}
