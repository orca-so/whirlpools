import type { BN, Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import {
  SystemProgram,
  type AccountMeta,
  type PublicKey,
} from "@solana/web3.js";
import { MEMO_PROGRAM_ADDRESS } from "../..";
import type { Whirlpool } from "../../artifacts/whirlpool";
import {
  RemainingAccountsBuilder,
  RemainingAccountsType,
} from "../../utils/remaining-accounts-util";

/**
 * Parameters to reposition liquidity for a position.
 *
 * @category Instruction Types
 * @param newTickLowerIndex - the new lower tick index for the position.
 * @param newTickUpperIndex - the new upper tick index for the position.
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param tokenProgramA - PublicKey for the token program for token A.
 * @param tokenProgramB - PublicKey for the token program for token B.
 * @param memoProgram - PublicKey for the memo program.
 * @param funder - PublicKey for the funder.
 * @param position - PublicKey for the position.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param tokenMintA - PublicKey for the token A mint.
 * @param tokenMintB - PublicKey for the token B mint.
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tokenTransferHookAccountsA - Optional array of token transfer hook accounts for token A.
 * @param tokenTransferHookAccountsB - Optional array of token transfer hook accounts for token B.
 * @param existingTickArrayLower - PublicKey for the tick-array account that hosts the tick at the existing lower tick index.
 * @param existingTickArrayUpper - PublicKey for the tick-array account that hosts the tick at the existing upper tick index.
 * @param newTickArrayLower - PublicKey for the tick-array account that hosts the tick at the new lower tick index.
 * @param newTickArrayUpper - PublicKey for the tick-array account that hosts the tick at the new upper tick index.
 * @param systemProgram - PublicKey for the system program.
 */
export type RepositionLiquidityV2Params = {
  newTickLowerIndex: number;
  newTickUpperIndex: number;
  whirlpool: PublicKey;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
  positionAuthority: PublicKey;
  funder: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenTransferHookAccountsA?: AccountMeta[];
  tokenTransferHookAccountsB?: AccountMeta[];
  existingTickArrayLower: PublicKey;
  existingTickArrayUpper: PublicKey;
  newTickArrayLower: PublicKey;
  newTickArrayUpper: PublicKey;
  memoProgram?: PublicKey;
  systemProgram?: PublicKey;
} & RepositionLiquidityInput;

/**
 * Type union of all possible methods to reposition liquidity for a position.
 */
type RepositionLiquidityInput = ByLiquidityMethodParams;

export type RepositionLiquidityMethod = {
  byLiquidity: ByLiquidityMethodParams;
};

export type ByLiquidityMethodParams = {
  newLiquidityAmount: BN;
  existingRangeTokenMinA: BN;
  existingRangeTokenMinB: BN;
  newRangeTokenMaxA: BN;
  newRangeTokenMaxB: BN;
};

export function getRepositionLiquidityMethod(
  params: RepositionLiquidityInput,
): RepositionLiquidityMethod {
  if ("newLiquidityAmount" in params) {
    // by liquidity variant
    return {
      byLiquidity: {
        newLiquidityAmount: params.newLiquidityAmount,
        existingRangeTokenMinA: params.existingRangeTokenMinA,
        existingRangeTokenMinB: params.existingRangeTokenMinB,
        newRangeTokenMaxA: params.newRangeTokenMaxA,
        newRangeTokenMaxB: params.newRangeTokenMaxB,
      },
    };
  } else {
    throw new Error(
      "Unsupported method variant for params: " + JSON.stringify(params),
    );
  }
}

/**
 * Reposition liquidity for a position in the Whirlpool.
 *
 * #### Special Errors
 * - `LiquidityZero` - Provided liquidity amount is zero.
 * - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
 * - `TokenMaxExceeded` - The required token to perform this operation exceeds the user defined amount.
 * - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
 * - `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of
 *                        the tick-spacing in this pool.
 * - `SameTickRangeNotAllowed` - The provided tick range is the same as the current tick range.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - RepositionLiquidityV2Params object
 * @returns - Instruction to perform the action.
 */
export function repositionLiquidityV2Ix(
  program: Program<Whirlpool>,
  params: RepositionLiquidityV2Params,
): Instruction {
  const {
    newTickLowerIndex,
    newTickUpperIndex,
    tokenTransferHookAccountsA,
    tokenTransferHookAccountsB,
    whirlpool,
    tokenProgramA,
    tokenProgramB,
    positionAuthority,
    funder,
    position,
    positionTokenAccount,
    tokenMintA,
    tokenMintB,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
    existingTickArrayLower,
    existingTickArrayUpper,
    newTickArrayLower,
    newTickArrayUpper,
    memoProgram,
    systemProgram,
    ...remainingParams
  } = params;

  const [remainingAccountsInfo, remainingAccounts] =
    new RemainingAccountsBuilder()
      .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
      .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
      .build();

  const ix = program.instruction.repositionLiquidityV2(
    newTickLowerIndex,
    newTickUpperIndex,
    getRepositionLiquidityMethod(remainingParams),
    remainingAccountsInfo,
    {
      accounts: {
        whirlpool,
        tokenProgramA,
        tokenProgramB,
        memoProgram: memoProgram ?? MEMO_PROGRAM_ADDRESS,
        positionAuthority,
        funder,
        position,
        positionTokenAccount,
        tokenMintA,
        tokenMintB,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA,
        tokenVaultB,
        existingTickArrayLower,
        existingTickArrayUpper,
        newTickArrayLower,
        newTickArrayUpper,
        systemProgram: systemProgram ?? SystemProgram.programId,
      },
      remainingAccounts,
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
