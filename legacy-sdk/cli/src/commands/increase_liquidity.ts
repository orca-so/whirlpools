import { PublicKey } from "@solana/web3.js";
import type { IncreaseLiquidityQuote } from "@orca-so/whirlpools-sdk";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  WhirlpoolIx,
  PoolUtil,
  PriceMath,
  increaseLiquidityQuoteByInputTokenWithParams,
  IGNORE_CACHE,
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
import { promptConfirm, promptText } from "../utils/prompt";

console.info("increase Liquidity...");

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

const balanceA = await ctx.fetcher.getTokenInfo(
  getAssociatedTokenAddressSync(
    tokenMintAPubkey,
    ctx.wallet.publicKey,
    undefined,
    mintA.tokenProgram,
  ),
);
const balanceB = await ctx.fetcher.getTokenInfo(
  getAssociatedTokenAddressSync(
    tokenMintBPubkey,
    ctx.wallet.publicKey,
    undefined,
    mintB.tokenProgram,
  ),
);

let increaseLiquidityQuote: IncreaseLiquidityQuote;
while (true) {
  let depositByA: boolean;
  if (whirlpool.sqrtPrice.lte(lowerSqrtPrice)) {
    depositByA = true;
  } else if (whirlpool.sqrtPrice.gte(upperSqrtPrice)) {
    depositByA = false;
  } else {
    console.info(
      "current price is in the range, please specify the token to deposit (A or B)",
    );
    while (true) {
      const tokenAorB = await promptText("AorB");
      if (tokenAorB === "A" || tokenAorB === "B") {
        depositByA = tokenAorB === "A";
        break;
      }
    }
  }

  console.info(
    `balance A: ${DecimalUtil.fromBN(new BN(balanceA!.amount.toString()), decimalsA).toSD(6)}`,
  );
  console.info(
    `balance B: ${DecimalUtil.fromBN(new BN(balanceB!.amount.toString()), decimalsB).toSD(6)}`,
  );

  console.info(
    `Please enter the decimal amount of token ${depositByA ? "A" : "B"} to deposit`,
  );
  const decimalAmountStr = await promptText("decimalAmount");
  const decimalAmount = new Decimal(decimalAmountStr);
  const amount = DecimalUtil.toBN(
    decimalAmount,
    depositByA ? decimalsA : decimalsB,
  );

  const decimalSlippagePercentStr = await promptText("decimalSlippagePercent");
  const decimalSlippagePercent = new Decimal(decimalSlippagePercentStr);
  const slippage = Percentage.fromDecimal(decimalSlippagePercent);

  const quote = increaseLiquidityQuoteByInputTokenWithParams({
    inputTokenAmount: amount,
    inputTokenMint: depositByA ? tokenMintAPubkey : tokenMintBPubkey,
    sqrtPrice: whirlpool.sqrtPrice,
    tickCurrentIndex: whirlpool.tickCurrentIndex,
    tickLowerIndex: position.tickLowerIndex,
    tickUpperIndex: position.tickUpperIndex,
    tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
      ctx.fetcher,
      whirlpool,
      IGNORE_CACHE,
    ),
    tokenMintA: tokenMintAPubkey,
    tokenMintB: tokenMintBPubkey,
    slippageTolerance: slippage,
  });

  console.info(`estimated liquidity: ${quote.liquidityAmount.toString()}`);
  console.info(
    `estimated tokenA: ${DecimalUtil.fromBN(quote.tokenEstA, decimalsA).toSD(6)} at most ${DecimalUtil.fromBN(quote.tokenMaxA, decimalsA).toSD(6)}`,
  );
  console.info(
    `estimated tokenB: ${DecimalUtil.fromBN(quote.tokenEstB, decimalsB).toSD(6)} at most ${DecimalUtil.fromBN(quote.tokenMaxB, decimalsB).toSD(6)}`,
  );

  if (
    quote.tokenMaxA.gt(new BN(balanceA!.amount.toString())) ||
    quote.tokenMaxB.gt(new BN(balanceB!.amount.toString()))
  ) {
    throw new Error("insufficient balance");
  }

  const ok = await promptConfirm("if the above is OK, enter YES");
  if (ok) {
    increaseLiquidityQuote = quote;
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
  WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
    liquidityAmount: increaseLiquidityQuote.liquidityAmount,
    tokenMaxA: increaseLiquidityQuote.tokenMaxA,
    tokenMaxB: increaseLiquidityQuote.tokenMaxB,
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
increase Liquidity...
prompt: positionPubkey:  H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
tokenMintA Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
tokenMintB BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
current liquidity: 0 (0 A, 0 B)
lowerPrice(Index): 0.0000000000000000544947 (-443584)
upperPrice(Index): 18350300000000000000000 (443584)
deposit ratio A:B 50.00% : 50.00%
current price is in the range, please specify the token to deposit (A or B)
prompt: AorB:  A
balance A: 7708.07
balance B: 10189.3
Please enter the decimal amount of token A to deposit
prompt: decimalAmount:  10
prompt: decimalSlippagePercent:  1
estimated liquidity: 31638582
estimated tokenA: 9.99999 at most 10.0999
estimated tokenB: 0.1001 at most 0.101101
prompt: OK:  OK
estimatedComputeUnits: 152435
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature UdEZa3GWncberjduAxCLiiQH5MTMdLuzCycN6jceXo9bUefKPGuaqnvYJc1EiAeh4VDgvfUCEKB8L5UHnJr6ZXA

*/
