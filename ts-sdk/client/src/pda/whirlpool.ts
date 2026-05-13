import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/kit";
import type { WhirlpoolDeployment } from "../config";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the whirlpool PDA for the given mint pair and fee tier index under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getWhirlpoolAddress(
  tokenMintA: Address,
  tokenMintB: Address,
  feeTierIndex: number,
  whirlpoolDeployment: WhirlpoolDeployment = DEFAULT_WHIRLPOOL_DEPLOYMENT,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: whirlpoolDeployment.programId,
    seeds: [
      "whirlpool",
      getAddressEncoder().encode(whirlpoolDeployment.configAddress),
      getAddressEncoder().encode(tokenMintA),
      getAddressEncoder().encode(tokenMintB),
      getU16Encoder().encode(feeTierIndex),
    ],
  });
}
