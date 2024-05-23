import { Address } from "@coral-xyz/anchor";
import { AddressUtil, Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { SwapErrorCode } from "../errors/errors";
import { PREFER_CACHE, WhirlpoolAccountFetcherInterface } from "../network/public/fetcher";
import { SwapQuoteParam, swapQuoteWithParams } from "../quotes/public";
import { Path, PoolUtil } from "../utils/public";
import { SwapQuoteRequest, batchBuildSwapQuoteParams } from "./batch-swap-quote";
import { RoutingOptions, Trade, TradeHop } from "./public";

// Key between <splitPercent, array of quotes with successful hop quotes>
export type SanitizedQuoteMap = Record<number, PathQuote[]>;

// A trade quote on trading on a path between user input tokenIn -> tokenOut
export type PathQuote = {
  path: Path;
  edgesPoolAddrs: string[];
  splitPercent: number;
  amountIn: BN;
  amountOut: BN;
  calculatedEdgeQuotes: TradeHopQuoteSuccess[];
};

export async function getQuoteMap(
  trade: Trade,
  paths: Path[],
  amountSpecifiedIsInput: boolean,
  programId: PublicKey,
  fetcher: WhirlpoolAccountFetcherInterface,
  opts: RoutingOptions
) {
  const { percentIncrement, numTopPartialQuotes } = opts;
  const { tokenIn, tokenOut, tradeAmount } = trade;

  const { percents, amounts } = getSplitPercentageAmts(tradeAmount, percentIncrement);
  // The max route length is the number of iterations of quoting that we need to do
  const maxRouteLength = Math.max(...paths.map((path) => path.edges.length), 0);

  // For hop 0 of all routes, get swap quotes using [inputAmount, inputTokenMint]
  // For hop 1..n of all routes, get swap quotes using [outputAmount, outputTokenMint] of hop n-1 as input
  const quoteMap: InternalQuoteMap = {};
  let iteration = Array.from(Array(maxRouteLength).keys());
  if (!amountSpecifiedIsInput) {
    iteration = iteration.reverse();
  }

  try {
    for (const hop of iteration) {
      // Each batch of quotes needs to be iterative
      const quoteUpdates = buildQuoteUpdateRequests(
        tokenIn,
        tokenOut,
        paths,
        percents,
        amounts,
        hop,
        amountSpecifiedIsInput,
        quoteMap
      );

      const quoteParams = await batchBuildSwapQuoteParams(
        quoteUpdates.map((update) => update.request),
        AddressUtil.toPubKey(programId),
        fetcher,
        PREFER_CACHE
      );

      populateQuoteMap(quoteUpdates, quoteParams, quoteMap);
    }
  } catch (e) {
    throw e;
  }

  return sanitizeQuoteMap(quoteMap, numTopPartialQuotes, amountSpecifiedIsInput);
}

// Key between <splitPercent, array of quotes of pre-sanitized calculated-hops>
type InternalQuoteMap = Record<
  number,
  Array<
    Pick<InternalPathQuote, "path" | "edgesPoolAddrs" | "splitPercent" | "calculatedEdgeQuotes">
  >
>;

type InternalPathQuote = Omit<PathQuote, "calculatedEdgeQuotes"> & {
  calculatedEdgeQuotes: (TradeHopQuoteResult | undefined)[];
};

type TradeHopQuoteResult = TradeHopQuoteSuccess | TradeHopQuoteError;
type TradeHopQuoteSuccess = TradeHop & { success: true };
type TradeHopQuoteError = {
  success: false;
  error: SwapErrorCode;
};

function populateQuoteMap(
  quoteUpdates: ReturnType<typeof buildQuoteUpdateRequests>,
  quoteParams: SwapQuoteParam[],
  quoteMap: InternalQuoteMap
) {
  for (const { splitPercent, pathIndex, quoteIndex, edgeIndex, request } of quoteUpdates) {
    const swapParam = quoteParams[quoteIndex];
    const path = quoteMap[splitPercent][pathIndex];
    try {
      const quote = swapQuoteWithParams(swapParam, Percentage.fromFraction(0, 1000));
      const { whirlpoolData, tokenAmount, aToB, amountSpecifiedIsInput } = swapParam;
      const [mintA, mintB, vaultA, vaultB] = [
        whirlpoolData.tokenMintA.toBase58(),
        whirlpoolData.tokenMintB.toBase58(),
        whirlpoolData.tokenVaultA.toBase58(),
        whirlpoolData.tokenVaultB.toBase58(),
      ];
      const [inputMint, outputMint] = aToB ? [mintA, mintB] : [mintB, mintA];
      path.calculatedEdgeQuotes[edgeIndex] = {
        success: true,
        amountIn: amountSpecifiedIsInput ? tokenAmount : quote.estimatedAmountIn.amount,
        amountOut: amountSpecifiedIsInput ? quote.estimatedAmountOut.amount : tokenAmount,
        whirlpool: request.whirlpool,
        inputMint,
        outputMint,
        mintA,
        mintB,
        vaultA,
        vaultB,
        quote,
        snapshot: {
          aToB: swapParam.aToB,
          sqrtPrice: whirlpoolData.sqrtPrice,
          feeRate: PoolUtil.getFeeRate(whirlpoolData.feeRate),
        },
      };
    } catch (e: any) {
      const errorCode: SwapErrorCode = e.errorCode;
      path.calculatedEdgeQuotes[edgeIndex] = {
        success: false,
        error: errorCode,
      };
      continue;
    }
  }
}

/**
 * A list of quote requests to be queried in a batch.
 *
 * @param quoteIndex The index for this quote in the QuoteRequest array
 * @param pathIndex The index of the trade paths this request is evaluating
 * @param edgeIndex The index of the edge for the evaluated path
 * @param splitPercent The percent of the total amount to be swapped
 * @param poolAddress The account address of the pool this edge is evaluating
 *
 */
type QuoteRequest = {
  quoteIndex: number;
  pathIndex: number;
  edgeIndex: number;
  splitPercent: number;
  request: SwapQuoteRequest;
};

function buildQuoteUpdateRequests(
  tokenIn: Address,
  tokenOut: Address,
  paths: Path[],
  percents: number[],
  amounts: BN[],
  hop: number,
  amountSpecifiedIsInput: boolean,
  quoteMap: InternalQuoteMap
): QuoteRequest[] {
  // Each batch of quotes needs to be iterative
  const quoteUpdates: QuoteRequest[] = [];
  for (let amountIndex = 0; amountIndex < amounts.length; amountIndex++) {
    const percent = percents[amountIndex];
    const tradeAmount = amounts[amountIndex];

    // Initialize quote map for first hop
    if (!quoteMap[percent]) {
      quoteMap[percent] = Array(paths.length);
    }

    // Iterate over all routes
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      const edges = path.edges;
      // If the current route is already complete (amountSpecifiedIsInput = true) or if the current hop is beyond
      // this route's length (amountSpecifiedIsInput = false), don't do anything
      if (amountSpecifiedIsInput ? edges.length <= hop : hop > edges.length - 1) {
        continue;
      }

      const startingRouteEval = amountSpecifiedIsInput ? hop === 0 : hop === edges.length - 1;
      const poolsPath = AddressUtil.toStrings(edges.map((edge) => edge.poolAddress));

      // If this is the first hop of the route, initialize the quote map
      if (startingRouteEval) {
        quoteMap[percent][pathIndex] = {
          path: path,
          splitPercent: percent,
          edgesPoolAddrs: poolsPath,
          calculatedEdgeQuotes: Array(edges.length),
        };
      }
      const currentQuote = quoteMap[percent][pathIndex];

      const poolAddr = poolsPath[hop];
      const lastHop = amountSpecifiedIsInput
        ? currentQuote.calculatedEdgeQuotes[hop - 1]
        : currentQuote.calculatedEdgeQuotes[hop + 1];

      // If this is the first hop, use the input mint and amount, otherwise use the output of the last hop
      let tokenAmount: BN;
      let tradeToken: Address;
      if (startingRouteEval) {
        tokenAmount = tradeAmount;
        tradeToken = amountSpecifiedIsInput ? tokenIn : tokenOut;
      } else {
        if (!lastHop?.success) {
          continue;
        }
        tokenAmount = amountSpecifiedIsInput ? lastHop.amountOut : lastHop.amountIn;
        tradeToken = amountSpecifiedIsInput ? lastHop.outputMint : lastHop.inputMint;
      }

      quoteUpdates.push({
        splitPercent: percent,
        pathIndex,
        edgeIndex: hop,
        quoteIndex: quoteUpdates.length,
        request: {
          whirlpool: poolAddr,
          tradeTokenMint: tradeToken,
          tokenAmount,
          amountSpecifiedIsInput,
        },
      });
    }
  }
  return quoteUpdates;
}

/**
 * Annotate amountIn/amountOut for calculations
 * @param tradeAmount
 * @param quoteMap
 * @returns
 */
function sanitizeQuoteMap(
  quoteMap: InternalQuoteMap,
  pruneN: number,
  amountSpecifiedIsInput: boolean
): readonly [SanitizedQuoteMap, Set<SwapErrorCode>] {
  const percents = Object.keys(quoteMap).map((percent) => Number(percent));
  const cleanedQuoteMap: SanitizedQuoteMap = {};
  const failureErrors: Set<SwapErrorCode> = new Set();
  for (let i = 0; i < percents.length; i++) {
    const percent = percents[i];
    const uncleanedQuotes = quoteMap[percent];
    cleanedQuoteMap[percent] = [];
    for (const {
      edgesPoolAddrs: hopPoolAddrs,
      calculatedEdgeQuotes: calculatedHops,
      path,
    } of uncleanedQuotes) {
      // If the route was successful at each step, add it to the clean quote stack
      const filteredCalculatedEdges = calculatedHops.flatMap((val) =>
        !!val && val.success ? val : []
      );
      if (filteredCalculatedEdges.length === hopPoolAddrs.length) {
        const [input, output] = [
          filteredCalculatedEdges[0].amountIn,
          filteredCalculatedEdges[filteredCalculatedEdges.length - 1].amountOut,
        ];
        cleanedQuoteMap[percent].push({
          path,
          splitPercent: percent,
          edgesPoolAddrs: hopPoolAddrs,
          amountIn: input,
          amountOut: output,
          calculatedEdgeQuotes: filteredCalculatedEdges,
        });
        continue;
      }

      // If a route failed, there would only be one failure
      const quoteFailures = calculatedHops.flatMap((f) => (f && !f?.success ? f : []));
      failureErrors.add(quoteFailures[0].error);
    }
  }

  // Prune the quote map to only include the top N quotes
  const prunedQuoteMap: SanitizedQuoteMap = {};
  const sortFn = amountSpecifiedIsInput
    ? (a: PathQuote, b: PathQuote) => b.amountOut.cmp(a.amountOut)
    : (a: PathQuote, b: PathQuote) => a.amountIn.cmp(b.amountIn);
  for (let i = 0; i < percents.length; i++) {
    const sortedQuotes = cleanedQuoteMap[percents[i]].sort(sortFn);
    const slicedSorted = sortedQuotes.slice(0, pruneN);
    prunedQuoteMap[percents[i]] = slicedSorted;
  }

  return [prunedQuoteMap, failureErrors] as const;
}

function getSplitPercentageAmts(inputAmount: BN, minPercent: number = 5) {
  const percents = [];
  const amounts = [];

  for (let i = 1; i <= 100 / minPercent; i++) {
    percents.push(i * minPercent);
    amounts.push(inputAmount.mul(new BN(i * minPercent)).div(new BN(100)));
  }

  return { percents, amounts };
}
