import type { Link } from "./receipt.js";

/** Where the owner can follow a trade afterwards. Every link is public and read-only. */

const hlApp = (testnet: boolean) => (testnet ? "https://app.hyperliquid-testnet.xyz" : "https://app.hyperliquid.xyz");

export const hyperliquidLinks = {
  /** Hyperdash shows any address's positions and PnL, live. Mainnet only. */
  tracker: (address: string): Link => ({ label: "Track PnL on Hyperdash", url: `https://hyperdash.com/address/${address}` }),
  account: (address: string, testnet: boolean): Link => ({ label: "Hyperliquid explorer", url: `${hlApp(testnet)}/explorer/address/${address}` }),
  tx: (hash: string, testnet: boolean, label = "Order on Hyperliquid explorer"): Link => ({ label, url: `${hlApp(testnet)}/explorer/tx/${hash}` }),
  chart: (coin: string, testnet: boolean): Link => ({ label: "Chart", url: `${hlApp(testnet)}/trade/${coin}` }),
};

const DEXSCREENER: Record<string, string> = { solana: "solana", base: "base", arbitrum: "arbitrum" };

/** A token's live chart. Null where DexScreener doesn't list the chain. */
export function tokenChart(chain: string, address: string): Link | null {
  const net = DEXSCREENER[chain];
  return net ? { label: "Chart on DexScreener", url: `https://dexscreener.com/${net}/${address}` } : null;
}

const WALLET_EXPLORER: Record<string, string> = {
  solana: "https://solscan.io/account/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

export function walletLink(chain: string, address: string): Link | null {
  const base = WALLET_EXPLORER[chain];
  return base ? { label: "Your wallet", url: `${base}${address}` } : null;
}
