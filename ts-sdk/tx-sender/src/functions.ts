import {
  IInstruction,
  TransactionSigner,
  Transaction,
  KeyPairSigner,
  prependTransactionMessageInstruction,
  sendTransactionWithoutConfirmingFactory,
  assertTransactionIsFullySigned,
  signTransaction,
  CompilableTransactionMessage,
} from "@solana/web3.js";

import {
  connection,
  generateTransactionMessage,
  getComputeUnitsForInstructions,
} from "./utils";
import { ConnectionContext, TransactionConfig } from "./types";
// TODO create flow for ui signing
// import {
//   useWalletAccountMessageSigner,
//   useSignAndSendTransaction,
// } from "@solana/react";

import { getJitoTipAddress, recentJitoTip } from "./jito";
import { calculateDynamicPriorityFees } from "./priority";
import { getConnectionContext } from "./config";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";

export const DEFAULT_PRIORITIZATION: TransactionConfig = {
  priorityFee: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  jito: {
    type: "dynamic",
    maxCapLamports: BigInt(4_000_000), // 0.004 SOL
  },
  chainId: "solana",
};

export const signAndSendTransaction = async (
  transaction: Transaction,
  signer: KeyPairSigner,
  rpcUrl: string = getConnectionContext().rpcUrl
) => {
  const signed = await signTransaction([signer.keyPair], transaction);
  const rpc = connection(rpcUrl);
  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc });
  assertTransactionIsFullySigned(signed);
  await sendTransaction(signed, { commitment: "confirmed" });
  // todo confirming factory
};

export const buildTransaction = async (
  instructions: IInstruction[],
  signer: TransactionSigner,
  transactionConfig: TransactionConfig,
  connectionContext: ConnectionContext
): Promise<CompilableTransactionMessage> => {
  const { rpcUrl, isTriton } = connectionContext;
  const rpc = connection(rpcUrl);
  const { value: recentBlockhash } = await rpc
    .getLatestBlockhash({
      commitment: "confirmed",
    })
    .send();

  const estimatedComputeUnits = await getComputeUnitsForInstructions(
    rpc,
    instructions,
    signer
  );

  let message = await generateTransactionMessage(
    instructions,
    recentBlockhash,
    signer
  );

  const { priorityFeeMicroLamports, jitoTipLamports } =
    await estimatePriorityFees(
      instructions,
      rpcUrl,
      isTriton,
      signer,
      transactionConfig
    );

  if (priorityFeeMicroLamports > 0) {
    message = prependTransactionMessageInstruction(
      getSetComputeUnitPriceInstruction({
        microLamports: priorityFeeMicroLamports,
      }),
      message
    );
    message = prependTransactionMessageInstruction(
      getSetComputeUnitLimitInstruction({ units: estimatedComputeUnits }),
      message
    );
  }

  if (jitoTipLamports > 0) {
    message = prependTransactionMessageInstruction(
      getTransferSolInstruction({
        source: signer,
        destination: getJitoTipAddress(),
        amount: jitoTipLamports,
      }),
      message
    );
  }

  return message;
};

export const estimatePriorityFees = async (
  instructions: IInstruction[],
  rpcUrl: string,
  isTriton: boolean,
  feePayer: TransactionSigner,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<{
  priorityFeeMicroLamports: bigint;
  jitoTipLamports: bigint;
}> => {
  const rpc = connection(rpcUrl);
  const computeUnits = await getComputeUnitsForInstructions(
    rpc,
    instructions,
    feePayer
  );

  if (!computeUnits) throw new Error("Transaction simulation failed");

  let priorityFeeMicroLamports = BigInt(0);
  let jitoTipLamports = BigInt(0);

  const { priorityFee, jito, chainId } = transactionConfig;

  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports =
      (priorityFee.amountLamports * BigInt(1_000_000)) / BigInt(computeUnits);
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      instructions,
      rpcUrl,
      chainId === "solana" && isTriton
      // lookupTables todo
    );

    if (!priorityFee.maxCapLamports) {
      priorityFeeMicroLamports = estimatedPriorityFee;
    } else {
      const maxCapMicroLamports =
        (priorityFee.maxCapLamports * BigInt(1_000_000)) / BigInt(computeUnits);

      priorityFeeMicroLamports =
        maxCapMicroLamports > estimatedPriorityFee
          ? estimatedPriorityFee
          : maxCapMicroLamports;
    }
  }

  if (jito.type === "exact") {
    jitoTipLamports = jito.amountLamports;
  } else if (jito.type === "dynamic" && chainId === "solana") {
    jitoTipLamports = await recentJitoTip();
  }

  return {
    jitoTipLamports,
    priorityFeeMicroLamports,
  };
};
