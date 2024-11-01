import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { NATIVE_MINT } from "../../src/token";

export default {
  address: NATIVE_MINT,
  data: getMintEncoder().encode({
    mintAuthority: null,
    supply: 1000000000,
    decimals: 9,
    isInitialized: true,
    freezeAuthority: null,
  }),
  owner: TOKEN_PROGRAM_ADDRESS,
};
