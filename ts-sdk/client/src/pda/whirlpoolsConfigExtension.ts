import type { ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { WhirlpoolDeployment } from "../config";

/** Derives the whirlpool config extension PDA under the supplied whirlpool deployment. */
export async function getWhirlpoolsConfigExtensionAddress(
  whirlpoolDeployment: WhirlpoolDeployment,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: whirlpoolDeployment.programId,
    seeds: [
      "config_extension",
      getAddressEncoder().encode(whirlpoolDeployment.configAddress),
    ],
  });
}
