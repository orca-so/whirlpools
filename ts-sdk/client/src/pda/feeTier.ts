import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/kit";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getFeeTierAddress(
  whirlpoolsConfig: Address,
  feeTierIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: [
      "fee_tier",
      getAddressEncoder().encode(whirlpoolsConfig),
      getU16Encoder().encode(feeTierIndex),
    ],
  });
}
