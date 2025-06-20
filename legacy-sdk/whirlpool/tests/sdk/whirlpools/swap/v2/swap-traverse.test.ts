import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import {
  buildWhirlpoolClient,
  MAX_SQRT_PRICE,
  MAX_TICK_INDEX,
  MIN_SQRT_PRICE,
  MIN_TICK_INDEX,
  NO_ORACLE_DATA,
  PriceMath,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  SwapUtils,
  TICK_ARRAY_SIZE,
  WhirlpoolContext,
} from "../../../../../src";
import type { WhirlpoolsError } from "../../../../../src/errors/errors";
import { SwapErrorCode } from "../../../../../src/errors/errors";
import { IGNORE_CACHE } from "../../../../../src/network/public/fetcher";
import {
  assertInputOutputQuoteEqual,
  assertQuoteAndResults,
  TickSpacing,
} from "../../../../utils";
import { defaultConfirmOptions } from "../../../../utils/const";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
} from "../../../../utils/swap-test-utils";
import { setupSwapTestV2 } from "../../../../utils/v2/swap-test-utils-v2";
import { getVaultAmounts } from "../../../../utils/whirlpools-test-utils";
import { TokenExtensionUtil } from "../../../../../src/utils/public/token-extension-util";
import { useMaxCU, type TokenTrait } from "../../../../utils/v2/init-utils-v2";

describe("swap traversal tests", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  const tokenTraitVariations: {
    tokenTraitA: TokenTrait;
    tokenTraitB: TokenTrait;
  }[] = [
    {
      tokenTraitA: { isToken2022: false },
      tokenTraitB: { isToken2022: false },
    },
    {
      tokenTraitA: { isToken2022: true },
      tokenTraitB: { isToken2022: false },
    },
    {
      tokenTraitA: { isToken2022: false },
      tokenTraitB: { isToken2022: true },
    },
    {
      tokenTraitA: { isToken2022: true },
      tokenTraitB: { isToken2022: true },
    },
  ];
  tokenTraitVariations.forEach((tokenTraits) => {
    describe(`tokenTraitA: ${
      tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
    }, tokenTraitB: ${
      tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"
    }`, () => {
      /**
       * |--------------------|b-----x2----a-------b-|x1-a------------------|
       */
      it("curr_index on the last initializable tick, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 0, offsetIndex: 15 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -1, offsetIndex: 44 },
              { arrayIndex: 0, offsetIndex: 30 },
              tickSpacing,
              new BN(250_000),
            ),
            buildPosition(
              //b
              { arrayIndex: -1, offsetIndex: 0 },
              { arrayIndex: -1, offsetIndex: TICK_ARRAY_SIZE - 1 },
              tickSpacing,
              new BN(350_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(150000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );

        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);

        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |--------------------x1,a|-b--------a----x2---b-|-------------------|
       */
      it("curr_index on the last initializable tick, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
              { arrayIndex: 1, offsetIndex: 44 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: 1, offsetIndex: 0 },
              { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 1 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(190000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);

        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * b|-----x2---------|a---------------|a,x1-------------b|
       */
      it("curr_index on the first initializable tick, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 1, offsetIndex: 0 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 0, offsetIndex: 0 },
              { arrayIndex: 1, offsetIndex: 0 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: -2, offsetIndex: 44 },
              { arrayIndex: 2, offsetIndex: TICK_ARRAY_SIZE - 1 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(200000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * b|a,x1--------------|a---------------|---------x2--------b|
       */
      it("curr_index on the first initializable tick, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 0, offsetIndex: 0 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 0, offsetIndex: 0 },
              { arrayIndex: 1, offsetIndex: 0 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: -1, offsetIndex: 44 },
              { arrayIndex: 2, offsetIndex: TICK_ARRAY_SIZE - 1 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(450000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |--------b-----x1-a|------a---x2---b--|-------------------|
       */
      it("curr_index on the 2nd last initialized tick, with the next tick initialized, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 2 }, // 5504
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
              { arrayIndex: 1, offsetIndex: 44 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: 0, offsetIndex: 44 },
              { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 4 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(150000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |-----------b--x2--|-------a-----b-----|a-x1-------------|
       */
      it("curr_index on the 2nd initialized tick, with the first tick initialized, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 2, offsetIndex: 1 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 1, offsetIndex: 44 },
              { arrayIndex: 2, offsetIndex: 0 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: 0, offsetIndex: 44 },
              { arrayIndex: 1, offsetIndex: 64 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(75000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |--------b-----a-x1|a---------x2---b--|-------------------|
       */
      it("curr_index btw end of last offset and next array, with the next tick initialized, b->a", async () => {
        const currIndex = 5629;
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 0, offsetIndex: TICK_ARRAY_SIZE - 1 },
              { arrayIndex: 1, offsetIndex: 1 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: 0, offsetIndex: 44 },
              { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 4 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(15000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |-----------b--x2--|-------a-----b-----|x1,a-------------|
       */
      it("curr_index btw end of last offset and next array, with the next tick initialized, a->b", async () => {
        const currIndex = 11264 + 30;
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 1, offsetIndex: 44 },
              { arrayIndex: 2, offsetIndex: 0 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: 0, offsetIndex: 44 },
              { arrayIndex: 1, offsetIndex: 64 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(7500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |----------------|-----a----x2-----b|--------x1----a---b----|
       */
      it("on some tick, traverse to the 1st initialized tick in the next tick-array, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 2, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 1, offsetIndex: 44 },
              { arrayIndex: 2, offsetIndex: 44 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: 1, offsetIndex: TICK_ARRAY_SIZE - 1 },
              { arrayIndex: 2, offsetIndex: 64 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(45000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |----a--b---x1------|a---x2-----b-------|------------------|
       */
      it("on some tick, traverse to the 1st initialized tick in the next tick-array, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -1, offsetIndex: 64 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-5632, 0, 5632],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -1, offsetIndex: 10 },
              { arrayIndex: 0, offsetIndex: 0 },
              tickSpacing,
              new BN(250_000_000),
            ),
            buildPosition(
              //b
              { arrayIndex: -1, offsetIndex: 22 },
              { arrayIndex: 0, offsetIndex: 64 },
              tickSpacing,
              new BN(350_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(49500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |-------a----x2------|-----------------|----x1-----a-------|
       */
      it("on some tick, traverse to the next tick in the n+2 tick-array, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 1, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-5632, 0, 5632],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -1, offsetIndex: 10 },
              { arrayIndex: 1, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(119500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |-------a------x1----|-----------------|-----x2--------a---|
       */
      it("on some tick, traverse to the next tick in the n+2 tick-array, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -1, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-5632, 0, 5632],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -1, offsetIndex: 10 },
              { arrayIndex: 1, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(119500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * a|----------------|-----------------|-------x1--------|a
       */
      it("3 arrays, on some initialized tick, no other initialized tick in the sequence, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 1, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(119500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * |-----x1-------------|-----------------|-------------------|
       */
      it("3 arrays, on some initialized tick, no other initialized tick in the sequence, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -1, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(159500000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * [1, 0, -1]
       * e|---c--x2----a---d----b|f-----a--b----d----|f-----c---x1-------|e
       */
      it("3 arrays, on some uninitialized tick, traverse lots of ticks, a->b", async () => {
        const currIndex =
          arrayTickIndexToTickIndex(
            { arrayIndex: 1, offsetIndex: 25 },
            tickSpacing,
          ) - 30;
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // e
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000),
            ),
            buildPosition(
              // c
              { arrayIndex: -1, offsetIndex: 10 },
              { arrayIndex: 1, offsetIndex: 15 },
              tickSpacing,
              new BN(100_000_000),
            ),
            buildPosition(
              // a
              { arrayIndex: -1, offsetIndex: 30 },
              { arrayIndex: 0, offsetIndex: 20 },
              tickSpacing,
              new BN(100_000_000),
            ),
            buildPosition(
              // d
              { arrayIndex: -1, offsetIndex: 60 },
              { arrayIndex: 0, offsetIndex: 60 },
              tickSpacing,
              new BN(50_000_000),
            ),
            buildPosition(
              // f
              { arrayIndex: 0, offsetIndex: 0 },
              { arrayIndex: 1, offsetIndex: 0 },
              tickSpacing,
              new BN(25_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN(102195000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote))
          .addInstruction(useMaxCU())
          .buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * e|---c--x1----a---d--b---|f-----a--b----d----|f------c---x2--------|e
       */
      it("3 arrays, on some uninitialized tick, traverse lots of ticks, b->a", async () => {
        const currIndex =
          arrayTickIndexToTickIndex(
            { arrayIndex: -1, offsetIndex: 15 },
            tickSpacing,
          ) - 30;
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // e
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000),
            ),
            buildPosition(
              // c
              { arrayIndex: -1, offsetIndex: 10 },
              { arrayIndex: 1, offsetIndex: 15 },
              tickSpacing,
              new BN(100_000_000),
            ),
            buildPosition(
              // a
              { arrayIndex: -1, offsetIndex: 30 },
              { arrayIndex: 0, offsetIndex: 20 },
              tickSpacing,
              new BN(100_000_000),
            ),
            buildPosition(
              // d
              { arrayIndex: -1, offsetIndex: 60 },
              { arrayIndex: 0, offsetIndex: 60 },
              tickSpacing,
              new BN(50_000_000),
            ),
            buildPosition(
              // f
              { arrayIndex: 0, offsetIndex: 0 },
              { arrayIndex: 1, offsetIndex: 0 },
              tickSpacing,
              new BN(25_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(99900000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * trade amount > liquidity
       * |----------x1----------|-----------------|-------------------|
       */
      it("3 arrays, trade amount exceeds liquidity available in array sequence, b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -1, offsetIndex: 22 },
          tickSpacing,
        );
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        await assert.rejects(
          async () =>
            await swapQuoteByInputToken(
              whirlpool,
              whirlpoolData.tokenMintB,
              new BN(9159500000),
              slippageTolerance,
              ctx.program.programId,
              fetcher,
              IGNORE_CACHE,
            ),
          (err) => {
            const whirlErr = err as WhirlpoolsError;
            const errorMatch =
              whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
            // Message contains failure on finding beyond tickIndex
            const messageMatch = whirlErr.message.indexOf("11264") >= 0;
            assert.ok(messageMatch, "Error Message must match condition.");
            assert.ok(errorMatch, "Error Code must match condition.");
            return true;
          },
        );
      });

      /**
       * trade amount > liquidity
       * |--------------------|-----------------|---------x1----------|
       */
      it("3 arrays, trade amount exceeds liquidity available in array sequence, a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 1, offsetIndex: 22 },
          tickSpacing,
        );
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        await assert.rejects(
          async () =>
            await swapQuoteByInputToken(
              whirlpool,
              whirlpoolData.tokenMintA,
              new BN(9159500000),
              slippageTolerance,
              ctx.program.programId,
              fetcher,
              IGNORE_CACHE,
            ),
          (err) => {
            const whirlErr = err as WhirlpoolsError;
            const errorMatch =
              whirlErr.errorCode === SwapErrorCode.TickArraySequenceInvalid;
            // Message contains failure on finding beyond tickIndex
            const messageMatch = whirlErr.message.indexOf("-5696") >= 0;
            assert.ok(messageMatch, "Error Message must match condition.");
            assert.ok(errorMatch, "Error Code must match condition.");
            return true;
          },
        );
      });

      /**
       * |a--------x1----------a| Max
       */
      it("on the last tick-array, traverse to the MAX_TICK_INDEX tick", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 78, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [MAX_TICK_INDEX],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: 78, offsetIndex: 0 }, // 439,296
              { arrayIndex: 78, offsetIndex: 67 }, // 443,584
              tickSpacing,
              new BN(250),
            ),
          ],
          tokenMintAmount: new BN("95000000000000000"),
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const quote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN("12595000000000"),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        await (await whirlpool.swap(quote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          quote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * Min |a--------x2--------a----|-----------------|-------------------|
       */
      it("on the first tick-array, traverse to the MIN_TICK_INDEX tick", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -79, offsetIndex: 22 },
          tickSpacing,
        );
        const aToB = true;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [MIN_TICK_INDEX],
          fundedPositions: [
            buildPosition(
              // a -444,928
              { arrayIndex: -79, offsetIndex: 21 },
              { arrayIndex: -79, offsetIndex: TICK_ARRAY_SIZE - 1 },
              tickSpacing,
              new BN(250),
            ),
          ],
          tokenMintAmount: new BN("95000000000000000"),
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const quote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          new BN("12595000000000"),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        await (await whirlpool.swap(quote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          quote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       *          -5632        0         5632      11264
       * |-a--------|-------x1-|----------|----------|-x2-----a-|
       *                            ta0        ta1        ta2
       */
      it("b->a, tickCurrentIndex = -tickSpacing, shifted", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -1, offsetIndex: 87 },
          tickSpacing,
        );
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 80 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(200000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const ta2StartTickIndex = 11264;
        assert.ok(inputTokenQuote.estimatedEndTickIndex > ta2StartTickIndex); // traverse ta0, ta1, and ta2

        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       *          -5632        0         5632      11264
       * |-a--------|--------x1|----------|----------|-x2-----a-|
       *                            ta0        ta1        ta2
       */
      it("b->a, tickCurrentIndex = -1, shifted", async () => {
        const currIndex = -1;
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 80 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(200000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const ta2StartTickIndex = 11264;
        assert.ok(inputTokenQuote.estimatedEndTickIndex > ta2StartTickIndex); // traverse ta0, ta1, and ta2

        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       *          -5632        0         5632      11264
       * |-a--------|XXXXXXXXx1|----------|----------|-x2-----a-|
       *                            ta0        ta1        ta2
       */
      it("b->a, tickCurrentIndex = -1, tickCurrentIndex on uninitialized TickArray, shifted", async () => {
        const currIndex = -1;
        const aToB = false;
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 80 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        const inputTokenQuote = await swapQuoteByInputToken(
          whirlpool,
          whirlpoolData.tokenMintB,
          new BN(200000000),
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        const ta2StartTickIndex = 11264;
        assert.ok(inputTokenQuote.estimatedEndTickIndex > ta2StartTickIndex); // traverse ta0, ta1, and ta2

        const outputTokenQuote = await swapQuoteByOutputToken(
          whirlpool,
          whirlpoolData.tokenMintA,
          inputTokenQuote.estimatedAmountOut,
          slippageTolerance,
          ctx.program.programId,
          fetcher,
          IGNORE_CACHE,
        );
        assertInputOutputQuoteEqual(inputTokenQuote, outputTokenQuote);
        await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

        const newData = await whirlpool.refreshData();
        const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
        assertQuoteAndResults(
          aToB,
          inputTokenQuote,
          newData,
          beforeVaultAmounts,
          afterVaultAmounts,
        );
      });

      /**
       * sqrtPriceLimit < MIN_SQRT_PRICE
       * |--------------------|-----------------|---------x1----------|
       */
      it("3 arrays, sqrtPriceLimit is out of bounds (< MIN_SQRT_PRICE), a->b", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: 1, offsetIndex: 22 },
          tickSpacing,
        );
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const aToB = true;
        const tickArrays = await SwapUtils.getTickArrays(
          currIndex,
          tickSpacing,
          aToB,
          ctx.program.programId,
          whirlpool.getAddress(),
          fetcher,
          IGNORE_CACHE,
        );
        const tokenExtensionCtx =
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            whirlpoolData,
            IGNORE_CACHE,
          );

        assert.throws(
          () =>
            swapQuoteWithParams(
              {
                aToB,
                amountSpecifiedIsInput: true,
                tokenAmount: new BN("10000"),
                whirlpoolData,
                tickArrays,
                sqrtPriceLimit: new BN(MIN_SQRT_PRICE).subn(1),
                otherAmountThreshold:
                  SwapUtils.getDefaultOtherAmountThreshold(true),
                tokenExtensionCtx,
                oracleData: NO_ORACLE_DATA,
              },
              slippageTolerance,
            ),
          (err) =>
            (err as WhirlpoolsError).errorCode ===
            SwapErrorCode.SqrtPriceOutOfBounds,
        );
      });

      /**
       * sqrtPriceLimit > MAX_SQRT_PRICE
       * |-----x1-------------|-----------------|---------------------|
       */
      it("3 arrays, sqrtPriceLimit is out of bounds (> MAX_SQRT_PRICE), b->a", async () => {
        const currIndex = arrayTickIndexToTickIndex(
          { arrayIndex: -1, offsetIndex: 22 },
          tickSpacing,
        );
        const whirlpool = await setupSwapTestV2({
          ctx,
          ...tokenTraits,
          client,
          tickSpacing,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
          initArrayStartTicks: [-11264, -5632, 0, 5632, 11264],
          fundedPositions: [
            buildPosition(
              // a
              { arrayIndex: -2, offsetIndex: 10 },
              { arrayIndex: 2, offsetIndex: 23 },
              tickSpacing,
              new BN(250_000_000),
            ),
          ],
        });

        const whirlpoolData = await whirlpool.refreshData();
        const aToB = false;
        const tickArrays = await SwapUtils.getTickArrays(
          currIndex,
          tickSpacing,
          aToB,
          ctx.program.programId,
          whirlpool.getAddress(),
          fetcher,
          IGNORE_CACHE,
        );
        const tokenExtensionCtx =
          await TokenExtensionUtil.buildTokenExtensionContext(
            fetcher,
            whirlpoolData,
            IGNORE_CACHE,
          );

        assert.throws(
          () =>
            swapQuoteWithParams(
              {
                aToB,
                amountSpecifiedIsInput: true,
                tokenAmount: new BN("10000"),
                whirlpoolData,
                tickArrays,
                sqrtPriceLimit: new BN(MAX_SQRT_PRICE).addn(1),
                otherAmountThreshold:
                  SwapUtils.getDefaultOtherAmountThreshold(true),
                tokenExtensionCtx,
                oracleData: NO_ORACLE_DATA,
              },
              slippageTolerance,
            ),
          (err) =>
            (err as WhirlpoolsError).errorCode ===
            SwapErrorCode.SqrtPriceOutOfBounds,
        );
      });
    });
  });
});
