import { Percentage, ZERO } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { Address } from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import {
  buildWhirlpoolClient, PriceMath,
  swapQuoteByInputToken,
  Whirlpool,
  WhirlpoolContext
} from "../../../../src";
import { SwapErrorCode, WhirlpoolsError } from "../../../../src/errors/errors";
import { swapQuoteByInputTokenWithDevFees } from "../../../../src/quotes/public/dev-fee-swap-quote";
import {
  assertDevFeeQuotes,
  assertDevTokenAmount,
  assertQuoteAndResults,
  TickSpacing
} from "../../../utils";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest
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
    const inputTokenAmount = new u64(1195000);
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );

    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = aToB ? whirlpoolData.tokenMintA : whirlpoolData.tokenMintB;
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
    await assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey);
  });

  it("swap with dev-fee 1%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 22 }, tickSpacing);
    const devWallet = Keypair.generate();
    const aToB = true;
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

    const devFeePercentage = Percentage.fromFraction(1, 100); // 1%
    const inputTokenAmount = new u64(119500000);
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );

    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = aToB ? whirlpoolData.tokenMintA : whirlpoolData.tokenMintB;
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
    await assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey);
  });

  it("swap with input-token as NATIVE_MINT & dev-fee 1%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 1, offsetIndex: 1 }, tickSpacing);
    const aToB = true;
    const tokenAIsNative = true;
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-16896, -11264, -5632, 0, 5632],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 1, offsetIndex: 23 },
          tickSpacing,
          new anchor.BN(990_000_000)
        ),
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 10 },
          { arrayIndex: 0, offsetIndex: 23 },
          tickSpacing,
          new anchor.BN(990_000_000)
        ),
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: 22 },
          { arrayIndex: 1, offsetIndex: 23 },
          tickSpacing,
          new anchor.BN(1_990_000_000)
        ),
        buildPosition(
          // a
          { arrayIndex: 0, offsetIndex: 23 },
          { arrayIndex: 1, offsetIndex: 23 },
          tickSpacing,
          new anchor.BN(990_000_000)
        ),
      ],
    }, tokenAIsNative);

    const { devWallet, balance: preDevWalletBalance } = await setupDevWallet(ctx, 10_000_000)

    const devFeePercentage = Percentage.fromFraction(1, 10000); // 0.01%
    const inputTokenAmount = new u64(1_000_000_000); // Swap 1SOL
    const postFeeTokenAmount = inputTokenAmount.sub(
      inputTokenAmount.mul(devFeePercentage.numerator).div(devFeePercentage.denominator)
    );

    const whirlpoolData = await whirlpool.refreshData();
    const swapToken = aToB ? whirlpoolData.tokenMintA : whirlpoolData.tokenMintB;
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
    await assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey, preDevWalletBalance);
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
    const swapToken = aToB ? whirlpoolData.tokenMintA : whirlpoolData.tokenMintB;
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
    await assertDevTokenAmount(ctx, inputTokenQuoteWithDevFees, swapToken, devWallet.publicKey);
  });

  it("swap with dev-fee of 100%", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
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

async function setupDevWallet(ctx: WhirlpoolContext, airdrop: number) {
  // Setup dev-wallet. Airdrop some tokens in or it'll be difficult to account for
  // rent-tokens when we do assertion
  const devWallet = Keypair.generate();
  const txn = await ctx.provider.connection.requestAirdrop(devWallet.publicKey, airdrop);
  await ctx.provider.connection.confirmTransaction(txn);
  const balance = await ctx.provider.connection.getBalance(devWallet.publicKey);
  return { devWallet, balance }
}
