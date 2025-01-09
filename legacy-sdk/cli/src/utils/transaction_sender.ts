import type {
  AddressLookupTableAccount,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import { ComputeBudgetProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  DecimalUtil,
  TransactionBuilder,
  estimateComputeBudgetLimit,
} from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import base58 from "bs58";
import { promptConfirm, promptText } from "./prompt";

export async function sendTransaction(
  builder: TransactionBuilder,
  defaultPriorityFeeInLamports?: number,
  alts?: AddressLookupTableAccount[],
): Promise<boolean> {
  const instructions = builder.compressIx(true);
  // HACK: to clone TransactionBuilder
  const signers = builder["signers"] as Keypair[];

  const estimatedComputeUnits = await estimateComputeBudgetLimit(
    builder.connection,
    [instructions],
    undefined,
    builder.wallet.publicKey,
    0.1, // + 10%
  );
  console.info("estimatedComputeUnits:", estimatedComputeUnits);

  let useDefaultPriorityFeeInLamports =
    defaultPriorityFeeInLamports !== undefined;

  let landed = false;
  let success = false;
  while (true) {
    let priorityFeeInLamports = 0;

    if (useDefaultPriorityFeeInLamports) {
      priorityFeeInLamports = defaultPriorityFeeInLamports!;
      useDefaultPriorityFeeInLamports = false;
    } else {
      while (true) {
        const priorityFeeInSOL = await promptText("priorityFeeInSOL");
        priorityFeeInLamports = DecimalUtil.toBN(
          new Decimal(priorityFeeInSOL),
          9,
        ).toNumber();
        if (priorityFeeInLamports > LAMPORTS_PER_SOL) {
          console.info("> 1 SOL is obviously too much for priority fee");
          continue;
        }
        if (priorityFeeInLamports > 5_000_000) {
          console.info(
            `Is it okay to use ${priorityFeeInLamports / LAMPORTS_PER_SOL} SOL for priority fee ? (if it is OK, enter OK)`,
          );
          const ok = await promptConfirm("OK");
          if (!ok) continue;
        }

        console.info(
          "Priority fee:",
          priorityFeeInLamports / LAMPORTS_PER_SOL,
          "SOL",
        );
        break;
      }
    }

    const builderWithPriorityFee = new TransactionBuilder(
      builder.connection,
      builder.wallet,
      builder.opts,
    );
    if (priorityFeeInLamports > 0) {
      const setComputeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor(
          (priorityFeeInLamports * 1_000_000) / estimatedComputeUnits,
        ),
      });
      const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: estimatedComputeUnits,
      });

      builderWithPriorityFee.addInstruction({
        instructions: [setComputeUnitLimitIx, setComputeUnitPriceIx],
        cleanupInstructions: [],
        signers: [],
      });
    }
    builderWithPriorityFee.addInstruction(instructions);
    signers.forEach((s) => builderWithPriorityFee.addSigner(s));

    let withDifferentPriorityFee = false;
    while (true) {
      console.info("process transaction...");
      const result = await send(builderWithPriorityFee, alts);
      landed = result.landed;
      success = result.success;
      if (landed) break;

      console.info("\ntransaction have not landed. retry ?, enter OK");
      const ok = await promptConfirm("OK");
      if (!ok) break;

      console.info("\nchange priority fee setting?, enter YES");
      const yesno = await promptConfirm("YES");
      if (yesno) {
        withDifferentPriorityFee = true;
        break;
      }
    }

    if (landed) break;
    if (!withDifferentPriorityFee) break;
  }

  return landed && success;
}

async function send(
  builder: TransactionBuilder,
  alts: AddressLookupTableAccount[] = [],
): Promise<{ landed: boolean; success: boolean }> {
  const connection = builder.connection;
  const wallet = builder.wallet;

  // manual build
  const built = await builder.build({
    maxSupportedTransactionVersion: 0,
    lookupTableAccounts: alts,
  });

  const blockhash = await connection.getLatestBlockhashAndContext("confirmed");
  const blockHeight = await connection.getBlockHeight({
    commitment: "confirmed",
    minContextSlot: await blockhash.context.slot,
  });

  // why 151: https://solana.com/docs/core/transactions/confirmation#how-does-transaction-expiration-work
  const transactionTTL = blockHeight + 151;

  const notSigned = built.transaction as VersionedTransaction;
  notSigned.message.recentBlockhash = blockhash.value.blockhash;

  if (built.signers.length > 0) notSigned.sign(built.signers);
  const signed = await wallet.signTransaction(notSigned);
  const signature = base58.encode(signed.signatures[0]);

  // manual send and confirm
  const waitToConfirm = () =>
    new Promise((resolve) => setTimeout(resolve, 5000));
  const waitToRetry = () => new Promise((resolve) => setTimeout(resolve, 3000));

  const numTry = 100; // break by expiration
  let landed = false;
  let success = false;
  for (let i = 0; i < numTry; i++) {
    // check transaction TTL
    const blockHeight = await connection.getBlockHeight("confirmed");
    if (blockHeight > transactionTTL) {
      // check signature status (to avoid false negative)
      const sigStatus = await connection.getSignatureStatus(signature);
      if (sigStatus.value?.confirmationStatus === "confirmed") {
        success = sigStatus.value.err === null;
        console.info(
          success ? "✅successfully landed" : `🚨landed BUT TRANSACTION FAILED`,
        );
        landed = true;
        break;
      }

      console.info("transaction have been expired");
      break;
    }
    console.info(
      "transaction is still valid,",
      transactionTTL - blockHeight,
      "blocks left (at most)",
    );

    // send without retry on RPC server
    console.info("sending...");
    await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
    });

    console.info("confirming...");
    await waitToConfirm();

    // check signature status
    const sigStatus = await connection.getSignatureStatus(signature);
    if (sigStatus.value?.confirmationStatus === "confirmed") {
      success = sigStatus.value.err === null;
      console.info(
        success ? "✅successfully landed" : `🚨landed BUT TRANSACTION FAILED`,
      );
      landed = true;
      break;
    }

    // todo: need to increase wait time, but TTL is not long...
    await waitToRetry();
  }

  if (landed) {
    console.info("signature", signature);
  }

  return { landed, success };
}
