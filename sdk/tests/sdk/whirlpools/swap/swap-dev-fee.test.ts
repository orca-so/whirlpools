import { Percentage, ZERO } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { Address } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import {
  buildWhirlpoolClient,
  PriceMath,
  swapQuoteByInputToken,
  Whirlpool,
  WhirlpoolContext,
} from "../../../../src";
import { SwapErrorCode, WhirlpoolsError } from "../../../../src/errors/errors";
import { swapQuoteByInputTokenWithDevFees } from "../../../../src/quotes/public/dev-fee-swap-quote";
import {
  assertDevFeeQuotes,
  assertDevTokenAmount,
  assertQuoteAndResults,
  TickSpacing,
} from "../../../utils";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest,
} from "../../../utils/swap-test-utils";
import { getVaultAmounts } from "../../../utils/whirlpools-test-utils";

describe("whirlpool-dev-fee-swap", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  it("swap with dev-fee 0% equals swap", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(0, 1000); // 0%
    const inputTokenAmount = new u64(119500000);
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );
    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenAmount,
      slippageTolerance,
      ctx.program.programId,
      ctx.fetcher,
      true
    );
    const postFeeInputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      postFeeTokenAmount,
      slippageTolerance,
      ctx.program.programId,
      ctx.fetcher,
      true
    );
    const inputTokenQuoteWithDevFees = await swapQuoteByInputTokenWithDevFees(
      whirlpool,
      whirlpoolData.tokenMintB,
      inputTokenAmount,
      slippageTolerance,
      ctx.program.programId,
      ctx.fetcher,
      devFeePercentage,
      true
    );
    assertDevFeeQuotes(inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees);
    await (
      await whirlpool.swapWithDevFees(inputTokenQuoteWithDevFees, devWallet.publicKey)
    ).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  it("swap with dev-fee 0.1%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(1, 1000); // 0.1%
    const inputTokenAmount = new u64(119500000);
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );

    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = whirlpoolData.tokenMintB;
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const { inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees } = await getQuotes(
      ctx,
      whirlpool,
      swapToken,
      inputTokenAmount,
      postFeeTokenAmount,
      slippageTolerance,
      devFeePercentage
    );
    assertDevFeeQuotes(inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees);
    await (
      await whirlpool.swapWithDevFees(inputTokenQuoteWithDevFees, devWallet.publicKey)
    ).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(
      aToB,
      postFeeInputTokenQuote,
      newData,
      beforeVaultAmounts,
      afterVaultAmounts
    );
    assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey);
  });

  it("swap with dev-fee 1%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(1, 100); // 0.1%
    const inputTokenAmount = new u64(119500000);
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );

    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = whirlpoolData.tokenMintB;
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const { inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees } = await getQuotes(
      ctx,
      whirlpool,
      swapToken,
      inputTokenAmount,
      postFeeTokenAmount,
      slippageTolerance,
      devFeePercentage
    );
    assertDevFeeQuotes(inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees);
    await (
      await whirlpool.swapWithDevFees(inputTokenQuoteWithDevFees, devWallet.publicKey)
    ).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(
      aToB,
      postFeeInputTokenQuote,
      newData,
      beforeVaultAmounts,
      afterVaultAmounts
    );
    assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey);
  });

  it("swap with dev-fee 50%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(500000, 1000000); // 50%
    const inputTokenAmount = new u64(119500000);
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );

    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = whirlpoolData.tokenMintB;
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const { inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees } = await getQuotes(
      ctx,
      whirlpool,
      swapToken,
      inputTokenAmount,
      postFeeTokenAmount,
      slippageTolerance,
      devFeePercentage
    );
    assertDevFeeQuotes(inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees);
    await (
      await whirlpool.swapWithDevFees(inputTokenQuoteWithDevFees, devWallet.publicKey)
    ).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(
      aToB,
      postFeeInputTokenQuote,
      newData,
      beforeVaultAmounts,
      afterVaultAmounts
    );
    assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey);
  });

  it("swap with dev-fee of 100%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(100, 100); // 100%
    const inputTokenAmount = new u64(119500000);
    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = whirlpoolData.tokenMintB;

    assert.rejects(
      () =>
        swapQuoteByInputTokenWithDevFees(
          whirlpool,
          swapToken,
          inputTokenAmount,
          slippageTolerance,
          ctx.program.programId,
          ctx.fetcher,
          devFeePercentage,
          true
        ),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.InvalidDevFeePercentage
    );
  });

  it("swap with dev-fee of 200%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(200, 100); // 200%
    const inputTokenAmount = new u64(119500000);
    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = whirlpoolData.tokenMintB;

    assert.rejects(
      () =>
        swapQuoteByInputTokenWithDevFees(
          whirlpool,
          swapToken,
          inputTokenAmount,
          slippageTolerance,
          ctx.program.programId,
          ctx.fetcher,
          devFeePercentage,
          true
        ),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.InvalidDevFeePercentage
    );
  });

  it("swap with a manual quote with dev-fee of 200%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = false;
    const whirlpool = await setupSwapTest({
      ctx,
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
          new anchor.BN(250_000_000)
        ),
      ],
    });

    const devFeePercentage = Percentage.fromFraction(200, 100); // 200%
    const inputTokenAmount = new u64(119500000);
    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = whirlpoolData.tokenMintB;

    assert.rejects(
      async () =>
        (
          await whirlpool.swapWithDevFees(
            {
              amount: new u64(10000),
              devFeeAmount: new u64(30000),
              amountSpecifiedIsInput: true,
              aToB: true,
              otherAmountThreshold: ZERO,
              sqrtPriceLimit: ZERO,
              tickArray0: PublicKey.default,
              tickArray1: PublicKey.default,
              tickArray2: PublicKey.default,
            },
            devWallet.publicKey
          )
        ).buildAndExecute(),
      (err) => (err as WhirlpoolsError).errorCode === SwapErrorCode.InvalidDevFeePercentage
    );
  });
});

async function getQuotes(
  ctx: WhirlpoolContext,
  whirlpool: Whirlpool,
  swapToken: Address,
  inputTokenAmount: u64,
  postFeeTokenAmount: u64,
  slippageTolerance: Percentage,
  devFeePercentage: Percentage
) {
  const inputTokenQuote = await swapQuoteByInputToken(
    whirlpool,
    swapToken,
    inputTokenAmount,
    slippageTolerance,
    ctx.program.programId,
    ctx.fetcher,
    true
  );
  const postFeeInputTokenQuote = await swapQuoteByInputToken(
    whirlpool,
    swapToken,
    postFeeTokenAmount,
    slippageTolerance,
    ctx.program.programId,
    ctx.fetcher,
    true
  );
  const inputTokenQuoteWithDevFees = await swapQuoteByInputTokenWithDevFees(
    whirlpool,
    swapToken,
    inputTokenAmount,
    slippageTolerance,
    ctx.program.programId,
    ctx.fetcher,
    devFeePercentage,
    true
  );

  return { inputTokenQuote, postFeeInputTokenQuote, inputTokenQuoteWithDevFees };
}
