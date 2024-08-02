import { TwoHopSwapInput } from "../../instructions";
import { SwapEstimates, SwapQuote } from "./swap-quote";

/**
 * A collection of estimated values from quoting a swap.
 * @category Quotes
 * @link {NormalTwoHopSwapQuote}
 * @experimental Not yet ready for use
 */
export type TwoHopSwapQuote = NormalTwoHopSwapQuote; // TODO dev swap

/**
 * A collection of estimated values from quoting a two-hop-swap.
 * @category Quotes
 * @param swapOneEstimates - Estimates for the first leg of the two-hop-swap
 * @param swapTwoEstimates - Estimates for the second leg of the two-hop-swap
 * @experimental Not yet ready for use
 */
export type NormalTwoHopSwapQuote = {
  swapOneEstimates: SwapEstimates;
  swapTwoEstimates: SwapEstimates;
} & TwoHopSwapInput;

/**
 * Convert two individual swaps into a quote estimate
 * @category Quotes
 * @experimental Not yet ready for use
 */
export function twoHopSwapQuoteFromSwapQuotes(
  swapQuoteOne: SwapQuote,
  swapQuoteTwo: SwapQuote
): TwoHopSwapQuote {
  const amountSpecifiedIsInput = swapQuoteOne.amountSpecifiedIsInput;
  // If amount specified is input, then we care about input of the first swap
  // otherwise we care about output of the second swap
  let [amount, otherAmountThreshold] = amountSpecifiedIsInput
    ? [swapQuoteOne.amount, swapQuoteTwo.otherAmountThreshold]
    : [swapQuoteTwo.amount, swapQuoteOne.otherAmountThreshold];

  return {
    amount,
    otherAmountThreshold,
    amountSpecifiedIsInput,
    aToBOne: swapQuoteOne.aToB,
    aToBTwo: swapQuoteTwo.aToB,
    sqrtPriceLimitOne: swapQuoteOne.sqrtPriceLimit,
    sqrtPriceLimitTwo: swapQuoteTwo.sqrtPriceLimit,
    tickArrayOne0: swapQuoteOne.tickArray0,
    tickArrayOne1: swapQuoteOne.tickArray1,
    tickArrayOne2: swapQuoteOne.tickArray2,
    tickArrayTwo0: swapQuoteTwo.tickArray0,
    tickArrayTwo1: swapQuoteTwo.tickArray1,
    tickArrayTwo2: swapQuoteTwo.tickArray2,
    supplementalTickArraysOne: swapQuoteOne.supplementalTickArrays,
    supplementalTickArraysTwo: swapQuoteTwo.supplementalTickArrays,
    swapOneEstimates: { ...swapQuoteOne },
    swapTwoEstimates: { ...swapQuoteTwo },
  };
}
