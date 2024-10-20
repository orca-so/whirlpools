import type { Address, ProgramDerivedAddress } from "@solana/web3.js";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/web3.js";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "../generated/programs/whirlpool";

export async function getTickArrayAddress(
  whirlpool: Address,
  startTickIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
    seeds: [
      "tick_array",
      getAddressEncoder().encode(whirlpool),
      `${startTickIndex}`,
    ],
  });
}
