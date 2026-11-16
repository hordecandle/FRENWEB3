import { PublicKey, type AccountInfo, type AddressLookupTableAccount, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { SignerRuleError } from "./errors.js";
import { resolveAccountKeys, type SolanaTxReport } from "./rules.js";
import { NATIVE_MINT } from "./solana-ix.js";

/**
 * The simulation half of the Solana rules. The static check pins where the
 * listed instructions send money; this pins what actually happens to the
 * wallet, including everything inner instructions do:
 *
 * - the wallet's SOL may drop by at most the engine's stated maximum;
 * - none of the wallet's token accounts may change owner, gain a delegate
 *   or a close authority;
 * - a wallet token account may only go down if an allowed instruction spends
 *   from it, and by no more than that instruction says;
 * - swap outputs must go up.
 */

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);

export interface TokenState {
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  closeAuthority: string | null;
}

/** SPL token account (base layout, same in Token-2022), or null if the account isn't one. */
export function parseTokenAccount(programOwner: string, data: Buffer): TokenState | null {
  if (!TOKEN_PROGRAMS.has(programOwner) || data.length < 165) return null;
  const opt = (tagAt: number) => (data.readUInt32LE(tagAt) === 1 ? new PublicKey(data.subarray(tagAt + 4, tagAt + 36)).toBase58() : null);
  return {
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    owner: new PublicKey(data.subarray(32, 64)).toBase58(),
    amount: data.readBigUInt64LE(64),
    delegate: opt(72),
    delegatedAmount: data.readBigUInt64LE(121),
    closeAuthority: opt(129),
  };
}

export interface AccountSnapshot {
  lamports: number;
  programOwner: string;
  data: Buffer;
}

/**
 * Compare the wallet's accounts before and after. `pre` and `post` are keyed
 * by address; a missing or zero-lamport entry is an account that doesn't exist.
 * Pure, so it can be tested without a network.
 */
export function checkTokenEffects(
  owner: string,
  report: Pick<SolanaTxReport, "spends" | "mustIncrease">,
  watched: string[],
  pre: Map<string, AccountSnapshot | null>,
  post: Map<string, AccountSnapshot | null>,
): void {
  const live = (s: AccountSnapshot | null | undefined) => (s && s.lamports > 0 ? s : null);
  for (const address of watched) {
    const before = live(pre.get(address));
    const after = live(post.get(address));
    const b = before ? parseTokenAccount(before.programOwner, before.data) : null;
    const a = after ? parseTokenAccount(after.programOwner, after.data) : null;
    const wasOurs = b !== null && b.owner === owner;
    const isOurs = a !== null && a.owner === owner;

    if (wasOurs && after !== null && !isOurs) {
      throw new SignerRuleError(`Token account ${address} would stop belonging to the wallet.`);
    }
    if (!isOurs) {
      // Closed (only possible at zero balance, or wrapped SOL whose lamports the SOL check covers) or never ours.
      if (wasOurs && after === null && b.amount > 0n && b.mint !== NATIVE_MINT) {
        throw new SignerRuleError(`Token account ${address} would vanish while holding ${b.amount}.`);
      }
      continue;
    }
    if (a.delegate !== null && (a.delegate !== b?.delegate || a.delegatedAmount > (b?.delegatedAmount ?? 0n))) {
      throw new SignerRuleError(`Token account ${address} would let ${a.delegate} spend from it.`);
    }
    if (a.closeAuthority !== (b?.closeAuthority ?? null)) {
      throw new SignerRuleError(`Token account ${address} would get a new close authority.`);
    }
    const startAmount = wasOurs ? b.amount : 0n;
    const drop = startAmount - a.amount;
    if (drop > 0n) {
      const cap = report.spends[address];
      if (cap === undefined) throw new SignerRuleError(`Token account ${address} would lose ${drop} without an allowed instruction spending it.`);
      if (cap !== null && drop > BigInt(cap)) throw new SignerRuleError(`Token account ${address} would lose ${drop}, more than the ${cap} the instruction allows.`);
    }
  }
  for (const address of report.mustIncrease) {
    const b = live(pre.get(address));
    const a = live(post.get(address));
    const start = b ? (parseTokenAccount(b.programOwner, b.data)?.amount ?? 0n) : 0n;
    const end = a ? (parseTokenAccount(a.programOwner, a.data)?.amount ?? 0n) : 0n;
    if (end <= start) throw new SignerRuleError(`Swap output ${address} would not receive anything.`);
  }
}

/** Fetch the lookup tables a transaction uses. Missing tables stay missing; the static check then refuses what it can't see. */
export async function fetchLookupTables(connection: Connection, tx: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const l of tx.message.addressTableLookups ?? []) {
    const r = await connection.getAddressLookupTable(l.accountKey);
    if (r.value) out.push(r.value);
  }
  return out;
}

/** Simulate and apply every check above. Returns the wallet's SOL change in lamports. */
export async function simulateAndCheck(
  connection: Connection,
  tx: VersionedTransaction,
  owner: PublicKey,
  report: SolanaTxReport,
  lookupTables: AddressLookupTableAccount[],
  maxSolSpendLamports: number,
): Promise<number> {
  const ownerB58 = owner.toBase58();
  const all = [...new Set(resolveAccountKeys(tx, lookupTables).filter((k): k is string => k !== undefined && k !== ownerB58))];
  const before = await connection.getBalance(owner, "confirmed");
  const infos: Array<AccountInfo<Buffer> | null> = [];
  for (let i = 0; i < all.length; i += 100) {
    infos.push(...(await connection.getMultipleAccountsInfo(all.slice(i, i + 100).map((k) => new PublicKey(k)), "confirmed")));
  }
  const pre = new Map<string, AccountSnapshot | null>();
  const watched: string[] = [];
  all.forEach((k, i) => {
    const info = infos[i];
    const snap = info ? { lamports: info.lamports, programOwner: info.owner.toBase58(), data: Buffer.from(info.data) } : null;
    pre.set(k, snap);
    // Watch the wallet's token accounts, and anything that doesn't exist yet (it may become one).
    const tok = snap ? parseTokenAccount(snap.programOwner, snap.data) : null;
    if (snap === null || tok?.owner === ownerB58) watched.push(k);
  });
  for (const a of report.mustIncrease) if (!watched.includes(a)) watched.push(a);

  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: [ownerB58, ...watched] },
  });
  if (sim.value.err) throw new SignerRuleError(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  const accounts = sim.value.accounts;
  if (!accounts || accounts.length !== watched.length + 1) throw new SignerRuleError("Simulation did not return the wallet's accounts.");
  const after = accounts[0]?.lamports;
  if (after === undefined) throw new SignerRuleError("Simulation did not return the wallet balance.");
  const solDelta = after - before;
  if (-solDelta > maxSolSpendLamports) {
    throw new SignerRuleError(`Simulation shows the wallet losing ${-solDelta} lamports, more than the ${maxSolSpendLamports} allowed.`);
  }
  const post = new Map<string, AccountSnapshot | null>();
  watched.forEach((k, i) => {
    const s = accounts[i + 1];
    post.set(k, s ? { lamports: s.lamports, programOwner: s.owner, data: Buffer.from(s.data[0] ?? "", "base64") } : null);
  });
  checkTokenEffects(ownerB58, report, watched, pre, post);
  return solDelta;
}
