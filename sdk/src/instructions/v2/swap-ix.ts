import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { Whirlpool } from "../../artifacts/whirlpool";
import { MEMO_PROGRAM_ADDRESS, SwapInput } from "../../types/public";
import { RemainingAccountsBuilder, RemainingAccountsType, toSupplementalTickArrayAccountMetas } from "../../utils/remaining-accounts-util";

/**
 * Raw parameters and accounts to swap on a Whirlpool
 *
 * @category Instruction Types
 * @param swapInput - Parameters in {@link SwapInput}
 * @param whirlpool - PublicKey for the whirlpool that the swap will occur on
 * @param tokenMintA - PublicKey for the token A mint.
 * @param tokenMintB - PublicKey for the token B mint.
 * @param tokenOwnerAccountA - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenOwnerAccountB - PublicKey for the associated token account for tokenB in the collection wallet
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tokenTransferHookAccountsA - Optional array of token transfer hook accounts for token A.
 * @param tokenTransferHookAccountsB - Optional array of token transfer hook accounts for token B.
 * @param tokenProgramA - PublicKey for the token program for token A.
 * @param tokenProgramB - PublicKey for the token program for token B.
 * @param oracle - PublicKey for the oracle account for this Whirlpool.
 * @param tokenAuthority - authority to withdraw tokens from the input token account
 * @param supplementalTickArrays - Optional array of PublicKey for supplemental tick arrays of this whirlpool.
 */
export type SwapV2Params = SwapInput & {
  whirlpool: PublicKey;
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
  oracle: PublicKey;
  tokenAuthority: PublicKey;
  supplementalTickArrays?: PublicKey[];
};

/**
 * Perform a swap in this Whirlpool
 *
 * #### Special Errors
 * - `ZeroTradableAmount` - User provided parameter `amount` is 0.
 * - `InvalidSqrtPriceLimitDirection` - User provided parameter `sqrt_price_limit` does not match the direction of the trade.
 * - `SqrtPriceOutOfBounds` - User provided parameter `sqrt_price_limit` is over Whirlppool's max/min bounds for sqrt-price.
 * - `InvalidTickArraySequence` - User provided tick-arrays are not in sequential order required to proceed in this trade direction.
 * - `TickArraySequenceInvalidIndex` - The swap loop attempted to access an invalid array index during the query of the next initialized tick.
 * - `TickArrayIndexOutofBounds` - The swap loop attempted to access an invalid array index during tick crossing.
 * - `LiquidityOverflow` - Liquidity value overflowed 128bits during tick crossing.
 * - `InvalidTickSpacing` - The swap pool was initialized with tick-spacing of 0.
 *
 * ### Parameters
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - {@link SwapV2Params}
 * @returns - Instruction to perform the action.
 */
export function swapV2Ix(program: Program<Whirlpool>, params: SwapV2Params): Instruction {
  const {
    amount,
    otherAmountThreshold,
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

  const [remainingAccountsInfo, remainingAccounts] = new RemainingAccountsBuilder()
    .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
    .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
    .addSlice(RemainingAccountsType.SupplementalTickArrays, toSupplementalTickArrayAccountMetas(supplementalTickArrays))
    .build();

  const ix = program.instruction.swapV2(
    amount,
    otherAmountThreshold,
    sqrtPriceLimit,
    amountSpecifiedIsInput,
    aToB,
    remainingAccountsInfo,
    {
      accounts: {
        tokenProgramA,
        tokenProgramB,
        memoProgram: MEMO_PROGRAM_ADDRESS,
        tokenAuthority: tokenAuthority,
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
    }
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
