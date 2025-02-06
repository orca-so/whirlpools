import {
  IInstruction,
  TransactionSigner,
  prependTransactionMessageInstruction,
  CompilableTransactionMessage,
  Address,
  compressTransactionMessageUsingAddressLookupTables,
  assertAccountDecoded,
  assertAccountExists,
  fetchJsonParsedAccounts,
  appendTransactionMessageInstructions,
  Blockhash,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/web3.js";
import {
  createFeePayerSigner,
  normalizeAddresses,
  normalizeInstructions,
  PublicKey,
  rpcFromUrl,
} from "./compatibility";
import { getJitoTipAddress } from "./jito";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { estimatePriorityFees } from "./priorityFees";
import {
  DEFAULT_PRIORITIZATION,
  getPriorityConfig,
  getConnectionContext,
  ConnectionContext,
  TransactionConfig,
} from "./config";
import { TransactionInstruction } from "./legacy";

async function buildTransaction(
  instructions: (IInstruction | TransactionInstruction)[],
  feePayer: Address | PublicKey,
  lookupTableAddresses?: (Address | PublicKey)[],
  rpcUrl?: string,
  isTriton?: boolean,
  transactionConfig: TransactionConfig = DEFAULT_PRIORITIZATION
): Promise<CompilableTransactionMessage> {
  return buildTransactionMessage(
    normalizeInstructions(instructions),
    createFeePayerSigner(feePayer),
    getPriorityConfig(transactionConfig),
    getConnectionContext(rpcUrl, isTriton),
    normalizeAddresses(lookupTableAddresses)
  );
}

async function buildTransactionMessage(
  instructions: IInstruction[],
  signer: TransactionSigner,
  transactionConfig: TransactionConfig,
  connectionContext: ConnectionContext,
  lookupTableAddresses?: Address[]
): Promise<CompilableTransactionMessage> {
  const { rpcUrl, isTriton } = connectionContext;
  const rpc = rpcFromUrl(rpcUrl);
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
}

function generateTransactionMessage(
  instructions: IInstruction[],
  blockhash: {
    blockhash: Blockhash;
    lastValidBlockHeight: bigint;
  },
  signer: TransactionSigner
) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  );
}

type LookupTableData = {
  addresses: Address[];
};

export { buildTransaction };
