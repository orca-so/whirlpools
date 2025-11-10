import type { Program } from "@coral-xyz/anchor";
import type { AccountMeta, PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";
import type BN from "bn.js";
import { MEMO_PROGRAM_ADDRESS } from "../..";

import type { Instruction } from "@orca-so/common-sdk";
import {
  RemainingAccountsBuilder,
  RemainingAccountsType,
} from "../../utils/remaining-accounts-util";

/**
 * Parameters to increase liquidity for a position by token amounts.
 *
 * @category Instruction Types
 * @param tokenMaxA - The maximum amount of token A to add to the position.
 * @param tokenMaxB - The maximum amount of token B to add to the position.
 * @param minSqrtPrice - the minimum sqrt price allowed.
 * @param maxSqrtPrice - the maximum sqrt price allowed.
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tokenTransferHookAccountsA - Optional array of token transfer hook accounts for token A.
 * @param tokenTransferHookAccountsB - Optional array of token transfer hook accounts for token B.
 * @param tickArrayLower - PublicKey for the tick-array account that hosts the tick at the lower tick index.
 * @param tickArrayUpper - PublicKey for the tick-array account that hosts the tick at the upper tick index.
 */
export type IncreaseLiquidityByTokenAmountsV2Params = {
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
} & IncreaseLiquidityInput;

/**
 * Type union of all possible methods to increase liquidity (that support the method param).
 */
type IncreaseLiquidityInput = ByTokenAmountsParams;

export type IncreaseLiquidityMethod = {
  byTokenAmounts: ByTokenAmountsParams;
};

/**
 * Input parameters to deposit liquidity into a position by token amounts.
 *
 * @category Instruction Types
 * @param tokenMaxA - the maximum amount of tokenA allowed to withdraw from the source wallet.
 * @param tokenMaxB - the maximum amount of tokenB allowed to withdraw from the source wallet.
 * @param minSqrtPrice - the minimum sqrt price allowed.
 * @param maxSqrtPrice - the maximum sqrt price allowed.
 */
export type ByTokenAmountsParams = {
  tokenMaxA: BN;
  tokenMaxB: BN;
  minSqrtPrice: BN;
  maxSqrtPrice: BN;
};

export function getIncreaseLiquidityMethod(
  params: IncreaseLiquidityInput
): IncreaseLiquidityMethod {
  if ("tokenMaxA" in params && "tokenMaxB" in params) {
    // by liquidity variant
    return {
      byTokenAmounts: {
        tokenMaxA: params.tokenMaxA,
        tokenMaxB: params.tokenMaxB,
        minSqrtPrice: params.minSqrtPrice,
        maxSqrtPrice: params.maxSqrtPrice,
      },
    };
  } else {
    throw new Error(
      "Unsupported method variant for params: " + JSON.stringify(params)
    );
  }
}

/**
 * Add liquidity to a position in the Whirlpool by token amounts.
 *
 * #### Special Errors
 * `LiquidityZero` - Computed liquidity amount is zero.
 * `LiquidityTooHigh` - Computed liquidity exceeds u128::max.
 * `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - IncreaseLiquidityByTokenAmountsV2Params object
 * @returns - Instruction to perform the action.
 */
export function increaseLiquidityByTokenAmountsV2Ix(
  program: Program<Whirlpool>,
  params: IncreaseLiquidityByTokenAmountsV2Params
): Instruction {
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
    tickArrayLower,
    tickArrayUpper,
    ...remainingParams
  } = params;

  const [remainingAccountsInfo, remainingAccounts] =
    new RemainingAccountsBuilder()
      .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
      .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
      .build();

  const ix = program.instruction.increaseLiquidityByTokenAmountsV2(
    getIncreaseLiquidityMethod(remainingParams),
    remainingAccountsInfo,
    {
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
    }
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
