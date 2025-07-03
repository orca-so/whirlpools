import { PublicKey } from "@solana/web3.js";
import {
  PDAUtil,
  WhirlpoolIx,
  PriceMath,
  TickUtil,
  TICK_ARRAY_SIZE,
  IGNORE_CACHE,
} from "@orca-so/whirlpools-sdk";
import type { PDA } from "@orca-so/common-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import type Decimal from "decimal.js";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("initialize TickArray...");

// prompt
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");

const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}

const mintA = await ctx.fetcher.getMintInfo(whirlpool.tokenMintA);
const mintB = await ctx.fetcher.getMintInfo(whirlpool.tokenMintB);
const tickSpacing = whirlpool.tickSpacing;

if (!mintA || !mintB) {
  throw new Error("mintA or mintB not found");
}

type TickArrayInfo = {
  pda: PDA;
  startTickIndex: number;
  startPrice: Decimal;
  endPrice: Decimal;
  isCurrent: boolean;
  isFullRange: boolean;
  isInitialized?: boolean;
};

const tickArrayInfos: TickArrayInfo[] = [];
const [minTickIndex, maxTickIndex] =
  TickUtil.getFullRangeTickIndex(tickSpacing);
tickArrayInfos.push({
  pda: PDAUtil.getTickArrayFromTickIndex(
    minTickIndex,
    tickSpacing,
    whirlpoolPubkey,
    ctx.program.programId,
  ),
  startTickIndex: TickUtil.getStartTickIndex(minTickIndex, tickSpacing),
  startPrice: PriceMath.tickIndexToPrice(
    minTickIndex,
    mintA.decimals,
    mintB.decimals,
  ),
  endPrice: PriceMath.tickIndexToPrice(
    Math.ceil(minTickIndex / (tickSpacing * TICK_ARRAY_SIZE)) *
      (tickSpacing * TICK_ARRAY_SIZE),
    mintA.decimals,
    mintB.decimals,
  ),
  isCurrent: false,
  isFullRange: true,
});

for (let offset = -6; offset <= +6; offset++) {
  const startTickIndex = TickUtil.getStartTickIndex(
    whirlpool.tickCurrentIndex,
    tickSpacing,
    offset,
  );
  const pda = PDAUtil.getTickArray(
    ctx.program.programId,
    whirlpoolPubkey,
    startTickIndex,
  );
  const endTickIndex = startTickIndex + tickSpacing * TICK_ARRAY_SIZE;
  const startPrice = PriceMath.tickIndexToPrice(
    startTickIndex,
    mintA.decimals,
    mintB.decimals,
  );
  const endPrice = PriceMath.tickIndexToPrice(
    endTickIndex,
    mintA.decimals,
    mintB.decimals,
  );

  tickArrayInfos.push({
    pda,
    startTickIndex,
    startPrice,
    endPrice,
    isCurrent: offset == 0,
    isFullRange: false,
  });
}

tickArrayInfos.push({
  pda: PDAUtil.getTickArrayFromTickIndex(
    maxTickIndex,
    tickSpacing,
    whirlpoolPubkey,
    ctx.program.programId,
  ),
  startTickIndex: TickUtil.getStartTickIndex(maxTickIndex, tickSpacing),
  startPrice: PriceMath.tickIndexToPrice(
    Math.floor(maxTickIndex / (tickSpacing * TICK_ARRAY_SIZE)) *
      (tickSpacing * TICK_ARRAY_SIZE),
    mintA.decimals,
    mintB.decimals,
  ),
  endPrice: PriceMath.tickIndexToPrice(
    maxTickIndex,
    mintA.decimals,
    mintB.decimals,
  ),
  isCurrent: false,
  isFullRange: true,
});

while (true) {
  const checkInitialized = await ctx.fetcher.getTickArrays(
    tickArrayInfos.map((info) => info.pda.publicKey),
    IGNORE_CACHE,
  );
  checkInitialized.forEach((ta, i) => (tickArrayInfos[i].isInitialized = !!ta));

  console.info("neighring tickarrays & fullrange tickarrays...");
  tickArrayInfos.forEach((ta) =>
    console.info(
      ta.isCurrent ? ">>" : "  ",
      ta.pda.publicKey.toBase58().padEnd(45, " "),
      ta.isInitialized ? "    initialized" : "NOT INITIALIZED",
      "start",
      ta.startTickIndex.toString().padStart(10, " "),
      "covered range",
      ta.startPrice.toSignificantDigits(6),
      "-",
      ta.endPrice.toSignificantDigits(6),
      ta.isFullRange ? "(FULL)" : "",
    ),
  );

  const tickArrayPubkeyStr = await promptText("tickArrayPubkey");
  const tickArrayPubkey = new PublicKey(tickArrayPubkeyStr);
  const which = tickArrayInfos.filter((ta) =>
    ta.pda.publicKey.equals(tickArrayPubkey),
  )[0];

  const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
  builder.addInstruction(
    WhirlpoolIx.initDynamicTickArrayIx(ctx.program, {
      funder: ctx.wallet.publicKey,
      whirlpool: whirlpoolPubkey,
      startTick: which.startTickIndex,
      tickArrayPda: which.pda,
    }),
  );

  const landed = await sendTransaction(builder);
  if (landed) {
    console.info("initialized tickArray address:", tickArrayPubkey.toBase58());
  }

  const more = await promptConfirm("initialize more tickArray ?");
  if (!more) {
    break;
  }
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
create TickArray...
prompt: whirlpoolPubkey:  CJBunHdcRxtYSWGxkw8KarDpoz78KtNeMni2yU51TbPq
neighring tickarrays...
   DUeNdqcFMo573Wg58GmRvYYhw3m9p5cZmzeg7kTxxLuy  NOT INITIALIZED start     -73216 covered range 0.661345 - 1.161477
   dufQnkLbrHTWZmbmuZGwxQgBCebKLVi2peTrdgmsq3S   NOT INITIALIZED start     -67584 covered range 1.161477 - 2.039827
   9Fj1szNFbzc7hwJxuGkHmjBreAGR7Yvqnt6FCwuyTd3w  NOT INITIALIZED start     -61952 covered range 2.039827 - 3.582413
   7tQ6FvFkm2PwbbyZ3tBnHyE5bqq8dw8ucnfLGBjHPbtD  NOT INITIALIZED start     -56320 covered range 3.582413 - 6.291557
   6f2k4NkMBR6jhy52QTqrMca7Hb7a7ArWdP1bWgtuxYij  NOT INITIALIZED start     -50688 covered range 6.291557 - 11.049448
   DpNHXExUnksYhmD1tQLr25W4BJSz3Ykk4a8DN7YtYgBG  NOT INITIALIZED start     -45056 covered range 11.049448 - 19.405419
>> 48W97WVPhfbLWHBP4Z5828GAWzgvmbr9YngkNbGmR7zr  NOT INITIALIZED start     -39424 covered range 19.405419 - 34.080460
   ck7UA3Hb68mC33hftDY5aGpyNzrTHaTu4ZShBV5yzqY   NOT INITIALIZED start     -33792 covered range 34.080460 - 59.853270
   BTHpoHPNh8TQq4HSoKAvxKBxee1BffyFAbxEZcxr4BYU  NOT INITIALIZED start     -28160 covered range 59.853270 - 105.116358
   3CMuyPQatYQQmyXsrUMQTDAghzcecpw1qXyiR1uczFe6  NOT INITIALIZED start     -22528 covered range 105.116358 - 184.608940
   By4Avt7jgymhiK5EaTzQnrDMMdzDWguEuuPLwJ1jazcS  NOT INITIALIZED start     -16896 covered range 184.608940 - 324.216530
   9qKqNjLf61YfyhnDBK5Nf35e1PCxkQqRnCiApqs9uJSo  NOT INITIALIZED start     -11264 covered range 324.216530 - 569.400149
   EzHNpv1X8KDwugXi1ALnkzV9wpJdsShXY5DdNcgCXoc4  NOT INITIALIZED start      -5632 covered range 569.400149 - 999.999999
prompt: tickArrayPubkey:  48W97WVPhfbLWHBP4Z5828GAWzgvmbr9YngkNbGmR7zr
tx: 5cxpJC4MDxiHxh1hSjKPtVxKjLR1CzNA3As3scBZu7vLYEmc6PPgUACG5tnnh2QYSFhM2h1nCkt6Ao5PRhq5G6b1
initialized tickArray address: 48W97WVPhfbLWHBP4Z5828GAWzgvmbr9YngkNbGmR7zr


connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
create TickArray...
prompt: whirlpoolPubkey:  CJBunHdcRxtYSWGxkw8KarDpoz78KtNeMni2yU51TbPq
neighring tickarrays...
   DUeNdqcFMo573Wg58GmRvYYhw3m9p5cZmzeg7kTxxLuy  NOT INITIALIZED start     -73216 covered range 0.661345 - 1.161477
   dufQnkLbrHTWZmbmuZGwxQgBCebKLVi2peTrdgmsq3S   NOT INITIALIZED start     -67584 covered range 1.161477 - 2.039827
   9Fj1szNFbzc7hwJxuGkHmjBreAGR7Yvqnt6FCwuyTd3w  NOT INITIALIZED start     -61952 covered range 2.039827 - 3.582413
   7tQ6FvFkm2PwbbyZ3tBnHyE5bqq8dw8ucnfLGBjHPbtD  NOT INITIALIZED start     -56320 covered range 3.582413 - 6.291557
   6f2k4NkMBR6jhy52QTqrMca7Hb7a7ArWdP1bWgtuxYij  NOT INITIALIZED start     -50688 covered range 6.291557 - 11.049448
   DpNHXExUnksYhmD1tQLr25W4BJSz3Ykk4a8DN7YtYgBG  NOT INITIALIZED start     -45056 covered range 11.049448 - 19.405419
>> 48W97WVPhfbLWHBP4Z5828GAWzgvmbr9YngkNbGmR7zr      initialized start     -39424 covered range 19.405419 - 34.080460
   ck7UA3Hb68mC33hftDY5aGpyNzrTHaTu4ZShBV5yzqY   NOT INITIALIZED start     -33792 covered range 34.080460 - 59.853270
   BTHpoHPNh8TQq4HSoKAvxKBxee1BffyFAbxEZcxr4BYU  NOT INITIALIZED start     -28160 covered range 59.853270 - 105.116358
   3CMuyPQatYQQmyXsrUMQTDAghzcecpw1qXyiR1uczFe6  NOT INITIALIZED start     -22528 covered range 105.116358 - 184.608940
   By4Avt7jgymhiK5EaTzQnrDMMdzDWguEuuPLwJ1jazcS  NOT INITIALIZED start     -16896 covered range 184.608940 - 324.216530
   9qKqNjLf61YfyhnDBK5Nf35e1PCxkQqRnCiApqs9uJSo  NOT INITIALIZED start     -11264 covered range 324.216530 - 569.400149
   EzHNpv1X8KDwugXi1ALnkzV9wpJdsShXY5DdNcgCXoc4  NOT INITIALIZED start      -5632 covered range 569.400149 - 999.999999
prompt: tickArrayPubkey:  ck7UA3Hb68mC33hftDY5aGpyNzrTHaTu4ZShBV5yzqY
tx: 34hg8C72sXYYdHdy47u3r57AKJNCyDySCzbijjcfw6kVwrSDjdFnMY743tAiMxnyp4pUByZYgxHu6a1GQR4JRjgN
initialized tickArray address: ck7UA3Hb68mC33hftDY5aGpyNzrTHaTu4ZShBV5yzqY


connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
create TickArray...
prompt: whirlpoolPubkey:  CJBunHdcRxtYSWGxkw8KarDpoz78KtNeMni2yU51TbPq
neighring tickarrays...
   DUeNdqcFMo573Wg58GmRvYYhw3m9p5cZmzeg7kTxxLuy  NOT INITIALIZED start     -73216 covered range 0.661345 - 1.161477
   dufQnkLbrHTWZmbmuZGwxQgBCebKLVi2peTrdgmsq3S   NOT INITIALIZED start     -67584 covered range 1.161477 - 2.039827
   9Fj1szNFbzc7hwJxuGkHmjBreAGR7Yvqnt6FCwuyTd3w  NOT INITIALIZED start     -61952 covered range 2.039827 - 3.582413
   7tQ6FvFkm2PwbbyZ3tBnHyE5bqq8dw8ucnfLGBjHPbtD  NOT INITIALIZED start     -56320 covered range 3.582413 - 6.291557
   6f2k4NkMBR6jhy52QTqrMca7Hb7a7ArWdP1bWgtuxYij  NOT INITIALIZED start     -50688 covered range 6.291557 - 11.049448
   DpNHXExUnksYhmD1tQLr25W4BJSz3Ykk4a8DN7YtYgBG  NOT INITIALIZED start     -45056 covered range 11.049448 - 19.405419
>> 48W97WVPhfbLWHBP4Z5828GAWzgvmbr9YngkNbGmR7zr      initialized start     -39424 covered range 19.405419 - 34.080460
   ck7UA3Hb68mC33hftDY5aGpyNzrTHaTu4ZShBV5yzqY       initialized start     -33792 covered range 34.080460 - 59.853270
   BTHpoHPNh8TQq4HSoKAvxKBxee1BffyFAbxEZcxr4BYU  NOT INITIALIZED start     -28160 covered range 59.853270 - 105.116358
   3CMuyPQatYQQmyXsrUMQTDAghzcecpw1qXyiR1uczFe6  NOT INITIALIZED start     -22528 covered range 105.116358 - 184.608940
   By4Avt7jgymhiK5EaTzQnrDMMdzDWguEuuPLwJ1jazcS  NOT INITIALIZED start     -16896 covered range 184.608940 - 324.216530
   9qKqNjLf61YfyhnDBK5Nf35e1PCxkQqRnCiApqs9uJSo  NOT INITIALIZED start     -11264 covered range 324.216530 - 569.400149
   EzHNpv1X8KDwugXi1ALnkzV9wpJdsShXY5DdNcgCXoc4  NOT INITIALIZED start      -5632 covered range 569.400149 - 999.999999
prompt: tickArrayPubkey:  DpNHXExUnksYhmD1tQLr25W4BJSz3Ykk4a8DN7YtYgBG
tx: 4xLJmdjV9UvUxotH3iE4oqXXZj2MAthP27iFN9iGSRT8CYtzKj1vK3y6sa3DtyxUqZ3JPLziKTpKvWXHQPBggStv
initialized tickArray address: DpNHXExUnksYhmD1tQLr25W4BJSz3Ykk4a8DN7YtYgBG

*/
