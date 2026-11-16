import { readFileSync } from "node:fs";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { SOLANA_PROGRAMS, checkSolanaTransaction, type SolanaTxReport } from "./rules.js";
import { JUPITER_IX, KAMINO_MAIN_MARKET, KAMINO_USDC_RESERVE, KLEND_IX, USDC_MINT, ownerAtas } from "./solana-ix.js";
import { checkTokenEffects, simulateAndCheck, type AccountSnapshot } from "./solana-sim.js";

/**
 * H1: instruction allow-list and token-delta simulation, against unsigned
 * transactions taken from the real APIs (Jupiter swap, Jupiter Lend /earn,
 * Kamino /ktx) for a throwaway wallet with no funds, plus the lookup tables
 * they use. Attacks rewrite those real transactions.
 */

const fx = JSON.parse(readFileSync(new URL("./fixtures/solana-api-txs.json", import.meta.url), "utf8")) as {
  owner: string;
  txs: Record<string, string>;
  alts: Record<string, string[]>;
};
const owner = new PublicKey(fx.owner);
const tables = Object.entries(fx.alts).map(
  ([key, addresses]) =>
    new AddressLookupTableAccount({
      key: new PublicKey(key),
      state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: addresses.map((a) => new PublicKey(a)) },
    }),
);
const load = (name: string) => VersionedTransaction.deserialize(Buffer.from(fx.txs[name]!, "base64"));
const check = (tx: VersionedTransaction, extra: { jitoTipLamports?: number } = {}) => checkSolanaTransaction(tx, owner, { lookupTables: tables, ...extra });

/** Decompile a real transaction, let `edit` change its instructions, compile it back with the same lookup tables. */
function rewrite(name: string, edit: (ixs: TransactionInstruction[]) => void): VersionedTransaction {
  const tx = load(name);
  const msg = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: tables });
  edit(msg.instructions);
  return new VersionedTransaction(msg.compileToV0Message(tables));
}
const find = (ixs: TransactionInstruction[], program: string, discHex?: string) => {
  const ix = ixs.find((i) => i.programId.toBase58() === program && (!discHex || i.data.subarray(0, 8).toString("hex") === discHex));
  if (!ix) throw new Error(`no ${program} ${discHex ?? ""} instruction in fixture`);
  return ix;
};
const setKey = (ix: TransactionInstruction, i: number, key: PublicKey) => {
  ix.keys[i] = { ...ix.keys[i]!, pubkey: key };
};
const setDisc = (ix: TransactionInstruction, hex: string) => {
  ix.data = Buffer.concat([Buffer.from(hex, "hex"), ix.data.subarray(8)]);
};

const stranger = Keypair.generate().publicKey;
const strangerAta = (mint: string) => [...ownerAtas(stranger.toBase58(), mint)][0]!;
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const atas = (mint: string) => ownerAtas(fx.owner, mint);

describe("H1: real API transactions pass", () => {
  for (const name of Object.keys(fx.txs)) {
    it(name, () => {
      expect(() => check(load(name), name === "swap_jito" ? { jitoTipLamports: 10_000_000 } : {})).not.toThrow();
    });
  }

  it("records what each one may spend and what must come back", () => {
    const usdc = [...atas(USDC_MINT)];
    const jupSwap = check(load("swap_usdc_jup"));
    expect(Object.keys(jupSwap.spends).some((a) => usdc.includes(a))).toBe(true);
    expect(jupSwap.mustIncrease.every((a) => atas(JUP_MINT).has(a))).toBe(true);
    expect(jupSwap.mustIncrease).toHaveLength(1);
    // SOL out lands in wrapped SOL that is closed back to the wallet, so nothing to watch going up.
    expect(check(load("swap_usdc_sol")).mustIncrease).toEqual([]);
    const jl = check(load("jl_deposit"));
    expect(Object.entries(jl.spends)).toHaveLength(1);
    expect(Object.values(jl.spends)[0]).not.toBeNull();
    const k = check(load("k_deposit"));
    expect(Object.keys(k.spends).every((a) => usdc.includes(a))).toBe(true);
  });

  it("refuses a route whose mints sit in a lookup table the signer could not read", () => {
    expect(() => checkSolanaTransaction(load("swap_usdc_jup"), owner)).toThrow(/lookup table/);
  });
});

describe("H1 attacks: Jupiter output must be the wallet's", () => {
  it("refuses a shared route paying out to someone else", () => {
    const tx = rewrite("swap_usdc_jup", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterV6), 6, new PublicKey(strangerAta(JUP_MINT))));
    expect(() => check(tx)).toThrow(/Jupiter output.*not the wallet's own/);
  });

  it("refuses a route paying out to someone else", () => {
    const tx = rewrite("swap_sol_usdc", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterV6), 3, new PublicKey(strangerAta(USDC_MINT))));
    expect(() => check(tx)).toThrow(/Jupiter output/);
  });

  it("refuses a route that sends the output on to someone else via destination_token_account", () => {
    const tx = rewrite("swap_sol_usdc", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterV6), 4, new PublicKey(strangerAta(USDC_MINT))));
    expect(() => check(tx)).toThrow(/destination_token_account/);
  });

  it("refuses a route where someone else's token account is the output for a lying mint", () => {
    // Swap the destination mint so the stranger's account would match "some mint": it still has to be the wallet's.
    const tx = rewrite("swap_sol_usdc", (ixs) => {
      const ix = find(ixs, SOLANA_PROGRAMS.jupiterV6);
      setKey(ix, 3, new PublicKey(strangerAta(JUP_MINT)));
      setKey(ix, 5, new PublicKey(JUP_MINT));
    });
    expect(() => check(tx)).toThrow(/Jupiter output/);
  });

  it("refuses a platform fee account or a platform fee", () => {
    const withAccount = rewrite("swap_usdc_jup", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterV6), 9, new PublicKey(strangerAta(USDC_MINT))));
    expect(() => check(withAccount)).toThrow(/platform fee account/);
    const withBps = rewrite("swap_usdc_jup", (ixs) => {
      const ix = find(ixs, SOLANA_PROGRAMS.jupiterV6);
      ix.data = Buffer.from(ix.data);
      ix.data[ix.data.length - 1] = 100;
    });
    expect(() => check(withBps)).toThrow(/platform fee is not allowed/);
  });

  it("refuses a route signed for by someone else's authority", () => {
    const tx = rewrite("swap_sol_usdc", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterV6), 1, stranger));
    expect(() => check(tx)).toThrow(/wallet must be the signer/);
  });

  it("refuses every other Jupiter instruction (exact-out, token-ledger, v2 routes, unknown)", () => {
    for (const hex of ["d033ef977b2bed5c", "b0d169a89a7d453e", "96564774a75d0e68", "e6798f50779f6aaa", "bb64facc31c4af14", "d19853937cfed8e9", "0000000000000000"]) {
      const tx = rewrite("swap_usdc_jup", (ixs) => setDisc(find(ixs, SOLANA_PROGRAMS.jupiterV6), hex));
      expect(() => check(tx), hex).toThrow(/Jupiter instruction/);
    }
  });
});

describe("H1 attacks: Jupiter Lend", () => {
  it("refuses a deposit whose receipt tokens go to someone else", () => {
    const tx = rewrite("jl_deposit", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterLend), 2, stranger));
    expect(() => check(tx)).toThrow(/deposit receipt/);
  });

  it("refuses a withdraw or redeem paying someone else", () => {
    for (const name of ["jl_withdraw", "jl_redeem"]) {
      const tx = rewrite(name, (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterLend), 2, new PublicKey(strangerAta(USDC_MINT))));
      expect(() => check(tx), name).toThrow(/withdraw recipient/);
    }
  });

  it("refuses another asset, another signer, and unknown instructions", () => {
    const otherMint = rewrite("jl_deposit", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterLend), 3, new PublicKey(JUP_MINT)));
    expect(() => check(otherMint)).toThrow(/mint must be/);
    const otherSigner = rewrite("jl_deposit", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.jupiterLend), 0, stranger));
    expect(() => check(otherSigner)).toThrow();
    const unknown = rewrite("jl_deposit", (ixs) => setDisc(find(ixs, SOLANA_PROGRAMS.jupiterLend), "1111111111111111"));
    expect(() => check(unknown)).toThrow(/Jupiter Lend instruction/);
  });
});

describe("H1 attacks: Kamino", () => {
  const deposit = (ixs: TransactionInstruction[]) => find(ixs, SOLANA_PROGRAMS.kaminoLend, KLEND_IX.depositV2);

  it("refuses borrowing and flash loans", () => {
    for (const hex of ["a1808ff5abc7c206", "797f12cc49f5e141", "87e734a70734d4c1"]) {
      const tx = rewrite("k_deposit", (ixs) => setDisc(deposit(ixs), hex));
      expect(() => check(tx), hex).toThrow(/Kamino instruction/);
    }
  });

  it("refuses another market, another reserve, another asset", () => {
    expect(() => check(rewrite("k_deposit", (ixs) => setKey(deposit(ixs), 2, stranger)))).toThrow(/Kamino market/);
    expect(() => check(rewrite("k_deposit", (ixs) => setKey(deposit(ixs), 4, stranger)))).toThrow(/Kamino reserve/);
    expect(() => check(rewrite("k_deposit", (ixs) => setKey(deposit(ixs), 5, new PublicKey(JUP_MINT))))).toThrow(/mint must be/);
  });

  it("allows a withdraw to the wallet and refuses one to someone else", () => {
    // Same account layout as the deposit (klend IDL); account 9 becomes the destination.
    const toUs = rewrite("k_deposit", (ixs) => setDisc(deposit(ixs), KLEND_IX.withdrawV2));
    expect(() => check(toUs)).not.toThrow();
    const toThem = rewrite("k_deposit", (ixs) => {
      const ix = deposit(ixs);
      setDisc(ix, KLEND_IX.withdrawV2);
      setKey(ix, 9, new PublicKey(strangerAta(USDC_MINT)));
    });
    expect(() => check(toThem)).toThrow(/withdraw recipient/);
  });

  it("refuses a user-metadata or obligation paid for or owned by someone else", () => {
    const meta = rewrite("k_deposit", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.kaminoLend, KLEND_IX.initUserMetadata), 0, stranger));
    expect(() => check(meta)).toThrow(/wallet must be the signer/);
    const ob = rewrite("k_deposit", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.kaminoLend, KLEND_IX.initObligation), 3, stranger));
    expect(() => check(ob)).toThrow(/Kamino market/);
  });

  it("refuses a refresh that is handed the wallet", () => {
    const tx = rewrite("k_deposit", (ixs) => setKey(find(ixs, SOLANA_PROGRAMS.kaminoLend, KLEND_IX.refreshObligation), 1, owner));
    expect(() => check(tx)).toThrow(/refresh must not involve the wallet/);
  });

  it("refuses Kamino's oracle program or any other listed helper being handed the wallet", () => {
    const tx = rewrite("k_deposit", (ixs) => {
      ixs.push(new TransactionInstruction({ programId: new PublicKey(SOLANA_PROGRAMS.kaminoScope), keys: [{ pubkey: owner, isSigner: true, isWritable: true }], data: Buffer.alloc(8) }));
    });
    expect(() => check(tx)).toThrow(/may not be given the wallet/);
  });
});

// ---------------------------------------------------------------------------
// Simulation: token deltas

function tokenData(o: { mint: string; owner: string; amount: bigint; delegate?: string; delegatedAmount?: bigint; closeAuthority?: string }): Buffer {
  const b = Buffer.alloc(165);
  new PublicKey(o.mint).toBuffer().copy(b, 0);
  new PublicKey(o.owner).toBuffer().copy(b, 32);
  b.writeBigUInt64LE(o.amount, 64);
  if (o.delegate) {
    b.writeUInt32LE(1, 72);
    new PublicKey(o.delegate).toBuffer().copy(b, 76);
  }
  b[108] = 1; // initialized
  b.writeBigUInt64LE(o.delegatedAmount ?? 0n, 121);
  if (o.closeAuthority) {
    b.writeUInt32LE(1, 129);
    new PublicKey(o.closeAuthority).toBuffer().copy(b, 133);
  }
  return b;
}
const TOKEN = SOLANA_PROGRAMS.token;
const snap = (o: Parameters<typeof tokenData>[0]): AccountSnapshot => ({ lamports: 2_039_280, programOwner: TOKEN, data: tokenData(o) });

describe("H1: simulation of the wallet's token accounts", () => {
  const me = fx.owner;
  const src = [...atas(USDC_MINT)][0]!;
  const out = [...atas(JUP_MINT)][0]!;
  const report: Pick<SolanaTxReport, "spends" | "mustIncrease"> = { spends: { [src]: "1000000" }, mustIncrease: [out] };
  const run = (pre: Record<string, AccountSnapshot | null>, post: Record<string, AccountSnapshot | null>, r = report) =>
    checkTokenEffects(me, r, Object.keys({ ...pre, ...post }), new Map(Object.entries(pre)), new Map(Object.entries(post)));

  it("passes a normal swap: source down within the limit, output up", () => {
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 4_000_000n }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 42n }) },
      ),
    ).not.toThrow();
  });

  it("refuses taking more from the source than the instruction says", () => {
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 3_999_999n }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 42n }) },
      ),
    ).toThrow(/more than the 1000000/);
  });

  it("refuses draining a token account nothing was allowed to spend", () => {
    const other = [...atas("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")][0]!;
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [other]: snap({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", owner: me, amount: 10n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 4_000_000n }), [other]: snap({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", owner: me, amount: 0n }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 42n }) },
      ),
    ).toThrow(/without an allowed instruction/);
  });

  it("refuses an inner approve (new delegate) on any wallet token account", () => {
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 4_000_000n, delegate: stranger.toBase58(), delegatedAmount: 1n }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 42n }) },
      ),
    ).toThrow(/would let .* spend from it/);
  });

  it("refuses an inner SetAuthority handing the account to someone else", () => {
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: stranger.toBase58(), amount: 5_000_000n }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 42n }) },
      ),
    ).toThrow(/stop belonging/);
  });

  it("refuses a new close authority", () => {
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 4_000_000n, closeAuthority: stranger.toBase58() }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 42n }) },
      ),
    ).toThrow(/close authority/);
  });

  it("refuses a swap whose output never arrives", () => {
    expect(() =>
      run(
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 5_000_000n }), [out]: null },
        { [src]: snap({ mint: USDC_MINT, owner: me, amount: 4_000_000n }), [out]: snap({ mint: JUP_MINT, owner: me, amount: 0n }) },
      ),
    ).toThrow(/would not receive/);
  });

  it("allows closing the wallet's wrapped SOL (its lamports are the SOL check's job)", () => {
    const wsol = [...atas("So11111111111111111111111111111111111111112")][0]!;
    expect(() =>
      run({ [wsol]: snap({ mint: "So11111111111111111111111111111111111111112", owner: me, amount: 7n }) }, { [wsol]: null }, { spends: {}, mustIncrease: [] }),
    ).not.toThrow();
  });

  it("runs end to end through a simulating RPC, and refuses on its answer", async () => {
    const tx = load("swap_usdc_jup");
    const report = check(tx);
    const [srcAcct] = Object.keys(report.spends);
    const outAcct = report.mustIncrease[0]!;
    const usdcBefore = snap({ mint: USDC_MINT, owner: me, amount: 5_000_000_000n });
    const fakeRpc = (postSrc: AccountSnapshot, postOut: AccountSnapshot | null, lamportsAfter: number) =>
      ({
        getBalance: async () => 100_000_000,
        getMultipleAccountsInfo: async (keys: PublicKey[]) =>
          keys.map((k) => (k.toBase58() === srcAcct ? { lamports: usdcBefore.lamports, owner: new PublicKey(TOKEN), data: usdcBefore.data, executable: false } : k.toBase58() === outAcct ? null : { lamports: 1, owner: stranger, data: Buffer.alloc(0), executable: false })),
        simulateTransaction: async (_tx: unknown, cfg: { accounts: { addresses: string[] } }) => ({
          value: {
            err: null,
            accounts: cfg.accounts.addresses.map((a, i) =>
              i === 0
                ? { lamports: lamportsAfter, owner: "11111111111111111111111111111111", data: ["", "base64"] }
                : a === srcAcct
                  ? { lamports: postSrc.lamports, owner: TOKEN, data: [postSrc.data.toString("base64"), "base64"] }
                  : a === outAcct && postOut
                    ? { lamports: postOut.lamports, owner: TOKEN, data: [postOut.data.toString("base64"), "base64"] }
                    : null,
            ),
          },
        }),
      }) as unknown as Connection;
    const inAmount = BigInt(report.spends[srcAcct!]!);
    const good = fakeRpc(snap({ mint: USDC_MINT, owner: me, amount: 5_000_000_000n - inAmount }), snap({ mint: JUP_MINT, owner: me, amount: 9n }), 99_990_000);
    await expect(simulateAndCheck(good, tx, owner, report, tables, 10_000_000)).resolves.toBe(-10_000);
    const delegated = fakeRpc(snap({ mint: USDC_MINT, owner: me, amount: 5_000_000_000n - inAmount, delegate: stranger.toBase58(), delegatedAmount: 1n }), snap({ mint: JUP_MINT, owner: me, amount: 9n }), 99_990_000);
    await expect(simulateAndCheck(delegated, tx, owner, report, tables, 10_000_000)).rejects.toThrow(/spend from it/);
    const drained = fakeRpc(snap({ mint: USDC_MINT, owner: me, amount: 0n }), snap({ mint: JUP_MINT, owner: me, amount: 9n }), 99_990_000);
    await expect(simulateAndCheck(drained, tx, owner, report, tables, 10_000_000)).rejects.toThrow(/more than the/);
    const solDrain = fakeRpc(snap({ mint: USDC_MINT, owner: me, amount: 5_000_000_000n - inAmount }), snap({ mint: JUP_MINT, owner: me, amount: 9n }), 1);
    await expect(simulateAndCheck(solDrain, tx, owner, report, tables, 10_000_000)).rejects.toThrow(/lamports/);
  });
});

describe("H1: KAMINO constants match the engine", () => {
  it("pins the main market and USDC reserve the engine lends through", () => {
    const lend = readFileSync(new URL("../../engine/src/venues/solana-lend.ts", import.meta.url), "utf8");
    expect(lend).toContain(KAMINO_MAIN_MARKET);
    expect(lend).toContain(KAMINO_USDC_RESERVE);
    expect(JUPITER_IX.route).toBe("e517cb977ae3ad2a");
  });
});
