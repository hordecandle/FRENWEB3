import { existsSync, readFileSync } from "node:fs";
import { isolatedMarker } from "./setup.js";
import { SignerProcess, type SignerApi } from "@fren/signer";
import { createApi } from "./api.js";
import { Dashboard } from "./dashboard.js";
import { Connection } from "@solana/web3.js";
import { deriveApiUrl, hyperliquidApiUrl, jupiterApiUrl, jupiterLendApiUrl, frenPaths, loadConfig, relayApiUrl, type FrenConfig, type FrenPaths } from "./config.js";
import { Fren } from "./engine.js";
import type { Fetch } from "./http.js";
import { GatewayLine, OwnerNotifier, TelegramLine, type Exec, type OwnerLine } from "./notify.js";
import { Store } from "./store.js";
import { AgentBudget } from "./guard.js";
import { HyperliquidVenue } from "./venues/hyperliquid.js";
import { JupiterVenue, USDC_MINT } from "./venues/jupiter.js";
import { OnlinePumpFun } from "./venues/pumpfun.js";
import { RELAY_DEPOSIT_MAX_SOL_LAMPORTS, RELAY_SOLANA_CHAIN_ID, RelayVenue } from "./venues/relay.js";
import { SolanaToArbitrum } from "./venues/cctp.js";
import { DeriveVenue } from "./venues/derive.js";
import { PolymarketVenue } from "./venues/polymarket.js";
import { polymarketGeoblock, SdkPolymarketData, SdkPolymarketTrader } from "./venues/polymarket-sdk.js";
import { AaveUsdc } from "./venues/aave.js";
import { JupiterLendUsdc, KaminoUsdc } from "./venues/solana-lend.js";
import { YieldVenue, type YieldProtocolAdapter } from "./venues/yield.js";
import { UpdateReporter, Updater } from "./updater.js";
import { SnipeFeed, solanaMentions } from "./snipe-feed.js";

export interface BuildOptions {
  config: FrenConfig;
  store: Store;
  signer: SignerApi | null;
  fetchFn?: Fetch;
  exec?: Exec;
}

/** Wire the engine from its parts. Used by the daemon and by tests with fakes. */
/** Lines to the owner, most private first. */
export function ownerLines(config: FrenConfig, fetchFn: Fetch, exec?: Exec): OwnerLine[] {
  return [
    ...(config.telegram ? [new TelegramLine(fetchFn, config.telegram)] : []),
    ...config.notify.map((t) => new GatewayLine(t, exec, config.openclawBin)),
  ];
}

export function buildFren({ config, store, signer, fetchFn = fetch, exec }: BuildOptions): Fren {
  const isTestnet = config.network === "testnet";
  // Money moves between the wallet's own Solana and EVM addresses. Circle's
  // bridge (Solana to Arbitrum), Relay to Solana and Relay from Solana to
  // Hyperliquid run on mainnet only.
  // The venues are read lazily: they are built just below.
  const bridges = signer && !isTestnet;
  const solanaBridge: SolanaToArbitrum | null = bridges
    ? new SolanaToArbitrum({
        fetchFn,
        kv: store,
        sendSolana: (ixs, extra, maxSol) => jupiter.sendWithSigners(ixs, extra, maxSol),
        solanaOwner: () => jupiter.walletKey(),
        evmOwner: async () => (await signer.addresses()).evm,
        sendArbitrum: (to, data) => relay.sendTx("arbitrum", to, data),
      })
    : null;
  const hyperliquid = new HyperliquidVenue({
    fetchFn,
    apiUrl: hyperliquidApiUrl(config),
    isTestnet,
    store,
    signer,
    markets: { dexes: config.hyperliquidDexes },
    // Read lazily: relay and jupiter are built just below.
    arbitrumUsdc: async () => (await relay.usdcBalances()).arbitrum ?? 0,
    solanaUsdc: async () => (await jupiter.usdcBalance()) ?? 0,
    ...(bridges ? { solanaDirect: { send: (usd: number) => relay.solanaToHyperliquid(usd, (ixs) => jupiter.sendWithSigners(ixs, [], RELAY_DEPOSIT_MAX_SOL_LAMPORTS)) } } : {}),
    ...(solanaBridge ? { solanaBridge } : {}),
  });
  const jupiter: JupiterVenue = new JupiterVenue({
    fetchFn,
    apiUrl: jupiterApiUrl(config),
    ...(config.jupiterApiKey ? { apiKey: config.jupiterApiKey } : {}),
    solanaRpcUrl: config.solanaRpcUrl,
    store,
    signer,
    pumpFun: new OnlinePumpFun(new Connection(config.solanaRpcUrl, { commitment: "confirmed", fetch: fetchFn })),
    snipeTipLamports: config.snipeTipLamports,
    evmUsdc: () => relay.usdcBalances(),
    ...(bridges
      ? {
          bridgeIn: async (usd: number) =>
            relay.bridgeUsdc({ toChainId: RELAY_SOLANA_CHAIN_ID, toCurrency: USDC_MINT, recipient: (await signer.addresses()).solana, usd, where: "your Solana wallet" }),
        }
      : {}),
  });
  const relay: RelayVenue = new RelayVenue({
    fetchFn,
    apiUrl: relayApiUrl(config),
    ...(config.relayApiKey ? { apiKey: config.relayApiKey } : {}),
    isTestnet,
    store,
    signer,
    rpcUrls: config.evmRpcUrls,
    gasReserveWei: ethToWei(config.evmGasReserveEth),
    solanaUsdc: async () => (await jupiter.usdcBalance()) ?? 0,
    ...(solanaBridge ? { solanaBridge } : {}),
  });
  const lending: YieldProtocolAdapter[] = [
    new JupiterLendUsdc({ fetchFn, apiUrl: jupiterLendApiUrl(config), ...(config.jupiterApiKey ? { apiKey: config.jupiterApiKey } : {}), solana: jupiter }),
    new KaminoUsdc({ fetchFn, apiUrl: config.kaminoApiUrl, solana: jupiter }),
    // Aave's pools are on mainnet Arbitrum and Base; on testnet the EVM side is Sepolia.
    ...(isTestnet ? [] : [new AaveUsdc("arbitrum", relay), new AaveUsdc("base", relay)]),
  ];
  return new Fren({
    store,
    signer,
    isTestnet,
    notifier: new OwnerNotifier(store, ownerLines(config, fetchFn, exec)),
    hyperliquid,
    jupiter,
    relay,
    derive: new DeriveVenue({
      fetchFn,
      apiUrl: deriveApiUrl(config),
      isTestnet,
      store,
      signer,
      spotPrice: async (asset) => (await hyperliquid.markets.get(asset))?.midPx ?? null,
    }),
    // Polymarket has no testnet: quotes and paper bets use its real markets, and
    // live bets only run on mainnet.
    polymarket: new PolymarketVenue({
      store,
      data: new SdkPolymarketData(),
      trader: signer && !isTestnet ? new SdkPolymarketTrader(signer) : null,
      geoblocked: polymarketGeoblock(fetchFn),
    }),
    yield: new YieldVenue({
      store,
      protocols: lending,
      walletUsdc: async (chain) => (chain === "solana" ? ((await jupiter.usdcBalance()) ?? 0) : ((await relay.usdcBalances())[chain] ?? 0)),
    }),
  });
}

export async function startDaemon(paths: FrenPaths = frenPaths()) {
  const iso = isolatedMarker(paths);
  if (iso) throw new Error(`Fren's engine runs as ${iso.engineUser} now (keys in ${iso.frenHome}). Start it with: sudo systemctl start fren`);
  const config = loadConfig(paths);
  if (!existsSync(paths.apiToken)) throw new Error(`No API token at ${paths.apiToken}. Run \`fren init\` first.`);
  const token = readFileSync(paths.apiToken, "utf8").trim();
  const store = new Store(paths.db, config.paperStartingUsd);

  let signer: SignerProcess | null = null;
  if (existsSync(paths.keystore)) {
    signer = new SignerProcess({
      keystorePath: paths.keystore,
      passphraseFile: paths.passphrase,
      solanaRpcUrl: config.solanaRpcUrl,
      evmRpcUrls: evmRpcsById(config),
      evmGasReserveWei: ethToWei(config.evmGasReserveEth),
      ...(process.env.FREN_SIGNER_PREFIX ? { commandPrefix: process.env.FREN_SIGNER_PREFIX.split(" ") } : {}),
    });
    await signer.ready;
  }

  const fren = buildFren({ config, store, signer });
  const budget = new AgentBudget(store, () => {
    try {
      return loadConfig(paths).agentGuard;
    } catch {
      return config.agentGuard;
    }
  });
  // The web dashboard runs where the installer put an HTTPS address in front of it (VPS).
  const dashUrl = dashboardUrl();
  const dashboard = dashUrl ? new Dashboard(fren, { publicUrl: dashUrl }) : null;
  const dashServer = dashboard?.server() ?? null;
  if (dashServer) {
    const port = Number(process.env.FREN_DASHBOARD_PORT ?? 7422);
    await new Promise<void>((res) => dashServer.listen(port, "127.0.0.1", res));
    console.log(`dashboard on http://127.0.0.1:${port}, public at ${dashUrl}`);
  }
  const updater = new Updater(paths.home);
  // /fren_update: say how it went as soon as the result lands and the chat line is up.
  const updates = new UpdateReporter(updater, (text) => fren.tellOwner(text));
  const checkUpdates = () => void updates.check().catch(() => {});
  setInterval(checkUpdates, 20_000).unref();
  const server = createApi(fren, token, budget, { dashboard, updater, onGatewayUp: () => setTimeout(checkUpdates, 5000) });
  await new Promise<void>((res) => server.listen(config.api.port, config.api.host, res));

  const timer = setInterval(() => {
    fren.tick().catch((err: Error) => console.error(`watcher: ${err.message}`));
  }, config.watcherIntervalMs);
  // Solana launches: a live feed fires the snipe the moment the coin moves; polling is the fallback.
  const feed = config.snipeFeed
    ? new SnipeFeed({
        source: solanaMentions(
          new Connection(config.solanaRpcUrl, { commitment: "processed", ...(config.solanaWsUrl ? { wsEndpoint: config.solanaWsUrl } : {}) }),
        ),
        targets: () => fren.snipeTargets().filter((t) => t.venue === "jupiter").map((t) => t.token),
        fire: () => fren.snipeTick().catch((err: Error) => console.error(`snipes: ${err.message}`)),
      })
    : null;
  const snipeTimer = setInterval(() => {
    feed?.sync();
    fren.snipeTick().catch((err: Error) => console.error(`snipes: ${err.message}`));
  }, config.snipeIntervalMs);

  const limits = fren.limits();
  console.log(
    `frend listening on http://${config.api.host}:${config.api.port} · ${config.network} · ${limits.mode} mode${limits.paused ? " · stopped" : ""}`,
  );

  const shutdown = () => {
    clearInterval(timer);
    clearInterval(snipeTimer);
    feed?.close();
    server.close();
    dashServer?.close();
    signer?.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { fren, server, stop: shutdown };
}

/** FREN_DASHBOARD_URL, or the address install.sh wrote for this server. Null = no dashboard. */
export function dashboardUrl(file = "/etc/fren-dashboard.url"): string | null {
  const v = (process.env.FREN_DASHBOARD_URL ?? (existsSync(file) ? readFileSync(file, "utf8") : "")).trim();
  return /^https:\/\/[\w.-]+(:\d+)?\/?$/.test(v) ? v : null;
}

/** Config ETH amounts to wei, without float drift past 9 decimals. */
export function ethToWei(eth: number): bigint {
  return BigInt(Math.round(eth * 1e9)) * 1_000_000_000n;
}

/** The signer wants RPCs by chain id; the config names chains. */
function evmRpcsById(config: FrenConfig): Record<number, string> {
  const ids = config.network === "mainnet" ? { base: 8453, robinhood: 4663, arbitrum: 42161 } : { base: 84532, robinhood: 46630, arbitrum: 421614 };
  const out: Record<number, string> = {};
  for (const [name, url] of Object.entries(config.evmRpcUrls)) if (url) out[ids[name as keyof typeof ids]] = url;
  return out;
}
