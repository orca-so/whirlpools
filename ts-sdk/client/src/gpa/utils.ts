import type {
  Account,
  Address,
  GetProgramAccountsApi,
  GetProgramAccountsMemcmpFilter,
  Rpc,
  VariableSizeDecoder,
} from "@solana/kit";
import { getBase64Encoder } from "@solana/kit";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

export async function fetchDecodedProgramAccounts<T extends object>(
  rpc: Rpc<GetProgramAccountsApi>,
  filters: GetProgramAccountsMemcmpFilter[],
  decoder: VariableSizeDecoder<T>,
  programAddress: Address = DEFAULT_WHIRLPOOL_DEPLOYMENT.programId,
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
