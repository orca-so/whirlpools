import { address } from "@solana/web3.js";
import { getMintEncoder, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";

export default {
  address: address("8Hm8mF7ZQaWmHXAkwovfFRYnTJYM4MqFZJqQVNEF6ydE"),
  data: getMintEncoder().encode({
    mintAuthority: null,
    supply: 1000000000,
    decimals: 9,
    isInitialized: true,
    freezeAuthority: null,
    extensions: null,
  }),
  owner: TOKEN_2022_PROGRAM_ADDRESS,
};
