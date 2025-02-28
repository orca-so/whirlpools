import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getWhirlpoolsConfigExtensionAddress(
  configAddress: Address,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: ["config_extension", getAddressEncoder().encode(configAddress)],
  });
}
