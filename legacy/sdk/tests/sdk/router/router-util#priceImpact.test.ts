import { Percentage } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PriceMath, RouterUtils } from "../../../src";
import { U64 } from "../../../src/utils/math/constants";

const maxDecimalAccuracy = 4;
describe("RouterUtil - Price Impact tests", () => {
  // Mock a Orca -> USDC ExactIn trade that has no split route and goes through a single hop (ORCA -> USDC)
  it("ExactIn, a->b true, single-hop, 1 split", () => {
    const params: RouteTestParam = {
      amountSpecifiedIsInput: true,
      totalAmountIn: new BN("1000000"),
      totalAmountOut: new BN("581050"),
      subRouteParams: [
        {
          hops: [
            {
              aToB: true,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("14082503933855903449"),
              amountIn: new BN("1000000"),
              amountOut: new BN("581050"),
            },
          ],
        },
      ],
    };
    const { trade, routes } = buildRouteTest(params);
    const impact = RouterUtils.getPriceImpactForRoute(trade, routes).toDecimalPlaces(
      maxDecimalAccuracy
    );
    const expect = calculateImpact(params).toDecimalPlaces(maxDecimalAccuracy);
    assert.equal(impact.toString(), expect.toString());
  });

  // Mock a Orca -> USDC ExactOut trade that has no split route and goes through a single hop (ORCA -> USDC)
  it("ExactOut, a->b false, single-hop, 1 split", () => {
    const params: RouteTestParam = {
      amountSpecifiedIsInput: false,
      totalAmountIn: new BN("5833496"),
      totalAmountOut: new BN("10000000"),
      subRouteParams: [
        {
          hops: [
            {
              aToB: false,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("14067691597581169278"),
              amountIn: new BN("5833496"),
              amountOut: new BN("10000000"),
            },
          ],
        },
      ],
    };
    const { trade, routes } = buildRouteTest(params);
    const impact = RouterUtils.getPriceImpactForRoute(trade, routes).toDecimalPlaces(
      maxDecimalAccuracy
    );
    const expect = calculateImpact(params).toDecimalPlaces(maxDecimalAccuracy);
    assert.equal(impact.toString(), expect.toString());
  });

  // Mock a ORCA -> USDC trade that has 2 split route and goes through a multi-hop (ORCA -> SOL -> USDC)
  it("ExactIn, mix a->b, single & multi-hop, 2 splits", () => {
    const params: RouteTestParam = {
      amountSpecifiedIsInput: true,
      totalAmountIn: new BN("40000000000"),
      totalAmountOut: new BN("22277933969"),
      subRouteParams: [
        {
          hops: [
            {
              aToB: false,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("3363616053614750676"),
              amountIn: new BN("32000000000"),
              amountOut: new BN("925083736236"),
            },
            {
              aToB: true,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("2567715337494939945"),
              amountIn: new BN("925083736236"),
              amountOut: new BN("17871834810"),
            },
          ],
        },
        {
          hops: [
            {
              aToB: true,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("14082503933855903449"),
              amountIn: new BN("8000000000"),
              amountOut: new BN("4406099159"),
            },
          ],
        },
      ],
    };
    const { trade, routes } = buildRouteTest(params);
    const impact = RouterUtils.getPriceImpactForRoute(trade, routes).toDecimalPlaces(
      maxDecimalAccuracy
    );
    const expect = calculateImpact(params).toDecimalPlaces(maxDecimalAccuracy);
    assert.equal(impact.toString(), expect.toString());
  });

  // Mock an ExactOut ORCA -> USDC trade that has 2 split route and goes through a multi-hop (ORCA -> SOL -> USDC)
  it("ExactOut, mix a->b, single & multi-hop, 2 splits", () => {
    const params: RouteTestParam = {
      amountSpecifiedIsInput: false,
      totalAmountIn: new BN("64800628033"),
      totalAmountOut: new BN("34000000000"),
      subRouteParams: [
        {
          hops: [
            {
              aToB: true,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("14067691597581169278"),
              amountIn: new BN("13107594181"),
              amountOut: new BN("6800000000"),
            },
          ],
        },
        {
          hops: [
            {
              aToB: false,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("3366318822902200326"),
              amountIn: new BN("51693033852"),
              amountOut: new BN("1403541983350"),
            },
            {
              aToB: true,
              feeRate: Percentage.fromFraction(3000, 1000000),
              sqrtPrice: new BN("2572953144905521240"),
              amountIn: new BN("1403541983350"),
              amountOut: new BN("27200000000"),
            },
          ],
        },
      ],
    };
    const { trade, routes } = buildRouteTest(params);
    const impact = RouterUtils.getPriceImpactForRoute(trade, routes).toDecimalPlaces(
      maxDecimalAccuracy
    );
    const expect = calculateImpact(params).toDecimalPlaces(maxDecimalAccuracy);
    assert.equal(impact.toString(), expect.toString());
  });

  // NOTE: The precision kept in these calculation slightly differs from the U64 calculation that we get from the RouterUtil function.
  function calculateImpact(params: RouteTestParam): Decimal {
    const { amountSpecifiedIsInput, totalAmountIn, totalAmountOut } = params;

    const finalBaseValue = params.subRouteParams
      .map((subRoute) => {
        const { hops } = subRoute;
        const directionalHops = amountSpecifiedIsInput ? hops : hops.slice().reverse();
        const hopResults: Decimal[] = new Array(hops.length);
        directionalHops.forEach((hop, index) => {
          const { aToB, feeRate, sqrtPrice, amountIn, amountOut } = hop;
          const directionalSqrtPrice = aToB
            ? new Decimal(sqrtPrice.toString())
            : new Decimal(PriceMath.invertSqrtPriceX64(sqrtPrice).toString());
          const directionalPrice = directionalSqrtPrice
            .pow(2)
            .div(U64.toString())
            .div(U64.toString());
          if (amountSpecifiedIsInput) {
            const amountInDec =
              index === 0 ? new Decimal(amountIn.toString()) : hopResults[index - 1];
            const amountOutDec = amountInDec
              .times(new Decimal(1).sub(feeRate.toDecimal()))
              .times(directionalPrice);
            hopResults[index] = amountOutDec.round();
          } else {
            const amountOutDec =
              index === 0 ? new Decimal(amountOut.toString()) : hopResults[index - 1];
            const amountInDec = amountOutDec
              .div(new Decimal(1).sub(feeRate.toDecimal()))
              .div(directionalPrice);
            hopResults[index] = amountInDec.round();
          }
        });
        return hopResults[hops.length - 1];
      })
      .reduce((acc, cur) => acc.add(cur), new Decimal(0));

    if (amountSpecifiedIsInput) {
      const totalAmountOutDec = new Decimal(totalAmountOut.toString());
      return finalBaseValue.sub(totalAmountOutDec).div(finalBaseValue).mul(100);
    } else {
      const totalAmountInDec = new Decimal(totalAmountIn.toString());
      return totalAmountInDec.sub(finalBaseValue).div(totalAmountInDec).mul(100);
    }
  }

  type TradeHopTestParam = {
    aToB: boolean;
    feeRate: Percentage;
    sqrtPrice: BN;
    amountIn: BN;
    amountOut: BN;
  };
  type SubRouteTestParam = {
    hops: TradeHopTestParam[];
  };
  type RouteTestParam = {
    amountSpecifiedIsInput: boolean;
    subRouteParams: SubRouteTestParam[];
    totalAmountIn: BN;
    totalAmountOut: BN;
  };
  function buildRouteTest(params: RouteTestParam) {
    return {
      trade: {
        tokenIn: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
        tokenOut: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tradeAmount: new BN(0),
        amountSpecifiedIsInput: params.amountSpecifiedIsInput,
      },
      routes: {
        subRoutes: params.subRouteParams.map((subRouteParam) => {
          return {
            hopQuotes: subRouteParam.hops.map((hopParam) => {
              return {
                amountIn: hopParam.amountIn,
                amountOut: hopParam.amountOut,
                whirlpool: PublicKey.default,
                inputMint: PublicKey.default,
                outputMint: PublicKey.default,
                mintA: PublicKey.default,
                mintB: PublicKey.default,
                vaultA: PublicKey.default,
                vaultB: PublicKey.default,
                quote: {
                  amount: new BN(0),
                  otherAmountThreshold: new BN(0),
                  sqrtPriceLimit: new BN(0),
                  amountSpecifiedIsInput: params.amountSpecifiedIsInput,
                  aToB: hopParam.aToB,
                  tickArray0: PublicKey.default,
                  tickArray1: PublicKey.default,
                  tickArray2: PublicKey.default,
                  estimatedAmountIn: new BN(0),
                  estimatedAmountOut: new BN(0),
                  estimatedEndTickIndex: 0,
                  estimatedEndSqrtPrice: new BN(0),
                  estimatedFeeAmount: new BN(0),
                  transferFee: {
                    deductingFromEstimatedAmountIn: new BN(0),
                    deductedFromEstimatedAmountOut: new BN(0),
                  },                
                },
                snapshot: {
                  aToB: hopParam.aToB,
                  feeRate: hopParam.feeRate,
                  sqrtPrice: hopParam.sqrtPrice,
                },
              };
            }),
            path: {
              startTokenMint: "startTokenMint",
              endTokenMint: "endTokenMint",
              edges: [],
            },
            splitPercent: 30,
            amountIn: new BN(0),
            amountOut: new BN(0),
          };
        }),
        totalAmountIn: params.totalAmountIn,
        totalAmountOut: params.totalAmountOut,
      },
    };
  }
});
