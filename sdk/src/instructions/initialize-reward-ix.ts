import * as anchor from "@project-serum/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { InitializeRewardParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildInitializeRewardIx(
  context: WhirlpoolContext,
  params: InitializeRewardParams
): Instruction {
  const { rewardAuthority, funder, whirlpool, rewardMint, rewardVaultKeypair, rewardIndex } =
    params;

  const ix = context.program.instruction.initializeReward(rewardIndex, {
    accounts: {
      rewardAuthority,
      funder,
      whirlpool,
      rewardMint,
      rewardVault: rewardVaultKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [rewardVaultKeypair],
  };
}
