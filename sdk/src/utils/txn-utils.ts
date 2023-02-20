import { TransactionBuilder } from "@orca-so/common-sdk";
import { WhirlpoolContext } from "..";

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

export async function checkMergedTransactionSizeIsValid(
  ctx: WhirlpoolContext,
  builders: TransactionBuilder[],
  latestBlockhash: Readonly<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>
): Promise<boolean> {
  const merged = new TransactionBuilder(ctx.connection, ctx.wallet);
  builders.forEach((builder) => merged.addInstruction(builder.compressIx(true)));

  try {
    const size = await merged.txnSize({ latestBlockhash }); // throws if txnSize is too large
    return true;
  } catch (e) {
    return false;
  }
}
