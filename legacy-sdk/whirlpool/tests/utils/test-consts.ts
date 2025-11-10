import * as anchor from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

export const TEST_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  TOKEN_PROGRAM_ID.toString(),
);
export const TEST_TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey(
  TOKEN_2022_PROGRAM_ID.toString(),
);

// sdk/tests/external_program/transfer_hook_counter.so
export const TEST_TRANSFER_HOOK_PROGRAM_ID = new anchor.web3.PublicKey(
  "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS",
);

export const ZERO_BN = new anchor.BN(0);

export const ONE_SOL = 1000000000;

export const MAX_U64 = new BN(
  new anchor.BN(2).pow(new anchor.BN(64)).sub(new anchor.BN(1)).toString(),
);

export const MAX_U128 = new BN(
  new anchor.BN(2).pow(new anchor.BN(128)).sub(new anchor.BN(1)).toString(),
);
