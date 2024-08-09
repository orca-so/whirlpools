import { GetProgramAccountsMemcmpFilter, getBase58Decoder, getAddressEncoder, getI32Encoder, Account, GetProgramAccountsApi, Rpc, Address } from "@solana/web3.js";
import { POSITION_DISCRIMINATOR, Position, getPositionDecoder } from "../generated/accounts/position";
import { fetchDecodedProgramAccount } from "./utils";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

type PositionFilter = GetProgramAccountsMemcmpFilter & {
  readonly __kind: unique symbol;
}

export function positionWhirlpoolFilter(address: Address): PositionFilter {
  return {
    memcmp: {
      offset: 8n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)), encoding: "base58"
    }
  } as PositionFilter;
}

export function positionMintFilter(address: Address): PositionFilter {
  return {
    memcmp: {
      offset: 40n, bytes: getBase58Decoder().decode(getAddressEncoder().encode(address)), encoding: "base58"
    }
  } as PositionFilter;
}

export function positionTickLowerIndexFilter(tickLowerIndex: number): PositionFilter {
  return {
    memcmp: {
      offset: 88n, bytes: getBase58Decoder().decode(getI32Encoder().encode(tickLowerIndex)), encoding: "base58"
    }
  } as PositionFilter;
}

export function positionTickUpperIndexFilter(tickUpperIndex: number): PositionFilter {
  return {
    memcmp: {
      offset: 92n, bytes: getBase58Decoder().decode(getI32Encoder().encode(tickUpperIndex)), encoding: "base58"
    }
  } as PositionFilter;
}

export async function fetchAllPositionWithFilter(rpc: Rpc<GetProgramAccountsApi>, ...filters: PositionFilter[]): Promise<Account<Position>[]> {
  const discriminator = getBase58Decoder().decode(POSITION_DISCRIMINATOR);
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
    getPositionDecoder()
  );
}
