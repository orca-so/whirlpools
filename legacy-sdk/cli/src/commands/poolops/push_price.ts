import { PublicKey } from "@solana/web3.js";
import type { SwapV2Params } from "@orca-so/whirlpools-sdk";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  WhirlpoolIx,
  PriceMath,
  TICK_ARRAY_SIZE,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  SwapUtils,
  IGNORE_CACHE,
  swapQuoteWithParams,
  TokenExtensionUtil,
  PREFER_CACHE,
} from "@orca-so/whirlpools-sdk";
import {
  DecimalUtil,
  Percentage,
  TransactionBuilder,
  U64_MAX,
} from "@orca-so/common-sdk";
import BN from "bn.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sendTransaction } from "../../utils/transaction_sender";
import Decimal from "decimal.js";
import { ctx } from "../../utils/provider";
import { promptConfirm, promptText } from "../../utils/prompt";

const SIGNIFICANT_DIGITS = 9;

console.info("try to push pool price...");

// prompt
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");

const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}
const tickSpacing = whirlpool.tickSpacing;

const tokenMintAPubkey = whirlpool.tokenMintA;
const tokenMintBPubkey = whirlpool.tokenMintB;
const mintA = await ctx.fetcher.getMintInfo(tokenMintAPubkey);
const mintB = await ctx.fetcher.getMintInfo(tokenMintBPubkey);
if (!mintA || !mintB) {
  // extremely rare case (CloseMint extension on Token-2022 is used)
  throw new Error("token mint not found");
}
const decimalsA = mintA.decimals;
const decimalsB = mintB.decimals;
const currentPrice = PriceMath.sqrtPriceX64ToPrice(
  whirlpool.sqrtPrice,
  decimalsA,
  decimalsB,
);

console.info(
  "tokenMintA",
  tokenMintAPubkey.toBase58(),
  `(${mintA.tokenProgram})`,
);
console.info(
  "tokenMintB",
  tokenMintBPubkey.toBase58(),
  `(${mintB.tokenProgram})`,
);

const currentTickIndex = whirlpool.tickCurrentIndex;

// yeah, there is obviously edge-case, but it is okay because this is just a dev tool
const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
const targetTickIndexMax = Math.min(
  Math.ceil(currentTickIndex / ticksInArray) * ticksInArray +
    2 * ticksInArray -
    1,
  MAX_TICK_INDEX,
);
const targetTickIndexMin = Math.max(
  Math.floor(currentTickIndex / ticksInArray) * ticksInArray - 2 * ticksInArray,
  MIN_TICK_INDEX,
);

const targetPriceMax = PriceMath.tickIndexToPrice(
  targetTickIndexMax,
  decimalsA,
  decimalsB,
);
const targetPriceMin = PriceMath.tickIndexToPrice(
  targetTickIndexMin,
  decimalsA,
  decimalsB,
);
const targetSqrtPriceMax = PriceMath.priceToSqrtPriceX64(
  targetPriceMax,
  decimalsA,
  decimalsB,
);
const targetSqrtPriceMin = PriceMath.priceToSqrtPriceX64(
  targetPriceMin,
  decimalsA,
  decimalsB,
);

let targetSqrtPrice: BN;
while (true) {
  console.info(`current price: ${currentPrice.toSD(SIGNIFICANT_DIGITS)} B/A`);
  console.info(
    `available target price range: ${targetPriceMin.toSD(SIGNIFICANT_DIGITS)} B/A ~ ${targetPriceMax.toSD(SIGNIFICANT_DIGITS)} B/A`,
  );

  const targetPriceStr = await promptText("targetPrice");
  const targetPrice = new Decimal(targetPriceStr);
  targetSqrtPrice = PriceMath.priceToSqrtPriceX64(
    targetPrice,
    decimalsA,
    decimalsB,
  );

  if (
    targetSqrtPrice.lt(targetSqrtPriceMin) ||
    targetSqrtPrice.gt(targetSqrtPriceMax)
  ) {
    console.info("invalid target price");
    continue;
  }

  console.info(`target price: ${targetPrice.toSD(SIGNIFICANT_DIGITS)} B/A`);
  console.info(`is target price OK ? (if it is OK, enter OK)`);
  const ok = await promptConfirm("OK");
  if (ok) {
    break;
  }
}

// get swap quote
const aToB = targetSqrtPrice.lt(whirlpool.sqrtPrice);
const inputToken = aToB ? mintA : mintB;
const outputToken = aToB ? mintB : mintA;

const tickArrays = await SwapUtils.getTickArrays(
  whirlpool.tickCurrentIndex,
  tickSpacing,
  aToB,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  whirlpoolPubkey,
  ctx.fetcher,
  IGNORE_CACHE,
);

const tokenExtensionCtx =
  await TokenExtensionUtil.buildTokenExtensionContextForPool(
    ctx.fetcher,
    tokenMintAPubkey,
    tokenMintBPubkey,
    PREFER_CACHE,
  );
const quote = swapQuoteWithParams(
  {
    aToB,
    amountSpecifiedIsInput: true,
    otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
    tickArrays,
    whirlpoolData: whirlpool,
    tokenExtensionCtx,
    oracleData: await SwapUtils.getOracle(
      ORCA_WHIRLPOOL_PROGRAM_ID,
      whirlpoolPubkey,
      ctx.fetcher,
      IGNORE_CACHE,
    ),
    // use too much input to estimate required input amount
    tokenAmount: U64_MAX,
    sqrtPriceLimit: targetSqrtPrice,
  },
  Percentage.fromFraction(1, 1000),
); // 0.1% slippage

console.info("aToB", quote.aToB);
console.info(
  "estimatedAmountIn",
  DecimalUtil.fromBN(quote.estimatedAmountIn, inputToken.decimals).toString(),
  aToB ? "A" : "B",
);
console.info(
  "estimatedAmountOut",
  DecimalUtil.fromBN(quote.estimatedAmountOut, outputToken.decimals).toString(),
  aToB ? "B" : "A",
);

// ok prompt
console.info(`OK ? (if it is OK, enter OK)`);
const ok = await promptConfirm("OK");
if (!ok) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

const tokenOwnerAccountA = getAssociatedTokenAddressSync(
  tokenMintAPubkey,
  ctx.wallet.publicKey,
  undefined,
  mintA.tokenProgram,
);
const tokenOwnerAccountB = getAssociatedTokenAddressSync(
  tokenMintBPubkey,
  ctx.wallet.publicKey,
  undefined,
  mintB.tokenProgram,
);
const swapV2Params: SwapV2Params = {
  amount: quote.amount,
  amountSpecifiedIsInput: quote.amountSpecifiedIsInput,
  aToB: quote.aToB,
  sqrtPriceLimit: targetSqrtPrice,
  otherAmountThreshold: quote.otherAmountThreshold,
  tokenAuthority: ctx.wallet.publicKey,
  tokenMintA: tokenMintAPubkey,
  tokenMintB: tokenMintBPubkey,
  tokenOwnerAccountA,
  tokenOwnerAccountB,
  tokenVaultA: whirlpool.tokenVaultA,
  tokenVaultB: whirlpool.tokenVaultB,
  whirlpool: whirlpoolPubkey,
  tokenProgramA: mintA.tokenProgram,
  tokenProgramB: mintB.tokenProgram,
  oracle: PDAUtil.getOracle(ctx.program.programId, whirlpoolPubkey).publicKey,
  tickArray0: quote.tickArray0,
  tickArray1: quote.tickArray1,
  tickArray2: quote.tickArray2,
  ...TokenExtensionUtil.getExtraAccountMetasForTransferHookForPool(
    ctx.connection,
    tokenExtensionCtx,
    // hmm, why I didn't make Utility class more convenient ... ?
    aToB ? tokenOwnerAccountA : whirlpool.tokenVaultA,
    aToB ? whirlpool.tokenVaultA : tokenOwnerAccountA,
    aToB ? ctx.wallet.publicKey : whirlpoolPubkey,
    aToB ? whirlpool.tokenVaultB : tokenOwnerAccountB,
    aToB ? tokenOwnerAccountB : whirlpool.tokenVaultB,
    aToB ? whirlpoolPubkey : ctx.wallet.publicKey,
  ),
};

if (quote.estimatedAmountIn.isZero() && quote.estimatedAmountOut.isZero()) {
  // push empty pool price
  builder.addInstruction(
    WhirlpoolIx.swapV2Ix(ctx.program, {
      ...swapV2Params,
      // partial fill (intentional)
      amount: new BN(1),
      amountSpecifiedIsInput: false,
      sqrtPriceLimit: targetSqrtPrice,
      otherAmountThreshold: new BN(1),
    }),
  );
} else {
  builder.addInstruction(WhirlpoolIx.swapV2Ix(ctx.program, swapV2Params));
}

const landed = await sendTransaction(builder);
if (landed) {
  const postWhirlpool = await ctx.fetcher.getPool(
    whirlpoolPubkey,
    IGNORE_CACHE,
  );
  if (!postWhirlpool) {
    throw new Error("whirlpool not found");
  }
  const updatedPrice = PriceMath.sqrtPriceX64ToPrice(
    postWhirlpool.sqrtPrice,
    decimalsA,
    decimalsB,
  );
  // if arb bot executed opposite trade, the price will be reverted
  console.info(
    "updated current price",
    updatedPrice.toSD(SIGNIFICANT_DIGITS),
    "B/A",
  );
}

/*

SAMPLE EXECUTION LOG

$ yarn run pushPrice
yarn run v1.22.22
$ npx ts-node src/push_price.ts
connection endpoint https://orca.mainnet.eclipse.rpcpool.com/xxxxxxxxxxxxxx
wallet EvQdhqCLKc6Sh6mxvzF7pMrCjhnMzsJCvXEmYfu18Boj
try to push pool price...
prompt: whirlpoolPubkey:  44w4HrojzxKwxEb3bmjRNcJ4irFhUGBUjrCYecYhPvqq
tokenMintA So11111111111111111111111111111111111111112 (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
tokenMintB AKEWE7Bgh87GPp171b4cJPSSZfmZwQ3KaqYqXoKLNAEE (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
current price: 1054.7755 B/A
available target price range: 868.669141 B/A ~ 1235.02281 B/A
prompt: targetPrice:  1080
target price: 1080 B/A
is target price OK ? (if it is OK, enter OK)
prompt: OK:  OK
aToB false
estimatedAmountIn 0.333295 B
estimatedAmountOut 0.00031196 A
OK ? (if it is OK, enter OK)
prompt: OK:  OK
estimatedComputeUnits: 176958
prompt: priorityFeeInSOL:  0.0000001
Priority fee: 1e-7 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 23KANyU2dQCowps4HEstxHsqZMJS8GYJV7hb6NZhrVPQfmk1aRHFHMVMdxY1sVcEsbTe37ozqd513orzH7fZHnJP
updated current price 1079.99999 B/A
✨  Done in 49.55s.

*/
