import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the lock config PDA for the given position under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getLockConfigAddress(
  position: Address,
  programAddress: Address = DEFAULT_WHIRLPOOL_DEPLOYMENT.programId,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress,
    seeds: ["lock_config", getAddressEncoder().encode(position)],
  });
}
