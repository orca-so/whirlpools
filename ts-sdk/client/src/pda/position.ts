import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the position PDA for the given position mint under the supplied target program.
 *
 * Uses the mutable Whirlpool program ("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc") when `programAddress` is omitted.
 */
export async function getPositionAddress(
  positionMint: Address,
  programAddress: Address = DEFAULT_WHIRLPOOL_DEPLOYMENT.programId,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress,
    seeds: ["position", getAddressEncoder().encode(positionMint)],
  });
}
