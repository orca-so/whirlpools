import { Percentage } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import {
  buildWhirlpoolClient,
  PriceMath,
  swapQuoteByInputToken,
  WhirlpoolContext,
} from "../../../../src";
import { swapQuoteByInputTokenWithDevFees } from "../../../../src/quotes/public/dev-fee-swap-quote";
import { assertInputOutputQuoteEqual, assertQuoteAndResults, TickSpacing } from "../../../utils";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest,
} from "../../../utils/swap-test-utils";
import { getVaultAmounts } from "../../../utils/whirlpools-test-utils";

describe.only("whirlpool-dev-fee-swap", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  it("swap with dev-fee 0% equals swap", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: -1, offsetIndex: 22 }, tickSpacing);
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

    const whirlpoolData = await whirlpool.refreshData();
    const beforeVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    const inputTokenQuote = await swapQuoteByInputToken(
      whirlpool,
      whirlpoolData.tokenMintB,
      new u64(119500000),
      slippageTolerance,
      ctx.program.programId,
      ctx.fetcher,
      true
    );
    const inputTokenQuoteWithDevFees = await swapQuoteByInputTokenWithDevFees(
      whirlpool,
      whirlpoolData.tokenMintA,
      inputTokenQuote.estimatedAmountOut,
      slippageTolerance,
      ctx.program.programId,
      ctx.fetcher,
      Percentage.fromFraction(0, 1000), // 0%
      true
    );
    assertInputOutputQuoteEqual(inputTokenQuote, inputTokenQuoteWithDevFees);
    await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();

    const newData = await whirlpool.refreshData();
    const afterVaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
    assertQuoteAndResults(aToB, inputTokenQuote, newData, beforeVaultAmounts, afterVaultAmounts);
  });

  it("swap with dev-fee 0.1%", async () => {});

  it("swap with dev-fee 1%", async () => {});
  it("swap with dev-fee 10%", async () => {});
});
