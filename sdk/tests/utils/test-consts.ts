import { TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import * as anchor from "@project-serum/anchor";

export const TEST_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(TOKEN_PROGRAM_ID.toString());

export const ZERO_BN = new anchor.BN(0);

export const ONE_SOL = 1000000000;

export const MAX_U64 = new u64(new anchor.BN(2).pow(new anchor.BN(64)).sub(new anchor.BN(1)).toString());
