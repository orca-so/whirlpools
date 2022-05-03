import { utils } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { PDA } from "../types/public/helper-types";

export function findProgramAddress(seeds: (Uint8Array | Buffer)[], programId: PublicKey): PDA {
  const [publicKey, bump] = utils.publicKey.findProgramAddressSync(seeds, programId);
  return { publicKey, bump };
}
