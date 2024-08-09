import { Account, Address, getBase64Encoder, GetProgramAccountsApi, GetProgramAccountsMemcmpFilter, Rpc, VariableSizeDecoder } from "@solana/web3.js";

export async function fetchDecodedProgramAccount<T extends object>(
  rpc: Rpc<GetProgramAccountsApi>,
  programAddress: Address,
  filters: GetProgramAccountsMemcmpFilter[],
  decoder: VariableSizeDecoder<T>,
): Promise<Account<T>[]> {
  const accountInfos = await rpc.getProgramAccounts(programAddress, {
    encoding: "base64",
    filters,
  }).send();
  const encoder = getBase64Encoder();
  const datas = accountInfos.map(x => encoder.encode(x.account.data[0]));
  const decoded = datas.map(x => decoder.decode(x));
  return decoded.map((data, i) => ({
    ...accountInfos[i].account,
    address: accountInfos[i].pubkey,
    programAddress: programAddress,
    data,
  }));
}
