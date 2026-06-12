import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";
import type { SwapV2Params } from "../../types/public";
import { MEMO_PROGRAM_ADDRESS } from "../../types/public";
import {
  RemainingAccountsBuilder,
  RemainingAccountsType,
  toSupplementalTickArrayAccountMetas,
} from "../../utils/remaining-accounts-util";

/**
 * Raw parameters and accounts to execute a prepared swap on a Whirlpool.
 *
 * @category Instruction Types
 * @param SwapV2Params - Parameters in {@link SwapV2Params}
 * @param preparedSwap - PreparedSwap account that will receive the pending state updates for later execution via commit_swap_v2.
 */
export type CommitSwapV2Params = Omit<SwapV2Params, "otherAmountThreshold"> & {
  preparedSwap: PublicKey;
}

/**
 * Execute a prepared swap on a Whirlpool
 *
 * #### Special Errors
 * All swap-related errors from swap_v2 may be returned.
 *
 * Additional errors:
 * - `PreparedSwapVersionMismatch` - if the PreparedSwap account layout version does not match the expected version.
 * - `PreparedSwapNotPrepared` - if the PreparedSwap account is not in the Prepared state.
 * - `PreparedSwapPreconditionMismatch` - if the PreparedSwap precondition does not match the current Whirlpool state or instruction parameters.
 *
 * ### Parameters
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - {@link CommitSwapV2Params}
 * @returns - Instruction to perform the action.
 */
export function commitSwapV2Ix(
  program: Program<Whirlpool>,
  params: CommitSwapV2Params,
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
    tokenOwnerAccountA,
    tokenVaultA,
    tokenOwnerAccountB,
    tokenVaultB,
    tokenTransferHookAccountsA,
    tokenTransferHookAccountsB,
    tokenProgramA,
    tokenProgramB,
    tickArray0,
    tickArray1,
    tickArray2,
    oracle,
    supplementalTickArrays,
  } = params;

  const [remainingAccountsInfo, remainingAccounts] =
    new RemainingAccountsBuilder()
      .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
      .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
      .addSlice(
        RemainingAccountsType.SupplementalTickArrays,
        toSupplementalTickArrayAccountMetas(supplementalTickArrays),
      )
      .build();

  const ix = program.instruction.commitSwapV2(
    amount,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    remainingAccountsInfo,
    {
      accounts: {
        preparedSwap,
        tokenProgramA,
        tokenProgramB,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        tokenAuthority,
        whirlpool,
        tokenMintA,
        tokenMintB,
        tokenOwnerAccountA,
        tokenVaultA,
        tokenOwnerAccountB,
        tokenVaultB,
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
