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
  Address,
  compressTransactionMessageUsingAddressLookupTables,
  assertAccountDecoded,
  assertAccountExists,
  fetchJsonParsedAccounts,
} from "@solana/web3.js";
import {
  connection,
  generateTransactionMessage,
  getComputeUnitsForTxMessage,
} from "./utils";
import { ConnectionContext, LookupTableData, TransactionConfig } from "./types";
// TODO create flow for ui signing
// import {
//   useWalletAccountMessageSigner,
//   useSignAndSendTransaction,
// } from "@solana/react";

import { getJitoTipAddress, recentJitoTip } from "./jito";
import { calculateDynamicPriorityFees } from "./priority";
import { DEFAULT_PRIORITIZATION, getConnectionContext } from "./config";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";

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
  connectionContext: ConnectionContext,
  lookupTableAddresses?: Address[]
): Promise<CompilableTransactionMessage> => {
  const { rpcUrl, isTriton } = connectionContext;
  const rpc = connection(rpcUrl);
  const { value: recentBlockhash } = await rpc
    .getLatestBlockhash({
      commitment: "confirmed",
    })
    .send();

  let message = await generateTransactionMessage(
    instructions,
    recentBlockhash,
    signer
  );

  if (lookupTableAddresses) {
    const lookupTableAccounts = await fetchJsonParsedAccounts<
      LookupTableData[]
    >(rpc, lookupTableAddresses);
    const tables = lookupTableAccounts.reduce(
      (prev, account) => {
        assertAccountDecoded(account);
        assertAccountExists(account);
        prev[account.address] = account.data.addresses;
        return prev;
      },
      {} as { [address: Address]: Address[] }
    );
    message = compressTransactionMessageUsingAddressLookupTables(
      message,
      tables
    );
  }

  const { priorityFeeMicroLamports, jitoTipLamports, computeUnits } =
    await estimatePriorityFees(message, rpcUrl, isTriton, transactionConfig);

  if (priorityFeeMicroLamports > 0) {
    message = prependTransactionMessageInstruction(
      getSetComputeUnitPriceInstruction({
        microLamports: priorityFeeMicroLamports,
      }),
      message
    );
    message = prependTransactionMessageInstruction(
      getSetComputeUnitLimitInstruction({ units: computeUnits }),
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
  txMessage: CompilableTransactionMessage,
  rpcUrl: string,
  isTriton: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<{
  priorityFeeMicroLamports: bigint;
  jitoTipLamports: bigint;
  computeUnits: number;
}> => {
  const rpc = connection(rpcUrl);
  const computeUnits = await getComputeUnitsForTxMessage(rpc, txMessage);

  if (!computeUnits) throw new Error("Transaction simulation failed");

  let priorityFeeMicroLamports = BigInt(0);
  let jitoTipLamports = BigInt(0);

  const { priorityFee, jito, chainId } = transactionConfig;

  if (priorityFee.type === "exact") {
    priorityFeeMicroLamports =
      (priorityFee.amountLamports * BigInt(1_000_000)) / BigInt(computeUnits);
  } else if (priorityFee.type === "dynamic") {
    const estimatedPriorityFee = await calculateDynamicPriorityFees(
      txMessage.instructions,
      rpcUrl,
      chainId === "solana" && isTriton
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
    computeUnits,
  };
};
