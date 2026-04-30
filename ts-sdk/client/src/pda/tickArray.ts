import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { getWhirlpoolProgramAddress } from "../program";

export async function getTickArrayAddress(
  whirlpool: Address,
  startTickIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: [
      "tick_array",
      getAddressEncoder().encode(whirlpool),
      `${startTickIndex}`,
    ],
  });
}
