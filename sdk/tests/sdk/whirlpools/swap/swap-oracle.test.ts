import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import { BN } from "bn.js";
import {
  buildWhirlpoolClient, InitPoolParams, PDAUtil, PriceMath,
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

describe("swap with oracle tests", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;
  const client = buildWhirlpoolClient(ctx);
  const tickSpacing = TickSpacing.SixtyFour;
  const slippageTolerance = Percentage.fromFraction(0, 100);

  describe("swap with oracle", async () => {
    /**
     * |a-------------------|x---------------------|---------------------a|
     */
    it("init, skip, add, skip, skip, add, add", async () => {
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

      const whirlpoolData = await whirlpool.refreshData();
      assert.equal(whirlpoolData.tickCurrentIndex, 0);

      const oracleInfo = await initializeOracle(
        ctx,
        whirlpool.getAddress(),
        // funder = ctx.wallet.publicKey
      );
      const { oraclePda } = oracleInfo;
      const oraclePubkey = oraclePda.publicKey;
  
      const oracle0 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.ok(oracle0!.whirlpool.equals(whirlpool.getAddress()));
      assert.strictEqual(oracle0!.observationIndex, 0);
      assert.ok(oracle0!.observations[0].tickCumulative.isZero());

      const vaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
      
      // 1st swap (observation will not be added)
      // b --> a, tick_index: 0 --> 32
      const quote1 = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        vaultAmounts.tokenA.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote1,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(32),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, 32);
      const oracle1 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.strictEqual(oracle1!.observationIndex, 0); // unchanged

      // 2nd swap (observation will be added)
      // a --> b, tick_index: 32 --> 24
      await sleep(11 * 1000);
      const quote2 = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        vaultAmounts.tokenB.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote2,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(24),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, 24);
      const oracle2 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.strictEqual(oracle2!.observationIndex, 1);
      const timeDelta2 = oracle2!.observations[1].timestamp - oracle2!.observations[0].timestamp;
      assert.ok(timeDelta2 >= 10);
      // not 24 * timeDelta2 because tickCurrentIndex "before" swap will be used
      assert.equal(oracle2!.observations[1].tickCumulative.toNumber(), 32 * timeDelta2);

      // 3rd swap (observation will not be added)
      // a --> b, tick_index: 24 --> -16
      await sleep(3 * 1000);
      await whirlpool.refreshData();
      const quote3 = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        vaultAmounts.tokenB.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote3,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(-16),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, -16);
      const oracle3 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.strictEqual(oracle3!.observationIndex, 1); // unchanged

      // 4th swap (observation will not be added)
      // a --> b, tick_index: -16 --> -48
      await sleep(3 * 1000);
      await whirlpool.refreshData();
      const quote4 = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintB,
        vaultAmounts.tokenB.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote4,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(-48),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, -48);
      const oracle4 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.strictEqual(oracle4!.observationIndex, 1); // unchanged

      // 5th swap (observation will be added)
      // b --> a, tick_index: -48 --> 8
      await sleep(5 * 1000);
      await whirlpool.refreshData();
      const quote5 = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        vaultAmounts.tokenA.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote5,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(8),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, 8);
      const oracle5 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.strictEqual(oracle5!.observationIndex, 2);
      const timeDelta5 = oracle5!.observations[2].timestamp - oracle5!.observations[1].timestamp;
      assert.ok(timeDelta5 >= 10);
      // not 8 * timeDelta5 because tickCurrentIndex "before" swap will be used
      assert.equal(
        oracle5!.observations[2].tickCumulative.toNumber(),
        oracle5!.observations[1].tickCumulative.toNumber() + -48 * timeDelta5
      );

      // 6th swap (observation will be added)
      // b --> a, tick_index: 8 --> 64
      await sleep(11 * 1000);
      await whirlpool.refreshData();
      const quote6 = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        vaultAmounts.tokenA.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      await (await whirlpool.swap({
        ...quote6,
        sqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(64),
      })).buildAndExecute();

      assert.equal((await whirlpool.refreshData()).tickCurrentIndex, 64);
      const oracle6 = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
      assert.strictEqual(oracle6!.observationIndex, 3);
      const timeDelta6 = oracle6!.observations[3].timestamp - oracle6!.observations[2].timestamp;
      assert.ok(timeDelta6 >= 10);
      // not 64 * timeDelta5 because tickCurrentIndex "before" swap will be used
      assert.equal(
        oracle6!.observations[3].tickCumulative.toNumber(),
        oracle6!.observations[2].tickCumulative.toNumber() + 8 * timeDelta6
      );

    });

    it("should be failed: invalid oracle account (not initialized)", async () => {
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

      const whirlpoolData = await whirlpool.refreshData();
      const vaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
      
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        vaultAmounts.tokenA.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      const params = SwapUtils.getSwapParamsFromQuote(
        quote,
        ctx,
        whirlpool,
        getAssociatedTokenAddressSync(whirlpoolData.tokenMintB, ctx.wallet.publicKey),
        getAssociatedTokenAddressSync(whirlpoolData.tokenMintA, ctx.wallet.publicKey),
        ctx.wallet.publicKey
      );

      const tx = await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, {
        ...params,
        oracle: Keypair.generate().publicKey, // invalid oracle address (uninitialized)        
      }));

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("should be failed: invalid oracle account (initialized account, but one of different pool)", async () => {
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

      const anotherWhirlpool = await setupSwapTest({
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

      const anotherOracleInfo = await initializeOracle(
        ctx,
        anotherWhirlpool.getAddress(),
        // funder = ctx.wallet.publicKey
      );
      const { oraclePda: anotherOraclePda } = anotherOracleInfo;
      const anotherOraclePubkey = anotherOraclePda.publicKey;
      const anotherOracleData = await ctx.fetcher.getOracle(anotherOraclePubkey, IGNORE_CACHE);
      assert.ok(anotherOracleData!.whirlpool.equals(anotherWhirlpool.getAddress()));

      const whirlpoolData = await whirlpool.refreshData();
      const vaultAmounts = await getVaultAmounts(ctx, whirlpoolData);
      
      const quote = await swapQuoteByOutputToken(
        whirlpool,
        whirlpoolData.tokenMintA,
        vaultAmounts.tokenA.divn(2),
        slippageTolerance,
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
      const params = SwapUtils.getSwapParamsFromQuote(
        quote,
        ctx,
        whirlpool,
        getAssociatedTokenAddressSync(whirlpoolData.tokenMintB, ctx.wallet.publicKey),
        getAssociatedTokenAddressSync(whirlpoolData.tokenMintA, ctx.wallet.publicKey),
        ctx.wallet.publicKey
      );

      const tx = await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, {
        ...params,
        oracle: anotherOraclePubkey,
      }));

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

  });

  describe("two-hop swap with oracle", async () => {
    let aqConfig: InitAquariumParams;
    beforeEach(async () => {
      aqConfig = getDefaultAquarium();
      // Add a third token and account and a second pool
      aqConfig.initMintParams.push({});
      aqConfig.initTokenAccParams.push({ mintIndex: 2 });
      aqConfig.initPoolParams.push({ mintIndices: [1, 2], tickSpacing: TickSpacing.Standard });
  
      // Add tick arrays and positions
      const aToB = false;
      aqConfig.initTickArrayRangeParams.push({
        poolIndex: 0,
        startTickIndex: 22528,
        arrayCount: 3,
        aToB,
      });
      aqConfig.initTickArrayRangeParams.push({
        poolIndex: 1,
        startTickIndex: 22528,
        arrayCount: 3,
        aToB,
      });
      const fundParams: FundedPositionParams[] = [
        {
          liquidityAmount: new anchor.BN(10_000_000),
          tickLowerIndex: 29440,
          tickUpperIndex: 33536,
        },
      ];
      aqConfig.initPositionParams.push({ poolIndex: 0, fundParams });
      aqConfig.initPositionParams.push({ poolIndex: 1, fundParams });
    });

    function getParamsFromPools(
      pools: [InitPoolParams, InitPoolParams],
      tokenAccounts: { mint: PublicKey; account: PublicKey }[]
    ) {
      const tokenAccKeys = getTokenAccsForPools(pools, tokenAccounts);
  
      const whirlpoolOne = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwo = pools[1].whirlpoolPda.publicKey;
      const oracleOne = PDAUtil.getOracle(ctx.program.programId, whirlpoolOne).publicKey;
      const oracleTwo = PDAUtil.getOracle(ctx.program.programId, whirlpoolTwo).publicKey;
      return {
        whirlpoolOne: pools[0].whirlpoolPda.publicKey,
        whirlpoolTwo: pools[1].whirlpoolPda.publicKey,
        tokenOwnerAccountOneA: tokenAccKeys[0],
        tokenVaultOneA: pools[0].tokenVaultAKeypair.publicKey,
        tokenOwnerAccountOneB: tokenAccKeys[1],
        tokenVaultOneB: pools[0].tokenVaultBKeypair.publicKey,
        tokenOwnerAccountTwoA: tokenAccKeys[2],
        tokenVaultTwoA: pools[1].tokenVaultAKeypair.publicKey,
        tokenOwnerAccountTwoB: tokenAccKeys[3],
        tokenVaultTwoB: pools[1].tokenVaultBKeypair.publicKey,
        oracleOne,
        oracleTwo,
      };
    }
  
    it("init, skip, add (both oracle initialized)", async () => {
      const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;
  
      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
  
      const [inputToken, intermediaryToken, _outputToken] = mintKeys;
  
      const oracleOneInfo = await initializeOracle(ctx, whirlpoolOne.getAddress());
      const oracleTwoInfo = await initializeOracle(ctx, whirlpoolTwo.getAddress());

      const oracleOnePubkey = oracleOneInfo.oraclePda.publicKey;
      const oracleTwoPubkey = oracleTwoInfo.oraclePda.publicKey;
  
      const oracleOne0 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      assert.ok(oracleOne0!.whirlpool.equals(whirlpoolOne.getAddress()));
      assert.strictEqual(oracleOne0!.observationIndex, 0);
      assert.ok(oracleOne0!.observations[0].tickCumulative.isZero());

      const oracleTwo0 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      assert.ok(oracleTwo0!.whirlpool.equals(whirlpoolTwo.getAddress()));
      assert.strictEqual(oracleTwo0!.observationIndex, 0);
      assert.ok(oracleTwo0!.observations[0].tickCumulative.isZero());

      const quoteOne1 = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const quoteTwo1 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteOne1.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const twoHopQuote1 = twoHopSwapQuoteFromSwapQuotes(quoteOne1, quoteTwo1);
  
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote1,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute();

      const tickCurrentIndexOne = (await whirlpoolOne.refreshData()).tickCurrentIndex;
      const tickCurrentIndexTwo = (await whirlpoolTwo.refreshData()).tickCurrentIndex;

      const oracleOne1 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      assert.strictEqual(oracleOne1!.observationIndex, 0); // unchanged

      const oracleTwo1 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      assert.strictEqual(oracleTwo1!.observationIndex, 0); // unchanged

      await sleep(11 * 1000);
      await whirlpoolOne.refreshData();
      await whirlpoolTwo.refreshData();

      const quoteOne2 = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const quoteTwo2 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteOne2.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const twoHopQuote2 = twoHopSwapQuoteFromSwapQuotes(quoteOne2, quoteTwo2);
  
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote2,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute();

      const oracleOne2 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      assert.strictEqual(oracleOne2!.observationIndex, 1);
      const oracleTwo2 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      assert.strictEqual(oracleTwo2!.observationIndex, 1);

      const timeDeltaOne2 = oracleOne2!.observations[1].timestamp - oracleOne2!.observations[0].timestamp;
      assert.ok(timeDeltaOne2 >= 10);
      const timeDeltaTwo2 = oracleTwo2!.observations[1].timestamp - oracleTwo2!.observations[0].timestamp;
      assert.ok(timeDeltaTwo2 >= 10);

      assert.equal(oracleOne2!.observations[1].tickCumulative.toNumber(), oracleOne2!.observations[0].tickCumulative.toNumber() + tickCurrentIndexOne * timeDeltaOne2);
      assert.equal(oracleTwo2!.observations[1].tickCumulative.toNumber(), oracleTwo2!.observations[0].tickCumulative.toNumber() + tickCurrentIndexTwo * timeDeltaTwo2);
    });

    it("init, skip, add (only oracleOne is initialized)", async () => {
      const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;
  
      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
  
      const [inputToken, intermediaryToken, _outputToken] = mintKeys;
  
      const oracleOneInfo = await initializeOracle(ctx, whirlpoolOne.getAddress());
      //const oracleTwoInfo = await initializeOracle(ctx, whirlpoolTwo.getAddress());

      const oracleOnePubkey = oracleOneInfo.oraclePda.publicKey;
      //const oracleTwoPubkey = oracleTwoInfo.oraclePda.publicKey;
  
      const oracleOne0 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      assert.ok(oracleOne0!.whirlpool.equals(whirlpoolOne.getAddress()));
      assert.strictEqual(oracleOne0!.observationIndex, 0);
      assert.ok(oracleOne0!.observations[0].tickCumulative.isZero());

      //const oracleTwo0 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      //assert.ok(oracleTwo0!.whirlpool.equals(whirlpoolTwo.getAddress()));
      //assert.strictEqual(oracleTwo0!.observationIndex, 0);
      //assert.ok(oracleTwo0!.observations[0].tickCumulative.isZero());

      const quoteOne1 = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const quoteTwo1 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteOne1.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const twoHopQuote1 = twoHopSwapQuoteFromSwapQuotes(quoteOne1, quoteTwo1);
  
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote1,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute();

      const tickCurrentIndexOne = (await whirlpoolOne.refreshData()).tickCurrentIndex;
      //const tickCurrentIndexTwo = (await whirlpoolTwo.refreshData()).tickCurrentIndex;

      const oracleOne1 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      assert.strictEqual(oracleOne1!.observationIndex, 0); // unchanged

      //const oracleTwo1 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      //assert.strictEqual(oracleTwo1!.observationIndex, 0); // unchanged

      await sleep(11 * 1000);
      await whirlpoolOne.refreshData();
      await whirlpoolTwo.refreshData();

      const quoteOne2 = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const quoteTwo2 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteOne2.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const twoHopQuote2 = twoHopSwapQuoteFromSwapQuotes(quoteOne2, quoteTwo2);
  
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote2,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute();

      const oracleOne2 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      assert.strictEqual(oracleOne2!.observationIndex, 1);
      //const oracleTwo2 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      //assert.strictEqual(oracleTwo2!.observationIndex, 1);

      const timeDeltaOne2 = oracleOne2!.observations[1].timestamp - oracleOne2!.observations[0].timestamp;
      assert.ok(timeDeltaOne2 >= 10);
      //const timeDeltaTwo2 = oracleTwo2!.observations[1].timestamp - oracleTwo2!.observations[0].timestamp;
      //assert.ok(timeDeltaTwo2 >= 10);

      assert.equal(oracleOne2!.observations[1].tickCumulative.toNumber(), oracleOne2!.observations[0].tickCumulative.toNumber() + tickCurrentIndexOne * timeDeltaOne2);
      //assert.equal(oracleTwo2!.observations[1].tickCumulative.toNumber(), oracleTwo2!.observations[0].tickCumulative.toNumber() + tickCurrentIndexTwo * timeDeltaTwo2);
    });

    it("init, skip, add (only oracleTwo is initialized)", async () => {
      const aquarium = (await buildTestAquariums(ctx, [aqConfig]))[0];
      const { tokenAccounts, mintKeys, pools } = aquarium;
  
      const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
      const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
      let whirlpoolOne = await client.getPool(whirlpoolOneKey, IGNORE_CACHE);
      let whirlpoolTwo = await client.getPool(whirlpoolTwoKey, IGNORE_CACHE);
  
      const [inputToken, intermediaryToken, _outputToken] = mintKeys;
  
      //const oracleOneInfo = await initializeOracle(ctx, whirlpoolOne.getAddress());
      const oracleTwoInfo = await initializeOracle(ctx, whirlpoolTwo.getAddress());

      //const oracleOnePubkey = oracleOneInfo.oraclePda.publicKey;
      const oracleTwoPubkey = oracleTwoInfo.oraclePda.publicKey;
  
      //const oracleOne0 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      //assert.ok(oracleOne0!.whirlpool.equals(whirlpoolOne.getAddress()));
      //assert.strictEqual(oracleOne0!.observationIndex, 0);
      //assert.ok(oracleOne0!.observations[0].tickCumulative.isZero());

      const oracleTwo0 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      assert.ok(oracleTwo0!.whirlpool.equals(whirlpoolTwo.getAddress()));
      assert.strictEqual(oracleTwo0!.observationIndex, 0);
      assert.ok(oracleTwo0!.observations[0].tickCumulative.isZero());

      const quoteOne1 = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const quoteTwo1 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteOne1.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const twoHopQuote1 = twoHopSwapQuoteFromSwapQuotes(quoteOne1, quoteTwo1);
  
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote1,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute();

      //const tickCurrentIndexOne = (await whirlpoolOne.refreshData()).tickCurrentIndex;
      const tickCurrentIndexTwo = (await whirlpoolTwo.refreshData()).tickCurrentIndex;

      //const oracleOne1 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      //assert.strictEqual(oracleOne1!.observationIndex, 0); // unchanged

      const oracleTwo1 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      assert.strictEqual(oracleTwo1!.observationIndex, 0); // unchanged

      await sleep(11 * 1000);
      await whirlpoolOne.refreshData();
      await whirlpoolTwo.refreshData();

      const quoteOne2 = await swapQuoteByInputToken(
        whirlpoolOne,
        inputToken,
        new BN(1000),
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const quoteTwo2 = await swapQuoteByInputToken(
        whirlpoolTwo,
        intermediaryToken,
        quoteOne2.estimatedAmountOut,
        Percentage.fromFraction(1, 100),
        ctx.program.programId,
        fetcher,
        IGNORE_CACHE
      );
  
      const twoHopQuote2 = twoHopSwapQuoteFromSwapQuotes(quoteOne2, quoteTwo2);
  
      await toTx(
        ctx,
        WhirlpoolIx.twoHopSwapIx(ctx.program, {
          ...twoHopQuote2,
          ...getParamsFromPools([pools[0], pools[1]], tokenAccounts),
          tokenAuthority: ctx.wallet.publicKey,
        })
      ).buildAndExecute();

      //const oracleOne2 = await ctx.fetcher.getOracle(oracleOnePubkey, IGNORE_CACHE);
      //assert.strictEqual(oracleOne2!.observationIndex, 1);
      const oracleTwo2 = await ctx.fetcher.getOracle(oracleTwoPubkey, IGNORE_CACHE);
      assert.strictEqual(oracleTwo2!.observationIndex, 1);

      //const timeDeltaOne2 = oracleOne2!.observations[1].timestamp - oracleOne2!.observations[0].timestamp;
      //assert.ok(timeDeltaOne2 >= 10);
      const timeDeltaTwo2 = oracleTwo2!.observations[1].timestamp - oracleTwo2!.observations[0].timestamp;
      assert.ok(timeDeltaTwo2 >= 10);

      //assert.equal(oracleOne2!.observations[1].tickCumulative.toNumber(), oracleOne2!.observations[0].tickCumulative.toNumber() + tickCurrentIndexOne * timeDeltaOne2);
      assert.equal(oracleTwo2!.observations[1].tickCumulative.toNumber(), oracleTwo2!.observations[0].tickCumulative.toNumber() + tickCurrentIndexTwo * timeDeltaTwo2);
    });

  });
});
