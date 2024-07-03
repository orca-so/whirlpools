import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { Whirlpool } from "../../artifacts/whirlpool";
import { MEMO_PROGRAM_ADDRESS } from "../../types/public";
import { RemainingAccountsBuilder, RemainingAccountsType, toSupplementalTickArrayAccountMetas } from "../../utils/remaining-accounts-util";
import { TwoHopSwapInput } from "../two-hop-swap-ix";

/**
 * Parameters to execute a two-hop swap on a Whirlpool.
 *
 * @category Instruction Types
 * @param whirlpoolOne - PublicKey for the whirlpool that the swap-one will occur on
 * @param whirlpoolTwo - PublicKey for the whirlpool that the swap-two will occur on
 * @param tokenMintInput - PublicKey for the input token mint.
 * @param tokenMintIntermediate - PublicKey for the intermediate token mint.
 * @param tokenMintOutput - PublicKey for the output token mint.
 * @param tokenOwnerAccountInput - PublicKey for the input token owner account.
 * @param tokenOwnerAccountOutput - PublicKey for the output token owner account.
 * @param tokenVaultOneInput - PublicKey for the input token vault of whirlpoolOne.
 * @param tokenVaultOneIntermediate - PublicKey for the intermediate token vault of whirlpoolOne.
 * @param tokenVaultTwoIntermediate - PublicKey for the intermediate token vault of whirlpoolTwo.
 * @param tokenVaultTwoOutput - PublicKey for the output token vault of whirlpoolTwo.
 * @param tokenTransferHookAccountsInput - AccountMeta[] for the input token transfer hook accounts.
 * @param tokenTransferHookAccountsIntermediate - AccountMeta[] for the intermediate token transfer hook accounts.
 * @param tokenTransferHookAccountsOutput - AccountMeta[] for the output token transfer hook accounts.
 * @param oracleOne - PublicKey for the oracle account for this whirlpoolOne.
 * @param oracleTwo - PublicKey for the oracle account for this whirlpoolTwo.
 * @param tokenAuthority - authority to withdraw tokens from the input token account
 * @param supplementalTickArraysOne - Optional array of PublicKey for supplemental tick arrays of whirlpoolOne.
 * @param supplementalTickArraysTwo - Optional array of PublicKey for supplemental tick arrays of whirlpoolTwo.
 * @param swapInput - Parameters in {@link TwoHopSwapInput}
 */
export type TwoHopSwapV2Params = TwoHopSwapInput & {
  whirlpoolOne: PublicKey;
  whirlpoolTwo: PublicKey;
  tokenMintInput: PublicKey;
  tokenMintIntermediate: PublicKey;
  tokenMintOutput: PublicKey;
  tokenOwnerAccountInput: PublicKey;
  tokenOwnerAccountOutput: PublicKey;
  tokenVaultOneInput: PublicKey;
  tokenVaultOneIntermediate: PublicKey;
  tokenVaultTwoIntermediate: PublicKey;
  tokenVaultTwoOutput: PublicKey;
  tokenTransferHookAccountsInput?: AccountMeta[];
  tokenTransferHookAccountsIntermediate?: AccountMeta[];
  tokenTransferHookAccountsOutput?: AccountMeta[];
  tokenProgramInput: PublicKey;
  tokenProgramIntermediate: PublicKey;
  tokenProgramOutput: PublicKey;
  oracleOne: PublicKey;
  oracleTwo: PublicKey;
  tokenAuthority: PublicKey;
  supplementalTickArraysOne?: PublicKey[];
  supplementalTickArraysTwo?: PublicKey[];
};

/**
 * Perform a two-hop swap in this Whirlpool
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
 * - `InvalidIntermediaryMint` - Error if the intermediary mint between hop one and two do not equal.
 * - `DuplicateTwoHopPool` - Error if whirlpool one & two are the same pool.
 *
 * ### Parameters
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - {@link TwoHopSwapV2Params} object
 * @returns - Instruction to perform the action.
 */
export function twoHopSwapV2Ix(program: Program<Whirlpool>, params: TwoHopSwapV2Params): Instruction {
  const {
    amount,
    otherAmountThreshold,
    amountSpecifiedIsInput,
    aToBOne,
    aToBTwo,
    sqrtPriceLimitOne,
    sqrtPriceLimitTwo,
    whirlpoolOne,
    whirlpoolTwo,
    tokenMintInput,
    tokenMintIntermediate,
    tokenMintOutput,
    tokenProgramInput,
    tokenProgramIntermediate,
    tokenProgramOutput,
    tokenVaultOneInput,
    tokenVaultOneIntermediate,
    tokenVaultTwoIntermediate,
    tokenVaultTwoOutput,
    tokenAuthority,
    tokenTransferHookAccountsInput,
    tokenTransferHookAccountsIntermediate,
    tokenTransferHookAccountsOutput,
    tokenOwnerAccountInput,
    tokenOwnerAccountOutput,
    tickArrayOne0,
    tickArrayOne1,
    tickArrayOne2,
    tickArrayTwo0,
    tickArrayTwo1,
    tickArrayTwo2,
    oracleOne,
    oracleTwo,
    supplementalTickArraysOne,
    supplementalTickArraysTwo,
  } = params;

  const [remainingAccountsInfo, remainingAccounts] = new RemainingAccountsBuilder()
    .addSlice(RemainingAccountsType.TransferHookInput, tokenTransferHookAccountsInput)
    .addSlice(RemainingAccountsType.TransferHookIntermediate, tokenTransferHookAccountsIntermediate)
    .addSlice(RemainingAccountsType.TransferHookOutput, tokenTransferHookAccountsOutput)
    .addSlice(RemainingAccountsType.SupplementalTickArraysOne, toSupplementalTickArrayAccountMetas(supplementalTickArraysOne))
    .addSlice(RemainingAccountsType.SupplementalTickArraysTwo, toSupplementalTickArrayAccountMetas(supplementalTickArraysTwo))
    .build();

  const ix = program.instruction.twoHopSwapV2(
    amount,
    otherAmountThreshold,
    amountSpecifiedIsInput,
    aToBOne,
    aToBTwo,
    sqrtPriceLimitOne,
    sqrtPriceLimitTwo,
    remainingAccountsInfo,
    {
      accounts: {
        whirlpoolOne,
        whirlpoolTwo,
        tokenMintInput,
        tokenMintIntermediate,
        tokenMintOutput,
        tokenProgramInput,
        tokenProgramIntermediate,
        tokenProgramOutput,
        tokenOwnerAccountInput,
        tokenVaultOneInput,
        tokenVaultOneIntermediate,
        tokenVaultTwoIntermediate,
        tokenVaultTwoOutput,
        tokenOwnerAccountOutput,
        tokenAuthority,
        tickArrayOne0,
        tickArrayOne1,
        tickArrayOne2,
        tickArrayTwo0,
        tickArrayTwo1,
        tickArrayTwo2,
        oracleOne,
        oracleTwo,
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
