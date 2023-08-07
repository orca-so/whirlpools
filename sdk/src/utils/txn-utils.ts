import {
  TransactionBuilder,
  TransactionBuilderOptions,
  defaultTransactionBuilderOptions,
} from "@orca-so/common-sdk";
import { WhirlpoolContext, WhirlpoolContextOpts as WhirlpoolContextOptions } from "..";

export function convertListToMap<T>(fetchedData: T[], addresses: string[]): Record<string, T> {
  const result: Record<string, T> = {};
  fetchedData.forEach((data, index) => {
    if (data) {
      const addr = addresses[index];
      result[addr] = data;
    }
  });
  return result;
}

// Filter out null objects in the first array and remove the corresponding objects in the second array
export function filterNullObjects<T, K>(
  firstArray: ReadonlyArray<T | null>,
  secondArray: ReadonlyArray<K>
): [Array<T>, Array<K>] {
  const filteredFirstArray: Array<T> = [];
  const filteredSecondArray: Array<K> = [];

  firstArray.forEach((item, idx) => {
    if (item !== null) {
      filteredFirstArray.push(item);
      filteredSecondArray.push(secondArray[idx]);
    }
  });

  return [filteredFirstArray, filteredSecondArray];
}

export async function checkMergedTransactionSizeIsValid(
  ctx: WhirlpoolContext,
  builders: TransactionBuilder[],
  latestBlockhash: Readonly<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>
): Promise<boolean> {
  const merged = new TransactionBuilder(ctx.connection, ctx.wallet, ctx.txBuilderOpts);
  builders.forEach((builder) => merged.addInstruction(builder.compressIx(true)));
  try {
    const size = await merged.txnSize({
      latestBlockhash,
    });
    return true;
  } catch (e) {
    return false;
  }
}

export function contextOptionsToBuilderOptions(
  opts: WhirlpoolContextOptions
): TransactionBuilderOptions | undefined {
  return {
    defaultBuildOption: {
      ...defaultTransactionBuilderOptions.defaultBuildOption,
      ...opts.userDefaultBuildOptions,
    },
    defaultSendOption: {
      ...defaultTransactionBuilderOptions.defaultSendOption,
      ...opts.userDefaultSendOptions,
    },
    defaultConfirmationCommitment:
      opts.userDefaultConfirmCommitment ??
      defaultTransactionBuilderOptions.defaultConfirmationCommitment,
  };
}
