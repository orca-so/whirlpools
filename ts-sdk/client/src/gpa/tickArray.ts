import { Account, Address, GetProgramAccountsApi, GetProgramAccountsMemcmpFilter, Rpc, getAddressEncoder, getBase58Decoder, getI32Encoder } from "@solana/web3.js";
import { TickArray, TICK_ARRAY_DISCRIMINATOR, getTickArrayDecoder } from "../generated/accounts/tickArray";
import { fetchDecodedProgramAccount } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export type TickArrayFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
}

export function tickArrayStartTickIndexFilter(startTickIndex: number): TickArrayFilter {
  return {
    memcmp: {
      offset: 8n,
      bytes: getBase58Decoder().decode(getI32Encoder().encode(startTickIndex)),
      encoding: "base58"
    }
  } as TickArrayFilter;
}

export function tickArrayWhirlpoolFilter(address: Address): TickArrayFilter {
  return {
    memcmp: {
      offset: 9956n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)),
      encoding: "base58"
    }
  } as TickArrayFilter;
}

export async function fetchAllTickArrayWithFilter(rpc: Rpc<GetProgramAccountsApi>, ...filters: TickArrayFilter[]): Promise<Account<TickArray>[]> {
  const discriminator = getBase58Decoder().decode(TICK_ARRAY_DISCRIMINATOR);
  const discriminatorFilter: GetProgramAccountsMemcmpFilter = {
    memcmp: {
      offset: 0n,
      bytes: discriminator,
      encoding: "base58"
    }
  };
  return fetchDecodedProgramAccount(
    rpc,
    WHIRLPOOL_PROGRAM_ADDRESS,
    [discriminatorFilter, ...filters],
    getTickArrayDecoder()
  );
}
