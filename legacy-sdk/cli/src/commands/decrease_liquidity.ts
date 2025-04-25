import { PublicKey } from "@solana/web3.js";
import type { DecreaseLiquidityQuote } from "@orca-so/whirlpools-sdk";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  WhirlpoolIx,
  PoolUtil,
  PriceMath,
  IGNORE_CACHE,
  decreaseLiquidityQuoteByLiquidityWithParams,
} from "@orca-so/whirlpools-sdk";
import {
  DecimalUtil,
  Percentage,
  TransactionBuilder,
} from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import Decimal from "decimal.js";
import { calcDepositRatio } from "../utils/deposit_ratio";
import BN from "bn.js";
import { TokenExtensionUtil } from "@orca-so/whirlpools-sdk/dist/utils/public/token-extension-util";
import { ctx } from "../utils/provider";
import { promptConfirm, promptNumber, promptText } from "../utils/prompt";

console.info("decrease Liquidity...");

// prompt
const positionPubkeyStr = await promptText("positionPubkey");

const positionPubkey = new PublicKey(positionPubkeyStr);
const position = await ctx.fetcher.getPosition(positionPubkey);
if (!position) {
  throw new Error("position not found");
}
const positionMint = await ctx.fetcher.getMintInfo(position.positionMint);
if (!positionMint) {
  throw new Error("positionMint not found");
}

const whirlpoolPubkey = position.whirlpool;
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

const currentBalance = PoolUtil.getTokenAmountsFromLiquidity(
  position.liquidity,
  whirlpool.sqrtPrice,
  PriceMath.tickIndexToSqrtPriceX64(position.tickLowerIndex),
  PriceMath.tickIndexToSqrtPriceX64(position.tickUpperIndex),
  false,
);
console.info(
  `current liquidity: ${position.liquidity} (${DecimalUtil.fromBN(currentBalance.tokenA, decimalsA).toSD(6)} A, ${DecimalUtil.fromBN(currentBalance.tokenB, decimalsB).toSD(6)} B)`,
);
console.info(
  "lowerPrice(Index):",
  PriceMath.tickIndexToPrice(
    position.tickLowerIndex,
    decimalsA,
    decimalsB,
  ).toSD(6),
  `(${position.tickLowerIndex})`,
);
console.info(
  "upperPrice(Index):",
  PriceMath.tickIndexToPrice(
    position.tickUpperIndex,
    decimalsA,
    decimalsB,
  ).toSD(6),
  `(${position.tickUpperIndex})`,
);

const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
  position.tickLowerIndex,
);
const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
  position.tickUpperIndex,
);
const depositRatio = calcDepositRatio(
  whirlpool.sqrtPrice,
  lowerSqrtPrice,
  upperSqrtPrice,
  decimalsA,
  decimalsB,
);
console.info(`current price: ${currentPrice.toSD(6)} B/A`);
console.info(
  `deposit ratio A:B ${depositRatio[0].toFixed(2)}% : ${depositRatio[1].toFixed(2)}%`,
);

let decreaseLiquidityQuote: DecreaseLiquidityQuote;
while (true) {
  console.info();
  const decreaseLiquidityAmountOrPercentage = await promptText(
    "Please enter liquidity amount to decrease or enter percentage to decrease with % (e.g. 10%)",
  );

  let liquidityAmount: BN;
  if (decreaseLiquidityAmountOrPercentage.trim().endsWith("%")) {
    const percentage = new Decimal(
      decreaseLiquidityAmountOrPercentage.trim().slice(0, -1),
    );
    if (percentage.gt(100) || percentage.lessThanOrEqualTo(0)) {
      console.info("invalid percentage");
      continue;
    }
    const liquidity = new Decimal(position.liquidity.toString());
    liquidityAmount = new BN(
      liquidity.mul(percentage).div(100).floor().toString(),
    );
  } else {
    liquidityAmount = new BN(decreaseLiquidityAmountOrPercentage);
    if (liquidityAmount.gt(position.liquidity)) {
      console.info("too large liquidity amount");
      continue;
    }
  }

  const decimalSlippagePercentNum = await promptNumber(
    "decimalSlippagePercent",
  );
  const decimalSlippagePercent = new Decimal(decimalSlippagePercentNum);
  const slippage = Percentage.fromDecimal(decimalSlippagePercent);

  const quote = decreaseLiquidityQuoteByLiquidityWithParams({
    liquidity: liquidityAmount,
    sqrtPrice: whirlpool.sqrtPrice,
    tickCurrentIndex: whirlpool.tickCurrentIndex,
    tickLowerIndex: position.tickLowerIndex,
    tickUpperIndex: position.tickUpperIndex,
    tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
      ctx.fetcher,
      whirlpool,
      IGNORE_CACHE,
    ),
    slippageTolerance: slippage,
  });

  console.info(`liquidity DELTA: ${quote.liquidityAmount.toString()}`);
  console.info(
    `estimated tokenA: ${DecimalUtil.fromBN(quote.tokenEstA, decimalsA).toSD(6)} at least ${DecimalUtil.fromBN(quote.tokenMinA, decimalsA).toSD(6)}`,
  );
  console.info(
    `estimated tokenB: ${DecimalUtil.fromBN(quote.tokenEstB, decimalsB).toSD(6)} at least ${DecimalUtil.fromBN(quote.tokenMinB, decimalsB).toSD(6)}`,
  );

  const ok = await promptConfirm("If the above is OK, enter YES");
  if (ok) {
    decreaseLiquidityQuote = quote;
    break;
  }
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

builder.addInstruction(
  WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
    liquidityAmount: decreaseLiquidityQuote.liquidityAmount,
    tokenMinA: decreaseLiquidityQuote.tokenMinA,
    tokenMinB: decreaseLiquidityQuote.tokenMinB,
    position: positionPubkey,
    positionAuthority: ctx.wallet.publicKey,
    tokenMintA: tokenMintAPubkey,
    tokenMintB: tokenMintBPubkey,
    positionTokenAccount: getAssociatedTokenAddressSync(
      position.positionMint,
      ctx.wallet.publicKey,
      undefined,
      positionMint.tokenProgram,
    ),
    tickArrayLower: PDAUtil.getTickArrayFromTickIndex(
      position.tickLowerIndex,
      tickSpacing,
      whirlpoolPubkey,
      ORCA_WHIRLPOOL_PROGRAM_ID,
    ).publicKey,
    tickArrayUpper: PDAUtil.getTickArrayFromTickIndex(
      position.tickUpperIndex,
      tickSpacing,
      whirlpoolPubkey,
      ORCA_WHIRLPOOL_PROGRAM_ID,
    ).publicKey,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenProgramA: mintA.tokenProgram,
    tokenProgramB: mintB.tokenProgram,
    tokenVaultA: whirlpool.tokenVaultA,
    tokenVaultB: whirlpool.tokenVaultB,
    whirlpool: whirlpoolPubkey,
    tokenTransferHookAccountsA:
      await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
        ctx.provider.connection,
        mintA,
        tokenOwnerAccountA,
        whirlpool.tokenVaultA,
        ctx.wallet.publicKey,
      ),
    tokenTransferHookAccountsB:
      await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
        ctx.provider.connection,
        mintB,
        tokenOwnerAccountB,
        whirlpool.tokenVaultB,
        ctx.wallet.publicKey,
      ),
  }),
);

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
decrease Liquidity...
prompt: positionPubkey:  H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
tokenMintA Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
tokenMintB BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
current liquidity: 31538582 (9.96839 A, 0.099783 B)
lowerPrice(Index): 0.0000000000000000544947 (-443584)
upperPrice(Index): 18350300000000000000000 (443584)
current price: 0.0100099 B/A
deposit ratio A:B 50.00% : 50.00%
Please enter liquidity amount to decrease or enter percentage to decrease with % (e.g. 10%)
prompt: decreaseLiquidityAmountOrPercentage:  50%
prompt: decimalSlippagePercent:  10
liquidity DELTA: 15769291
estimated tokenA: 4.98419 at least 4.53108
estimated tokenB: 0.049891 at least 0.045355
if the above is OK, enter OK
prompt: OK:  OK
estimatedComputeUnits: 153091
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 2XPsDXqcX936gD46MM4MsyigaFcP7u2vxFCErYTKUMUXGVHphMFdx9P6ckoVnNeVDS1TxK1C5qn4LKg4ivz9c6um

*/
