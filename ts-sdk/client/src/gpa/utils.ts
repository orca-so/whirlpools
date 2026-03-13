import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
  VariableSizeDecoder,
} from "@solana/kit";
import { getBase64Encoder } from "@solana/kit";

export async function fetchDecodedProgramAccounts<T extends object>(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  filters: GetProgramAccountsMemcmpFilter[],
  decoder: VariableSizeDecoder<T>,
): Promise<Account<T>[]> {
  const accountInfos = await rpc
    .getProgramAccounts(programAddress, {
      encoding: "base64",
      filters,
    })
    .send();
  const encoder = getBase64Encoder();
  return accountInfos.map((accountInfo) => {
    const [base64Data, _encoding] = accountInfo.account.data;
    return {
      ...accountInfo.account,
      address: accountInfo.pubkey,
      programAddress,
      data: decoder.decode(encoder.encode(base64Data)),
    };
  });
}
