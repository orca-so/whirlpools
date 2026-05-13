import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { WhirlpoolDeployment } from "../config";
import { DEFAULT_WHIRLPOOL_DEPLOYMENT } from "../config";

/**
 * Derives the token badge PDA for the given mint under the supplied whirlpool deployment.
 *
 * Uses {@link DEFAULT_WHIRLPOOL_DEPLOYMENT} when `whirlpoolDeployment` is omitted.
 */
export async function getTokenBadgeAddress(
  tokenMint: Address,
  whirlpoolDeployment: WhirlpoolDeployment = DEFAULT_WHIRLPOOL_DEPLOYMENT,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: whirlpoolDeployment.programId,
    seeds: [
      "token_badge",
      getAddressEncoder().encode(whirlpoolDeployment.configAddress),
      getAddressEncoder().encode(tokenMint),
    ],
  });
}
