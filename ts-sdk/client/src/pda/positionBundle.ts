import type { Address, ProgramDerivedAddress } from "@solana/web3.js";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/web3.js";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getPositionBundleAddress(
  positionMint: Address,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: ["position", getAddressEncoder().encode(positionMint)],
  });
}
