import { ZERO, U64_MAX, Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { AccountFetcher } from "../../network/public";
import {
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  WhirlpoolData,
  MAX_SWAP_TICK_ARRAYS,
  TickArray,
  SwapInput,
} from "../../types/public";
import { adjustForSlippage } from "../math/token-math";
import { PDAUtil } from "./pda-utils";
import { PoolUtil } from "./pool-utils";
import { TickUtil } from "./tick-utils";
import { SwapDirection, TokenType } from "./types";

/**
 * @category Whirlpool Utils
 */
export class SwapUtils {
  /**
   * Get the default values for the sqrtPriceLimit parameter in a swap.
   * @param aToB - The direction of a swap
   * @returns The default values for the sqrtPriceLimit parameter in a swap.
   */
  public static getDefaultSqrtPriceLimit(aToB: boolean) {
    return new BN(aToB ? MIN_SQRT_PRICE : MAX_SQRT_PRICE);
  }

  /**
   * Get the default values for the otherAmountThreshold parameter in a swap.
   * @param amountSpecifiedIsInput - The direction of a swap
   * @returns The default values for the otherAmountThreshold parameter in a swap.
   */
  public static getDefaultOtherAmountThreshold(amountSpecifiedIsInput: boolean) {
    return amountSpecifiedIsInput ? ZERO : U64_MAX;
  }

  /**
   * Given the intended token mint to swap, return the swap direction of a swap for a Whirlpool
   * @param pool The Whirlpool to evaluate the mint against
   * @param swapTokenMint The token mint PublicKey the user bases their swap against
   * @param swapTokenIsInput Whether the swap token is the input token. (similar to amountSpecifiedIsInput from swap Ix)
   * @returns The direction of the swap given the swapTokenMint. undefined if the token mint is not part of the trade pair of the pool.
   */
  public static getSwapDirection(
    pool: WhirlpoolData,
    swapTokenMint: PublicKey,
    swapTokenIsInput: boolean
  ): SwapDirection | undefined {
    const tokenType = PoolUtil.getTokenType(pool, swapTokenMint);
    if (!tokenType) {
      return undefined;
    }

    return (tokenType === TokenType.TokenA) === swapTokenIsInput
      ? SwapDirection.AtoB
      : SwapDirection.BtoA;
  }

  /**
   * Given the current tick-index, returns the dervied PDA and fetched data
   * for the tick-arrays that this swap may traverse across.
   *
   * @category Whirlpool Utils
   * @param tickCurrentIndex - The current tickIndex for the Whirlpool to swap on.
   * @param tickSpacing - The tickSpacing for the Whirlpool.
   * @param aToB - The direction of the trade.
   * @param programId - The Whirlpool programId which the Whirlpool lives on.
   * @param whirlpoolAddress - PublicKey of the whirlpool to swap on.
   * @returns An array of PublicKey[] for the tickArray accounts that this swap may traverse across.
   */
  public static getTickArrayPublicKeys(
    tickCurrentIndex: number,
    tickSpacing: number,
    aToB: boolean,
    programId: PublicKey,
    whirlpoolAddress: PublicKey
  ) {
    const shift = aToB ? 0 : tickSpacing;

    let offset = 0;
    let tickArrayAddresses: PublicKey[] = [];
    for (let i = 0; i < MAX_SWAP_TICK_ARRAYS; i++) {
      let startIndex: number;
      try {
        startIndex = TickUtil.getStartTickIndex(tickCurrentIndex + shift, tickSpacing, offset);
      } catch {
        return tickArrayAddresses;
      }

      const pda = PDAUtil.getTickArray(programId, whirlpoolAddress, startIndex);
      tickArrayAddresses.push(pda.publicKey);
      offset = aToB ? offset - 1 : offset + 1;
    }

    return tickArrayAddresses;
  }

  /**
   * Given the current tick-index, returns TickArray objects that this swap may traverse across.
   *
   * @category Whirlpool Utils
   * @param tickCurrentIndex - The current tickIndex for the Whirlpool to swap on.
   * @param tickSpacing - The tickSpacing for the Whirlpool.
   * @param aToB - The direction of the trade.
   * @param programId - The Whirlpool programId which the Whirlpool lives on.
   * @param whirlpoolAddress - PublicKey of the whirlpool to swap on.
   * @param fetcher - AccountFetcher object to fetch solana accounts
   * @param refresh - If true, fetcher would default to fetching the latest accounts
   * @returns An array of PublicKey[] for the tickArray accounts that this swap may traverse across.
   */
  public static async getTickArrays(
    tickCurrentIndex: number,
    tickSpacing: number,
    aToB: boolean,
    programId: PublicKey,
    whirlpoolAddress: PublicKey,
    fetcher: AccountFetcher,
    refresh: boolean
  ): Promise<TickArray[]> {
    const addresses = SwapUtils.getTickArrayPublicKeys(
      tickCurrentIndex,
      tickSpacing,
      aToB,
      programId,
      whirlpoolAddress
    );
    const data = await fetcher.listTickArrays(addresses, refresh);
    return addresses.map((addr, index) => {
      return {
        address: addr,
        data: data[index],
      };
    });
  }

  /**
   * Calculate the SwapInput parameters `amount` & `otherAmountThreshold` based on the amountIn & amountOut estimates from a quote.
   * @param amount - The amount of tokens the user wanted to swap from.
   * @param estAmountIn - The estimated amount of input tokens expected in a `SwapQuote`
   * @param estAmountOut - The estimated amount of output tokens expected from a `SwapQuote`
   * @param slippageTolerance - The amount of slippage to adjust for.
   * @param amountSpecifiedIsInput - Specifies the token the parameter `amount`represents in the swap quote. If true, the amount represents
   *                                 the input token of the swap.
   * @returns A Partial `SwapInput` object containing the slippage adjusted 'amount' & 'otherAmountThreshold' parameters.
   */
  public static calculateSwapAmountsFromQuote(
    amount: BN,
    estAmountIn: BN,
    estAmountOut: BN,
    slippageTolerance: Percentage,
    amountSpecifiedIsInput: boolean
  ): Pick<SwapInput, "amount" | "otherAmountThreshold"> {
    if (amountSpecifiedIsInput) {
      return {
        amount,
        otherAmountThreshold: adjustForSlippage(estAmountOut, slippageTolerance, false),
      };
    } else {
      return {
        amount,
        otherAmountThreshold: adjustForSlippage(estAmountIn, slippageTolerance, true),
      };
    }
  }
}
