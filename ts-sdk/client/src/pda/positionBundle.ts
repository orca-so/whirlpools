import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the position bundle PDA for the given position mint under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getPositionBundleAddress(
  positionBundleMint: Address,
  programAddress: Address = DEFAULT_WHIRLPOOL_DEPLOYMENT.programId,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress,
    seeds: ["position_bundle", getAddressEncoder().encode(positionBundleMint)],
  });
}

/**
 * Derives the bundled position PDA for the given position bundle address and bundle index
 * under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getBundledPositionAddress(
  positionBundleAddress: Address,
  bundleIndex: number,
  programAddress: Address = DEFAULT_WHIRLPOOL_DEPLOYMENT.programId,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress,
    seeds: [
      "bundled_position",
      getAddressEncoder().encode(positionBundleAddress),
      Buffer.from(bundleIndex.toString()),
    ],
  });
}
