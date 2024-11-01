import { getMintEncoder, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022"
import { address } from "@solana/web3.js";
import { DEFAULT_ADDRESS } from "../../src/config";

export default {
  address: address("Aq1b8Ggz8qXQxUZAGnPPWmDQGzGvmMBVB9x8ZJVPUJgx"),
  data: getMintEncoder().encode({
    mintAuthority: DEFAULT_ADDRESS,
    supply: 1000000000,
    decimals: 9,
    isInitialized: true,
    freezeAuthority: null,
    extensions: null, // TODO: add transfer fee
  }),
  owner: TOKEN_2022_PROGRAM_ADDRESS,
};
