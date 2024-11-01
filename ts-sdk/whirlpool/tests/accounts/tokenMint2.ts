import { address } from "@solana/web3.js";
import { getMintEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { DEFAULT_ADDRESS } from "../../src/config";

export default {
  address: address("GJQUFGWZqK8nEzJEEiRMaAJH1EWzZLou5KvwCkyw7AuS"),
  data: getMintEncoder().encode({
    mintAuthority: DEFAULT_ADDRESS,
    supply: 1000000000,
    decimals: 9,
    isInitialized: true,
    freezeAuthority: null,
  }),
  owner: TOKEN_PROGRAM_ADDRESS,
};
