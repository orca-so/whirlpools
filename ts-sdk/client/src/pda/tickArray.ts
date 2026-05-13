import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the tick array PDA for the given whirlpool and start tick index under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getTickArrayAddress(
  whirlpool: Address,
  startTickIndex: number,
  programAddress: Address = DEFAULT_WHIRLPOOL_DEPLOYMENT.programId,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress,
    seeds: [
      "tick_array",
      getAddressEncoder().encode(whirlpool),
      `${startTickIndex}`,
    ],
  });
}
