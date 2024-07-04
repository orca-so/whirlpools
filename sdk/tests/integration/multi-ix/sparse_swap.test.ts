import * as anchor from "@coral-xyz/anchor";
import { DecimalUtil, Percentage, U64_MAX } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AccountMeta, Keypair } from "@solana/web3.js";
import * as assert from "assert";
import { BN } from "bn.js";
import { MEMO_PROGRAM_ADDRESS, PDAUtil, PriceMath, SwapQuote, SwapUtils, TickUtil, TwoHopSwapV2Params, WhirlpoolClient, WhirlpoolData, WhirlpoolIx, buildWhirlpoolClient, increaseLiquidityQuoteByInputToken, swapQuoteByInputToken, swapQuoteByOutputToken, swapQuoteWithParams, toTx } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { defaultConfirmOptions } from "../../utils/const";
import { buildTestAquariums, getDefaultAquarium, initTestPoolWithTokens } from "../../utils/init-utils";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import { buildTickArrayData } from "../../utils/testDataTypes";
import { SwapV2Params } from "../../../src/instructions";
import { RemainingAccountsBuilder, RemainingAccountsType } from "../../../src/utils/remaining-accounts-util";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("sparse swap tests", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  let testCtx: SharedTestContext;

  before(() => {
    anchor.setProvider(provider);
    const program = anchor.workspace.Whirlpool;
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    testCtx = {
      provider,
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

    describe("failures", () => {
      async function buildTestEnvironment() {
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

        // deposit [-9984, 2944], 100_000
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

        return { poolInitInfo, params };
      }

      it("fail: invalid tick array (owned by other program)", async () => {
        const { poolInitInfo, params } = await buildTestEnvironment();

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tokenVaultA, // owned by TokenProgram
              tickArray1: params.tickArray1,
              tickArray2: params.tickArray2,
            })
          ).buildAndExecute(),
          /0xbbf/ // AccountOwnedByWrongProgram
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tickArray0,
              tickArray1: params.tokenVaultA, // owned by TokenProgram
              tickArray2: params.tickArray2,
            })
          ).buildAndExecute(),
          /0xbbf/ // AccountOwnedByWrongProgram
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tickArray0,
              tickArray1: params.tickArray1,
              tickArray2: params.tokenVaultA, // owned by TokenProgram
            })
          ).buildAndExecute(),
          /0xbbf/ // AccountOwnedByWrongProgram
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
              ...params,
              // v2 specific
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: TOKEN_PROGRAM_ID,
              tokenProgramB: TOKEN_PROGRAM_ID,
              // supplemental
              supplementalTickArrays: [
                params.tokenVaultA,
              ],
            })
          ).buildAndExecute(),
          /0xbbf/ // AccountOwnedByWrongProgram
        );
      });

      it("fail: invalid tick array (owned by Whirlpool program, but not TickArray account)", async () => {
        const { poolInitInfo, params } = await buildTestEnvironment();

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.whirlpool, // owned by Whirlpool program, but Whirlpool account
              tickArray1: params.tickArray1,
              tickArray2: params.tickArray2,
            })
          ).buildAndExecute(),
          /0xbba/ // AccountDiscriminatorMismatch
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tickArray0,
              tickArray1: params.whirlpool, // owned by Whirlpool program, but Whirlpool account
              tickArray2: params.tickArray2,
            })
          ).buildAndExecute(),
          /0xbba/ // AccountDiscriminatorMismatch
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tickArray0,
              tickArray1: params.tickArray1,
              tickArray2: params.whirlpool, // owned by Whirlpool program, but Whirlpool account
            })
          ).buildAndExecute(),
          /0xbba/ // AccountDiscriminatorMismatch
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
              ...params,
              // v2 specific
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: TOKEN_PROGRAM_ID,
              tokenProgramB: TOKEN_PROGRAM_ID,
              // supplemental
              supplementalTickArrays: [
                params.whirlpool, // owned by Whirlpool program, but Whirlpool account
              ],
            })
          ).buildAndExecute(),
          /0xbba/ // AccountDiscriminatorMismatch
        );
      });

      it("fail: invalid tick array (initialized TickArray account, but for other whirlpool)", async () => {
        const { poolInitInfo, params } = await buildTestEnvironment();

        const { whirlpoolPda: anotherWhirlpoolPda } =
          await initTestPoolWithTokens(
            testCtx.whirlpoolCtx,
            tickSpacing64,
            PriceMath.tickIndexToSqrtPriceX64(3000), // tickCurrentIndex = 3000
            new BN(1_000_000)
          );

        const anotherPool = await testCtx.whirlpoolClient.getPool(anotherWhirlpoolPda.publicKey);
        await (await anotherPool.initTickArrayForTicks([-11264, -5632, 0]))!.buildAndExecute();

        const anotherWhirlpoolTickArray0 = PDAUtil.getTickArray(
          testCtx.whirlpoolCtx.program.programId,
          anotherWhirlpoolPda.publicKey,
          0
        ).publicKey;
        const fetched = await testCtx.whirlpoolCtx.fetcher.getTickArray(anotherWhirlpoolTickArray0, IGNORE_CACHE);
        assert.ok(fetched !== null);

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: anotherWhirlpoolTickArray0, // for another Whirlpool
              tickArray1: params.tickArray1,
              tickArray2: params.tickArray2,
            })
          ).buildAndExecute(),
          /0x17a7/ // DifferentWhirlpoolTickArrayAccount
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tickArray0,
              tickArray1: anotherWhirlpoolTickArray0, // for another Whirlpool
              tickArray2: params.tickArray2,
            })
          ).buildAndExecute(),
          /0x17a7/ // DifferentWhirlpoolTickArrayAccount
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              tickArray0: params.tickArray0,
              tickArray1: params.tickArray1,
              tickArray2: anotherWhirlpoolTickArray0, // for another Whirlpool
            })
          ).buildAndExecute(),
          /0x17a7/ // DifferentWhirlpoolTickArrayAccount
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
              ...params,
              // v2 specific
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: TOKEN_PROGRAM_ID,
              tokenProgramB: TOKEN_PROGRAM_ID,
              // supplemental
              supplementalTickArrays: [
                anotherWhirlpoolTickArray0, // for another Whirlpool
              ],
            })
          ).buildAndExecute(),
          /0x17a7/ // DifferentWhirlpoolTickArrayAccount
        );
      });

      it("fail: no appropriate tick array (initialized TickArray, but start_tick_index mismatch)", async () => {
        const { poolInitInfo, params } = await buildTestEnvironment();

        const tickArrayNeg5632 = PDAUtil.getTickArray(
          testCtx.whirlpoolCtx.program.programId,
          poolInitInfo.whirlpoolPda.publicKey,
          -5632,
        ).publicKey;
        const fetched = await testCtx.whirlpoolCtx.fetcher.getTickArray(tickArrayNeg5632, IGNORE_CACHE);
        assert.ok(fetched !== null);

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              // expected first tick array should start from 0
              tickArray0: tickArrayNeg5632,
              tickArray1: tickArrayNeg5632,
              tickArray2: tickArrayNeg5632,
            })
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
              ...params,
              // v2 specific
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: TOKEN_PROGRAM_ID,
              tokenProgramB: TOKEN_PROGRAM_ID,
              // expected first tick array should start from 0
              tickArray0: tickArrayNeg5632,
              tickArray1: tickArrayNeg5632,
              tickArray2: tickArrayNeg5632,
              // supplemental
              supplementalTickArrays: [
                tickArrayNeg5632,
                tickArrayNeg5632,
                tickArrayNeg5632,
              ],
            })
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );
      });

      it("fail: no appropriate tick array (uninitialized TickArray, and PDA mismatch)", async () => {
        const { poolInitInfo, params } = await buildTestEnvironment();

        const uninitializedRandomAddress = Keypair.generate().publicKey;

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
              ...params,
              // expected first tick array should start from 0
              tickArray0: uninitializedRandomAddress,
              tickArray1: uninitializedRandomAddress,
              tickArray2: uninitializedRandomAddress,
            })
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
              ...params,
              // v2 specific
              tokenMintA: poolInitInfo.tokenMintA,
              tokenMintB: poolInitInfo.tokenMintB,
              tokenProgramA: TOKEN_PROGRAM_ID,
              tokenProgramB: TOKEN_PROGRAM_ID,
              // expected first tick array should start from 0
              tickArray0: uninitializedRandomAddress,
              tickArray1: uninitializedRandomAddress,
              tickArray2: uninitializedRandomAddress,
              // supplemental
              supplementalTickArrays: [
                uninitializedRandomAddress,
                uninitializedRandomAddress,
                uninitializedRandomAddress,
              ],
            })
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );
      });
    });
  });

  describe("swap through uninitialized TickArrays(*: init, -: uninit, S: start, T: end)", () => {
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
      const targetTickIndex = 2816 + tickSpacing64 * 88 * 2; // --> 2 tick arrays
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
  
        // pool1(b(2) -> a(1)) --> pool0(b(1) -> a(0)) (so pool0 has smaller liquidity)
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

    describe("twoHopSwap, a to b: 2816 + (64 * 88) * 2 <-- 2816", () => {
      const aToB = true;
      const initialTickIndex = 2816;
      const targetTickIndex = 2816 - tickSpacing64 * 88 * 2; // <-- 2 tick arrays
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
  
        // pool0(a(0) -> b(1)) --> pool1(a(1) -> b(2)) (so pool1 has smaller liquidity)
        aqConfig.initPositionParams.push({ poolIndex: 0, fundParams: [
          {
            liquidityAmount: new anchor.BN(10_000_000),
            tickLowerIndex: -443584,
            tickUpperIndex: 443584,
          },
        ]});
        aqConfig.initPositionParams.push({ poolIndex: 1, fundParams: [
          {
            liquidityAmount: new anchor.BN(7_000_000),
            tickLowerIndex: -443584,
            tickUpperIndex: 443584,
          },
        ]});
        const aquarium = (await buildTestAquariums(testCtx.whirlpoolCtx, [aqConfig]))[0];

        const startTickIndexes = [0, -5632, -11264];
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


        const quote0 = swapQuoteWithParams({
          whirlpoolData: pool0.getData(),
          amountSpecifiedIsInput: true,
          aToB,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          tokenAmount: U64_MAX,
          sqrtPriceLimit: targetSqrtPrice,
          tickArrays: tickArrays0,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        }, Percentage.fromFraction(0, 100));

        const quote1 = swapQuoteWithParams({
          whirlpoolData: pool1.getData(),
          amountSpecifiedIsInput: true,
          aToB,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          tokenAmount: quote0.estimatedAmountOut,
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          tickArrays: tickArrays1,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        }, Percentage.fromFraction(0, 100));

        assert.ok(quote0.estimatedAmountIn.gtn(0));
        assert.ok(quote0.estimatedAmountOut.gtn(0));
        assert.ok(quote1.estimatedAmountIn.gtn(0));
        assert.ok(quote1.estimatedAmountOut.gtn(0));

        const params = {
          amount: quote0.estimatedAmountIn,
          amountSpecifiedIsInput: true,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          aToBOne: aToB,
          aToBTwo: aToB,
          oracleOne: PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, pool0.getAddress()).publicKey,
          oracleTwo: PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, pool1.getAddress()).publicKey,
          sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          tickArrayOne0: tickArrays0[0].address,
          tickArrayOne1: tickArrays0[1].address,
          tickArrayOne2: tickArrays0[2].address,
          tickArrayTwo0: tickArrays1[0].address,
          tickArrayTwo1: tickArrays1[1].address,
          tickArrayTwo2: tickArrays1[2].address,
          tokenAuthority: testCtx.provider.wallet.publicKey,
          whirlpoolOne: pool0.getAddress(),
          whirlpoolTwo: pool1.getAddress(),
          // v1 specific
          tokenOwnerAccountOneA: aquarium.tokenAccounts[0].account,
          tokenOwnerAccountOneB: aquarium.tokenAccounts[1].account,
          tokenOwnerAccountTwoA: aquarium.tokenAccounts[1].account,
          tokenOwnerAccountTwoB: aquarium.tokenAccounts[2].account,
          tokenVaultOneA: pool0.getData().tokenVaultA,
          tokenVaultOneB: pool0.getData().tokenVaultB,
          tokenVaultTwoA: pool1.getData().tokenVaultA,
          tokenVaultTwoB: pool1.getData().tokenVaultB,
          // v2 specific
          tokenOwnerAccountInput: aquarium.tokenAccounts[0].account,
          tokenOwnerAccountOutput: aquarium.tokenAccounts[2].account,
          tokenVaultOneInput: pool0.getData().tokenVaultA,
          tokenVaultOneIntermediate: pool0.getData().tokenVaultB,
          tokenVaultTwoIntermediate: pool1.getData().tokenVaultA,
          tokenVaultTwoOutput: pool1.getData().tokenVaultB,
          tokenMintInput: pool0.getData().tokenMintA,
          tokenMintIntermediate: pool0.getData().tokenMintB,
          tokenMintOutput: pool1.getData().tokenMintB,
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
        assert.ok((await pool0.refreshData()).tickCurrentIndex <= targetTickIndex);
        assert.ok((await pool1.refreshData()).tickCurrentIndex <= targetTickIndex);

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

        it(`${swap}: ${ta2}${ta1}${ta0} <- ${ta2}${ta1}${ta0}`, async () => {
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

  describe("supplemental TickArrays (v2 only)", () => {
    describe("swapV2", () => {
      async function buildTestEnvironment() {
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

        return { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB };
      }

      it("using 3 supplemental tick arrays", async () => {
        const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } = await buildTestEnvironment();
        const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);

        const swapQuote = await swapQuoteByOutputToken(
          pool,
          poolInitInfo.tokenMintB,
          new BN(99_000),
          Percentage.fromFraction(0, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const taStart5632 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), 5632).publicKey;
        const taStart0 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), 0).publicKey;
        const taStartNeg5632 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), -5632).publicKey;
        const taStartNeg11264 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), -11264).publicKey;

        const paramsWithoutSupplemental = {
          ...SwapUtils.getSwapParamsFromQuote(
            swapQuote,
            testCtx.whirlpoolCtx,
            pool,
            tokenAccountA,
            tokenAccountB,
            testCtx.provider.wallet.publicKey
          ),
          // v2 required
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
          // TA starting with 5632 will not be used...
          tickArray0: taStart5632,
          tickArray1: taStart5632,
          tickArray2: taStart5632,
        };

        assert.ok((await pool.refreshData()).tickCurrentIndex >= 2944);
        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, paramsWithoutSupplemental)
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        const paramsWithSupplemental = {
          ...paramsWithoutSupplemental,
          supplementalTickArrays: [
            // should be adjusted at the program side
            taStartNeg11264,
            taStart0,
            taStartNeg5632,
          ],
        };

        assert.ok((await pool.refreshData()).tickCurrentIndex >= 2944);
        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, paramsWithSupplemental)
        ).buildAndExecute(undefined, {skipPreflight: true});

        // 3000 --> less than -5632
        assert.ok((await pool.refreshData()).tickCurrentIndex < -5632);
      });

      it("fail: 4 supplemental tick arrays (too many)", async () => {
        const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } = await buildTestEnvironment();
        const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);

        const swapQuote = await swapQuoteByOutputToken(
          pool,
          poolInitInfo.tokenMintB,
          new BN(99_000),
          Percentage.fromFraction(0, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const taStart5632 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), 5632).publicKey;
        const supplementalTickArrays = [
          taStart5632,
          taStart5632,
          taStart5632,
          taStart5632,
        ];
        const params: SwapV2Params = {
          ...SwapUtils.getSwapParamsFromQuote(
            swapQuote,
            testCtx.whirlpoolCtx,
            pool,
            tokenAccountA,
            tokenAccountB,
            testCtx.provider.wallet.publicKey
          ),
          // v2 required
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
          // too many
          supplementalTickArrays,
        };

        assert.throws(
          () => WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, params),
          /Too many supplemental tick arrays provided/ // SDK error
        );

        // bypass SDK
        const supplementalTickArrayAccountMetas: AccountMeta[] = supplementalTickArrays
          .map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));
        const [remainingAccountsInfo, remainingAccounts] = new RemainingAccountsBuilder()
          .addSlice(RemainingAccountsType.SupplementalTickArrays, supplementalTickArrayAccountMetas)
          .build();

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            cleanupInstructions: [],
            signers: [],
            instructions: [
              testCtx.whirlpoolCtx.program.instruction.swapV2(
                params.amount,
                params.otherAmountThreshold,
                params.sqrtPriceLimit,
                params.amountSpecifiedIsInput,
                params.aToB,
                remainingAccountsInfo,
                {
                  accounts: {
                    ...params,
                    memoProgram: MEMO_PROGRAM_ADDRESS,
                  },
                  remainingAccounts,
                }
              ),
            ],
          }).buildAndExecute(),
          /0x17a6/ // TooManySupplementalTickArrays
        );
      });

      it("go back to the previous tick array", async () => {
        const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          tickSpacing64,
          PriceMath.tickIndexToSqrtPriceX64(-128), // tickCurrentIndex = -128
          new BN(1_000_000)
        );

        const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

        // [-11264  ][-5632   ][0       ]
        await (await pool.initTickArrayForTicks([-11264, -5632, 0]))!.buildAndExecute();

        // deposit [-9984, 2944], 100_000
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
          new BN(80_000),
          Percentage.fromFraction(0, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const taStart0 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), 0).publicKey;
        const taStartNeg5632 = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool.getAddress(), -5632).publicKey;

        const paramsWithoutSupplemental = {
          ...SwapUtils.getSwapParamsFromQuote(
            swapQuote,
            testCtx.whirlpoolCtx,
            pool,
            tokenAccountA,
            tokenAccountB,
            testCtx.provider.wallet.publicKey
          ),
          // v2 required
          tokenMintA: poolInitInfo.tokenMintA,
          tokenMintB: poolInitInfo.tokenMintB,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
        };

        // it should start from TA with startTickIndex -5632
        assert.ok(pool.getData().tickCurrentIndex == -128);
        assert.ok(paramsWithoutSupplemental.tickArray0.equals(taStartNeg5632));

        // another swap to push tickCurrentIndex to > 0
        const anotherSwapQuote = await swapQuoteByInputToken(
          pool,
          poolInitInfo.tokenMintB,
          new BN(10_000),
          Percentage.fromFraction(0, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        assert.ok(anotherSwapQuote.estimatedEndTickIndex > 128);

        await (await pool.swap(anotherSwapQuote)).buildAndExecute();

        await pool.refreshData();
        assert.ok(pool.getData().tickCurrentIndex > 128);

        const preOutputBalance = await testCtx.whirlpoolCtx.connection.getTokenAccountBalance(paramsWithoutSupplemental.tokenOwnerAccountB);

        // now tickCurrentIndex was push backed to > 128, so TickArray with startTickIndex 0 should be used as the first one
        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, paramsWithoutSupplemental)
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );
        
        // If TickArray with startTickIndex 0 is included in supplementalTickArrays, it should work.
        const paramsWithSupplemental = {
          ...paramsWithoutSupplemental,
          supplementalTickArrays: [
            taStart0,
          ],
        };
        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, paramsWithSupplemental)
        ).buildAndExecute(undefined, {skipPreflight: true});

        assert.ok((await pool.refreshData()).tickCurrentIndex < 0);

        const postOutputBalance = await testCtx.whirlpoolCtx.connection.getTokenAccountBalance(paramsWithoutSupplemental.tokenOwnerAccountB);

        // output balance should be increased (actual output will be better than quote due to the push back)
        assert.ok(new BN(postOutputBalance.value.amount).sub(new BN(preOutputBalance.value.amount)).gte(swapQuote.estimatedAmountOut));
      });
    });

    describe("twoHopSwapV2", () => {
      it("using 3 supplemental tick arrays", async () => {
        const aToB = false;
        const initialTickIndex = 2816;
        const targetTickIndex = 2816 + tickSpacing64 * 88 * 2; // --> 2 tick arrays
        const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);
  
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
  
        // pool1(b(2) -> a(1)) --> pool0(b(1) -> a(0)) (so pool0 has smaller liquidity)
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

        const poolInit0 = aquarium.pools[0];
        const poolInit1 = aquarium.pools[1];

        const pool0 = await testCtx.whirlpoolClient.getPool(poolInit0.whirlpoolPda.publicKey, IGNORE_CACHE);
        const pool1 = await testCtx.whirlpoolClient.getPool(poolInit1.whirlpoolPda.publicKey, IGNORE_CACHE);

        // init tick arrays
        await (await pool0.initTickArrayForTicks(startTickIndexes))!.buildAndExecute();
        await (await pool1.initTickArrayForTicks(startTickIndexes))!.buildAndExecute();

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

        const wrongAddress = Keypair.generate().publicKey;
        const paramsWithoutSupplemental = {
          amount: quote1.estimatedAmountIn,
          amountSpecifiedIsInput: true,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(true),
          aToBOne: aToB,
          aToBTwo: aToB,
          oracleOne: PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, pool1.getAddress()).publicKey,
          oracleTwo: PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, pool0.getAddress()).publicKey,
          sqrtPriceLimitOne: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          sqrtPriceLimitTwo: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          tickArrayOne0: wrongAddress,
          tickArrayOne1: wrongAddress,
          tickArrayOne2: wrongAddress,
          tickArrayTwo0: wrongAddress,
          tickArrayTwo1: wrongAddress,
          tickArrayTwo2: wrongAddress,
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

        const supplementalTickArraysOne = [
          // should be adjusted at the program side
          tickArrays1[2].address,
          tickArrays1[0].address,
          tickArrays1[1].address,
        ];
        const supplementalTickArraysTwo = [
          // should be adjusted at the program side
          tickArrays0[2].address,
          tickArrays0[0].address,
          tickArrays0[1].address,
        ];

        assert.ok((await pool0.refreshData()).tickCurrentIndex === initialTickIndex);
        assert.ok((await pool1.refreshData()).tickCurrentIndex === initialTickIndex);
        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, paramsWithoutSupplemental)
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        const paramsWithSupplemental: TwoHopSwapV2Params = {
          ...paramsWithoutSupplemental,
          supplementalTickArraysOne,
          supplementalTickArraysTwo,
        };

        assert.ok((await pool0.refreshData()).tickCurrentIndex === initialTickIndex);
        assert.ok((await pool1.refreshData()).tickCurrentIndex === initialTickIndex);
        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, paramsWithSupplemental)
        ).buildAndExecute(),
        assert.ok((await pool0.refreshData()).tickCurrentIndex >= targetTickIndex);
        assert.ok((await pool1.refreshData()).tickCurrentIndex >= targetTickIndex);  
      });

      it("fail: 4 supplemental tick arrays (too many)", async () => {
        const aToB = false;
        const initialTickIndex = 2816;
        const targetTickIndex = 2816 + tickSpacing64 * 88 * 2; // --> 2 tick arrays
        const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);
  
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
  
        // pool1(b(2) -> a(1)) --> pool0(b(1) -> a(0)) (so pool0 has smaller liquidity)
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

        const poolInit0 = aquarium.pools[0];
        const poolInit1 = aquarium.pools[1];

        const pool0 = await testCtx.whirlpoolClient.getPool(poolInit0.whirlpoolPda.publicKey, IGNORE_CACHE);
        const pool1 = await testCtx.whirlpoolClient.getPool(poolInit1.whirlpoolPda.publicKey, IGNORE_CACHE);

        // init tick arrays
        await (await pool0.initTickArrayForTicks(startTickIndexes))!.buildAndExecute();
        await (await pool1.initTickArrayForTicks(startTickIndexes))!.buildAndExecute();

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

        const wrongAddress = Keypair.generate().publicKey;
        const supplementalTickArraysOne = [
          wrongAddress,
          wrongAddress,
          wrongAddress,
          wrongAddress,
        ];
        const supplementalTickArraysTwo = [
          wrongAddress,
          wrongAddress,
          wrongAddress,
          wrongAddress,
        ];

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
          tickArrayOne0: wrongAddress,
          tickArrayOne1: wrongAddress,
          tickArrayOne2: wrongAddress,
          tickArrayTwo0: wrongAddress,
          tickArrayTwo1: wrongAddress,
          tickArrayTwo2: wrongAddress,
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
          // too many
          supplementalTickArraysOne,
          supplementalTickArraysTwo,
        };

        assert.throws(
          () => WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, params),
          /Too many supplemental tick arrays provided/ // SDK error
        );

        // bypass SDK
        const supplementalTickArrayOneAccountMetas: AccountMeta[] = supplementalTickArraysOne
          .map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));
        const [remainingAccountsInfoOne, remainingAccountsOne] = new RemainingAccountsBuilder()
          .addSlice(RemainingAccountsType.SupplementalTickArraysOne, supplementalTickArrayOneAccountMetas)
          .build();

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            cleanupInstructions: [],
            signers: [],
            instructions: [
              testCtx.whirlpoolCtx.program.instruction.twoHopSwapV2(
                params.amount,
                params.otherAmountThreshold,
                params.amountSpecifiedIsInput,
                params.aToBOne,
                params.aToBTwo,
                params.sqrtPriceLimitOne,
                params.sqrtPriceLimitTwo,
                remainingAccountsInfoOne,
                {
                  accounts: {
                    ...params,
                    memoProgram: MEMO_PROGRAM_ADDRESS,
                  },
                  remainingAccounts: remainingAccountsOne,
                }
              ),
            ],
          }).buildAndExecute(),
          /0x17a6/ // TooManySupplementalTickArrays
        );

        // bypass SDK
        const supplementalTickArrayTwoAccountMetas: AccountMeta[] = supplementalTickArraysTwo
          .map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));
        const [remainingAccountsInfoTwo, remainingAccountsTwo] = new RemainingAccountsBuilder()
          .addSlice(RemainingAccountsType.SupplementalTickArraysTwo, supplementalTickArrayTwoAccountMetas)
          .build();

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            cleanupInstructions: [],
            signers: [],
            instructions: [
              testCtx.whirlpoolCtx.program.instruction.twoHopSwapV2(
                params.amount,
                params.otherAmountThreshold,
                params.amountSpecifiedIsInput,
                params.aToBOne,
                params.aToBTwo,
                params.sqrtPriceLimitOne,
                params.sqrtPriceLimitTwo,
                remainingAccountsInfoTwo,
                {
                  accounts: {
                    ...params,
                    memoProgram: MEMO_PROGRAM_ADDRESS,
                  },
                  remainingAccounts: remainingAccountsTwo,
                }
              ),
            ],
          }).buildAndExecute(),
          /0x17a6/ // TooManySupplementalTickArrays
        );
      });

      it("go back to the previous tick array", async () => {
        const aToB = false;
        const initialTickIndex = 256;
        const targetTickIndex = 256 + tickSpacing64 * 88 * 1; // --> 1 tick array
        const targetSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(targetTickIndex);
  
        const aqConfig = getDefaultAquarium();

        // Add a third token and account and a second pool
        aqConfig.initFeeTierParams = [{ tickSpacing: tickSpacing64 }];
        aqConfig.initMintParams.push({});
        aqConfig.initTokenAccParams.push({ mintIndex: 2 });
        aqConfig.initPoolParams = [
          { mintIndices: [0, 1], tickSpacing: tickSpacing64, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(256) },
          { mintIndices: [1, 2], tickSpacing: tickSpacing64, initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(256) },
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
  
        // pool1(b(2) -> a(1)) --> pool0(b(1) -> a(0)) (so pool0 has smaller liquidity)
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

        const startTickIndexes = [-5632, 0, 5632, 11264];

        const poolInit0 = aquarium.pools[0];
        const poolInit1 = aquarium.pools[1];

        const pool0 = await testCtx.whirlpoolClient.getPool(poolInit0.whirlpoolPda.publicKey, IGNORE_CACHE);
        const pool1 = await testCtx.whirlpoolClient.getPool(poolInit1.whirlpoolPda.publicKey, IGNORE_CACHE);

        // init tick arrays
        await (await pool0.initTickArrayForTicks(startTickIndexes))!.buildAndExecute();
        await (await pool1.initTickArrayForTicks(startTickIndexes))!.buildAndExecute();

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

        const taStart0One = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool1.getAddress(), 0).publicKey;
        const taStart0Two = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool0.getAddress(), 0).publicKey;
        const taStartNeg5632One = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool1.getAddress(), -5632).publicKey;
        const taStartNeg5632Two = PDAUtil.getTickArray(testCtx.whirlpoolCtx.program.programId, pool0.getAddress(), -5632).publicKey;

        const paramsWithoutSupplemental = {
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

        // it should start from TA with startTickIndex 0
        assert.ok((await pool1.refreshData()).tickCurrentIndex === initialTickIndex);
        assert.ok((await pool0.refreshData()).tickCurrentIndex === initialTickIndex);
        assert.ok(paramsWithoutSupplemental.tickArrayOne0.equals(taStart0One));
        assert.ok(paramsWithoutSupplemental.tickArrayTwo0.equals(taStart0Two));

        // another swap to push tickCurrentIndex to <= -128
        const anotherSwapQuoteOne = await swapQuoteByInputToken(
          pool1,
          pool1.getData().tokenMintA,
          new BN(200_000),
          Percentage.fromFraction(0, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const anotherSwapQuoteTwo = await swapQuoteByInputToken(
          pool0,
          pool0.getData().tokenMintA,
          new BN(90_000),
          Percentage.fromFraction(0, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program,
            SwapUtils.getSwapParamsFromQuote(
              anotherSwapQuoteOne,
              testCtx.whirlpoolCtx,
              pool1,
              aquarium.tokenAccounts[1].account,
              aquarium.tokenAccounts[2].account,
              testCtx.provider.wallet.publicKey
            ),
          )
        ).buildAndExecute();
        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program,
            SwapUtils.getSwapParamsFromQuote(
              anotherSwapQuoteTwo,
              testCtx.whirlpoolCtx,
              pool0,
              aquarium.tokenAccounts[0].account,
              aquarium.tokenAccounts[1].account,
              testCtx.provider.wallet.publicKey
            ),
          )
        ).buildAndExecute();

        assert.ok((await pool1.refreshData()).tickCurrentIndex <= -128);
        assert.ok((await pool0.refreshData()).tickCurrentIndex <= -128);

        const preOutputBalance = await testCtx.whirlpoolCtx.connection.getTokenAccountBalance(aquarium.tokenAccounts[0].account);

        // now tickCurrentIndex was push backed to <= -128, so TickArray with startTickIndex -5632 should be used as the first one
        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, paramsWithoutSupplemental)
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, {
              ...paramsWithoutSupplemental,
              supplementalTickArraysOne: [taStartNeg5632One],
            })
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        await assert.rejects(
          toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, {
              ...paramsWithoutSupplemental,
              supplementalTickArraysTwo: [taStartNeg5632Two],
            })
          ).buildAndExecute(),
          /0x1787/ // InvalidTickArraySequence
        );

        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.twoHopSwapV2Ix(testCtx.whirlpoolCtx.program, {
            ...paramsWithoutSupplemental,
            supplementalTickArraysOne: [taStartNeg5632One],
            supplementalTickArraysTwo: [taStartNeg5632Two],
          })
        ).buildAndExecute();

        const postOutputBalance = await testCtx.whirlpoolCtx.connection.getTokenAccountBalance(aquarium.tokenAccounts[0].account);

        // output balance should be increased (actual output will be better than quote due to the push back)
        assert.ok(new BN(postOutputBalance.value.amount).sub(new BN(preOutputBalance.value.amount)).gte(quote0.estimatedAmountOut));
        assert.ok((await pool1.refreshData()).tickCurrentIndex > 0);
        assert.ok((await pool0.refreshData()).tickCurrentIndex > 0);
      });
    });
  });
});
