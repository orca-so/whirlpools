import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { getWhirlpoolProgramAddress } from "../program";

export async function getPositionAddress(
  positionMint: Address,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: ["position", getAddressEncoder().encode(positionMint)],
  });
}
