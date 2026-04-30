import type { Address, ProgramDerivedAddress } from "@solana/kit";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
} from "@solana/kit";
import { getWhirlpoolProgramAddress } from "../program";

export async function getFeeTierAddress(
  whirlpoolsConfig: Address,
  feeTierIndex: number,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: [
      "fee_tier",
      getAddressEncoder().encode(whirlpoolsConfig),
      getU16Encoder().encode(feeTierIndex),
    ],
  });
}
