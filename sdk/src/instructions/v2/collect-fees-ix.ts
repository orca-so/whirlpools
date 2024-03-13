import { Program } from "@coral-xyz/anchor";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";
import { MEMO_PROGRAM_ADDRESS } from "../..";

import { Instruction } from "@orca-so/common-sdk";
import { RemainingAccountsBuilder, RemainingAccountsType } from "../../utils/remaining-accounts-util";

/**
 * Parameters to collect fees from a position.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 * @param tokenMintA - PublicKey for the token A mint.
 * @param tokenMintB - PublicKey for the token B mint.
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tokenTransferHookAccountsA - Optional array of token transfer hook accounts for token A.
 * @param tokenTransferHookAccountsB - Optional array of token transfer hook accounts for token B.
 * @param tokenProgramA - PublicKey for the token program for token A.
 * @param tokenProgramB - PublicKey for the token program for token B.
 */
export type CollectFeesV2Params = {
  whirlpool: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  positionAuthority: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenTransferHookAccountsA?: AccountMeta[];
  tokenTransferHookAccountsB?: AccountMeta[];
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
};

/**
 * Collect fees accrued for this position.
 * Call updateFeesAndRewards before this to update the position to the newest accrued values.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectFeesV2Params object
 * @returns - Instruction to perform the action.
 */
export function collectFeesV2Ix(program: Program<Whirlpool>, params: CollectFeesV2Params): Instruction {
  const {
    whirlpool,
    positionAuthority,
    position,
    positionTokenAccount,
    tokenMintA,
    tokenMintB,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
    tokenTransferHookAccountsA,
    tokenTransferHookAccountsB,
    tokenProgramA,
    tokenProgramB,
  } = params;

  const [remainingAccountsInfo, remainingAccounts] = new RemainingAccountsBuilder()
    .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
    .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
    .build();

  const ix = program.instruction.collectFeesV2(remainingAccountsInfo, {
    accounts: {
      whirlpool,
      positionAuthority,
      position,
      positionTokenAccount,
      tokenMintA,
      tokenMintB,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA,
      tokenVaultB,
      tokenProgramA,
      tokenProgramB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
    },
    remainingAccounts,
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
