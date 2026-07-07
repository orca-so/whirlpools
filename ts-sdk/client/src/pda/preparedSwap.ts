import type { ProgramDerivedAddress } from "@solana/kit";
import { getProgramDerivedAddress, getU16Encoder } from "@solana/kit";
import type { WhirlpoolDeployment } from "../config";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the prepared swap PDA for the given nonce under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getPreparedSwapAddress(
  nonce: number,
  whirlpoolDeployment: WhirlpoolDeployment = DEFAULT_WHIRLPOOL_DEPLOYMENT,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: whirlpoolDeployment.programId,
    seeds: ["prepared_swap", getU16Encoder().encode(nonce)],
  });
}
