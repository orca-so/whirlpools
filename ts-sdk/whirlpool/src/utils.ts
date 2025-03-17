import {
  fetchEncodedAccounts,
  type Address,
  type GetMultipleAccountsApi,
  type MaybeAccount,
  type MaybeEncodedAccount,
  type Rpc,
} from "@solana/kit";

const MAX_CHUNK_SIZE = 100;

export async function fetchMultipleAccountsBatched<T extends object>(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  decoder: (account: MaybeEncodedAccount) => MaybeAccount<T>,
): Promise<MaybeAccount<T>[]> {
  const numChunks = Math.ceil(addresses.length / MAX_CHUNK_SIZE);
  const chunks = [...Array(numChunks).keys()].map((i) =>
    addresses.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
  );

  const results: MaybeAccount<T>[] = [];
  for (const chunk of chunks) {
    const chunkResult = await fetchEncodedAccounts(rpc, chunk);
    chunkResult.forEach((account, i) => {
      const data = decoder(account);
      results.push(data);
    });
  }
  return results;
}
