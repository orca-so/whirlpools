import { address } from "@solana/web3.js";
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { DEFAULT_ADDRESS } from "../../src/config";

export default {
  address: address("DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe"),
  data: getMintEncoder().encode({
    mintAuthority: DEFAULT_ADDRESS,
    supply: 1000000000,
    decimals: 6,
    isInitialized: true,
    freezeAuthority: null,
  }),
  owner: TOKEN_PROGRAM_ADDRESS,
};
