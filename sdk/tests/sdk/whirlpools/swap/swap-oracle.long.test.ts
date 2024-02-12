import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import {
  buildWhirlpoolClient, InitPoolParams, NUM_ORACLE_OBSERVATIONS, PDAUtil, PoolUtil, PriceMath,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  SwapUtils,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
  WhirlpoolContext,
  WhirlpoolIx
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import { sleep, TickSpacing } from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import {
  arrayTickIndexToTickIndex,
  buildPosition,
  setupSwapTest
} from "../../../utils/swap-test-utils";
import { getVaultAmounts } from "../../../utils/whirlpools-test-utils";
import { buildTestAquariums, FundedPositionParams, getDefaultAquarium, getTokenAccsForPools, InitAquariumParams, initializeOracle } from "../../../utils/init-utils";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

describe("swap with oracle tests (long)", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  /**
   * |a-------------------|x---------------------|---------------------a|
   */
  it("init, add, add, add, ...", async () => {
    const currIndex = arrayTickIndexToTickIndex({ arrayIndex: 0, offsetIndex: 0 }, tickSpacing);
    const whirlpool = await setupSwapTest({
      ctx,
      client,
      tickSpacing,
      initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currIndex),
      initArrayStartTicks: [-5632, 0, 5632],
      fundedPositions: [
        buildPosition(
          // a
          { arrayIndex: -1, offsetIndex: 0 },
          { arrayIndex: +1, offsetIndex: 87 },
          tickSpacing,
          new BN(250_000)
        ),
      ],
    });

    const whirlpoolData0 = await whirlpool.refreshData();
    assert.equal(whirlpoolData0.tickCurrentIndex, 0);

    const oracleInfo = await initializeOracle(
      ctx,
      whirlpool.getAddress(),
      // funder = ctx.wallet.publicKey
    );
    const { oraclePda } = oracleInfo;
    const oraclePubkey = oraclePda.publicKey;

    const oracle0 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
    assert.ok(oracle0!.whirlpool.equals(whirlpool.getAddress()));


    const SWAP_TEST_COUNT = Math.ceil(NUM_ORACLE_OBSERVATIONS + NUM_ORACLE_OBSERVATIONS / 10);

    let previousObservationIndex = 0;
    let previousTickCumulative = new BN(0);
    let previousTimestamp = oracle0!.observations[0].timestamp;
    assert.strictEqual(oracle0!.observationIndex, previousObservationIndex);
    assert.ok(oracle0!.observations[0].tickCumulative.eq(previousTickCumulative));

    for (let i = 0; i < SWAP_TEST_COUNT; i++) {
      await sleep(11 * 1000);
      const whirlpoolData = await whirlpool.refreshData();
      const vaultAmounts = await getVaultAmounts(ctx, whirlpoolData);

      const beforeSwapTickIndex = whirlpoolData.tickCurrentIndex;
      
      // nextTickIndex: -2816 ~ +2816 (random)
      let nextTickIndex: number | undefined = undefined;
      while (nextTickIndex === undefined) {
        const next = Math.floor(5632 * Math.random()) - 5632/2;
        if (next !== beforeSwapTickIndex) {
          nextTickIndex = next;
        }
      }

      console.log("tickIndex:", whirlpoolData.tickCurrentIndex, "-->", nextTickIndex);

      const aToB = nextTickIndex < beforeSwapTickIndex;
      const amounts = PoolUtil.getTokenAmountsFromLiquidity(
        whirlpoolData.liquidity,
        whirlpoolData.sqrtPrice,
        aToB ? PriceMath.tickIndexToSqrtPriceX64(nextTickIndex) : whirlpoolData.sqrtPrice,
        aToB ? whirlpoolData.sqrtPrice : PriceMath.tickIndexToSqrtPriceX64(nextTickIndex),
        true
      );
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        aToB ? whirlpoolData.tokenMintB : whirlpoolData.tokenMintA,
        aToB ? amounts.tokenB : amounts.tokenA,
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(nextTickIndex),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, nextTickIndex);
      const oracle = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);

      const expectedObservationIndex = (previousObservationIndex + 1) % NUM_ORACLE_OBSERVATIONS;
      assert.strictEqual(oracle!.observationIndex, expectedObservationIndex);

      const latestObservation = oracle!.observations[oracle!.observationIndex];

      const timeDelta = latestObservation.timestamp - previousTimestamp;
      assert.ok(timeDelta >= 10);

      console.log("observationIndex:", previousObservationIndex, "-->", expectedObservationIndex);
      console.log("timeDelta:", timeDelta, "seconds");
      console.log("tickCumulative:", previousTickCumulative.toString(), "+", beforeSwapTickIndex, "x", timeDelta, "=", previousTickCumulative.add(new BN(beforeSwapTickIndex).mul(new BN(timeDelta))).toString());
      console.log("tickCumulative(latest):", latestObservation.tickCumulative.toString());
      const expectedTickCumulative = previousTickCumulative.add(new BN(beforeSwapTickIndex).mul(new BN(timeDelta)));
      assert.ok(latestObservation.tickCumulative.eq(expectedTickCumulative));

      previousObservationIndex = oracle!.observationIndex;
      previousTimestamp = latestObservation.timestamp;
      previousTickCumulative = latestObservation.tickCumulative;
    }

  });

});
