import type {
  CompilableTransactionMessage,
  IInstruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
  IAccountLookupMeta,
  IAccountMeta,
  ITransactionMessageWithFeePayerSigner,
  TransactionMessageWithBlockhashLifetime,
  TransactionVersion,
} from "@solana/kit";
import { getComputeUnitEstimateForTransactionMessageFactory } from "@solana/kit";
import { getJitoConfig, getRpcConfig } from "./config";
import { rpcFromUrl } from "./compatibility";
import { processJitoTipForTxMessage } from "./jito";
import { processComputeBudgetForTxMessage } from "./computeBudget";

export type TxMessage = ITransactionMessageWithFeePayerSigner<
  string,
  TransactionSigner<string>
> &
  Omit<
    TransactionMessageWithBlockhashLifetime &
      Readonly<{
        instructions: readonly IInstruction<
          string,
          readonly (IAccountLookupMeta<string, string> | IAccountMeta<string>)[]
        >[];
        version: TransactionVersion;
      }>,
    "feePayer"
  >;

export async function addPriorityInstructions(
  message: TxMessage,

  signer: TransactionSigner,
) {
  const { rpcUrl, chainId } = getRpcConfig();
  const jito = getJitoConfig();
  const rpc = rpcFromUrl(rpcUrl);

  if (jito.type !== "none") {
    message = await processJitoTipForTxMessage(message, signer, jito, chainId);
  }
  let computeUnits = await getComputeUnitsForTxMessage(rpc, message);

  return processComputeBudgetForTxMessage(message, computeUnits);
}

async function getComputeUnitsForTxMessage(
  rpc: Rpc<SolanaRpcApi>,
  txMessage: CompilableTransactionMessage,
) {
  const estimator = getComputeUnitEstimateForTransactionMessageFactory({
    rpc,
  });

  try {
    const estimate = await estimator(txMessage);
    return estimate;
  } catch {
    console.warn(
      "Transaction simulation failed, using 1,400,000 compute units",
    );
    return 1_400_000;
  }
}
