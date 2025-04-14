import type { Address } from "@coral-xyz/anchor";
import type { Percentage } from "@orca-so/common-sdk";
import { AddressUtil, U64_MAX, ZERO } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type { OracleData, WhirlpoolContext } from "../..";
import { TickUtil } from "../..";
import type {
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
} from "../../network/public/fetcher";
import type {
  SwapInput,
  SwapParams,
  TickArray,
  WhirlpoolData,
} from "../../types/public";
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "../../types/public";
import type { Whirlpool } from "../../whirlpool-client";
import { adjustForSlippage } from "../math/token-math";
import { PDAUtil } from "./pda-utils";
import { PoolUtil } from "./pool-utils";
import { SwapDirection, TokenType } from "./types";
import type { TickArrayAddress } from "../swap-utils";
import {
  buildZeroedTickArray,
  getTickArrayPublicKeysWithStartTickIndex,
} from "../swap-utils";

/**
 * A request to fetch the tick-arrays that a swap may traverse across.
 * @category Whirlpool Utils
 */
export interface TickArrayRequest {
  whirlpoolAddress: PublicKey;
  aToB: boolean;
  tickCurrentIndex: number;
  tickSpacing: number;
}

/*
 * An alias for null indicating that the adaptive fee context does not exist.
 * @category Whirlpool Utils
 */
export const NO_ORACLE_DATA = null;

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
  public static getDefaultOtherAmountThreshold(
    amountSpecifiedIsInput: boolean,
  ) {
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
    swapTokenIsInput: boolean,
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
    whirlpoolAddress: PublicKey,
  ): PublicKey[] {
    return getTickArrayPublicKeysWithStartTickIndex(
      tickCurrentIndex,
      tickSpacing,
      aToB,
      programId,
      whirlpoolAddress,
    ).map((p) => p.pubkey);
  }

  /**
   * Given the tickArrays, return the fallback tickArray account that this swap may traverse across.
   *
   * @category Whirlpool Utils
   * @param tickArrays - An array of tickArrays to be used in the swap.
   * @param tickSpacing - The tickSpacing for the Whirlpool.
   * @param aToB - The direction of the trade.
   * @param programId - The Whirlpool programId which the Whirlpool lives on.
   * @param whirlpoolAddress - PublicKey of the whirlpool to swap on.
   * @returns A PublicKey for the fallback tickArray account that this swap may traverse across. If the fallback tickArray does not exist, return undefined.
   */
  public static getFallbackTickArrayPublicKey(
    tickArrays: TickArray[],
    tickSpacing: number,
    aToB: boolean,
    programId: PublicKey,
    whirlpoolAddress: PublicKey,
  ): PublicKey | undefined {
    try {
      const fallbackStartTickIndex = TickUtil.getStartTickIndex(
        tickArrays[0].startTickIndex,
        tickSpacing,
        aToB ? 1 : -1,
      );
      const pda = PDAUtil.getTickArray(
        programId,
        whirlpoolAddress,
        fallbackStartTickIndex,
      );
      return pda.publicKey;
    } catch {
      return undefined;
    }
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
   * @param fetcher - WhirlpoolAccountCacheInterface object to fetch solana accounts
   * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
   * @returns An array of PublicKey[] for the tickArray accounts that this swap may traverse across.
   */
  public static async getTickArrays(
    tickCurrentIndex: number,
    tickSpacing: number,
    aToB: boolean,
    programId: PublicKey,
    whirlpoolAddress: PublicKey,
    fetcher: WhirlpoolAccountFetcherInterface,
    opts?: WhirlpoolAccountFetchOptions,
  ): Promise<TickArray[]> {
    const data = await this.getBatchTickArrays(
      programId,
      fetcher,
      [{ tickCurrentIndex, tickSpacing, aToB, whirlpoolAddress }],
      opts,
    );
    return data[0];
  }

  /**
   * Fetch the oracle data for a given whirlpool.
   *
   * @category Whirlpool Utils
   * @param programId - The Whirlpool programId which the Whirlpool lives on.
   * @param whirlpoolAddress - PublicKey of the whirlpool to swap on.
   * @param fetcher - WhirlpoolAccountCacheInterface object to fetch solana accounts
   * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
   * @returns OracleData object containing the trade enable timestamp and adaptive fee constants and variables if the oracle is initialized, otherwise null.
   */
  public static async getOracle(
    programId: PublicKey,
    whirlpoolAddress: PublicKey,
    fetcher: WhirlpoolAccountFetcherInterface,
    opts?: WhirlpoolAccountFetchOptions,
  ): Promise<OracleData | null> {
    const oracleAddress = PDAUtil.getOracle(
      programId,
      whirlpoolAddress,
    ).publicKey;

    const oracleData = await fetcher.getOracle(oracleAddress, opts);
    if (!oracleData) {
      return NO_ORACLE_DATA;
    }

    return oracleData;
  }

  /**
   * Fetch a batch of tick-arrays for a set of TA requests.
   * @param programId - The Whirlpool programId which the Whirlpool lives on.
   * @param fetcher - WhirlpoolAccountCacheInterface instance to fetch solana accounts
   * @param tickArrayRequests - An array of {@link TickArrayRequest} of tick-arrays to request for.
   * @param opts an {@link WhirlpoolAccountFetchOptions} object to define fetch and cache options when accessing on-chain accounts
   * @returns A array of request indicies mapped to an array of resulting PublicKeys.
   */
  public static async getBatchTickArrays(
    programId: PublicKey,
    fetcher: WhirlpoolAccountFetcherInterface,
    tickArrayRequests: TickArrayRequest[],
    opts?: WhirlpoolAccountFetchOptions,
  ): Promise<TickArray[][]> {
    let addresses: TickArrayAddress[] = [];
    let requestToIndices = [];

    // Each individual tick array request may correspond to more than one tick array
    // so we map each request to a slice of the batch request
    for (let i = 0; i < tickArrayRequests.length; i++) {
      const { tickCurrentIndex, tickSpacing, aToB, whirlpoolAddress } =
        tickArrayRequests[i];
      const requestAddresses = getTickArrayPublicKeysWithStartTickIndex(
        tickCurrentIndex,
        tickSpacing,
        aToB,
        programId,
        whirlpoolAddress,
      );
      requestToIndices.push([
        addresses.length,
        addresses.length + requestAddresses.length,
      ]);
      addresses.push(...requestAddresses);
    }
    const data = await fetcher.getTickArrays(
      addresses.map((a) => a.pubkey),
      opts,
    );

    // Re-map from flattened batch data to TickArray[] for request
    return requestToIndices.map((indices) => {
      const [start, end] = indices;
      const addressSlice = addresses.slice(start, end);
      const dataSlice = data.slice(start, end);
      return addressSlice.map((addr, index) => ({
        address: addr.pubkey,
        startTickIndex: addr.startTickIndex,
        data: dataSlice[index],
      }));
    });
  }

  /**
   * Given a set of tickArrays, interpolate the tickArrays with zeroed tick data if they are not initialized.
   *
   * @param whirlpoolAddress - PublicKey of the whirlpool to swap on.
   * @param tickArrays - Fetched tickArrays to interpolate.
   * @returns An array of TickArray objects with zeroed tick data if they are not initialized.
   */
  public static interpolateUninitializedTickArrays(
    whirlpoolAddress: PublicKey,
    tickArrays: TickArray[],
  ): TickArray[] {
    return tickArrays.map((tickArray) => ({
      address: tickArray.address,
      startTickIndex: tickArray.startTickIndex,
      data:
        tickArray.data ??
        buildZeroedTickArray(whirlpoolAddress, tickArray.startTickIndex),
    }));
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
    amountSpecifiedIsInput: boolean,
  ): Pick<SwapInput, "amount" | "otherAmountThreshold"> {
    if (amountSpecifiedIsInput) {
      return {
        amount,
        otherAmountThreshold: adjustForSlippage(
          estAmountOut,
          slippageTolerance,
          false,
        ),
      };
    } else {
      return {
        amount,
        otherAmountThreshold: adjustForSlippage(
          estAmountIn,
          slippageTolerance,
          true,
        ),
      };
    }
  }

  /**
   * Convert a quote object and WhirlpoolClient's {@link Whirlpool} object into a {@link SwapParams} type
   * to be plugged into {@link WhirlpoolIx.swapIx}.
   *
   * @param quote - A {@link SwapQuote} type generated from {@link swapQuoteWithParams}
   * @param ctx - {@link WhirlpoolContext}
   * @param whirlpool - A {@link Whirlpool} object from WhirlpoolClient
   * @param inputTokenAssociatedAddress - The public key for the ATA of the input token in the swap
   * @param outputTokenAssociatedAddress - The public key for the ATA of the input token in the swap
   * @param wallet - The token authority for this swap
   * @returns A converted {@link SwapParams} generated from the input
   */
  public static getSwapParamsFromQuote(
    quote: SwapInput,
    ctx: WhirlpoolContext,
    whirlpool: Whirlpool,
    inputTokenAssociatedAddress: Address,
    outputTokenAssociatedAddress: Address,
    wallet: PublicKey,
  ) {
    const data = whirlpool.getData();
    return this.getSwapParamsFromQuoteKeys(
      quote,
      ctx,
      whirlpool.getAddress(),
      data.tokenVaultA,
      data.tokenVaultB,
      inputTokenAssociatedAddress,
      outputTokenAssociatedAddress,
      wallet,
    );
  }

  public static getSwapParamsFromQuoteKeys(
    quote: SwapInput,
    ctx: WhirlpoolContext,
    whirlpool: PublicKey,
    tokenVaultA: PublicKey,
    tokenVaultB: PublicKey,
    inputTokenAssociatedAddress: Address,
    outputTokenAssociatedAddress: Address,
    wallet: PublicKey,
  ) {
    const aToB = quote.aToB;
    const [inputTokenATA, outputTokenATA] = AddressUtil.toPubKeys([
      inputTokenAssociatedAddress,
      outputTokenAssociatedAddress,
    ]);
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpool);
    const params: SwapParams = {
      whirlpool,
      tokenOwnerAccountA: aToB ? inputTokenATA : outputTokenATA,
      tokenOwnerAccountB: aToB ? outputTokenATA : inputTokenATA,
      tokenVaultA,
      tokenVaultB,
      oracle: oraclePda.publicKey,
      tokenAuthority: wallet,
      ...quote,
    };
    return params;
  }
}
