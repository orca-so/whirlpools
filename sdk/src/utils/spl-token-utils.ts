import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export function isNativeMint(mint: PublicKey) {
  return mint.equals(NATIVE_MINT);
}

// TODO: Update spl-token so we get this method
export function getAssociatedTokenAddressSync(
  mint: string,
  owner: string,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), programId.toBuffer(), new PublicKey(mint).toBuffer()],
    associatedTokenProgramId
  );

  return address;
}
