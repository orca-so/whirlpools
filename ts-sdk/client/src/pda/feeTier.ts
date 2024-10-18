import type { Address, ProgramDerivedAddress } from "@solana/web3.js";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/web3.js";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getFeeTierAddress(
  whirlpoolsConfig: Address,
  tickSpacing: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: [
      "fee_tier",
      getAddressEncoder().encode(whirlpoolsConfig),
      getU16Encoder().encode(tickSpacing),
    ],
  });
}
