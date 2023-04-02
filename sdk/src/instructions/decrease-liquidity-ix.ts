import { BN, Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";

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
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tickArrayLower - PublicKey for the tick-array account that hosts the tick at the lower tick index.
 * @param tickArrayUpper - PublicKey for the tick-array account that hosts the tick at the upper tick index.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 */
export type DecreaseLiquidityParams = {
  whirlpool: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
  positionAuthority: PublicKey;
} & DecreaseLiquidityInput;

/**
 * @category Instruction Types
 */
export type DecreaseLiquidityInput = {
  tokenMinA: BN;
  tokenMinB: BN;
  liquidityAmount: BN;
};

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
 * @param params - DecreaseLiquidityParams object
 * @returns - Instruction to perform the action.
 */
export function decreaseLiquidityIx(
  program: Program<Whirlpool>,
  params: DecreaseLiquidityParams
): Instruction {
  const {
    liquidityAmount,
    tokenMinA,
    tokenMinB,
    whirlpool,
    positionAuthority,
    position,
    positionTokenAccount,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
    tickArrayLower,
    tickArrayUpper,
  } = params;

  const ix = program.instruction.decreaseLiquidity(liquidityAmount, tokenMinA, tokenMinB, {
    accounts: {
      whirlpool,
      tokenProgram: TOKEN_PROGRAM_ID,
      positionAuthority,
      position,
      positionTokenAccount,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA,
      tokenVaultB,
      tickArrayLower,
      tickArrayUpper,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
