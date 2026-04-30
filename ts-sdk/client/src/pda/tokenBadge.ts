import type { Address, ProgramDerivedAddress } from "@solana/kit";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { getWhirlpoolProgramAddress } from "../program";

export async function getTokenBadgeAddress(
  whirlpoolsConfig: Address,
  tokenMint: Address,
): Promise<ProgramDerivedAddress> {
  return await getProgramDerivedAddress({
    programAddress: getWhirlpoolProgramAddress(),
    seeds: [
      "token_badge",
      getAddressEncoder().encode(whirlpoolsConfig),
      getAddressEncoder().encode(tokenMint),
    ],
  });
}
