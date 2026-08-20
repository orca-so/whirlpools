import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { Whirlpool } from "../../artifacts/whirlpool";
import {
  RemainingAccountsBuilder,
  RemainingAccountsType,
  toSupplementalTickArrayAccountMetas,
} from "../../utils/remaining-accounts-util";
import type { CommitSwapV2Params } from "./commit-swap-ix";

/**
 * Raw parameters and accounts to prepare a swap on a Whirlpool.
 *
 * @category Instruction Types
 * @param CommitSwapV2Params - Parameters in {@link CommitSwapV2Params}
 */
export type PrepareSwapV2Params = Omit<
  CommitSwapV2Params,
  | "tokenProgramA"
  | "tokenProgramB"
  | "tokenOwnerAccountA"
  | "tokenVaultA"
  | "tokenOwnerAccountB"
  | "tokenVaultB"
  | "tokenTransferHookAccountsA"
  | "tokenTransferHookAccountsB"
>;

/**
 * Prepare a swap on a Whirlpool
 *
 * #### Special Errors
 * Most swap-related errors are returned as PrepareSwapV2ReturnData::QuoteError
 * rather than causing the transaction to fail.
 *
 * ### Parameters
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - {@link PrepareSwapV2Params}
 * @returns - Instruction to perform the action.
 */
export function prepareSwapV2Ix(
  program: Program<Whirlpool>,
  params: PrepareSwapV2Params,
): Instruction {
  const {
    preparedSwap,
    amount,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    whirlpool,
    tokenAuthority,
    tokenMintA,
    tokenMintB,
    tickArray0,
    tickArray1,
    tickArray2,
    oracle,
    supplementalTickArrays,
  } = params;

  const [remainingAccountsInfo, remainingAccounts] =
    new RemainingAccountsBuilder()
      .addSlice(
        RemainingAccountsType.SupplementalTickArrays,
        toSupplementalTickArrayAccountMetas(supplementalTickArrays),
      )
      .build();

  const ix = program.instruction.prepareSwapV2(
    amount,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    remainingAccountsInfo,
    {
      accounts: {
        preparedSwap,
        tokenAuthority,
        whirlpool,
        tokenMintA,
        tokenMintB,
        tickArray0,
        tickArray1,
        tickArray2,
        oracle,
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
