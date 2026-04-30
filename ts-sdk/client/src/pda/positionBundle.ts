import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { getWhirlpoolProgramAddress } from "../program";

export async function getPositionBundleAddress(
  positionBundleMint: Address,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: ["position_bundle", getAddressEncoder().encode(positionBundleMint)],
  });
}

export async function getBundledPositionAddress(
  positionBundleAddress: Address,
  bundleIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: [
      "bundled_position",
      getAddressEncoder().encode(positionBundleAddress),
      Buffer.from(bundleIndex.toString()),
    ],
  });
}
