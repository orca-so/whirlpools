import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/kit";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getWhirlpoolAddress(
  whirlpoolsConfig: Address,
  tokenMintA: Address,
  tokenMintB: Address,
  feeTierIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: [
      "whirlpool",
      getAddressEncoder().encode(whirlpoolsConfig),
      getAddressEncoder().encode(tokenMintA),
      getAddressEncoder().encode(tokenMintB),
      getU16Encoder().encode(feeTierIndex),
    ],
  });
}
