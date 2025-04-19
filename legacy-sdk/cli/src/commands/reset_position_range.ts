import { PublicKey } from "@solana/web3.js";
import {
  PDAUtil,
  WhirlpoolIx,
  TickUtil,
  PriceMath,
  ORCA_WHIRLPOOL_PROGRAM_ID,
} from "@orca-so/whirlpools-sdk";
import {
  TransactionBuilder,
} from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";
import Decimal from "decimal.js";
import { calcDepositRatio } from "../utils/deposit_ratio";

console.info("reset position range...");

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

if (!position.liquidity.isZero()) {
  throw new Error("position liquidity is NOT zero (only empty position is resettable)");
}
if (!position.feeOwedA.isZero() || !position.feeOwedB.isZero()) {
  throw new Error("position feeOwed is NOT zero (only empty position is resettable)");
}
if (!position.rewardInfos.every((ri) => ri.amountOwed.isZero())) {
  throw new Error("position rewardOwed is NOT zero (only empty position is resettable)");
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

let lowerTickIndex: number;
let upperTickIndex: number;

console.info("current lowerPrice(Index)",
  PriceMath.tickIndexToPrice(position.tickLowerIndex, decimalsA, decimalsB).toSD(6),
  `(${position.tickLowerIndex})`
);
console.info("current upperPrice(Index)",
  PriceMath.tickIndexToPrice(position.tickUpperIndex, decimalsA, decimalsB).toSD(6),
  `(${position.tickUpperIndex})`
);

console.info(`if you want to create FULL RANGE position, enter YES`);
const fullrangeYesno = await promptConfirm("YES");
if (fullrangeYesno) {
  // RULL RANGE
  const fullrange = TickUtil.getFullRangeTickIndex(tickSpacing);
  lowerTickIndex = fullrange[0];
  upperTickIndex = fullrange[1];
  console.info("using full range");
} else {
  // CONCENTRATED
  while (true) {
    console.info(`current price: ${currentPrice.toSD(6)} B/A`);

    const lowerPriceStr = await promptText("lowerPrice");
    const upperPriceStr = await promptText("upperPrice");
    const lowerPrice = new Decimal(lowerPriceStr);
    const upperPrice = new Decimal(upperPriceStr);

    const initializableLowerTickIndex = PriceMath.priceToInitializableTickIndex(
      lowerPrice,
      decimalsA,
      decimalsB,
      tickSpacing,
    );
    const initializableUpperTickIndex = PriceMath.priceToInitializableTickIndex(
      upperPrice,
      decimalsA,
      decimalsB,
      tickSpacing,
    );
    const initializableLowerPrice = PriceMath.tickIndexToPrice(
      initializableLowerTickIndex,
      decimalsA,
      decimalsB,
    );
    const initializableUpperPrice = PriceMath.tickIndexToPrice(
      initializableUpperTickIndex,
      decimalsA,
      decimalsB,
    );

    const [ratioA, ratioB] = calcDepositRatio(
      whirlpool.sqrtPrice,
      PriceMath.tickIndexToSqrtPriceX64(initializableLowerTickIndex),
      PriceMath.tickIndexToSqrtPriceX64(initializableUpperTickIndex),
      decimalsA,
      decimalsB,
    );
    console.info(
      `deposit ratio A:B ${ratioA.toFixed(2)}% : ${ratioB.toFixed(2)}%`,
    );
    console.info(
      `is range [${initializableLowerPrice.toSD(6)}, ${initializableUpperPrice.toSD(6)}] OK ? (if it is OK, enter OK)`,
    );
    const ok = await promptConfirm("OK");
    if (ok) {
      lowerTickIndex = initializableLowerTickIndex;
      upperTickIndex = initializableUpperTickIndex;
      break;
    }
  }
}

const lowerTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
  lowerTickIndex,
  tickSpacing,
  whirlpoolPubkey,
  ORCA_WHIRLPOOL_PROGRAM_ID,
);
const upperTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
  upperTickIndex,
  tickSpacing,
  whirlpoolPubkey,
  ORCA_WHIRLPOOL_PROGRAM_ID,
);
const lowerTickArray = await ctx.fetcher.getTickArray(
  lowerTickArrayPda.publicKey,
);
const upperTickArray = await ctx.fetcher.getTickArray(
  upperTickArrayPda.publicKey,
);
const initLowerTickArray = !lowerTickArray;
const initUpperTickArray = !upperTickArray;

console.info("pool", whirlpoolPubkey.toBase58());
console.info("position", positionPubkey.toBase58());
console.info("position lowerPrice(Index)",
  PriceMath.tickIndexToPrice(position.tickLowerIndex, decimalsA, decimalsB).toSD(6),
  `(${position.tickLowerIndex})`,
  "-->",
  PriceMath.tickIndexToPrice(lowerTickIndex, decimalsA, decimalsB).toSD(6),
  `(${lowerTickIndex})`,
);
console.info("position upperPrice(Index)",
  PriceMath.tickIndexToPrice(position.tickUpperIndex, decimalsA, decimalsB).toSD(6),
  `(${position.tickUpperIndex})`,
  "-->",
  PriceMath.tickIndexToPrice(upperTickIndex, decimalsA, decimalsB).toSD(6),
  `(${upperTickIndex})`,
);
console.info(
  "lowerTickArray",
  lowerTickArrayPda.publicKey.toBase58(),
  initLowerTickArray ? "(TO BE INITIALIZED)" : "(initialized)",
  "\nupperTickArray",
  upperTickArrayPda.publicKey.toBase58(),
  initUpperTickArray ? "(TO BE INITIALIZED)" : "(initialized)",
);

console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}
const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

if (initLowerTickArray) {
  builder.addInstruction(
    WhirlpoolIx.initTickArrayIx(ctx.program, {
      whirlpool: whirlpoolPubkey,
      funder: ctx.wallet.publicKey,
      startTick: TickUtil.getStartTickIndex(lowerTickIndex, tickSpacing),
      tickArrayPda: lowerTickArrayPda,
    }),
  );
}

if (initUpperTickArray && !upperTickArrayPda.publicKey.equals(lowerTickArrayPda.publicKey)) {
  builder.addInstruction(
    WhirlpoolIx.initTickArrayIx(ctx.program, {
      whirlpool: whirlpoolPubkey,
      funder: ctx.wallet.publicKey,
      startTick: TickUtil.getStartTickIndex(upperTickIndex, tickSpacing),
      tickArrayPda: upperTickArrayPda,
    }),
  );
}

builder.addInstruction(
  WhirlpoolIx.resetPositionRangeIx(ctx.program, {
    tickLowerIndex: lowerTickIndex,
    tickUpperIndex: upperTickIndex,
    position: positionPubkey,
    positionAuthority: ctx.wallet.publicKey,
    positionTokenAccount: getAssociatedTokenAddressSync(
      position.positionMint,
      ctx.wallet.publicKey,
      undefined,
      positionMint.tokenProgram,
    ),
    whirlpool: whirlpoolPubkey,
    funder: ctx.wallet.publicKey,
  }),
);

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint https://api.devnet.solana.com
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
reset position range...
✔ positionPubkey … 9MtyLDRJK5fBvLozLqzfFdiSgXiH2QBLVDPcDEYJUrRC
tokenMintA So11111111111111111111111111111111111111112 (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
tokenMintB BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
current lowerPrice(Index) 0.0000000000000000544947 (-443584)
current upperPrice(Index) 18350300000000000000000 (443584)
if you want to create FULL RANGE position, enter YES
✔ YES › No
current price: 13.5467 B/A
✔ lowerPrice … 500
✔ upperPrice … 800
deposit ratio A:B 100.00% : 0.00%
is range [500.991, 804.455] OK ? (if it is OK, enter OK)
✔ OK › Yes
pool 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
position 9MtyLDRJK5fBvLozLqzfFdiSgXiH2QBLVDPcDEYJUrRC
position lowerPrice(Index) 0.0000000000000000544947 (-443584) --> 500.991 (-6912)
position upperPrice(Index) 18350300000000000000000 (443584) --> 804.455 (-2176)
lowerTickArray GsCSnitrDbtw5m8UzPsmwb3Tr3R3DYmpz4WzhTriWri (initialized) 
upperTickArray 3rC87MFCC7VKpkhAR5gp2zMBjHr46jRajvMHxCBF8MWr (initialized)

if the above is OK, enter YES
✔ yesno › Yes
estimatedComputeUnits: 106232
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 4vDt37s8fHr6uktrna5FTn5tfu836yA4r7ah9eCmu5i1DSXCHMVeB3vocqtUiVuP7BF47aKBuKy1Y2i58V7Rzf1F

*/
