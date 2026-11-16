import { PublicKey } from "@solana/web3.js";
import { SignerRuleError } from "./errors.js";

/**
 * Instruction-level allow-list for the Solana programs that can move the
 * wallet's tokens: the Jupiter v6 router, Jupiter Lend (Earn) and Kamino Lend.
 * A program being on the allow list is not enough; each instruction is
 * matched by its Anchor discriminator, and the accounts that decide where
 * money goes are pinned to the wallet's own accounts.
 *
 * Layouts were read off real transactions from Jupiter's swap API, Jupiter
 * Lend's /earn API and Kamino's /ktx API (2026-11-16), and the klend IDL
 * (Kamino-Finance/klend-sdk). See projects/fren/security/H1.md in Pantheon.
 */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";

/** Kamino's main market and its USDC reserve, the only place Fren lends through Kamino. */
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const KAMINO_USDC_RESERVE = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/** What one checked instruction lets the wallet's token accounts do, for the simulation check. */
export interface IxEffects {
  /** Wallet token accounts this instruction may draw down, with the most it may take (raw units), or null for "no fixed bound". */
  spends: Array<{ account: string; maxRaw: bigint | null }>;
  /** Wallet token accounts that must end the transaction with more than they started (swap outputs). */
  mustIncrease: string[];
}

const disc = (hex: string) => hex;

export const JUPITER_IX = {
  route: disc("e517cb977ae3ad2a"),
  sharedAccountsRoute: disc("c1209b3341d69c81"),
} as const;

export const JUPITER_LEND_IX = {
  deposit: disc("f223c68952e1f2b6"),
  withdraw: disc("b712469c946da122"),
  redeem: disc("b80c569546c461e1"),
} as const;

export const KLEND_IX = {
  initUserMetadata: disc("75a9b045c5170fa2"),
  initObligation: disc("fb0ae74c1b0b9f60"),
  initObligationFarmsForReserve: disc("883f0fbad398a8a4"),
  refreshReserve: disc("02da8aeb4fc91966"),
  refreshObligation: disc("218493e497c04859"),
  refreshObligationFarmsForReserve: disc("8c90fd150a4af803"),
  depositV2: disc("d8e0bf1bcc9766af"),
  withdrawV2: disc("eb34779895c51407"),
} as const;

const ataCache = new Map<string, Set<string>>();

/** The wallet's associated token accounts for a mint, under both token programs. */
export function ownerAtas(owner: string, mint: string): Set<string> {
  const key = `${owner}:${mint}`;
  let set = ataCache.get(key);
  if (!set) {
    const o = new PublicKey(owner);
    const m = new PublicKey(mint);
    set = new Set(
      [TOKEN, TOKEN_2022].map((p) =>
        PublicKey.findProgramAddressSync([o.toBuffer(), new PublicKey(p).toBuffer(), m.toBuffer()], new PublicKey(ASSOCIATED_TOKEN))[0].toBase58(),
      ),
    );
    ataCache.set(key, set);
  }
  return set;
}

export interface IxContext {
  owner: string;
  data: Buffer;
  /** Account at position i of the instruction; throws if it can't be resolved. */
  acct(i: number): string;
  count: number;
}

function requireOwner(ctx: IxContext, i: number, what: string): void {
  if (ctx.acct(i) !== ctx.owner) throw new SignerRuleError(`${what}: the wallet must be the signer, not ${ctx.acct(i)}.`);
}

function requireOwnerAta(ctx: IxContext, i: number, mint: string, what: string): string {
  const a = ctx.acct(i);
  if (!ownerAtas(ctx.owner, mint).has(a)) throw new SignerRuleError(`${what}: ${a} is not the wallet's own token account for ${mint}.`);
  return a;
}

function requireEq(ctx: IxContext, i: number, expected: string, what: string): void {
  if (ctx.acct(i) !== expected) throw new SignerRuleError(`${what} must be ${expected}, not ${ctx.acct(i)}.`);
}

function u64At(data: Buffer, offset: number, what: string): bigint {
  if (offset < 0 || data.length < offset + 8) throw new SignerRuleError(`${what}: instruction data is too short.`);
  return data.readBigUInt64LE(offset);
}

function needAccounts(ctx: IxContext, n: number, what: string): void {
  if (ctx.count < n) throw new SignerRuleError(`${what}: expected at least ${n} accounts, got ${ctx.count}.`);
}

// ---------------------------------------------------------------------------
// Jupiter v6

/**
 * route and shared_accounts_route, exact-in only. Their data ends with
 * in_amount u64, quoted_out_amount u64, slippage_bps u16, platform_fee_bps u8.
 * Out goes to the wallet's own token account for the output mint, no platform fee.
 */
export function checkJupiterIx(ctx: IxContext): IxEffects {
  const d = ctx.data.subarray(0, 8).toString("hex");
  const tail = ctx.data.length - 19;
  let authority: number, source: number, dest: number, destMint: number, feeAccount: number;
  let extraDest: number | null = null;
  if (d === JUPITER_IX.route) {
    // 0 token_program, 1 user_transfer_authority, 2 user_source, 3 user_destination,
    // 4 destination_token_account (optional: program id = None), 5 destination_mint, 6 platform_fee_account, 7 event_authority, 8 program
    needAccounts(ctx, 9, "Jupiter route");
    [authority, source, dest, destMint, feeAccount] = [1, 2, 3, 5, 6];
    if (ctx.acct(4) !== JUPITER_V6) extraDest = 4;
  } else if (d === JUPITER_IX.sharedAccountsRoute) {
    // 0 token_program, 1 program_authority, 2 user_transfer_authority, 3 source_token_account, 4 program_source,
    // 5 program_destination, 6 destination_token_account, 7 source_mint, 8 destination_mint, 9 platform_fee_account, 10 token_2022, 11 event_authority, 12 program
    needAccounts(ctx, 13, "Jupiter shared route");
    [authority, source, dest, destMint, feeAccount] = [2, 3, 6, 8, 9];
  } else {
    throw new SignerRuleError(`Jupiter instruction ${d} is not one the signer allows (only exact-in route and shared_accounts_route).`);
  }
  if (tail < 8) throw new SignerRuleError("Jupiter route: instruction data is too short.");
  requireOwner(ctx, authority, "Jupiter route");
  const mint = ctx.acct(destMint);
  const out = requireOwnerAta(ctx, dest, mint, "Jupiter output");
  let finalOut = out;
  if (extraDest !== null) finalOut = requireOwnerAta(ctx, extraDest, mint, "Jupiter destination_token_account");
  if (ctx.acct(feeAccount) !== JUPITER_V6) throw new SignerRuleError("Jupiter route: a platform fee account is not allowed.");
  if (ctx.data[ctx.data.length - 1] !== 0) throw new SignerRuleError("Jupiter route: a platform fee is not allowed.");
  const inAmount = u64At(ctx.data, tail, "Jupiter route");
  return {
    spends: [{ account: ctx.acct(source), maxRaw: inAmount }],
    // A SOL output lands in wrapped SOL that is closed back to the wallet in the same transaction, so only token outputs are checked here.
    mustIncrease: mint === NATIVE_MINT ? [] : [finalOut],
  };
}

// ---------------------------------------------------------------------------
// Jupiter Lend (Earn), USDC only

export function checkJupiterLendIx(ctx: IxContext): IxEffects {
  const d = ctx.data.subarray(0, 8).toString("hex");
  needAccounts(ctx, 7, "Jupiter Lend");
  requireOwner(ctx, 0, "Jupiter Lend");
  const amount = u64At(ctx.data, 8, "Jupiter Lend");
  if (d === JUPITER_LEND_IX.deposit) {
    // 0 signer, 1 depositor_token_account, 2 recipient_token_account, 3 mint, 4 lending_admin, 5 lending, 6 f_token_mint
    requireEq(ctx, 3, USDC_MINT, "Jupiter Lend deposit mint");
    requireOwnerAta(ctx, 2, ctx.acct(6), "Jupiter Lend deposit receipt");
    return { spends: [{ account: ctx.acct(1), maxRaw: amount }], mustIncrease: [] };
  }
  if (d === JUPITER_LEND_IX.withdraw || d === JUPITER_LEND_IX.redeem) {
    // 0 signer, 1 owner_token_account (fToken), 2 recipient_token_account, 3 lending_admin, 4 lending, 5 mint, 6 f_token_mint
    requireEq(ctx, 5, USDC_MINT, "Jupiter Lend withdraw mint");
    requireOwnerAta(ctx, 2, USDC_MINT, "Jupiter Lend withdraw recipient");
    // withdraw takes a USDC amount and burns however many shares that is; redeem takes the share count.
    return { spends: [{ account: ctx.acct(1), maxRaw: d === JUPITER_LEND_IX.redeem ? amount : null }], mustIncrease: [] };
  }
  throw new SignerRuleError(`Jupiter Lend instruction ${d} is not one the signer allows (only deposit, withdraw, redeem).`);
}

// ---------------------------------------------------------------------------
// Kamino Lend: main market, USDC reserve, deposit and withdraw only

export function checkKaminoIx(ctx: IxContext): IxEffects {
  const d = ctx.data.subarray(0, 8).toString("hex");
  const none: IxEffects = { spends: [], mustIncrease: [] };
  switch (d) {
    case KLEND_IX.initUserMetadata:
      // 0 owner, 1 fee_payer
      needAccounts(ctx, 2, "Kamino init_user_metadata");
      requireOwner(ctx, 0, "Kamino init_user_metadata");
      requireOwner(ctx, 1, "Kamino init_user_metadata payer");
      return none;
    case KLEND_IX.initObligation:
      // 0 obligation_owner, 1 fee_payer, 2 obligation, 3 lending_market
      needAccounts(ctx, 4, "Kamino init_obligation");
      requireOwner(ctx, 0, "Kamino init_obligation");
      requireOwner(ctx, 1, "Kamino init_obligation payer");
      requireEq(ctx, 3, KAMINO_MAIN_MARKET, "Kamino market");
      return none;
    case KLEND_IX.initObligationFarmsForReserve:
      // 0 payer, 1 owner, 2 obligation, 3 market_authority, 4 reserve, …, 7 lending_market
      needAccounts(ctx, 8, "Kamino init_obligation_farms_for_reserve");
      requireOwner(ctx, 0, "Kamino init_obligation_farms_for_reserve payer");
      requireOwner(ctx, 1, "Kamino init_obligation_farms_for_reserve");
      requireEq(ctx, 4, KAMINO_USDC_RESERVE, "Kamino reserve");
      requireEq(ctx, 7, KAMINO_MAIN_MARKET, "Kamino market");
      return none;
    case KLEND_IX.refreshReserve:
    case KLEND_IX.refreshObligation:
      // Permissionless bookkeeping; never needs the wallet.
      for (let i = 0; i < ctx.count; i++) {
        if (ctx.acct(i) === ctx.owner) throw new SignerRuleError("Kamino refresh must not involve the wallet.");
      }
      return none;
    case KLEND_IX.refreshObligationFarmsForReserve:
      // 0 crank (any signer), 1 obligation, 2 market_authority, 3 reserve, …, 6 lending_market
      needAccounts(ctx, 7, "Kamino refresh_obligation_farms_for_reserve");
      requireEq(ctx, 3, KAMINO_USDC_RESERVE, "Kamino reserve");
      requireEq(ctx, 6, KAMINO_MAIN_MARKET, "Kamino market");
      return none;
    case KLEND_IX.depositV2: {
      // 0 owner, 1 obligation, 2 lending_market, 3 market_authority, 4 reserve, 5 reserve_liquidity_mint, …, 9 user_source_liquidity
      needAccounts(ctx, 10, "Kamino deposit");
      requireOwner(ctx, 0, "Kamino deposit");
      requireEq(ctx, 2, KAMINO_MAIN_MARKET, "Kamino market");
      requireEq(ctx, 4, KAMINO_USDC_RESERVE, "Kamino reserve");
      requireEq(ctx, 5, USDC_MINT, "Kamino deposit mint");
      return { spends: [{ account: ctx.acct(9), maxRaw: u64At(ctx.data, 8, "Kamino deposit") }], mustIncrease: [] };
    }
    case KLEND_IX.withdrawV2: {
      // 0 owner, 1 obligation, 2 lending_market, 3 market_authority, 4 withdraw_reserve, 5 reserve_liquidity_mint, …, 9 user_destination_liquidity
      needAccounts(ctx, 10, "Kamino withdraw");
      requireOwner(ctx, 0, "Kamino withdraw");
      requireEq(ctx, 2, KAMINO_MAIN_MARKET, "Kamino market");
      requireEq(ctx, 4, KAMINO_USDC_RESERVE, "Kamino reserve");
      requireEq(ctx, 5, USDC_MINT, "Kamino withdraw mint");
      requireOwnerAta(ctx, 9, USDC_MINT, "Kamino withdraw recipient");
      return none;
    }
    default:
      throw new SignerRuleError(`Kamino instruction ${d} is not one the signer allows (borrowing, flash loans and other markets are refused).`);
  }
}
