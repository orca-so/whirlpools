import * as anchor from "@coral-xyz/anchor";
import { DecimalUtil, MathUtil, Percentage, TransactionBuilder, U64_MAX, ZERO } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import Decimal from "decimal.js";
import { NUM_REWARDS, PDAUtil, POSITION_BUNDLE_SIZE, PoolUtil, PositionBundleData, PriceMath, SwapQuote, SwapUtils, TickUtil, TwoHopSwapV2Params, Whirlpool, WhirlpoolClient, WhirlpoolData, WhirlpoolIx, buildWhirlpoolClient, collectFeesQuote, increaseLiquidityQuoteByInputToken, swapQuoteByInputToken, swapQuoteByOutputToken, swapQuoteWithParams, toTx } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing, ZERO_BN, createTokenAccount } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { buildTestAquariums, getDefaultAquarium, initTestPoolWithTokens, initTickArrayRange, initializePositionBundle, openBundledPosition } from "../../utils/init-utils";
import { NO_TOKEN_EXTENSION_CONTEXT, TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { buildTickArrayData } from "../../utils/testDataTypes";
import { TwoHopSwapParams } from "../../../src/instructions";


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

    describe("swap, b to a: 2816 --> 2816 + (64 * 88) * 2", () => {
      const aToB = false;
      const initialTickIndex = 2816;
      const targetTickIndex = 2816 + tickSpacing64 * 88 * 2; // --> 2 tick arrays
      const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);

      async function runSwap(init0: boolean, init1: boolean, init2: boolean, v2: boolean): Promise<{ quote: SwapQuote, poolData: WhirlpoolData }> {
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

        const quote = swapQuoteWithParams({
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

        const params = {
          ...SwapUtils.getSwapParamsFromQuote(
            quote,
            testCtx.whirlpoolCtx,
            pool,
            tokenAccountB,
            tokenAccountA,
            testCtx.provider.wallet.publicKey,
          ),
          amountSpecifiedIsInput: true,
          amount: quote.estimatedAmountIn,
          otherAmountThreshold: quote.estimatedAmountOut,
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          // v2 specific
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
        };

        assert.ok((await pool.refreshData()).tickCurrentIndex === initialTickIndex);
        await toTx(
          testCtx.whirlpoolCtx,
          !v2
            ? WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, params)
            : WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, params),
        ).buildAndExecute(undefined, {skipPreflight: true});
        assert.ok((await pool.refreshData()).tickCurrentIndex === targetTickIndex);

        return { quote, poolData: pool.getData() };
      }

      let referenceResult: { quote: SwapQuote, poolData: WhirlpoolData };
      before(async () => {
        referenceResult = await runSwap(true, true, true, false);
      });

      function runTest(init0: boolean, init1: boolean, init2: boolean, v2: boolean) {
        const swap = v2 ? "v2" : "v1";
        const ta0 = init0 ? "|****S***|" : "|----S---|";
        const ta1 = init1 ? "********" : "--------";
        const ta2 = init2 ? "|****T***|" : "|----T---|";

        it(`${swap}: ${ta0}${ta1}${ta2}`, async () => {
          const result = await runSwap(init0, init1, init2, v2);
          assert.ok(result.quote.estimatedAmountIn.eq(referenceResult.quote.estimatedAmountIn));
          assert.ok(result.quote.estimatedAmountOut.eq(referenceResult.quote.estimatedAmountOut));
          assert.ok(result.poolData.tickCurrentIndex === referenceResult.poolData.tickCurrentIndex);
        });
      }

      for (const v2 of [false, true]) {
        for (const init0 of [true, false]) {
          for (const init1 of [true, false]) {
            for (const init2 of [true, false]) {
              runTest(init0, init1, init2, v2);
            }
          }
        }
      }
    });

    describe("swap, a to b: 2816 - (64 * 88) * 2 <-- 2816", () => {
      const aToB = true;
      const initialTickIndex = 2816;
      const targetTickIndex = 2816 - tickSpacing64 * 88 * 2; // <-- 2 tick arrays
      const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);

      async function runSwap(init0: boolean, init1: boolean, init2: boolean, v2: boolean): Promise<{ quote: SwapQuote, poolData: WhirlpoolData }> {
        const { poolInitInfo, tokenAccountA, tokenAccountB } = await buildTestEnvironment();

        const pool = await testCtx.whirlpoolClient.getPool(poolInitInfo.whirlpoolPda.publicKey, IGNORE_CACHE);

        const startTickIndexes = [0, -5632, -11264];
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

        const quote = swapQuoteWithParams({
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

        const params = {
          ...SwapUtils.getSwapParamsFromQuote(
            quote,
            testCtx.whirlpoolCtx,
            pool,
            tokenAccountA,
            tokenAccountB,
            testCtx.provider.wallet.publicKey,
          ),
          amountSpecifiedIsInput: true,
          amount: quote.estimatedAmountIn,
          otherAmountThreshold: quote.estimatedAmountOut,
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          // v2 specific
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
        };

        assert.ok((await pool.refreshData()).tickCurrentIndex === initialTickIndex);
        await toTx(
          testCtx.whirlpoolCtx,
          !v2
            ? WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, params)
            : WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, params),
        ).buildAndExecute(undefined, {skipPreflight: true});
        assert.ok((await pool.refreshData()).tickCurrentIndex === targetTickIndex - 1 /* shift */);

        return { quote, poolData: pool.getData() };
      }

      let referenceResult: { quote: SwapQuote, poolData: WhirlpoolData };
      before(async () => {
        referenceResult = await runSwap(true, true, true, false);
      });

      function runTest(init0: boolean, init1: boolean, init2: boolean, v2: boolean) {
        const swap = v2 ? "v2" : "v1";
        const ta0 = init0 ? "|****S***|" : "|----S---|";
        const ta1 = init1 ? "********" : "--------";
        const ta2 = init2 ? "|****T***|" : "|----T---|";

        it(`${swap}: ${ta2}${ta1}${ta0}`, async () => {
          const result = await runSwap(init0, init1, init2, v2);
          assert.ok(result.quote.estimatedAmountIn.eq(referenceResult.quote.estimatedAmountIn));
          assert.ok(result.quote.estimatedAmountOut.eq(referenceResult.quote.estimatedAmountOut));
          assert.ok(result.poolData.tickCurrentIndex === referenceResult.poolData.tickCurrentIndex);
        });
      }

      for (const v2 of [false, true]) {
        for (const init0 of [true, false]) {
          for (const init1 of [true, false]) {
            for (const init2 of [true, false]) {
              runTest(init0, init1, init2, v2);
            }
          }
        }
      }
    });

    describe("twoHopSwap, b to a: 2816 --> 2816 + (64 * 88) * 2", () => {
      const aToB = false;
      const initialTickIndex = 2816;
      const targetTickIndex = 2816 + tickSpacing64 * 88 * 2; // --> tick arrays
      const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);

      async function runSwap(init0: boolean, init1: boolean, init2: boolean, v2: boolean): Promise<{
        quote0: SwapQuote, poolData0: WhirlpoolData,
        quote1: SwapQuote, poolData1: WhirlpoolData,
      }> {
        const aqConfig = getDefaultAquarium();

        // Add a third token and account and a second pool
        aqConfig.initFeeTierParams = [{ tickSpacing: tickSpacing64 }];
        aqConfig.initMintParams.push({});
        aqConfig.initTokenAccParams.push({ mintIndex: 2 });
        aqConfig.initPoolParams = [
          { mintIndices: [0, 1], tickSpacing: tickSpacing64, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(2816) },
          { mintIndices: [1, 2], tickSpacing: tickSpacing64, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(2816) },
        ];
  
        // Add tick arrays and positions
        aqConfig.initTickArrayRangeParams.push({
          poolIndex: 0,
          startTickIndex: -444928,
          arrayCount: 1,
          aToB,
        });
        aqConfig.initTickArrayRangeParams.push({
          poolIndex: 0,
          startTickIndex: 439296,
          arrayCount: 1,
          aToB,
        });
        aqConfig.initTickArrayRangeParams.push({
          poolIndex: 1,
          startTickIndex: -444928,
          arrayCount: 1,
          aToB,
        });
        aqConfig.initTickArrayRangeParams.push({
          poolIndex: 1,
          startTickIndex: 439296,
          arrayCount: 1,
          aToB,
        });
  
        // pool2(b(2) -> a(1)) --> pool1(b(1) -> a(0)) (so pool0 has smaller liquidity)
        aqConfig.initPositionParams.push({ poolIndex: 0, fundParams: [
          {
            liquidityAmount: new anchor.BN(4_100_000),
            tickLowerIndex: -443584,
            tickUpperIndex: 443584,
          },
        ]});
        aqConfig.initPositionParams.push({ poolIndex: 1, fundParams: [
          {
            liquidityAmount: new anchor.BN(10_000_000),
            tickLowerIndex: -443584,
            tickUpperIndex: 443584,
          },
        ]});
        const aquarium = (await buildTestAquariums(testCtx.whirlpoolCtx, [aqConfig]))[0];

        const startTickIndexes = [0, 5632, 11264];
        const init = [init0, init1, init2];

        const poolInit0 = aquarium.pools[0];
        const poolInit1 = aquarium.pools[1];

        const pool0 = await testCtx.whirlpoolClient.getPool(poolInit0.whirlpoolPda.publicKey, IGNORE_CACHE);
        const pool1 = await testCtx.whirlpoolClient.getPool(poolInit1.whirlpoolPda.publicKey, IGNORE_CACHE);

        // init tick arrays
        const tickArrayIndexes: number[] = [];
        init.forEach((v, i) => {
          if (v) {
            tickArrayIndexes.push(startTickIndexes[i]);
          }
        });
        if (tickArrayIndexes.length > 0) {
          await (await pool0.initTickArrayForTicks(tickArrayIndexes))!.buildAndExecute();
          await (await pool1.initTickArrayForTicks(tickArrayIndexes))!.buildAndExecute();
        }

        // fetch tick arrays
        const tickArrays0 = await SwapUtils.getTickArrays(
          pool0.getData().tickCurrentIndex,
          pool0.getData().tickSpacing,
          aToB,
          testCtx.whirlpoolCtx.program.programId,
          pool0.getAddress(),
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );
        const tickArrays1 = await SwapUtils.getTickArrays(
          pool1.getData().tickCurrentIndex,
          pool1.getData().tickSpacing,
          aToB,
          testCtx.whirlpoolCtx.program.programId,
          pool1.getAddress(),
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );
        // padding if needed
        init.forEach((v, i) => {
          if (!v) {
            assert.ok(tickArrays0[i].data === null);
            tickArrays0[i].data = buildTickArrayData(startTickIndexes[i], []).data;
            tickArrays0[i].data!.whirlpool = pool0.getAddress();
            assert.ok(tickArrays1[i].data === null);
            tickArrays1[i].data = buildTickArrayData(startTickIndexes[i], []).data;
            tickArrays1[i].data!.whirlpool = pool1.getAddress();
          } else {
            assert.ok(tickArrays0[i].data !== null);
            assert.ok(tickArrays1[i].data !== null);
          }
        });

        const quote1 = swapQuoteWithParams({
          whirlpoolData: pool1.getData(),
          amountSpecifiedIsInput: true,
          aToB,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          tokenAmount: U64_MAX,
          sqrtPriceLimit: targetSqrtPrice,
          tickArrays: tickArrays1,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        }, Percentage.fromFraction(0, 100));

        const quote0 = swapQuoteWithParams({
          whirlpoolData: pool0.getData(),
          amountSpecifiedIsInput: true,
          aToB,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          tokenAmount: quote1.estimatedAmountOut,
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          tickArrays: tickArrays0,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        }, Percentage.fromFraction(0, 100));

        assert.ok(quote0.estimatedAmountIn.gtn(0));
        assert.ok(quote0.estimatedAmountOut.gtn(0));
        assert.ok(quote1.estimatedAmountIn.gtn(0));
        assert.ok(quote1.estimatedAmountOut.gtn(0));

        const params = {
          amount: quote1.estimatedAmountIn,
          amountSpecifiedIsInput: true,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          aToBOne: aToB,
          aToBTwo: aToB,
          oracleOne: PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, pool1.getAddress()).publicKey,
          oracleTwo: PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, pool0.getAddress()).publicKey,
          sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          tickArrayOne0: tickArrays1[0].address,
          tickArrayOne1: tickArrays1[1].address,
          tickArrayOne2: tickArrays1[2].address,
          tickArrayTwo0: tickArrays0[0].address,
          tickArrayTwo1: tickArrays0[1].address,
          tickArrayTwo2: tickArrays0[2].address,
          tokenAuthority: testCtx.provider.wallet.publicKey,
          whirlpoolOne: pool1.getAddress(),
          whirlpoolTwo: pool0.getAddress(),
          // v1 specific
          tokenOwnerAccountOneA: aquarium.tokenAccounts[1].account,
          tokenOwnerAccountOneB: aquarium.tokenAccounts[2].account,
          tokenOwnerAccountTwoA: aquarium.tokenAccounts[0].account,
          tokenOwnerAccountTwoB: aquarium.tokenAccounts[1].account,
          tokenVaultOneA: pool1.getData().tokenVaultA,
          tokenVaultOneB: pool1.getData().tokenVaultB,
          tokenVaultTwoA: pool0.getData().tokenVaultA,
          tokenVaultTwoB: pool0.getData().tokenVaultB,
          // v2 specific
          tokenOwnerAccountInput: aquarium.tokenAccounts[2].account,
          tokenOwnerAccountOutput: aquarium.tokenAccounts[0].account,
          tokenVaultOneInput: pool1.getData().tokenVaultB,
          tokenVaultOneIntermediate: pool1.getData().tokenVaultA,
          tokenVaultTwoIntermediate: pool0.getData().tokenVaultB,
          tokenVaultTwoOutput: pool0.getData().tokenVaultA,
          tokenMintInput: pool1.getData().tokenMintB,
          tokenMintIntermediate: pool1.getData().tokenMintA,
          tokenMintOutput: pool0.getData().tokenMintA,
          tokenProgramInput: TOKEN_PROGRAM_ID,
          tokenProgramIntermediate: TOKEN_PROGRAM_ID,
          tokenProgramOutput: TOKEN_PROGRAM_ID,
        };

        assert.ok((await pool0.refreshData()).tickCurrentIndex === initialTickIndex);
        assert.ok((await pool1.refreshData()).tickCurrentIndex === initialTickIndex);
        await toTx(
          testCtx.whirlpoolCtx,
          !v2
            ? WhirlpoolIx.twoHopSwapIx(testCtx.whirlpoolCtx.program, params)
            : WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, params),
        ).buildAndExecute(undefined, {skipPreflight: true});
        assert.ok((await pool0.refreshData()).tickCurrentIndex >= targetTickIndex);
        assert.ok((await pool1.refreshData()).tickCurrentIndex >= targetTickIndex);

        return { quote0, poolData0: pool0.getData(), quote1, poolData1: pool1.getData() };
      }

      let referenceResult: { quote0: SwapQuote, poolData0: WhirlpoolData, quote1: SwapQuote, poolData1: WhirlpoolData };
      before(async () => {
        referenceResult = await runSwap(true, true, true, false);
      });

      function runTest(init0: boolean, init1: boolean, init2: boolean, v2: boolean) {
        const swap = v2 ? "v2" : "v1";
        const ta0 = init0 ? "|****S***|" : "|----S---|";
        const ta1 = init1 ? "********" : "--------";
        const ta2 = init2 ? "|****T***|" : "|----T---|";

        it(`${swap}: ${ta0}${ta1}${ta2} -> ${ta0}${ta1}${ta2}`, async () => {
          const result = await runSwap(init0, init1, init2, v2);
          assert.ok(result.quote0.estimatedAmountIn.eq(referenceResult.quote0.estimatedAmountIn));
          assert.ok(result.quote0.estimatedAmountOut.eq(referenceResult.quote0.estimatedAmountOut));
          assert.ok(result.poolData0.tickCurrentIndex === referenceResult.poolData0.tickCurrentIndex);
          assert.ok(result.quote1.estimatedAmountIn.eq(referenceResult.quote1.estimatedAmountIn));
          assert.ok(result.quote1.estimatedAmountOut.eq(referenceResult.quote1.estimatedAmountOut));
          assert.ok(result.poolData1.tickCurrentIndex === referenceResult.poolData1.tickCurrentIndex);
        });
      }

      for (const v2 of [false, true]) {
        for (const init0 of [true, false]) {
          for (const init1 of [true, false]) {
            for (const init2 of [true, false]) {
              runTest(init0, init1, init2, v2);
            }
          }
        }
      }  
    });

  });
});
