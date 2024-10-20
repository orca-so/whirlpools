import type { Address, ProgramDerivedAddress } from "@solana/web3.js";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/web3.js";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getPositionBundleAddress(
  positionBundleMint: Address,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: ["position_bundle", getAddressEncoder().encode(positionBundleMint)],
  });
}

export async function getBundledPositionAddress(
  positionBundleAddress: Address,
  bundleIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: [
      "bundled_position",
      getAddressEncoder().encode(positionBundleAddress),
      Buffer.from(bundleIndex.toString()),
    ],
  });
}
