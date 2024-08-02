import BN from "bn.js";
import { kSmallestPartition } from "../utils/math/k-smallest-partition";
import { RoutingOptions, SubTradeRoute, TradeRoute } from "./public";
import { PathQuote, SanitizedQuoteMap } from "./quote-map";

export function getBestRoutesFromQuoteMap(
  quoteMap: SanitizedQuoteMap,
  amountSpecifiedIsInput: boolean,
  opts: RoutingOptions
): TradeRoute[] {
  const { numTopRoutes, maxSplits } = opts;
  const sortedRoutes = [
    ...getRankedRoutes(quoteMap, amountSpecifiedIsInput, numTopRoutes, maxSplits),
    ...getSingleHopSplit(quoteMap),
  ].sort(getRouteCompareFn(amountSpecifiedIsInput));

  return convertInternalRoutesToTradeRoutes(sortedRoutes);
}

function convertInternalRoutesToTradeRoutes(internalRoutes: InternalRoute[]): TradeRoute[] {
  const tradeRoutes: TradeRoute[] = internalRoutes.map((internalRoute) => {
    const { quotes, totalIn, totalOut } = internalRoute;
    return {
      subRoutes: quotes.map((quote) => convertPathQuoteToSubTradeRoute(quote)),
      totalAmountIn: totalIn,
      totalAmountOut: totalOut,
    };
  });
  return tradeRoutes;
}

function convertPathQuoteToSubTradeRoute(pathQuote: PathQuote): SubTradeRoute {
  const { calculatedEdgeQuotes, path, splitPercent, amountIn, amountOut } = pathQuote;
  return {
    path,
    splitPercent,
    amountIn,
    amountOut,
    hopQuotes: calculatedEdgeQuotes,
  };
}

type InternalRoute = {
  quotes: PathQuote[];
  splitPercent: number;
  totalIn: BN;
  totalOut: BN;
};

function getSingleHopSplit(quoteMap: SanitizedQuoteMap): InternalRoute[] {
  const fullFlow = quoteMap[100];
  if (fullFlow) {
    return fullFlow
      .filter((f) => f.calculatedEdgeQuotes.length == 1)
      .map((f) => {
        const oneHop = f.calculatedEdgeQuotes[0];
        return {
          quotes: [f],
          splitPercent: 100,
          totalIn: oneHop.amountIn,
          totalOut: oneHop.amountOut,
        };
      })
      .flatMap((g) => (!!g ? g : []));
  }
  return [];
}

function getRankedRoutes(
  percentMap: SanitizedQuoteMap,
  amountSpecifiedIsInput: boolean,
  topN: number,
  maxSplits: number
): InternalRoute[] {
  let routes = generateRoutes(percentMap, maxSplits);

  // Run quick select algorithm to partition the topN results, mutating inplace
  const routeCompare = getRouteCompareFn(amountSpecifiedIsInput);

  if (routes.length <= topN) {
    return routes.sort(routeCompare);
  }

  kSmallestPartition(routes, topN, 0, routes.length - 1, routeCompare);
  return routes.slice(0, topN).sort(routeCompare);
}

function generateRoutes(percentMap: SanitizedQuoteMap, maxSplits: number): InternalRoute[] {
  let routes: InternalRoute[] = [];
  buildRoutes(
    percentMap,
    maxSplits,
    {
      quotes: [],
      splitPercent: 0,
      totalIn: new BN(0),
      totalOut: new BN(0),
    },
    routes
  );
  return routes;
}

function buildRoutes(
  quotePercentMap: SanitizedQuoteMap,
  maxSplits: number,
  currentRoute: InternalRoute,
  routes: InternalRoute[]
) {
  const { splitPercent: percent, quotes } = currentRoute;
  const percents = Object.keys(quotePercentMap).map((percent) => Number(percent));
  for (let i = percents.length - 1; i >= 0; i--) {
    const nextPercent = percents[i];
    const newPercentTotal = percent + nextPercent;

    // Optimization to prevent exceeding 100% flow and excess combinations of flow by only using decreasing
    // amounts of flow percentages
    const nextPercentIsSmaller =
      quotes.length > 0 && nextPercent > quotes[quotes.length - 1].splitPercent;
    if (newPercentTotal > 100 || nextPercentIsSmaller) {
      continue;
    }

    const nextPercentQuotes = quotePercentMap[nextPercent];
    for (let j = 0; j < nextPercentQuotes.length; j++) {
      const nextQuote = nextPercentQuotes[j];

      // Don't use a quote that shares a pool with an existing quote
      const hasReusedPools = nextQuote.edgesPoolAddrs.some((r1) =>
        quotes.some((r2) => r2.edgesPoolAddrs.some((r3) => r3.indexOf(r1) !== -1))
      );
      if (hasReusedPools) {
        continue;
      }

      // todo: Doesn't take into transaction fees
      // double-hops, multi-route penalties, benefits for pairs that can share lookup tables
      const nextRoute: InternalRoute = {
        quotes: [...quotes, nextQuote],
        splitPercent: newPercentTotal,
        totalIn: currentRoute.totalIn.add(nextQuote.amountIn),
        totalOut: currentRoute.totalOut.add(nextQuote.amountOut),
      };

      // Remove the current and prior routes from consideration
      const nextCandidateQuotes = nextPercentQuotes.slice(j + 1);

      if (newPercentTotal === 100) {
        // If we have reached 100% flow routed, we add it to the set of valid route sets
        routes.push(nextRoute);
      } else if (quotes.length + 1 != maxSplits) {
        // Otherwise, recursively build route sets
        buildRoutes(
          {
            ...quotePercentMap,
            [nextPercent]: nextCandidateQuotes,
          },
          maxSplits,
          nextRoute,
          routes
        );
      }
    }
  }
}

function getRouteCompareFn(amountSpecifiedIsInput: boolean) {
  return amountSpecifiedIsInput ? routesCompareForInputAmount : routesCompareForOutputAmount;
}

function routesCompareForInputAmount(a: InternalRoute, b: InternalRoute) {
  return b.totalOut.cmp(a.totalOut);
}

function routesCompareForOutputAmount(a: InternalRoute, b: InternalRoute) {
  return a.totalIn.cmp(b.totalIn);
}
