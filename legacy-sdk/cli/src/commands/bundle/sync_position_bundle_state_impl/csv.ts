import { Percentage } from "@orca-so/common-sdk";
import {
  buildWhirlpoolClient,
  IGNORE_CACHE,
  increaseLiquidityQuoteByLiquidityWithParams,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  POSITION_BUNDLE_SIZE,
  PriceMath,
  TickUtil,
  TokenExtensionUtil,
  WhirlpoolData
} from "@orca-so/whirlpools-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { readFileSync } from "fs";
import { ctx } from "../../../utils/provider";

export type PositionBundleOpenState = {
  state: "open";
  lowerTickIndex: number;
  upperTickIndex: number;
  liquidity: BN;
};
export type PositionBundleClosedState = { state: "closed" };
export type PositionBundleStateItem =
  | PositionBundleOpenState
  | PositionBundleClosedState;

export async function readCustomPositionBundleStateCsv(
  whirlpoolPubkey: PublicKey,
  positionBundleStateCsvPath: string,
  tickSpacing: number,
): Promise<PositionBundleStateItem[]> {

  const whirlpool = (await ctx.fetcher.getPool(
    whirlpoolPubkey,
    IGNORE_CACHE,
  )) as WhirlpoolData;

  const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(
    ctx.fetcher,
    whirlpool,
    IGNORE_CACHE,
  );

  const client = buildWhirlpoolClient(ctx);

  const pool = await client.getPool(whirlpoolPubkey);

  const tokenADecimal = tokenExtensionCtx.tokenMintWithProgramA.decimals;
  const tokenBDecimal = tokenExtensionCtx.tokenMintWithProgramB.decimals;

  const clientToken = whirlpool.tokenMintB.equals(new PublicKey('So11111111111111111111111111111111111111112')) ?
    whirlpool.tokenMintA : whirlpool.tokenMintB;

  // read entire CSV file
  const csv = readFileSync(positionBundleStateCsvPath, "utf8");

  // parse CSV (trim is needed for safety (remove CR code))
  const lines = csv.split("\n");
  const header = lines[0].trim();
  const data = lines.slice(1).map((line) => line.trim().split(","));

  // check header
  const EXPECTED_HEADER =
    "bundle index,state,min price,max price,token amount";
  if (header !== EXPECTED_HEADER) {
    console.debug(`${header}<`);
    console.debug(`${EXPECTED_HEADER}<`);
    throw new Error(`unexpected header: ${header}`);
  }

  // Delete the last line of the data
  data.pop();

  // check data
  if (data.length !== POSITION_BUNDLE_SIZE) {
    // Pad the data with empty strings to make it the correct length with correct bundle index 
    let x = data.length;
    while (data.length < POSITION_BUNDLE_SIZE) {
      data.push([x.toString(), "closed", "", "", ""]);
      x++;
    }
  }

  // parse data
  return data.map((entry, expectedBundleIndex) => {
    // sanity checks...
    if (entry.length !== 5) {
      throw new Error(
        `unexpected entry length: ${entry.length}, line: ${entry}`,
      );
    }

    const bundleIndex = parseInt(entry[0]);
    if (bundleIndex !== expectedBundleIndex) {
      throw new Error(
        `unexpected bundle index: ${bundleIndex}, expected: ${expectedBundleIndex}`,
      );
    }

    const state = entry[1];
    if (state === "closed") {
      return { state: "closed" };
    }
    if (state !== "open") {
      throw new Error(`unexpected state: ${state}`);
    }


    const minPrice = parseFloat(entry[2]);
    const maxPrice = parseFloat(entry[3]);

    const lowerTickIndex1 = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(new Decimal(minPrice), tokenADecimal, tokenBDecimal),
      whirlpool.tickSpacing,
    );
    const upperTickIndex1 = TickUtil.getInitializableTickIndex(
      PriceMath.priceToTickIndex(new Decimal(maxPrice), tokenADecimal, tokenBDecimal),
      whirlpool.tickSpacing,
    );

    const [lowerTickIndex, upperTickIndex] = [lowerTickIndex1, upperTickIndex1];

    if (isNaN(lowerTickIndex) || isNaN(upperTickIndex)) {
      throw new Error(
        `invalid tick indexes (not number): ${entry[2]}, ${entry[3]}`,
      );
    }
    if (lowerTickIndex >= upperTickIndex) {
      throw new Error(
        `invalid tick indexes (lower >= upper): ${entry[2]}, ${entry[3]}`,
      );
    }
    if (lowerTickIndex < MIN_TICK_INDEX || upperTickIndex > MAX_TICK_INDEX) {
      throw new Error(
        `invalid tick indexes (out of range): ${entry[2]}, ${entry[3]}`,
      );
    }
    if (
      lowerTickIndex % tickSpacing !== 0 ||
      upperTickIndex % tickSpacing !== 0
    ) {
      throw new Error(
        `invalid tick indexes (not initializable): ${entry[2]}, ${entry[3]}`,
      );
    }


    // const result = increaseLiquidityQuoteByInputTokenWithParams({
    //   inputTokenAmount: new BN(entry[4]),
    //   inputTokenMint: clientToken,
    //   tokenMintA: whirlpool.tokenMintA,
    //   tokenMintB: whirlpool.tokenMintB,
    //   tickCurrentIndex: whirlpool.tickCurrentIndex,
    //   sqrtPrice: whirlpool.sqrtPrice,

    //   tickLowerIndex: lowerTickIndex,
    //   tickUpperIndex: upperTickIndex,
    //   tokenExtensionCtx: tokenExtensionCtx,
    //   slippageTolerance: Percentage.fromFraction(0, 100),
    // })
    const result = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new BN(entry[4]),
      tickCurrentIndex: whirlpool.tickCurrentIndex,
      sqrtPrice: whirlpool.sqrtPrice,
      tickLowerIndex: lowerTickIndex,
      tickUpperIndex: upperTickIndex,
      tokenExtensionCtx: tokenExtensionCtx,
      slippageTolerance: Percentage.fromFraction(0, 100),
    })

    console.log(JSON.stringify({
      clientToken: clientToken.toBase58(),
      tokenMintA: whirlpool.tokenMintA.toBase58(),
      tokenMintB: whirlpool.tokenMintB.toBase58(),
      inputTokenAmount: entry[4],
      tickCurrentIndex: whirlpool.tickCurrentIndex,
      price: PriceMath.tickIndexToPrice(whirlpool.tickCurrentIndex, tokenADecimal, tokenBDecimal).toString(),
      sqrtPrice: whirlpool.sqrtPrice.toString(),
      priceAtSqrtPrice: PriceMath.sqrtPriceX64ToPrice(whirlpool.sqrtPrice, tokenADecimal, tokenBDecimal),
      tickLowerIndex: lowerTickIndex,
      tickLowerPrice: PriceMath.tickIndexToPrice(lowerTickIndex, tokenADecimal, tokenBDecimal).toString(),
      tickUpperIndex: upperTickIndex,
      tickUpperPrice: PriceMath.tickIndexToPrice(upperTickIndex, tokenADecimal, tokenBDecimal).toString(),
      currentTick: whirlpool.tickCurrentIndex,
      liquidity: result.liquidityAmount.toString(),
      tokenEstA: result.tokenEstA.toString(),
      tokenEstB: result.tokenEstB.toString(),
    }, null, 2));

    const liquidity = result.liquidityAmount;
    return { state: "open", lowerTickIndex, upperTickIndex, liquidity };
  });
}


// export function readPositionBundleStateCsv(
//   positionBundleStateCsvPath: string,
//   tickSpacing: number,
// ): PositionBundleStateItem[] {
//   // read entire CSV file
//   const csv = readFileSync(positionBundleStateCsvPath, "utf8");

//   // parse CSV (trim is needed for safety (remove CR code))
//   const lines = csv.split("\n");
//   const header = lines[0].trim();
//   const data = lines.slice(1).map((line) => line.trim().split(","));

//   // check header
//   const EXPECTED_HEADER =
//     "bundle index,state,lower tick index,upper tick index,liquidity";
//   if (header !== EXPECTED_HEADER) {
//     console.debug(`${header}<`);
//     console.debug(`${EXPECTED_HEADER}<`);
//     throw new Error(`unexpected header: ${header}`);
//   }

//   // check data
//   if (data.length !== POSITION_BUNDLE_SIZE) {
//     throw new Error(
//       `unexpected data length: ${data.length} (must be ${POSITION_BUNDLE_SIZE})`,
//     );
//   }

//   // parse data
//   return data.map((entry, expectedBundleIndex) => {
//     // sanity checks...

//     if (entry.length !== 5) {
//       throw new Error(
//         `unexpected entry length: ${entry.length}, line: ${entry}`,
//       );
//     }

//     const bundleIndex = parseInt(entry[0]);
//     if (bundleIndex !== expectedBundleIndex) {
//       throw new Error(
//         `unexpected bundle index: ${bundleIndex}, expected: ${expectedBundleIndex}`,
//       );
//     }

//     const state = entry[1];
//     if (state === "closed") {
//       return { state: "closed" };
//     }
//     if (state !== "open") {
//       throw new Error(`unexpected state: ${state}`);
//     }

//     const lowerTickIndex = parseInt(entry[2]);
//     const upperTickIndex = parseInt(entry[3]);
//     const liquidity = new BN(entry[4]);
//     if (isNaN(lowerTickIndex) || isNaN(upperTickIndex)) {
//       throw new Error(
//         `invalid tick indexes (not number): ${entry[2]}, ${entry[3]}`,
//       );
//     }
//     if (lowerTickIndex >= upperTickIndex) {
//       throw new Error(
//         `invalid tick indexes (lower >= upper): ${entry[2]}, ${entry[3]}`,
//       );
//     }
//     if (lowerTickIndex < MIN_TICK_INDEX || upperTickIndex > MAX_TICK_INDEX) {
//       throw new Error(
//         `invalid tick indexes (out of range): ${entry[2]}, ${entry[3]}`,
//       );
//     }
//     if (
//       lowerTickIndex % tickSpacing !== 0 ||
//       upperTickIndex % tickSpacing !== 0
//     ) {
//       throw new Error(
//         `invalid tick indexes (not initializable): ${entry[2]}, ${entry[3]}`,
//       );
//     }

//     return { state: "open", lowerTickIndex, upperTickIndex, liquidity };
//   });
// }
