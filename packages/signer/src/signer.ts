import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
import { signL1Action, signUserSignedAction, type Signature } from "@nktkas/hyperliquid/signing";
import { ApproveAgentTypes, Withdraw3Types } from "@nktkas/hyperliquid/api/exchange";
import { depositToHyperliquid } from "./arbitrum.js";
import { sendEvmTransaction, type EvmTxRequest } from "./evm.js";
import {
  deriveAuthHeaders,
  deriveSessionKeyOf,
  registerDeriveSessionKey,
  signDeriveOrder,
  type DeriveAuthHeaders,
  type DeriveOrderRequest,
  type DeriveOrderSignature,
  type DeriveSessionKeyRegistration,
} from "./derive.js";
import { signPolymarketTypedData, type PolyTypedData } from "./polymarket.js";
import { addressesOf, type Addresses, type KeyMaterial } from "./keystore.js";
import { checkHyperliquidAction, checkSolanaTransaction, SignerRuleError, type SolanaTxReport } from "./rules.js";
import { fetchLookupTables, simulateAndCheck } from "./solana-sim.js";

export type { Signature };

export interface HlSignRequest {
  action: Record<string, unknown>;
  nonce: number;
  isTestnet: boolean;
  expiresAfter?: number;
}

export interface HlApproveAgentResult {
  action: Record<string, unknown>;
  signature: Signature;
  nonce: number;
}

export interface SolSignRequest {
  txBase64: string;
  /** Upper bound on SOL (in lamports) the wallet may lose in this transaction, fees included. */
  maxSolSpendLamports: number;
  /** Launch snipes only: allow a Jito tip up to this many lamports (the signer caps it at 0.01 SOL). */
  jitoTipLamports?: number;
}

export interface SolSignResult {
  signedTxBase64: string;
  report: SolanaTxReport & { simulatedSolDeltaLamports?: number };
}

/** The whole surface the engine can reach. Nothing here can export a key or move funds to an outside address. */
export interface SignerApi {
  addresses(): Promise<Addresses>;
  hlSignL1(req: HlSignRequest): Promise<Signature>;
  hlApproveAgent(req: { isTestnet: boolean }): Promise<HlApproveAgentResult>;
  solSignTransaction(req: SolSignRequest): Promise<SolSignResult>;
  /** Move USDC from the wallet's own Arbitrum address into its own Hyperliquid account. */
  hlDepositFromArbitrum(req: { amountUsd: number; isTestnet: boolean }): Promise<{ txHash: `0x${string}` }>;
  /**
   * Withdraw USDC from the wallet's own Hyperliquid account to the same
   * address on Arbitrum. The destination is fixed in the signer; the engine
   * only chooses the amount. Returns the signed action for the engine to post.
   */
  hlWithdrawToSelf(req: { amountUsd: number; isTestnet: boolean }): Promise<HlApproveAgentResult>;
  /** Send an EVM transaction to an allow-listed contract (Relay swaps and their approvals). Carries ETH only into a Relay swap selling ETH, keeping the gas reserve. */
  evmSendTransaction(req: EvmTxRequest): Promise<{ txHash: `0x${string}` }>;
  /** Sign a Derive option order with the session key. The signer builds the action; it can only be a trade. */
  deriveSignOrder(req: DeriveOrderRequest): Promise<DeriveOrderSignature>;
  /** Derive REST auth headers from the session key, for the current time. */
  deriveAuthHeaders(req: { isTestnet: boolean }): Promise<DeriveAuthHeaders>;
  /** The master key registers Fren's own session key with the option-trading scope only. */
  deriveRegisterSessionKey(req: { isTestnet: boolean }): Promise<DeriveSessionKeyRegistration>;
  /** Polymarket EIP-712: login, orders, and deposit-wallet approvals. Nothing that moves funds out. */
  polySignTypedData(req: PolyTypedData): Promise<`0x${string}`>;
}

export interface SignerOptions {
  /**
   * Solana RPC for lookup tables and pre-sign simulation. Omit only in tests:
   * without it the token-account checks don't run.
   */
  solanaRpcUrl?: string;
  /**
   * Arbitrum RPC for Hyperliquid deposits. If unset, the deposit uses the
   * Arbitrum entry of `evmRpcUrls` (config `evmRpcUrls.arbitrum`), and only
   * then the public endpoint.
   */
  arbitrumRpcUrl?: string;
  /** RPC per EVM chain id, overriding the public defaults. */
  evmRpcUrls?: Record<number, string>;
  /** ETH (wei) the wallet keeps for gas after selling ETH; from the owner's config. Default 0.0005 ETH. */
  evmGasReserveWei?: bigint;
}

export const HL_AGENT_NAME = "fren";

/** Hyperliquid charges 1 USDC per withdrawal; anything at or under it would arrive as nothing. */
export const HL_WITHDRAW_FEE_USD = 1;

/** Arbitrum One and Arbitrum Sepolia chain ids, matching the daemon's `evmRpcsById`. */
const ARBITRUM_CHAIN_ID = { mainnet: 42161, testnet: 421614 } as const;

/** The RPC a Hyperliquid deposit goes through; `undefined` means the public default. */
export function hlDepositRpcUrl(options: SignerOptions, isTestnet: boolean): string | undefined {
  return options.arbitrumRpcUrl ?? options.evmRpcUrls?.[isTestnet ? ARBITRUM_CHAIN_ID.testnet : ARBITRUM_CHAIN_ID.mainnet];
}

export function createSigner(keys: KeyMaterial, options: SignerOptions = {}): SignerApi {
  const addresses = addressesOf(keys);
  const sol = Keypair.fromSecretKey(Buffer.from(keys.solanaSecret, "base64"));
  const master = privateKeyToAccount(keys.evmMaster);
  const agent = privateKeyToAccount(keys.hlAgent);
  const deriveSession = privateKeyToAccount(deriveSessionKeyOf(keys.evmMaster));
  const connection = options.solanaRpcUrl ? new Connection(options.solanaRpcUrl, "confirmed") : undefined;

  return {
    async addresses() {
      return addresses;
    },

    async hlSignL1(req) {
      checkHyperliquidAction(req.action);
      return signL1Action({
        wallet: agent,
        action: req.action,
        nonce: req.nonce,
        isTestnet: req.isTestnet,
        ...(req.expiresAfter !== undefined ? { expiresAfter: req.expiresAfter } : {}),
      });
    },

    async hlApproveAgent({ isTestnet }) {
      // The master key signs exactly one kind of thing: approving our own agent key.
      const nonce = Date.now();
      const action = {
        type: "approveAgent",
        signatureChainId: (isTestnet ? "0x66eee" : "0xa4b1") as `0x${string}`,
        hyperliquidChain: isTestnet ? "Testnet" : "Mainnet",
        agentAddress: agent.address.toLowerCase(),
        agentName: HL_AGENT_NAME,
        nonce,
      };
      const signature = await signUserSignedAction({ wallet: master, action, types: ApproveAgentTypes });
      return { action, signature, nonce };
    },

    async solSignTransaction(req) {
      const tx = VersionedTransaction.deserialize(Buffer.from(req.txBase64, "base64"));
      const lookupTables = connection ? await fetchLookupTables(connection, tx) : [];
      const report: SolSignResult["report"] = checkSolanaTransaction(tx, sol.publicKey, {
        ...(req.jitoTipLamports !== undefined ? { jitoTipLamports: req.jitoTipLamports } : {}),
        lookupTables,
      });

      if (connection) {
        report.simulatedSolDeltaLamports = await simulateAndCheck(connection, tx, sol.publicKey, report, lookupTables, req.maxSolSpendLamports);
      }

      tx.sign([sol]);
      return { signedTxBase64: Buffer.from(tx.serialize()).toString("base64"), report };
    },

    async hlDepositFromArbitrum({ amountUsd, isTestnet }) {
      return { txHash: await depositToHyperliquid(master, amountUsd, isTestnet, hlDepositRpcUrl(options, isTestnet)) };
    },

    async hlWithdrawToSelf({ amountUsd, isTestnet }) {
      if (!(Number.isFinite(amountUsd) && amountUsd > HL_WITHDRAW_FEE_USD)) {
        throw new SignerRuleError(`Hyperliquid withdrawals must be more than its ${HL_WITHDRAW_FEE_USD} USDC fee.`);
      }
      // The master key signs a withdrawal only to itself: the destination is not a parameter.
      const nonce = Date.now();
      const action = {
        type: "withdraw3",
        signatureChainId: (isTestnet ? "0x66eee" : "0xa4b1") as `0x${string}`,
        hyperliquidChain: isTestnet ? "Testnet" : "Mainnet",
        destination: master.address.toLowerCase(),
        amount: String(Math.floor(amountUsd * 1e6) / 1e6),
        time: nonce,
      };
      const signature = await signUserSignedAction({ wallet: master, action, types: Withdraw3Types });
      return { action, signature, nonce };
    },

    async evmSendTransaction(req) {
      return { txHash: await sendEvmTransaction(master, req, {
        ...(options.evmRpcUrls ? { rpcOverrides: options.evmRpcUrls } : {}),
        ...(options.evmGasReserveWei !== undefined ? { gasReserveWei: options.evmGasReserveWei } : {}),
      }) };
    },

    async deriveSignOrder(req) {
      return signDeriveOrder(master.address, deriveSession, req);
    },

    async deriveAuthHeaders() {
      return deriveAuthHeaders(master.address, deriveSession);
    },

    async deriveRegisterSessionKey({ isTestnet }) {
      return registerDeriveSessionKey(master, deriveSession, isTestnet);
    },

    async polySignTypedData(req) {
      return signPolymarketTypedData(master, req);
    },
  };
}
