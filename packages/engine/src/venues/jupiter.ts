import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { JITO_TIP_ACCOUNTS } from "@fren/signer";
import { price as fmtPrice, shortToken, usd as fmtUsd, type PlanStep, type ResolvedStep, type SwapLeg } from "@fren/core";
import type { SignerApi } from "@fren/signer";
import { getJson, HttpError, postJson, type Fetch } from "../http.js";
import type { Store } from "../store.js";
import { curveUsdPrice, pumpFunNotes, type PumpCurve, type PumpFunApi } from "./pumpfun.js";
import { NotTradableYet, VenueError, type ExecContext, type ExecResult, type PositionView, type SpotVenueAdapter } from "./types.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Tokens whose mint and decimals never change. They are never looked up: when
 * Jupiter rate-limits us, SOL must still be SOL with 9 decimals (a wrong guess
 * once booked $30 of SOL as 383 coins at $0.078).
 */
export const KNOWN_TOKENS: Record<string, { mint: string; symbol: string; name: string; decimals: number }> = {
  SOL: { mint: SOL_MINT, symbol: "SOL", name: "Wrapped SOL", decimals: 9 },
  USDC: { mint: USDC_MINT, symbol: "USDC", name: "USD Coin", decimals: 6 },
};

function knownToken(query: string): TokenInfo | null {
  const key = query.trim().replace(/^\$/, "");
  const k = Object.values(KNOWN_TOKENS).find((t) => t.mint === key || t.symbol === key.toUpperCase());
  return k ? { ...k, verified: true, usdPrice: null, liquidityUsd: null } : null;
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  usdPrice: number | null;
  liquidityUsd: number | null;
}

interface JupToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  isVerified?: boolean;
  tags?: string[];
  usdPrice?: number;
  liquidity?: number;
}

interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  [k: string]: unknown;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isMint(s: string): boolean {
  return BASE58.test(s);
}

export interface JupiterVenueOptions {
  fetchFn: Fetch;
  apiUrl: string;
  apiKey?: string;
  solanaRpcUrl: string;
  store: Store;
  signer: SignerApi | null;
  /** pump.fun coin info, for the "this coin is 4 minutes old" notes. Optional. */
  pumpFun?: PumpFunApi;
  /** Jito block engine for snipes. Defaults to Jito mainnet. */
  jitoUrl?: string;
  /** Jito tip for snipes, in lamports. */
  snipeTipLamports?: number;
  /** Pause before the first retry after a 429 (doubles for the second). Default 800 ms. */
  retryDelayMs?: number;
  /** USDC the wallet's EVM side holds per chain, so a buy can be paid from there. */
  evmUsdc?: () => Promise<Partial<Record<"arbitrum" | "base", number>>>;
  /** Moves USDC from the wallet's own Arbitrum or Base address to its own Solana address. Returns the owner's line. */
  bridgeIn?: (usd: number) => Promise<string>;
  /** How long to wait for bridged USDC to land on Solana. Default 90 s. */
  bridgeWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** SOL kept on the wallet when a buy is paid in SOL: fees, a new token account's rent. */
export const SOL_BUY_RESERVE_LAMPORTS = 20_000_000n;

export type SolanaPayment =
  | { kind: "usdc" }
  | { kind: "sol"; lamports: bigint }
  | { kind: "bridge"; usd: number }
  | { kind: "short"; message: string };

const roundUpCents = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

/**
 * How to pay for a Solana buy of `usd`: the wallet's USDC; else its SOL
 * (keeping a reserve for fees); else USDC brought over from Arbitrum or Base.
 * A snipe pays in SOL first when it can: it skips a swap, and launches trade
 * against SOL.
 */
export function solanaPayment(a: {
  usd: number;
  usdcRaw: bigint;
  lamports: bigint;
  solPx: number | null;
  tipLamports: number;
  evmUsdc: Partial<Record<"arbitrum" | "base", number>>;
  canBridge: boolean;
  preferSol: boolean;
}): SolanaPayment {
  const needRaw = BigInt(Math.floor(a.usd * 1e6));
  const hasUsdc = a.usdcRaw >= needRaw;
  const spare = a.lamports - SOL_BUY_RESERVE_LAMPORTS - BigInt(a.tipLamports);
  const solNeed = a.solPx ? BigInt(Math.ceil((a.usd / a.solPx) * 1e9)) : null;
  const hasSol = solNeed !== null && spare >= solNeed;
  if (hasUsdc && !(a.preferSol && hasSol)) return { kind: "usdc" };
  if (hasSol) return { kind: "sol", lamports: solNeed! };
  const usdc = Number(a.usdcRaw) / 1e6;
  // Relay keeps a small fee, so bring a little more than the gap.
  const gap = a.usd - usdc;
  const bridge = roundUpCents(gap + Math.max(0.3, gap * 0.01));
  const evmBest = Math.max(a.evmUsdc.arbitrum ?? 0, a.evmUsdc.base ?? 0);
  if (a.canBridge && evmBest >= bridge) return { kind: "bridge", usd: bridge };
  const solUsd = a.solPx && spare > 0n ? (Number(spare) / 1e9) * a.solPx : 0;
  const parts = [`${fmtUsd(usdc)} USDC and about ${fmtUsd(solUsd)} of spare SOL on Solana`];
  for (const c of ["arbitrum", "base"] as const) if (a.evmUsdc[c] !== undefined) parts.push(`${fmtUsd(a.evmUsdc[c]!)} USDC on ${c === "arbitrum" ? "Arbitrum" : "Base"}`);
  return { kind: "short", message: `This buy needs ${fmtUsd(a.usd)}, and no wallet has enough: ${parts.join(", ")}.` };
}

/** Default Jito tip on a snipe: 0.001 SOL. The signer refuses anything over its own cap. */
export const DEFAULT_SNIPE_TIP_LAMPORTS = 1_000_000;

export class JupiterVenue implements SpotVenueAdapter {
  readonly venue = "jupiter" as const;
  private connection: Connection;
  private tokenCache = new Map<string, TokenInfo>();

  constructor(private readonly o: JupiterVenueOptions) {
    this.connection = new Connection(o.solanaRpcUrl, { commitment: "confirmed", fetch: o.fetchFn });
  }

  /** GET with two retries after a 429; any other failure, or a third 429, is thrown as it is. */
  private async get<T>(url: string): Promise<T> {
    const delay = this.o.retryDelayMs ?? 800;
    for (let attempt = 0; ; attempt++) {
      try {
        return await getJson<T>(this.o.fetchFn, url, this.headers());
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 429 || attempt >= 2) throw err;
        await new Promise((r) => setTimeout(r, delay * 2 ** attempt));
      }
    }
  }

  private headers(): Record<string, string> {
    return this.o.apiKey ? { "x-api-key": this.o.apiKey } : {};
  }

  private toInfo(t: JupToken): TokenInfo {
    return {
      mint: t.id,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      verified: Boolean(t.isVerified) || Boolean(t.tags?.includes("verified")),
      usdPrice: t.usdPrice ?? null,
      liquidityUsd: t.liquidity ?? null,
    };
  }

  async searchTokens(query: string): Promise<TokenInfo[]> {
    const list = await this.get<JupToken[]>(`${this.o.apiUrl}/tokens/v2/search?query=${encodeURIComponent(query)}`);
    return list.map((t) => this.toInfo(t));
  }

  /**
   * A contract address resolves to that token, verified or not. A bare symbol
   * only resolves to a verified token: dozens of tokens share every popular
   * ticker, and buying the wrong one is the classic way to lose money.
   */
  async token(query: string): Promise<TokenInfo> {
    const key = query.trim();
    const known = knownToken(key);
    if (known) return known;
    const cached = this.tokenCache.get(key.toUpperCase());
    if (cached) return cached;
    const results = await this.searchTokens(key);
    let found: TokenInfo | undefined;
    if (isMint(key)) {
      found = results.find((t) => t.mint === key);
      if (!found) throw new VenueError(`Jupiter doesn't know the token ${key}. It may not be tradable yet.`);
    } else {
      const sym = key.replace(/^\$/, "").toUpperCase();
      const matches = results.filter((t) => t.symbol.toUpperCase() === sym);
      found = matches.filter((t) => t.verified).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
      if (!found) {
        throw new VenueError(
          matches.length
            ? `${matches.length} unverified tokens use the ticker ${sym}. Send me the contract address.`
            : `No Solana token found for ${sym}. Send me the contract address.`,
        );
      }
    }
    this.tokenCache.set(key.toUpperCase(), found);
    // The engine later asks again by the contract address.
    this.tokenCache.set(found.mint.toUpperCase(), found);
    return found;
  }

  /**
   * For a launch snipe the token may trade before Jupiter's token list knows
   * it. A mint the owner gave us is enough; decimals come from the chain.
   */
  /** Decimals of a mint, read from the chain. Null when the mint doesn't exist yet or the RPC doesn't answer. */
  private async chainDecimals(mint: string): Promise<number | null> {
    const info = await Promise.resolve()
      .then(() => this.connection.getParsedAccountInfo(new PublicKey(mint)))
      .catch(() => null);
    const parsed = (info?.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed;
    return typeof parsed?.info?.decimals === "number" ? parsed.info.decimals : null;
  }

  /** True only when the RPC answered and there is no account at this address. */
  private async mintMissing(mint: string): Promise<boolean> {
    const info = await Promise.resolve()
      .then(() => this.connection.getAccountInfo(new PublicKey(mint)))
      .then((v) => ({ v }), () => null);
    return info !== null && info.v === null;
  }

  /**
   * A token Jupiter's list doesn't know (a launch snipe, or a lookup that
   * failed). Decimals come from the chain; pump.fun coins (mint ends in "pump")
   * may use their fixed 6 before they exist. Anything else we can't confirm is
   * refused: guessing decimals once made a price 1000x wrong.
   */
  private async bareToken(mint: string): Promise<TokenInfo> {
    let decimals = await this.chainDecimals(mint);
    if (decimals === null && mint.endsWith("pump")) decimals = 6;
    if (decimals === null) {
      if (await this.mintMissing(mint)) {
        throw new VenueError(
          `${shortToken(mint)} doesn't exist on Solana yet, so I can't tell how its amounts work and won't guess. I can snipe pump.fun addresses (ending in "pump") before launch; for this one, send it again once the token is created.`,
        );
      }
      throw new VenueError(`I couldn't confirm the price data for ${shortToken(mint)} right now (Jupiter and the Solana RPC didn't answer), so I won't trade it. Try again in a minute.`);
    }
    return { mint, symbol: shortToken(mint), name: "", decimals, verified: false, usdPrice: null, liquidityUsd: null };
  }

  private async tokenOrBare(query: string): Promise<TokenInfo> {
    try {
      return await this.token(query);
    } catch (err) {
      const mint = query.trim();
      if (!isMint(mint)) throw err;
      // "Jupiter doesn't know this token" may be a young coin; a rate limit or outage is not an answer.
      if (err instanceof HttpError && !(err.status === 404)) {
        const viaChain = await this.bareToken(mint).catch(() => null);
        if (viaChain) return viaChain;
        throw new VenueError(`Jupiter isn't answering right now (${err.status}), so I can't price ${shortToken(mint)}. Nothing was bought. Try again in a minute.`);
      }
      return this.bareToken(mint);
    }
  }

  private async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<JupQuote> {
    return this.get<JupQuote>(
      `${this.o.apiUrl}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`,
    );
  }

  /** True once Jupiter can route USDC into the token: it has launched and has a pool or bonding curve. */
  async isTradable(token: string): Promise<boolean> {
    const mint = token.trim();
    // A pump.fun coin trades the moment its curve exists, before any aggregator sees it.
    // One RPC read answers that faster than a Jupiter quote, so launches check it first.
    const onCurve = async () => {
      const curve = this.o.pumpFun ? await this.o.pumpFun.curve(mint).catch(() => null) : null;
      return curve !== null && !curve.complete && curve.quote !== "other";
    };
    if (mint.endsWith("pump") && (await onCurve())) return true;
    try {
      const q = await this.quote(USDC_MINT, mint, 1_000_000n, 5000);
      return BigInt(q.outAmount) > 0n;
    } catch {
      return mint.endsWith("pump") ? false : onCurve();
    }
  }

  private async solUsd(): Promise<number | null> {
    return (await this.prices([SOL_MINT]).catch(() => new Map<string, number>())).get(SOL_MINT) ?? null;
  }

  private async pumpNotes(mint: string): Promise<string[]> {
    if (!this.o.pumpFun) return [];
    return pumpFunNotes(this.o.pumpFun, mint, await this.solUsd()).catch(() => []);
  }

  /** USD price from a small quote, for tokens too new for the price API. */
  private async quotedPrice(t: TokenInfo): Promise<number | null> {
    try {
      const q = await this.quote(USDC_MINT, t.mint, 10_000_000n, 5000);
      const out = Number(q.outAmount) / 10 ** t.decimals;
      return out > 0 ? 10 / out : null;
    } catch {
      const curve = this.o.pumpFun ? await this.o.pumpFun.curve(t.mint).catch(() => null) : null;
      return curve && !curve.complete ? curveUsdPrice(curve, await this.solUsd()) : null;
    }
  }

  async prices(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (mints.length === 0) return out;
    const res = await this.get<Record<string, { usdPrice: number } | null>>(`${this.o.apiUrl}/price/v3?ids=${mints.join(",")}`);
    for (const [mint, v] of Object.entries(res)) if (v) out.set(mint, v.usdPrice);
    return out;
  }

  async resolve(step: PlanStep, index: number): Promise<ResolvedStep> {
    const leg = step.leg;
    if (leg.kind !== "swap") throw new VenueError(`Jupiter cannot run a ${leg.kind} leg.`);
    const snipe = step.when.some((c) => c.type === "tradable");
    let t: TokenInfo;
    try {
      t = await this.token(leg.token);
    } catch (err) {
      // A snipe targets a coin that doesn't exist yet, and a buy may come seconds after
      // launch, before Jupiter's list has it: the address is all there is.
      if (!isMint(leg.token.trim()) || (!snipe && leg.side !== "buy")) throw err;
      t = await this.bareToken(leg.token.trim());
    }
    if (t.mint === USDC_MINT) throw new VenueError("That's USDC already; pick the token to buy or sell.");
    const canonical = {
      ...step,
      leg: { ...leg, token: t.mint },
      when: step.when.map((c) => (c.type === "tradable" && c.token.trim() === leg.token.trim() ? { ...c, token: t.mint } : c)),
    } as PlanStep;
    const notes = leg.side === "buy" && this.o.pumpFun ? await this.pumpNotes(t.mint) : [];
    const spend = leg.side === "buy" && leg.amount.type === "usd" ? leg.amount.usd : 0;
    return {
      index,
      step: canonical,
      symbol: t.symbol,
      spendUsd: spend,
      notionalUsd: spend,
      ...(leg.side === "sell" ? await this.saleValue(leg, t) : {}),
      verifiedToken: t.verified,
      ...(notes.length ? { notes } : {}),
    };
  }

  /**
   * What a sale is worth in dollars, so the owner's auto-approve level can
   * decide it. Unknown (no price, no balance) leaves it out, and the sale asks.
   */
  private async saleValue(leg: SwapLeg, t: TokenInfo): Promise<{ sellUsd?: number }> {
    if (leg.amount.type === "usd") return { sellUsd: leg.amount.usd };
    try {
      const px = (await this.prices([t.mint])).get(t.mint) ?? t.usdPrice ?? null;
      if (!px) return {};
      if (leg.amount.type === "tokens") return { sellUsd: leg.amount.tokens * px };
      let held: number;
      if (this.o.store.getLimits().mode === "paper") {
        held = this.o.store.paperHolding(t.mint)?.amount ?? 0;
      } else {
        const owner = await this.owner();
        const raw = t.mint === SOL_MINT ? BigInt(await this.connection.getBalance(owner)) : await this.rawBalance(owner, t.mint);
        held = Number(raw) / 10 ** t.decimals;
      }
      return { sellUsd: held * leg.amount.fraction * px };
    } catch {
      return {};
    }
  }

  async execute(r: ResolvedStep, ctx: ExecContext): Promise<ExecResult> {
    const leg = r.step.leg;
    if (leg.kind !== "swap") throw new VenueError(`Jupiter cannot run a ${leg.kind} leg.`);
    const t = await this.tokenOrBare(leg.token);
    return ctx.mode === "paper" ? this.paperSwap(leg, t, ctx) : this.liveSwap(leg, t, ctx);
  }

  // -- paper -----------------------------------------------------------------

  private async paperSwap(leg: SwapLeg, t: TokenInfo, ctx: ExecContext): Promise<ExecResult> {
    const store = this.o.store;
    const px = (await this.prices([t.mint]).catch(() => new Map<string, number>())).get(t.mint) ?? t.usdPrice ?? (await this.quotedPrice(t));
    if (!px) throw leg.side === "buy" ? new NotTradableYet(`${t.symbol} has no pool or pump.fun curve to buy from yet.`) : new VenueError(`No price for ${t.symbol} right now.`);
    const held = store.paperHolding(t.mint) ?? { mint: t.mint, symbol: t.symbol, amount: 0, costUsd: 0 };
    if (leg.side === "buy") {
      if (leg.amount.type === "tokens") throw new VenueError('Say how much USDC to spend on a buy: amount {type:"usd"}.');
      const usd = leg.amount.type === "usd" ? leg.amount.usd : store.paperUsdc() * leg.amount.fraction;
      if (usd > store.paperUsdc()) throw new VenueError(`Practice balance is ${fmtUsd(store.paperUsdc())}.`);
      const qty = usd / px;
      store.setPaperUsdc(store.paperUsdc() - usd);
      store.setPaperHolding({ ...held, amount: held.amount + qty, costUsd: held.costUsd + usd });
      store.insertFill({ planId: ctx.planId, idx: ctx.idx, venue: "jupiter", symbol: t.symbol, action: "buy", size: qty, price: px, usd, spendUsd: usd, mode: "paper" });
      return { text: `📝 Practice: Bought ${fmtQty(qty)} ${t.symbol} for ${fmtUsd(usd)} at ${fmtPrice(px)}` };
    }
    if (leg.amount.type === "tokens" && leg.amount.tokens > held.amount + 1e-12) {
      throw new VenueError(`You hold ${fmtQty(held.amount)} paper ${t.symbol}, not ${leg.amount.tokens}.`);
    }
    const qty =
      leg.amount.type === "fraction" ? held.amount * leg.amount.fraction : leg.amount.type === "tokens" ? leg.amount.tokens : Math.min(held.amount, leg.amount.usd / px);
    if (qty <= 0) throw new VenueError(`You hold no paper ${t.symbol}.`);
    const usd = qty * px;
    store.setPaperUsdc(store.paperUsdc() + usd);
    store.setPaperHolding({ ...held, amount: held.amount - qty, costUsd: held.costUsd * (1 - qty / held.amount) });
    store.insertFill({ planId: ctx.planId, idx: ctx.idx, venue: "jupiter", symbol: t.symbol, action: "sell", size: qty, price: px, usd, spendUsd: 0, mode: "paper" });
    return { text: `📝 Practice: Sold ${fmtQty(qty)} ${t.symbol} for ${fmtUsd(usd)} at ${fmtPrice(px)}` };
  }

  // -- live ------------------------------------------------------------------

  private signer(): SignerApi {
    if (!this.o.signer) throw new VenueError("Live trading needs wallets. Run `fren init` first.");
    return this.o.signer;
  }

  private async owner(): Promise<PublicKey> {
    return new PublicKey((await this.signer().addresses()).solana);
  }

  async ownerAddress(): Promise<string> {
    return (await this.owner()).toBase58();
  }

  /**
   * Sign (the signer checks the programs and simulates SOL loss), send and
   * confirm a transaction an API built for this wallet. Returns the signature.
   */
  async sendApiTransaction(txBase64: string, maxSolSpendLamports: number): Promise<string> {
    const lastValidBlockHeight = (await this.connection.getBlockHeight("confirmed")) + 150;
    return this.signAndSend(txBase64, maxSolSpendLamports, 0, lastValidBlockHeight);
  }

  /**
   * Make sure the wallet has its associated token account for an SPL mint
   * (plain Token program), creating it if not. Some protocols' transactions
   * (Jupiter Lend's first deposit) assume the account exists and fail with
   * AccountNotInitialized (3012) otherwise. Costs ~0.002 SOL of rent, once.
   */
  async ensureTokenAccount(mint: string): Promise<void> {
    const owner = await this.owner();
    const m = new PublicKey(mint);
    const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const [ata] = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), m.toBuffer()], ATA_PROGRAM);
    if (await this.connection.getAccountInfo(ata)) return;
    const ix: TransactionInstruction = {
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: m, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      // CreateIdempotent: succeeds if someone created it in the meantime.
      data: Buffer.from([1]),
    };
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
    const txBase64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
    await this.sendApiTransaction(txBase64, 5_000_000);
  }

  /** Raw (integer) balance of an SPL token in the wallet, summed across accounts. */
  async rawBalance(owner: PublicKey, mint: string): Promise<bigint> {
    const res = await this.connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    return res.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount as string), 0n);
  }

  private async liveSwap(leg: SwapLeg, t: TokenInfo, ctx: ExecContext): Promise<ExecResult> {
    const owner = await this.owner();
    const tip = ctx.snipe ? (this.o.snipeTipLamports ?? DEFAULT_SNIPE_TIP_LAMPORTS) : 0;
    let inputMint: string;
    let outputMint: string;
    let amount: bigint;
    /** What paying for the buy took, for the owner, and SOL's price when it was paid in SOL. */
    let paid: string[] = [];
    let solPx = 0;
    if (leg.side === "buy") {
      inputMint = USDC_MINT;
      outputMint = t.mint;
      if (leg.amount.type === "tokens") throw new VenueError('Say how much USDC to spend on a buy: amount {type:"usd"}.');
      const usdcRaw = await this.rawBalance(owner, USDC_MINT);
      if (leg.amount.type === "usd") {
        amount = BigInt(Math.floor(leg.amount.usd * 1e6));
        if (amount > usdcRaw || ctx.snipe) {
          const pay = await this.payFor(owner, leg.amount.usd, usdcRaw, tip, Boolean(ctx.snipe), t.mint !== SOL_MINT);
          paid = pay.lines;
          if (pay.solPx) {
            inputMint = SOL_MINT;
            amount = pay.raw;
            solPx = pay.solPx;
          } else {
            amount = pay.raw;
          }
        }
      } else {
        amount = (usdcRaw * BigInt(Math.floor(leg.amount.fraction * 1e6))) / 1_000_000n;
      }
    } else {
      inputMint = t.mint;
      outputMint = USDC_MINT;
      const raw = t.mint === SOL_MINT ? BigInt(await this.connection.getBalance(owner)) - 10_000_000n : await this.rawBalance(owner, t.mint);
      if (raw <= 0n) throw new VenueError(`You hold no ${t.symbol}.`);
      if (leg.amount.type === "fraction") {
        amount = (raw * BigInt(Math.floor(leg.amount.fraction * 1e6))) / 1_000_000n;
      } else if (leg.amount.type === "tokens") {
        amount = toRaw(leg.amount.tokens, t.decimals);
        if (amount > raw) {
          const have = Number(raw) / 10 ** t.decimals;
          throw new VenueError(
            `You can sell up to ${fmtQty(have)} ${t.symbol}${t.mint === SOL_MINT ? " (Fren keeps 0.01 SOL for fees)" : ""}, not ${leg.amount.tokens}.`,
          );
        }
      } else {
        const px = (await this.prices([t.mint])).get(t.mint) ?? (await this.quotedPrice(t));
        if (!px) throw new VenueError(`No price for ${t.symbol} right now.`);
        const want = BigInt(Math.floor((leg.amount.usd / px) * 10 ** t.decimals));
        amount = want < raw ? want : raw;
      }
    }

    const paidSolPx = inputMint === SOL_MINT && leg.side === "buy" ? solPx : 0;
    // A launch snipe on a pump.fun coin buys on its curve straight away: no Jupiter round trip first.
    if (ctx.snipe && leg.side === "buy" && t.mint.endsWith("pump") && this.o.pumpFun) {
      const curve = await this.o.pumpFun.curve(t.mint).catch(() => null);
      if (curve && !curve.complete && curve.quote !== "other") return this.withPaid(paid, await this.curveSwap(leg, t, curve, owner, amount, tip, ctx, paidSolPx));
    }
    let quote: JupQuote;
    try {
      quote = await this.quote(inputMint, outputMint, amount, leg.maxSlippageBps);
    } catch (err) {
      // Young pump.fun coins trade only on their bonding curve, which Jupiter may not route yet.
      const curve = this.o.pumpFun ? await this.o.pumpFun.curve(t.mint).catch(() => null) : null;
      if (!curve || curve.complete) {
        // No route (400) on a buy: not launched yet, or pump.fun is moving it from the curve to its pool.
        if (leg.side === "buy" && err instanceof HttpError && err.status === 400) {
          throw new NotTradableYet(
            curve?.complete
              ? `${t.symbol} just finished its pump.fun curve and is moving to its pool, so it can't be traded for a moment.`
              : `${t.symbol} has no pool or pump.fun curve to buy from yet.`,
          );
        }
        throw err;
      }
      return this.withPaid(paid, await this.curveSwap(leg, t, curve, owner, amount, tip, ctx, paidSolPx));
    }
    const signature = await this.jupiterSwap(owner, quote, inputMint, amount, tip);

    const decimals = (mint: string) => (mint === USDC_MINT ? 6 : mint === SOL_MINT ? 9 : t.decimals);
    const inUi = Number(quote.inAmount) / 10 ** decimals(inputMint);
    const outUi = Number(quote.outAmount) / 10 ** decimals(outputMint);
    const usd = leg.side === "buy" ? (inputMint === SOL_MINT ? inUi * solPx : inUi) : outUi;
    const qty = leg.side === "buy" ? outUi : inUi;
    return this.withPaid(paid, this.recordLive(leg, t, ctx, qty, usd, signature, ""));
  }

  private withPaid(paid: string[], res: ExecResult): ExecResult {
    return paid.length ? { ...res, text: [...paid, res.text].join("\n") } : res;
  }

  /**
   * Pay for a buy the USDC alone can't cover (or a snipe): in SOL, or with
   * USDC brought over from the wallet's EVM side. Returns what to swap from.
   */
  private async payFor(owner: PublicKey, usd: number, usdcRaw: bigint, tip: number, preferSol: boolean, solAllowed: boolean): Promise<{ raw: bigint; solPx?: number; lines: string[] }> {
    const [lamports, px] = await Promise.all([
      // Buying SOL itself can't be paid in SOL.
      solAllowed ? this.connection.getBalance(owner).then(BigInt) : Promise.resolve(0n),
      this.prices([SOL_MINT]).then((m) => m.get(SOL_MINT) ?? null).catch(() => null),
    ]);
    const args = { usd, usdcRaw, lamports, solPx: px, tipLamports: tip, evmUsdc: {}, canBridge: Boolean(this.o.bridgeIn), preferSol };
    let pay = solanaPayment(args);
    // The EVM side is only asked when Solana alone can't pay: a snipe shouldn't wait on it.
    if (pay.kind === "short" && this.o.evmUsdc) pay = solanaPayment({ ...args, evmUsdc: await this.o.evmUsdc().catch(() => ({})) });
    const needRaw = BigInt(Math.floor(usd * 1e6));
    if (pay.kind === "usdc") return { raw: needRaw, lines: [] };
    if (pay.kind === "sol") {
      const why = usdcRaw >= needRaw ? "" : `, since your Solana wallet had ${fmtUsd(Number(usdcRaw) / 1e6)} USDC`;
      return { raw: pay.lamports, solPx: px!, lines: [`↪ Paid with ${fmtQty(Number(pay.lamports) / 1e9)} SOL${why}.`] };
    }
    if (pay.kind === "short") throw new VenueError(pay.message);
    const line = await this.o.bridgeIn!(pay.usd);
    // Relay reports the fill when it pays out; give the RPC a moment to see it.
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = Date.now() + (this.o.bridgeWaitMs ?? 90_000);
    let have = usdcRaw;
    while ((have = await this.rawBalance(owner, USDC_MINT).catch(() => have)) < needRaw) {
      if (Date.now() > deadline) {
        // A cent or two of fees short still buys, with what arrived.
        if (have * 100n >= needRaw * 98n && have > usdcRaw) return { raw: have, lines: [line] };
        throw new VenueError(`${line}\nIt hasn't reached your Solana wallet yet, so nothing was bought. Ask again in a minute.`);
      }
      await sleep(3_000);
    }
    return { raw: needRaw, lines: [line] };
  }

  private recordLive(leg: SwapLeg, t: TokenInfo, ctx: ExecContext, qty: number, usd: number, signature: string, suffix: string): ExecResult {
    this.o.store.insertFill({
      planId: ctx.planId,
      idx: ctx.idx,
      venue: "jupiter",
      symbol: t.symbol,
      action: leg.side,
      size: qty,
      price: usd / qty,
      usd,
      spendUsd: leg.side === "buy" ? usd : 0,
      mode: "live",
      ref: signature,
    });
    const verb = leg.side === "buy" ? "Bought" : "Sold";
    return { text: `✅ ${verb} ${fmtQty(qty)} ${t.symbol} for ${fmtUsd(usd)} at ${fmtPrice(usd / qty)}${suffix} · https://solscan.io/tx/${signature}` };
  }

  /** Build, sign, send and confirm one Jupiter swap. Returns the signature. */
  private async jupiterSwap(owner: PublicKey, quote: JupQuote, inputMint: string, amount: bigint, tip: number): Promise<string> {
    const swap = await postJson<{ swapTransaction: string; lastValidBlockHeight: number }>(
      this.o.fetchFn,
      `${this.o.apiUrl}/swap/v1/swap`,
      {
        quoteResponse: quote,
        userPublicKey: owner.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: tip
          ? { jitoTipLamports: tip }
          : { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } },
      },
      this.headers(),
    );
    // Selling SOL itself loses `amount` lamports; everything else should cost only fees, rent and the snipe tip.
    const maxSol = 10_000_000 + tip + (inputMint === SOL_MINT ? Number(amount) : 0);
    return this.signAndSend(swap.swapTransaction, maxSol, tip, swap.lastValidBlockHeight);
  }

  private async signAndSend(txBase64: string, maxSolSpendLamports: number, tip: number, lastValidBlockHeight: number): Promise<string> {
    const { signedTxBase64 } = await this.signer().solSignTransaction({
      txBase64,
      maxSolSpendLamports,
      ...(tip ? { jitoTipLamports: tip } : {}),
    });
    const raw = Buffer.from(signedTxBase64, "base64");
    if (tip) await this.sendToJito(signedTxBase64).catch(() => undefined);
    const signature = await this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    const blockhash = VersionedTransaction.deserialize(raw).message.recentBlockhash;
    const conf = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (conf.value.err) throw new VenueError(`Transaction failed on-chain: ${JSON.stringify(conf.value.err)} (tx ${signature})`);
    return signature;
  }

  /**
   * Trade a coin on its pump.fun bonding curve. SOL-priced curves need SOL, so
   * a buy first swaps the USDC to SOL, and a sell swaps the SOL back to USDC.
   */
  /** `paidSolPx` set: a buy's `amount` is lamports of SOL at that price; otherwise USDC. */
  private async curveSwap(leg: SwapLeg, t: TokenInfo, curve: PumpCurve, owner: PublicKey, amount: bigint, tip: number, ctx: ExecContext, paidSolPx = 0): Promise<ExecResult> {
    const pump = this.o.pumpFun!;
    if (curve.quote === "other") throw new VenueError(`${t.symbol}'s curve is priced in another coin, which Fren can't trade yet.`);
    const slippagePct = leg.maxSlippageBps / 100;
    const user = owner.toBase58();

    if (leg.side === "buy") {
      const paidMint = paidSolPx ? SOL_MINT : USDC_MINT;
      const curveMint = curve.quote === "SOL" ? SOL_MINT : USDC_MINT;
      let quoteRaw = amount;
      if (paidMint !== curveMint) {
        const q = await this.quote(paidMint, curveMint, amount, 100);
        await this.jupiterSwap(owner, q, paidMint, amount, 0);
        quoteRaw = BigInt((q as { otherAmountThreshold?: string }).otherAmountThreshold ?? q.outAmount);
      }
      const before = await this.rawBalance(owner, t.mint);
      const trade = await pump.buy({ mint: t.mint, user, quoteAmountRaw: quoteRaw, slippagePct });
      const maxSol = 10_000_000 + tip + (curve.quote === "SOL" ? Number(quoteRaw) : 0);
      let signature: string;
      try {
        signature = await this.sendInstructions(owner, trade.instructions, maxSol, tip);
      } catch (err) {
        // The curve filled up while we were buying: the coin is moving to its pool. Try again there.
        const now = await pump.curve(t.mint).catch(() => null);
        if (now?.complete) throw new NotTradableYet(`${t.symbol} finished its pump.fun curve while buying and is moving to its pool.`);
        throw err;
      }
      const got = (await this.rawBalance(owner, t.mint).catch(() => before + trade.expectedOutRaw)) - before;
      const qty = Number(got > 0n ? got : trade.expectedOutRaw) / 10 ** t.decimals;
      const usd = paidSolPx ? (Number(amount) / 1e9) * paidSolPx : Number(amount) / 1e6;
      return this.recordLive(leg, t, ctx, qty, usd, signature, " on the pump.fun curve");
    }

    const solBefore = BigInt(await this.connection.getBalance(owner));
    const usdcBefore = await this.rawBalance(owner, USDC_MINT);
    const trade = await pump.sell({ mint: t.mint, user, tokenAmountRaw: amount, slippagePct });
    const signature = await this.sendInstructions(owner, trade.instructions, 10_000_000 + tip, tip);
    const qty = Number(amount) / 10 ** t.decimals;
    let usd: number;
    let suffix = " on the pump.fun curve";
    if (curve.quote === "SOL") {
      const gained = BigInt(await this.connection.getBalance(owner)) - solBefore;
      const lamports = gained > 0n ? gained : trade.expectedOutRaw;
      try {
        const q = await this.quote(SOL_MINT, USDC_MINT, lamports, 100);
        await this.jupiterSwap(owner, q, SOL_MINT, lamports, 0);
        usd = Number(q.outAmount) / 1e6;
      } catch {
        const solPx = (await this.prices([SOL_MINT]).catch(() => new Map<string, number>())).get(SOL_MINT) ?? 0;
        usd = (Number(lamports) / 1e9) * solPx;
        suffix += ", kept the proceeds as SOL (swapping to USDC failed)";
      }
    } else {
      usd = Number((await this.rawBalance(owner, USDC_MINT)) - usdcBefore) / 1e6;
    }
    return this.recordLive(leg, t, ctx, qty, usd, signature, suffix);
  }

  private async sendInstructions(owner: PublicKey, instructions: TransactionInstruction[], maxSol: number, tip: number): Promise<string> {
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: tip ? 2_000_000 : 500_000 }), ...instructions];
    if (tip) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(randomTipAccount()), lamports: tip }));
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const tx = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
    return this.signAndSend(tx, maxSol, tip, lastValidBlockHeight);
  }

  /**
   * Send instructions that need one more signer than the wallet (a fresh
   * account the instruction creates). The extra keys sign first; the signer
   * checks and adds the wallet's signature. Returns the signature.
   */
  async sendWithSigners(instructions: TransactionInstruction[], extra: Keypair[], maxSolSpendLamports: number): Promise<string> {
    const owner = await this.owner();
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }), ...instructions];
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign(extra);
    return this.signAndSend(Buffer.from(tx.serialize()).toString("base64"), maxSolSpendLamports, 0, lastValidBlockHeight);
  }

  /** The wallet's Solana address. */
  async walletKey(): Promise<PublicKey> {
    return this.owner();
  }

  /** Jito's block engine lands tipped transactions faster than plain RPC. We send to both. */
  private async sendToJito(txBase64: string): Promise<void> {
    await postJson(this.o.fetchFn, `${this.o.jitoUrl ?? "https://mainnet.block-engine.jito.wtf"}/api/v1/transactions`, {
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [txBase64, { encoding: "base64" }],
    });
  }

  async positions(mode: "paper" | "live"): Promise<PositionView[]> {
    if (mode === "paper") {
      // Other venues keep paper holdings under prefixed keys ("evm:base:0x…"); Solana mints never contain a colon.
      const holdings = this.o.store.paperHoldings().filter((h) => !h.mint.includes(":"));
      const px = await this.prices(holdings.map((h) => h.mint)).catch(() => new Map<string, number>());
      return holdings.map((h) => {
        const mark = px.get(h.mint) ?? null;
        const value = mark === null ? h.costUsd : h.amount * mark;
        return { venue: "jupiter", symbol: h.symbol, kind: "spot", side: "hold", size: h.amount, entryPx: h.costUsd / h.amount, markPx: mark, valueUsd: value, pnlUsd: mark === null ? null : value - h.costUsd };
      });
    }
    if (!this.o.signer) return [];
    const owner = await this.owner();
    const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
    const held = accounts.value
      .map((a) => a.account.data.parsed.info as { mint: string; tokenAmount: { uiAmount: number } })
      .filter((i) => i.tokenAmount.uiAmount > 0 && i.mint !== USDC_MINT);
    const sol = (await this.connection.getBalance(owner)) / 1e9;
    const mints = [SOL_MINT, ...held.map((h) => h.mint)];
    const px = await this.prices(mints).catch(() => new Map<string, number>());
    const views: PositionView[] = [];
    if (sol > 0) views.push({ venue: "jupiter", symbol: "SOL", kind: "spot", side: "hold", size: sol, entryPx: null, markPx: px.get(SOL_MINT) ?? null, valueUsd: sol * (px.get(SOL_MINT) ?? 0), pnlUsd: null });
    for (const h of held) {
      const mark = px.get(h.mint) ?? null;
      views.push({ venue: "jupiter", symbol: h.mint, kind: "spot", side: "hold", size: h.tokenAmount.uiAmount, entryPx: null, markPx: mark, valueUsd: h.tokenAmount.uiAmount * (mark ?? 0), pnlUsd: null });
    }
    return views;
  }

  /** Native SOL, in SOL. */
  async solBalance(): Promise<number | null> {
    if (!this.o.signer) return null;
    return (await this.connection.getBalance(await this.owner())) / 1e9;
  }

  async usdcBalance(): Promise<number | null> {
    if (!this.o.signer) return null;
    return Number(await this.rawBalance(await this.owner(), USDC_MINT)) / 1e6;
  }

  /** Spot holdings are left alone by the kill switch; it only closes leveraged positions. */
  async flatten(): Promise<string[]> {
    return [];
  }
}

function randomTipAccount(): string {
  const all = [...JITO_TIP_ACCOUNTS];
  return all[Math.floor(Math.random() * all.length)]!;
}

function fmtQty(q: number): string {
  if (q >= 1000) return q.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (q >= 1) return q.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return q.toPrecision(4);
}

/** Whole tokens to base units, without float drift on the decimals. */
export function toRaw(tokens: number, decimals: number): bigint {
  const [whole, frac = ""] = tokens.toFixed(Math.min(decimals, 20)).split(".");
  return BigInt(whole! + frac.padEnd(decimals, "0").slice(0, decimals));
}
