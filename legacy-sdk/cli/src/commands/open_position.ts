import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  WhirlpoolIx,
  PriceMath,
  TickUtil,
} from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { processTransaction } from "../utils/transaction_sender";
import Decimal from "decimal.js";
import { calcDepositRatio } from "../utils/deposit_ratio";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("open Position...");

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

let lowerTickIndex: number;
let upperTickIndex: number;

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

console.info(`if you want to create position with Metadata, enter YES`);
const withMetadataYesno = await promptConfirm("YES");

console.info(`if you want to create position WITH TokenExtensions, enter YES`);
const withTokenExtensions = await promptConfirm("YES");

console.info(
  "setting...",
  "\n\twhirlpool",
  whirlpoolPubkey.toBase58(),
  "\n\ttokenMintA",
  tokenMintAPubkey.toBase58(),
  "\n\ttokenMintB",
  tokenMintBPubkey.toBase58(),
  "\n\ttickSpacing",
  tickSpacing,
  "\n\tcurrentPrice",
  currentPrice.toSD(6),
  "B/A",
  "\n\tlowerPrice(Index)",
  PriceMath.tickIndexToPrice(lowerTickIndex, decimalsA, decimalsB).toSD(6),
  `(${lowerTickIndex})`,
  "\n\tupperPrice(Index)",
  PriceMath.tickIndexToPrice(upperTickIndex, decimalsA, decimalsB).toSD(6),
  `(${upperTickIndex})`,
  "\n\tlowerTickArray",
  lowerTickArrayPda.publicKey.toBase58(),
  initLowerTickArray ? "(TO BE INITIALIZED)" : "(initialized)",
  "\n\tupperTickArray",
  upperTickArrayPda.publicKey.toBase58(),
  initUpperTickArray ? "(TO BE INITIALIZED)" : "(initialized)",
  "\n\twithMetadata",
  withMetadataYesno ? "WITH metadata" : "WITHOUT metadata",
  "\n\twithTokenExtensions",
  withTokenExtensions ? "WITH TokenExtensions" : "WITHOUT TokenExtensions",
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

if (initLowerTickArray) {
  builder.addInstruction(
    WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
      whirlpool: whirlpoolPubkey,
      funder: ctx.wallet.publicKey,
      startTick: TickUtil.getStartTickIndex(lowerTickIndex, tickSpacing),
      tickArrayPda: lowerTickArrayPda,
    }),
  );
}

if (
  initUpperTickArray &&
  !upperTickArrayPda.publicKey.equals(lowerTickArrayPda.publicKey)
) {
  builder.addInstruction(
    WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
      whirlpool: whirlpoolPubkey,
      funder: ctx.wallet.publicKey,
      startTick: TickUtil.getStartTickIndex(upperTickIndex, tickSpacing),
      tickArrayPda: upperTickArrayPda,
    }),
  );
}

const positionMintKeypair = Keypair.generate();
const positionPda = PDAUtil.getPosition(
  ORCA_WHIRLPOOL_PROGRAM_ID,
  positionMintKeypair.publicKey,
);
if (withTokenExtensions) {
  // TokenExtensions based Position NFT
  builder.addInstruction(
    WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
      funder: ctx.wallet.publicKey,
      whirlpool: whirlpoolPubkey,
      tickLowerIndex: lowerTickIndex,
      tickUpperIndex: upperTickIndex,
      withTokenMetadataExtension: withMetadataYesno,
      owner: ctx.wallet.publicKey,
      positionMint: positionMintKeypair.publicKey,
      positionPda,
      positionTokenAccount: getAssociatedTokenAddressSync(
        positionMintKeypair.publicKey,
        ctx.wallet.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID,
      ),
    }),
  );
} else {
  // TokenProgram based Position NFT

  const metadataPda = PDAUtil.getPositionMetadata(
    positionMintKeypair.publicKey,
  );
  const params = {
    funder: ctx.wallet.publicKey,
    whirlpool: whirlpoolPubkey,
    tickLowerIndex: lowerTickIndex,
    tickUpperIndex: upperTickIndex,
    owner: ctx.wallet.publicKey,
    positionMintAddress: positionMintKeypair.publicKey,
    positionPda,
    positionTokenAccount: getAssociatedTokenAddressSync(
      positionMintKeypair.publicKey,
      ctx.wallet.publicKey,
      true,
    ),
    metadataPda,
  };

  if (withMetadataYesno) {
    builder.addInstruction(
      WhirlpoolIx.openPositionWithMetadataIx(ctx.program, params),
    );
  } else {
    builder.addInstruction(WhirlpoolIx.openPositionIx(ctx.program, params));
  }
}
builder.addSigner(positionMintKeypair);

const landed = await processTransaction(builder);
if (landed) {
  console.info(
    "position mint address:",
    positionMintKeypair.publicKey.toBase58(),
  );
  console.info("position address:", positionPda.publicKey.toBase58());
  console.info(
    "📝position liquidity is empty, please use yarn run increaseLiquidity to deposit",
  );
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
open Position...
prompt: whirlpoolPubkey:  EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4
tokenMintA Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
tokenMintB BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)
if you want to create FULL RANGE position, enter YES
prompt: yesno:  YES
using full range
if you want to create position with Metadata, enter YES
prompt: yesno:  no
setting...
        whirlpool EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4
        tokenMintA Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa
        tokenMintB BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k
        tickSpacing 64
        currentPrice 0.0100099 B/A
        lowerPrice(Index) 0.0000000000000000544947 (-443584)
        upperPrice(Index) 18350300000000000000000 (443584)
        lowerTickArray AihMywzP74pU2riq1ihFW2YSVcc1itT3yiP7minvkxDs (initialized)
        upperTickArray F4h3qr6uBgdLDJyTms4YiebiaiuCEvC5C9LJE8scA1LV (initialized)
        withMetadata WITHOUT metadata

if the above is OK, enter YES
prompt: yesno:  YES
estimatedComputeUnits: 163606
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature CAY5wBXVhbHRVjJYgi8c1KS5XczLDwZB1S7sf5fwkCakXo8SQBtasvjBvtjwpdZUoQnwJoPmhG2ZrPGX3PRQ8ax
position mint address: 8nBbX74FraqPuoL8AwXxPiPaULg8CP8hUJ41hJGAx4nb
position address: H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
📝position liquidity is empty, please use yarn run increaseLiquidity to deposit

*/
