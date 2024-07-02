import * as anchor from "@coral-xyz/anchor";
import { DecimalUtil, MathUtil, Percentage, TransactionBuilder, U64_MAX, ZERO } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import { NUM_REWARDS, PDAUtil, POSITION_BUNDLE_SIZE, PoolUtil, PositionBundleData, PriceMath, SwapQuote, SwapUtils, TickUtil, Whirlpool, WhirlpoolClient, WhirlpoolData, WhirlpoolIx, buildWhirlpoolClient, collectFeesQuote, increaseLiquidityQuoteByInputToken, swapQuoteByInputToken, swapQuoteByOutputToken, swapQuoteWithParams, toTx } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing, ZERO_BN, createTokenAccount } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { initTestPoolWithTokens, initTickArrayRange, initializePositionBundle, openBundledPosition } from "../../utils/init-utils";
import { NO_TOKEN_EXTENSION_CONTEXT, TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { buildTickArrayData } from "../../utils/testDataTypes";


interface SharedTestContext {
  provider: anchor.AnchorProvider;
  program: Whirlpool;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("sparse swap tests", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  let testCtx: SharedTestContext;
  const sleep = (second: number) => new Promise(resolve => setTimeout(resolve, second * 1000))

  before(() => {
    anchor.setProvider(provider);
    const program = anchor.workspace.Whirlpool;
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    testCtx = {
      provider,
      program,
      whirlpoolCtx,
      whirlpoolClient,
    };
  });

  const tickSpacing64 = 64;
  const tickSpacing8192 = 8192;

  describe("TickArray order adjustment", () => {
    it("reverse order(ta2, ta1, ta0 => ta0, ta1, ta2), a to b", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(3000), // tickCurrentIndex = 3000
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-11264  ][-5632   ][0       ]
      await (await pool.initTickArrayForTicks([-11264, -5632, 0]))!.buildAndExecute();

      // deposit [-9984, 2944], 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintB,
        DecimalUtil.fromBN(new BN(100_000), 0),
        -9984,
        2944,
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(-9984, 2944, depositQuote)).tx.buildAndExecute();

      await pool.refreshData();
      const swapQuote = await swapQuoteByOutputToken(
        pool,
        poolInitInfo.tokenMintB,
        new BN(99_000),
        Percentage.fromFraction(0, 100),
        testCtx.whirlpoolCtx.program.programId,
        testCtx.whirlpoolCtx.fetcher,
        IGNORE_CACHE,
      );

      const params = SwapUtils.getSwapParamsFromQuote(
        swapQuote,
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountA,
        tokenAccountB,
        testCtx.provider.wallet.publicKey
      );

      assert.ok((await pool.refreshData()).tickCurrentIndex >= 2944);

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...params,
          // reverse
          tickArray0: params.tickArray2,
          tickArray1: params.tickArray1,
          tickArray2: params.tickArray0,
        })
      ).buildAndExecute();

      // 3000 --> less than -5632
      assert.ok((await pool.refreshData()).tickCurrentIndex < -5632);
    });

    it("reverse order(ta2, ta1, ta0 => ta0, ta1, ta2), b to a", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(-3000), // tickCurrentIndex = -3000
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-5632   ][0       ][5632    ]
      await (await pool.initTickArrayForTicks([-5632, 0, 5632]))!.buildAndExecute();

      // deposit [-2944, 9984], 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintA,
        DecimalUtil.fromBN(new BN(100_000), 0),
        -2944,
        9984,
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(-2944, 9984, depositQuote)).tx.buildAndExecute();

      await pool.refreshData();
      const swapQuote = await swapQuoteByOutputToken(
        pool,
        poolInitInfo.tokenMintA,
        new BN(99_000),
        Percentage.fromFraction(0, 100),
        testCtx.whirlpoolCtx.program.programId,
        testCtx.whirlpoolCtx.fetcher,
        IGNORE_CACHE,
      );

      const params = SwapUtils.getSwapParamsFromQuote(
        swapQuote,
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountB,
        tokenAccountA,
        testCtx.provider.wallet.publicKey
      );

      assert.ok((await pool.refreshData()).tickCurrentIndex <= -2944);

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...params,
          // reverse
          tickArray0: params.tickArray2,
          tickArray1: params.tickArray1,
          tickArray2: params.tickArray0,
        })
      ).buildAndExecute();

      // -3000 --> larger than 5632
      assert.ok((await pool.refreshData()).tickCurrentIndex > 5632);
    });

    it("skip ta0(ta0, ta1, ta2 => ta1, ta2), a to b", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(64), // tickCurrentIndex = 64
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-11264  ][-5632   ][0       ]
      await (await pool.initTickArrayForTicks([-11264, -5632, 0]))!.buildAndExecute();

      // deposit [-9984, -128], 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintB,
        DecimalUtil.fromBN(new BN(100_000), 0),
        -9984,
        -128,
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(-9984, -128, depositQuote)).tx.buildAndExecute();

      await pool.refreshData();
      const swapQuote = await swapQuoteByOutputToken(
        pool,
        poolInitInfo.tokenMintB,
        new BN(99_000),
        Percentage.fromFraction(10, 100),
        testCtx.whirlpoolCtx.program.programId,
        testCtx.whirlpoolCtx.fetcher,
        IGNORE_CACHE,
      );

      const params = SwapUtils.getSwapParamsFromQuote(
        swapQuote,
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountA,
        tokenAccountB,
        testCtx.provider.wallet.publicKey
      );

      assert.ok((await pool.refreshData()).tickCurrentIndex >= 64);

      // another swap push tickCurrentIndex to less than -128
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, SwapUtils.getSwapParamsFromQuote(
          await swapQuoteByOutputToken(
            pool,
            poolInitInfo.tokenMintB,
            new BN(1),
            Percentage.fromFraction(0, 100),
            testCtx.whirlpoolCtx.program.programId,
            testCtx.whirlpoolCtx.fetcher,
            IGNORE_CACHE,
          ),
          testCtx.whirlpoolCtx,
          pool,
          tokenAccountA,
          tokenAccountB,
          testCtx.provider.wallet.publicKey,
        )),
      ).buildAndExecute();

      assert.ok((await pool.refreshData()).tickCurrentIndex <= -128);
      assert.ok((await pool.refreshData()).tickCurrentIndex > -5632);

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, params),
      ).buildAndExecute();

      // less than -128 --> less than -5632
      assert.ok((await pool.refreshData()).tickCurrentIndex < -5632);
    });

    it("skip ta0, ta1(ta0, ta1, ta2 => ta2), a to b", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(64), // tickCurrentIndex = 64
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-11264  ][-5632   ][0       ]
      await (await pool.initTickArrayForTicks([-11264, -5632, 0]))!.buildAndExecute();

      // deposit [-9984, -5760], 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintB,
        DecimalUtil.fromBN(new BN(100_000), 0),
        -9984,
        -5760,
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(-9984, -5760, depositQuote)).tx.buildAndExecute();

      await pool.refreshData();
      const swapQuote = await swapQuoteByOutputToken(
        pool,
        poolInitInfo.tokenMintB,
        new BN(99_000),
        Percentage.fromFraction(10, 100),
        testCtx.whirlpoolCtx.program.programId,
        testCtx.whirlpoolCtx.fetcher,
        IGNORE_CACHE,
      );

      const params = SwapUtils.getSwapParamsFromQuote(
        swapQuote,
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountA,
        tokenAccountB,
        testCtx.provider.wallet.publicKey
      );

      assert.ok((await pool.refreshData()).tickCurrentIndex >= 64);

      // another swap push tickCurrentIndex to less than -5760
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, SwapUtils.getSwapParamsFromQuote(
          await swapQuoteByOutputToken(
            pool,
            poolInitInfo.tokenMintB,
            new BN(1),
            Percentage.fromFraction(0, 100),
            testCtx.whirlpoolCtx.program.programId,
            testCtx.whirlpoolCtx.fetcher,
            IGNORE_CACHE,
          ),
          testCtx.whirlpoolCtx,
          pool,
          tokenAccountA,
          tokenAccountB,
          testCtx.provider.wallet.publicKey,
        )),
      ).buildAndExecute();

      assert.ok((await pool.refreshData()).tickCurrentIndex <= -5760);
      assert.ok((await pool.refreshData()).tickCurrentIndex > -9984);

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, params),
      ).buildAndExecute();

      // less than -5760 --> less than -5760
      assert.ok((await pool.refreshData()).tickCurrentIndex < -5760);
    });

    it("skip ta0(ta0, ta1, ta2 => ta1, ta2), b to a", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(-64), // tickCurrentIndex = -64
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-5632   ][0       ][5632    ]
      await (await pool.initTickArrayForTicks([-5632, 0, 5632]))!.buildAndExecute();

      // deposit [128, 9984], 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintA,
        DecimalUtil.fromBN(new BN(100_000), 0),
        128,
        9984,
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(128, 9984, depositQuote)).tx.buildAndExecute();

      await pool.refreshData();
      const swapQuote = await swapQuoteByOutputToken(
        pool,
        poolInitInfo.tokenMintA,
        new BN(99_000),
        Percentage.fromFraction(10, 100),
        testCtx.whirlpoolCtx.program.programId,
        testCtx.whirlpoolCtx.fetcher,
        IGNORE_CACHE,
      );

      const params = SwapUtils.getSwapParamsFromQuote(
        swapQuote,
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountB,
        tokenAccountA,
        testCtx.provider.wallet.publicKey
      );

      assert.ok((await pool.refreshData()).tickCurrentIndex <= -64);

      // another swap push tickCurrentIndex to greater than 128
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, SwapUtils.getSwapParamsFromQuote(
          await swapQuoteByOutputToken(
            pool,
            poolInitInfo.tokenMintA,
            new BN(1),
            Percentage.fromFraction(0, 100),
            testCtx.whirlpoolCtx.program.programId,
            testCtx.whirlpoolCtx.fetcher,
            IGNORE_CACHE,
          ),
          testCtx.whirlpoolCtx,
          pool,
          tokenAccountB,
          tokenAccountA,
          testCtx.provider.wallet.publicKey,
        )),
      ).buildAndExecute();

      assert.ok((await pool.refreshData()).tickCurrentIndex >= 128);
      assert.ok((await pool.refreshData()).tickCurrentIndex < 5632);

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, params),
      ).buildAndExecute();

      // greater than 128 --> greater than 5632
      assert.ok((await pool.refreshData()).tickCurrentIndex > 5632);
    });

    it("skip ta0, ta1(ta0, ta1, ta2 => ta2), b to a", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(-64), // tickCurrentIndex = -64
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-5632   ][0       ][5632    ]
      await (await pool.initTickArrayForTicks([-5632, 0, 5632]))!.buildAndExecute();

      // deposit [5760, 9984], 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintA,
        DecimalUtil.fromBN(new BN(100_000), 0),
        5760,
        9984,
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(5760, 9984, depositQuote)).tx.buildAndExecute();

      await pool.refreshData();
      const swapQuote = await swapQuoteByOutputToken(
        pool,
        poolInitInfo.tokenMintA,
        new BN(99_000),
        Percentage.fromFraction(10, 100),
        testCtx.whirlpoolCtx.program.programId,
        testCtx.whirlpoolCtx.fetcher,
        IGNORE_CACHE,
      );

      const params = SwapUtils.getSwapParamsFromQuote(
        swapQuote,
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountB,
        tokenAccountA,
        testCtx.provider.wallet.publicKey
      );

      assert.ok((await pool.refreshData()).tickCurrentIndex <= -64);

      // another swap push tickCurrentIndex to greater than 5760
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, SwapUtils.getSwapParamsFromQuote(
          await swapQuoteByOutputToken(
            pool,
            poolInitInfo.tokenMintA,
            new BN(1),
            Percentage.fromFraction(0, 100),
            testCtx.whirlpoolCtx.program.programId,
            testCtx.whirlpoolCtx.fetcher,
            IGNORE_CACHE,
          ),
          testCtx.whirlpoolCtx,
          pool,
          tokenAccountB,
          tokenAccountA,
          testCtx.provider.wallet.publicKey,
        )),
      ).buildAndExecute();

      assert.ok((await pool.refreshData()).tickCurrentIndex >= 5760);
      assert.ok((await pool.refreshData()).tickCurrentIndex < 9984);

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, params),
      ).buildAndExecute();

      // greater than 5760 --> greater than 5760
      assert.ok((await pool.refreshData()).tickCurrentIndex > 5760);
    });

    it("a to b & b to a with same TickArray list", async () => {
      const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing8192,
          PriceMath.tickIndexToSqrtPriceX64(0),
          new BN(1_000_000)
        );

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

      // [-720896 ][0       ]
      await (await pool.initTickArrayForTicks([-720896, 0]))!.buildAndExecute();

      // deposit FullRange, 100_000_000
      const fullrange = TickUtil.getFullRangeTickIndex(tickSpacing8192);
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintA,
        DecimalUtil.fromBN(new BN(100_000), 0),
        fullrange[0],
        fullrange[1],
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(fullrange[0], fullrange[1], depositQuote)).tx.buildAndExecute();

      const ta0 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, whirlpoolPda.publicKey, -720896).publicKey;
      const ta1 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, whirlpoolPda.publicKey, 0).publicKey;

      // a to b
      await pool.refreshData();
      const aToBParams = SwapUtils.getSwapParamsFromQuote(
        await swapQuoteByOutputToken(
          pool,
          poolInitInfo.tokenMintB,
          new BN(1_000),
          Percentage.fromFraction(10, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        ),
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountA,
        tokenAccountB,
        testCtx.provider.wallet.publicKey
      );
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...aToBParams,
          // always use ta0, ta1, ta1
          tickArray0: ta0,
          tickArray1: ta1,
          tickArray2: ta1,
        }),
      ).buildAndExecute();

      // b to a
      await pool.refreshData();
      const bToAParams = SwapUtils.getSwapParamsFromQuote(
        await swapQuoteByOutputToken(
          pool,
          poolInitInfo.tokenMintA,
          new BN(1_000),
          Percentage.fromFraction(10, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        ),
        testCtx.whirlpoolCtx,
        pool,
        tokenAccountB,
        tokenAccountA,
        testCtx.provider.wallet.publicKey
      );
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...bToAParams,
          // always use ta0, ta1, ta1
          tickArray0: ta0,
          tickArray1: ta1,
          tickArray2: ta1,
        }),
      ).buildAndExecute();
    });
  });

  describe("swap through uninitialized TickArrays", () => {
    // |--------| uninitialized
    // |********| initialized
    // S: swap start / T: swap end

    async function buildTestEnvironment() {
      // ts: 64
      // liquidity provided from full range
      const initResult = await initTestPoolWithTokens(
        testCtx.whirlpoolCtx,
        tickSpacing64,
        PriceMath.tickIndexToSqrtPriceX64(2816),
        new BN(1_000_000_000)
      );
      const { poolInitInfo, whirlpoolPda } = initResult;

      const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);
      const fullrange = TickUtil.getFullRangeTickIndex(tickSpacing8192);

      await (await pool.initTickArrayForTicks([fullrange[0], fullrange[1]]))!.buildAndExecute();

      // deposit FullRange, 100_000_000
      const depositQuote = increaseLiquidityQuoteByInputToken(
        poolInitInfo.tokenMintA,
        DecimalUtil.fromBN(new BN(100_000_000), 0),
        fullrange[0],
        fullrange[1],
        Percentage.fromFraction(0, 100),
        pool,
        NO_TOKEN_EXTENSION_CONTEXT,
      );
      await (await pool.openPosition(fullrange[0], fullrange[1], depositQuote)).tx.buildAndExecute();

      const data = (await pool.refreshData());
      assert.ok(data.tickCurrentIndex == 2816);
      assert.ok(data.liquidity.gtn(0));
      return initResult;
    }

    describe("b to a: 2816 --> 2816 + (64 * 88) * 2", () => {
      const aToB = false;
      const initialTickIndex = 2816;
      const targetTickIndex = 2816 + tickSpacing64 * 88 * 2; // --> 2 tick arrays
      const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);

      async function runSwap(init0: boolean, init1: boolean, init2: boolean): Promise<{ quote: SwapQuote, poolData: WhirlpoolData }> {
        const { poolInitInfo, tokenAccountA, tokenAccountB } = await buildTestEnvironment();

        const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);

        const startTickIndexes = [0, 5632, 11264];
        const init = [init0, init1, init2];

        // init tick arrays
        const tickArrayIndexes: number[] = [];
        init.forEach((v, i) => {
          if (v) {
            tickArrayIndexes.push(startTickIndexes[i]);
          }
        });
        if (tickArrayIndexes.length > 0) {
          await (await pool.initTickArrayForTicks(tickArrayIndexes))!.buildAndExecute();
        }

        // fetch tick arrays
        const tickArrays = await SwapUtils.getTickArrays(
          pool.getData().tickCurrentIndex,
          pool.getData().tickSpacing,
          aToB,
          testCtx.whirlpoolCtx.program.programId,
          pool.getAddress(),
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        // padding if needed
        init.forEach((v, i) => {
          if (!v) {
            assert.ok(tickArrays[i].data === null);
            tickArrays[i].data = buildTickArrayData(startTickIndexes[i], []).data;
            tickArrays[i].data!.whirlpool = pool.getAddress();
          } else {
            assert.ok(tickArrays[i].data !== null);
          }
        });

        const quote = await swapQuoteWithParams({
          whirlpoolData: pool.getData(),
          amountSpecifiedIsInput: true,
          aToB,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          tokenAmount: U64_MAX,
          sqrtPriceLimit: targetSqrtPrice,
          tickArrays,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        }, Percentage.fromFraction(0, 100));

        assert.ok(quote.estimatedAmountIn.gtn(0));
        assert.ok(quote.estimatedAmountOut.gtn(0));

        assert.ok((await pool.refreshData()).tickCurrentIndex === initialTickIndex);
        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, SwapUtils.getSwapParamsFromQuote(
            quote,
            testCtx.whirlpoolCtx,
            pool,
            tokenAccountB,
            tokenAccountA,
            testCtx.provider.wallet.publicKey,
          )),
        ).buildAndExecute(undefined, {skipPreflight: true});
        assert.ok((await pool.refreshData()).tickCurrentIndex === targetTickIndex);

        return { quote, poolData: pool.getData() };
      }

      let referenceResult: { quote: SwapQuote, poolData: WhirlpoolData };
      before(async () => {
        referenceResult = await runSwap(true, true, true);
      });

      function runTest(init0: boolean, init1: boolean, init2: boolean) {
        const ta0 = init0 ? "|****S***|" : "|----S---|";
        const ta1 = init1 ? "********" : "--------";
        const ta2 = init2 ? "|****T***|" : "|----T---|";

        it(`${ta0}${ta1}${ta2}`, async () => {
          const result = await runSwap(init0, init1, init2);
          assert.ok(result.quote.estimatedAmountIn.eq(referenceResult.quote.estimatedAmountIn));
          assert.ok(result.quote.estimatedAmountOut.eq(referenceResult.quote.estimatedAmountOut));
          assert.ok(result.poolData.tickCurrentIndex === referenceResult.poolData.tickCurrentIndex);
        });
      }

      for (const init0 of [true, false]) {
        for (const init1 of [true, false]) {
          for (const init2 of [true, false]) {
            runTest(init0, init1, init2);
          }
        }
      }
    });

    it("a to b: |----T---|********|----S---|", async () => {});
    it("a to b: |****T***|--------|****S***|", async () => {});
    it("a to b: |----T---|--------|----S---|", async () => {});

  });
});
