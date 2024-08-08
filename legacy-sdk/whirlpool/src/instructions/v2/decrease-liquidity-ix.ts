import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";
import { DecreaseLiquidityInput, MEMO_PROGRAM_ADDRESS } from "../..";
import { RemainingAccountsBuilder, RemainingAccountsType } from "../../utils/remaining-accounts-util";

/**
 * Parameters to remove liquidity from a position.
 *
 * @category Instruction Types
 * @param liquidityAmount - The total amount of Liquidity the user is withdrawing
 * @param tokenMinA - The minimum amount of token A to remove from the position.
 * @param tokenMinB - The minimum amount of token B to remove from the position.
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
 * @param tickArrayLower - PublicKey for the tick-array account that hosts the tick at the lower tick index.
 * @param tickArrayUpper - PublicKey for the tick-array account that hosts the tick at the upper tick index.
 */
export type DecreaseLiquidityV2Params = {
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
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
} & DecreaseLiquidityInput;

/**
 * Remove liquidity to a position in the Whirlpool.
 *
 * #### Special Errors
 * - `LiquidityZero` - Provided liquidity amount is zero.
 * - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
 * - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - DecreaseLiquidityV2Params object
 * @returns - Instruction to perform the action.
 */
export function decreaseLiquidityV2Ix(
  program: Program<Whirlpool>,
  params: DecreaseLiquidityV2Params
): Instruction {
  const {
    liquidityAmount,
    tokenMinA,
    tokenMinB,
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
    tickArrayLower,
    tickArrayUpper,
  } = params;

  const [remainingAccountsInfo, remainingAccounts] = new RemainingAccountsBuilder()
    .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
    .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
    .build();

  const ix = program.instruction.decreaseLiquidityV2(liquidityAmount, tokenMinA, tokenMinB, remainingAccountsInfo, {
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
      tickArrayLower,
      tickArrayUpper,
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
