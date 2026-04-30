import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/kit";
import { getWhirlpoolProgramAddress } from "../program";

export async function getWhirlpoolAddress(
  whirlpoolsConfig: Address,
  tokenMintA: Address,
  tokenMintB: Address,
  feeTierIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: [
      "whirlpool",
      getAddressEncoder().encode(whirlpoolsConfig),
      getAddressEncoder().encode(tokenMintA),
      getAddressEncoder().encode(tokenMintB),
      getU16Encoder().encode(feeTierIndex),
    ],
  });
}
