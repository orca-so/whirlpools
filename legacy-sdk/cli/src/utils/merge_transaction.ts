import { ComputeBudgetProgram } from "@solana/web3.js";
import type { AddressLookupTableAccount } from "@solana/web3.js";
import type { WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import { MEASUREMENT_BLOCKHASH, TransactionBuilder } from "@orca-so/common-sdk";

export function mergeTransactionBuilders(ctx: WhirlpoolContext, txs: TransactionBuilder[], alts: AddressLookupTableAccount[]): TransactionBuilder[] {
  const merged: TransactionBuilder[] = [];
  let tx: TransactionBuilder | undefined = undefined;
  let cursor = 0;
  while (cursor < txs.length) {
    if (!tx) {
      tx = new TransactionBuilder(ctx.connection, ctx.wallet);
      // reserve space for ComputeBudgetProgram
      tx.addInstruction({
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({units: 0}), // dummy ix
          ComputeBudgetProgram.setComputeUnitPrice({microLamports: 0}), // dummy ix
        ],
        cleanupInstructions: [],
        signers: [],
      })
    }

    const mergeable = checkMergedTransactionSizeIsValid(ctx, [tx, txs[cursor]], alts);
    if (mergeable) {
      tx.addInstruction(txs[cursor].compressIx(true));
      cursor++;
    } else {
      merged.push(tx);
      tx = undefined;
    }
  }

  if (tx) {
    merged.push(tx);
  }

  // remove dummy ComputeBudgetProgram ixs
  return merged.map((tx) => {
    const newTx = new TransactionBuilder(ctx.connection, ctx.wallet);
    const ix = tx.compressIx(true);
    ix.instructions = ix.instructions.slice(2); // remove dummy ComputeBudgetProgram ixs
    newTx.addInstruction(ix);
    return newTx;
  });
}

function checkMergedTransactionSizeIsValid(
  ctx: WhirlpoolContext,
  builders: TransactionBuilder[],
  alts: AddressLookupTableAccount[],
): boolean {
  const merged = new TransactionBuilder(
    ctx.connection,
    ctx.wallet,
    ctx.txBuilderOpts,
  );
  builders.forEach((builder) =>
    merged.addInstruction(builder.compressIx(true)),
  );
  try {
    merged.txnSize({
      latestBlockhash: MEASUREMENT_BLOCKHASH,
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: alts,
    });
    return true;
  } catch {
    return false;
  }
}
