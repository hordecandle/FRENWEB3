// Confirms a USDC payment by reading the chain. No payment processor, no
// account for the buyer: they send an exact amount to Fren's address, and we
// look for that transfer.
//
// Each order gets its own amount (the price plus a few hundredths of a cent,
// e.g. 10.0437 USDC), so a transfer of exactly that amount to our address after
// the order was made can only be that order's payment. A pasted transaction
// hash is the fallback for wallets or exchanges that round the amount.

export const USDC = {
  base: { mint: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6, chainId: 8453 },
  solana: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

export const NETWORKS = {
  base: { label: "Base", token: "USDC", explorer: (tx) => `https://basescan.org/tx/${tx}` },
  solana: { label: "Solana", token: "USDC", explorer: (tx) => `https://solscan.io/tx/${tx}` },
};

// keccak256("Transfer(address,address,uint256)")
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// Base makes a block every 2 s; a few blocks back is safe from reorgs in practice.
const BASE_CONFIRMATIONS = 3;
const BASE_LOG_CHUNK = 2_000;

/** "10.0437" → 10043700n for 6 decimals. */
export function toUnits(amount, decimals = 6) {
  const [i, f = ""] = String(amount).split(".");
  return BigInt(i + f.padEnd(decimals, "0").slice(0, decimals));
}

/** 10043700n → "10.0437" (trailing zeros trimmed, at least two decimals). */
export function fromUnits(units, decimals = 6) {
  const s = BigInt(units).toString().padStart(decimals + 1, "0");
  let f = s.slice(-decimals).replace(/0+$/, "");
  if (f.length < 2) f = f.padEnd(2, "0");
  return `${s.slice(0, -decimals)}.${f}`;
}

/** The link a wallet opens from the QR code: the token, amount and address all filled in. */
export function walletUri(network, address, units) {
  if (network === "base") return `ethereum:${USDC.base.mint}@${USDC.base.chainId}/transfer?address=${address}&uint256=${units}`;
  return `solana:${address}?amount=${fromUnits(units)}&spl-token=${USDC.solana.mint}&label=Fren&message=Fren%20server`;
}

export function isAddress(network, a) {
  return network === "base" ? /^0x[0-9a-fA-F]{40}$/.test(a) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

export function isTxHash(network, h) {
  return network === "base" ? /^0x[0-9a-fA-F]{64}$/.test(h) : /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h);
}

function rpc(url, fetchFn) {
  let n = 0;
  return async (method, params) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "fren-site/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(`${method}: ${j.error?.message ?? `HTTP ${res.status}`}`);
    return j.result;
  };
}

/**
 * A transfer looks like { tx, units: bigint, at: ms | null }.
 * @param {{ baseRpc: string, solanaRpc: string, fetchFn?: typeof fetch }} o
 */
export function chainClient({ baseRpc, solanaRpc, fetchFn = fetch }) {
  const base = rpc(baseRpc, fetchFn);
  const sol = rpc(solanaRpc, fetchFn);
  const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

  const evm = {
    /** Where to start looking for an order made now. */
    async cursor(_to) {
      return Number(BigInt(await base("eth_blockNumber", [])));
    },

    /** USDC transfers to `to` from block `from` up to the confirmed head. Returns { transfers, next }. */
    async transfersTo(to, from) {
      const head = Number(BigInt(await base("eth_blockNumber", []))) - BASE_CONFIRMATIONS;
      const transfers = [];
      let start = from;
      while (start <= head) {
        const end = Math.min(head, start + BASE_LOG_CHUNK - 1);
        const logs = await base("eth_getLogs", [
          { address: USDC.base.mint, topics: [TRANSFER, null, pad(to)], fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) },
        ]);
        for (const l of logs ?? []) transfers.push({ tx: l.transactionHash, units: BigInt(l.data), at: null });
        start = end + 1;
      }
      return { transfers, next: Math.max(from, head + 1) };
    },

    /** The USDC this one transaction sent to `to`, once it has enough confirmations. */
    async transferInTx(to, tx) {
      const r = await base("eth_getTransactionReceipt", [tx]);
      if (!r) return null;
      if (r.status !== "0x1") return { tx, units: 0n, at: null, failed: true };
      const head = Number(BigInt(await base("eth_blockNumber", [])));
      if (head - Number(BigInt(r.blockNumber)) < BASE_CONFIRMATIONS) return { tx, pending: true };
      const block = await base("eth_getBlockByNumber", [r.blockNumber, false]);
      let units = 0n;
      for (const l of r.logs ?? []) {
        if (l.address?.toLowerCase() === USDC.base.mint && l.topics?.[0] === TRANSFER && l.topics?.[2]?.toLowerCase() === pad(to)) units += BigInt(l.data);
      }
      return { tx, units, at: block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : null };
    },
  };

  /** How much USDC `owner` gained in a parsed Solana transaction. */
  function solanaGain(t, owner) {
    if (!t || t.meta?.err) return 0n;
    const bal = (list) =>
      (list ?? [])
        .filter((b) => b.mint === USDC.solana.mint && b.owner === owner)
        .reduce((s, b) => s + BigInt(b.uiTokenAmount?.amount ?? "0"), 0n);
    const gain = bal(t.meta?.postTokenBalances) - bal(t.meta?.preTokenBalances);
    return gain > 0n ? gain : 0n;
  }

  const tokenAccounts = async (owner) =>
    (await sol("getTokenAccountsByOwner", [owner, { mint: USDC.solana.mint }, { encoding: "jsonParsed", commitment: "finalized" }]))?.value ?? [];

  const solana = {
    /** The newest signature on our USDC account, so an order only looks at what comes after it. */
    async cursor(owner) {
      const [a] = await tokenAccounts(owner);
      if (!a) return null;
      const [s] = (await sol("getSignaturesForAddress", [a.pubkey, { limit: 1, commitment: "finalized" }])) ?? [];
      return s?.signature ?? null;
    },

    /** USDC that reached `owner`'s token accounts. `from` is the newest signature already seen. */
    async transfersTo(owner, from) {
      const transfers = [];
      let next = from;
      for (const a of await tokenAccounts(owner)) {
        const sigs = await sol("getSignaturesForAddress", [a.pubkey, { limit: 25, commitment: "finalized", ...(from ? { until: from } : {}) }]);
        if (sigs?.[0]) next = sigs[0].signature;
        for (const s of sigs ?? []) {
          if (s.err) continue;
          const t = await sol("getTransaction", [s.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
          const units = solanaGain(t, owner);
          if (units > 0n) transfers.push({ tx: s.signature, units, at: s.blockTime ? s.blockTime * 1000 : null });
        }
      }
      return { transfers, next };
    },

    async transferInTx(owner, tx) {
      const t = await sol("getTransaction", [tx, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
      if (!t) return { tx, pending: true };
      if (t.meta?.err) return { tx, units: 0n, at: null, failed: true };
      return { tx, units: solanaGain(t, owner), at: t.blockTime ? t.blockTime * 1000 : null };
    },
  };

  return { base: evm, solana };
}
