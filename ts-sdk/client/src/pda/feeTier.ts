import type { ProgramDerivedAddress } from "@solana/kit";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/kit";
import type { WhirlpoolDeployment } from "../config";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the fee tier PDA for the given fee tier index under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getFeeTierAddress(
  feeTierIndex: number,
  whirlpoolDeployment: WhirlpoolDeployment = DEFAULT_WHIRLPOOL_DEPLOYMENT,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: whirlpoolDeployment.programId,
    seeds: [
      "fee_tier",
      getAddressEncoder().encode(whirlpoolDeployment.configAddress),
      getU16Encoder().encode(feeTierIndex),
    ],
  });
}
