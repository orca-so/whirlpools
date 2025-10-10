import * as anchor from "@coral-xyz/anchor";
import { DecimalUtil, Percentage, U64_MAX } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import type { WhirlpoolClient } from "../../../src";
import {
  MAX_SQRT_PRICE_BN,
  MAX_TICK_INDEX,
  MIN_SQRT_PRICE_BN,
  MIN_TICK_INDEX,
  NO_ORACLE_DATA,
  PDAUtil,
  PriceMath,
  SwapUtils,
  TickUtil,
  WhirlpoolIx,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputToken,
  increaseLiquidityQuoteByLiquidityWithParams,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  toTx,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { initTestPoolWithTokens } from "../../utils/init-utils";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import { MAX_U64, getTokenBalance } from "../../utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

const DEBUG_OUTPUT = false;

describe("splash pool tests (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);

  let testCtx: SharedTestContext;

  beforeAll(() => {
    anchor.setProvider(provider);
    // program initialized in beforeAll
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    testCtx = {
      provider,
      whirlpoolCtx,
      whirlpoolClient,
    };
  });

  describe("trades on splash pool (litesvm)", () => {
    type TestVariation = {
      figure: string;
      poolTickSpacing: number;
      poolInitialTickIndex: number;
      poolLiquidity: BN;
      tradeMode: "exactIn" | "exactOut";
      tradeDirection: "AtoB" | "BtoA";
      tradeTokenAmount: BN;
      expectedPartialFill: boolean;
    };

    const testVariations: TestVariation[] = [
      // Notation
      //
      // l: lower tick index for FullRange
      // u: upper tick index for FullRange
      // m: MIN_TICK_INDEX (-443636)
      // x: MAX_TICK_INDEX (+443636)
      // *: liquidity (flat distribution)
      // S: trade start
      // T: trade end
      //
      // Limit
      //
      // 2^33 is almost max liquidity to realize single side deposit at tick index MIN_TICK_INDEX or MAX_TICK_INDEX
      // 2^64 is almost max liquidity to realize 50:50 deposit at tick index 0
      //

      ////////////////////////////////////////////////////////////////////////////////
      // ExactIn
      ////////////////////////////////////////////////////////////////////////////////

      // ExactIn, BtoA, min to ...
      {
        figure:
          "(toB) |-----mS----l**********T*********|********************u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MIN_TICK_INDEX + 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactIn",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN(20000),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----mS----l********************|**********T*********u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MIN_TICK_INDEX + 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactIn",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN(200000000000),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----mS----l********************|********************u----Tx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MIN_TICK_INDEX + 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactIn",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN(MAX_U64), // partial fill
        expectedPartialFill: true,
      },

      // ExactIn, AtoB, max to ...
      {
        figure:
          "(toB) |-----m-----l********************|**********T*********u----Sx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MAX_TICK_INDEX - 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactIn",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN(20000),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----m-----l**********T*********|********************u----Sx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MAX_TICK_INDEX - 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactIn",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN(200000000000),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----mT----l********************|********************u----Sx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MAX_TICK_INDEX - 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactIn",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN(MAX_U64), // partial fill
        expectedPartialFill: true,
      },

      // ExactIn, BtoA, 1 to ...
      {
        figure:
          "(toB) |-----m-----l********************|S****T**************u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: 0,
        poolLiquidity: powBN(2, 63), // to use the remaining 2^63 amount in the trade
        tradeMode: "exactIn",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN(MAX_U64).divn(2),
        expectedPartialFill: false,
      },

      // ExactIn, AtoB, 1 to ...
      {
        figure:
          "(toB) |-----m-----l**************T****S|********************u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: 0,
        poolLiquidity: powBN(2, 63), // to use the remaining 2^63 amount in the trade
        tradeMode: "exactIn",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN(MAX_U64).divn(2),
        expectedPartialFill: false,
      },

      ////////////////////////////////////////////////////////////////////////////////
      // ExactOut
      ////////////////////////////////////////////////////////////////////////////////

      // ExactOut, BtoA, min to ...
      {
        figure:
          "(toB) |-----mS----l**********T*********|********************u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MIN_TICK_INDEX + 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactOut",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN("16583913771126114400"),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----mS----l********************|**********T*********u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MIN_TICK_INDEX + 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactOut",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN("16587613395589958784"),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----mS----l********************|********************u----Tx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MIN_TICK_INDEX + 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactOut",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN(MAX_U64), // partial fill
        expectedPartialFill: true,
      },

      // ExactOut, AtoB, max to ...
      {
        figure:
          "(toB) |-----m-----l********************|**********T*********u----Sx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MAX_TICK_INDEX - 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactOut",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN("16583913770960970547"),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----m-----l**********T*********|********************u----Sx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MAX_TICK_INDEX - 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactOut",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN("16587613395424814923"),
        expectedPartialFill: false,
      },
      {
        figure:
          "(toB) |-----mT----l********************|********************u----Sx-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: MAX_TICK_INDEX - 1,
        poolLiquidity: powBN(2, 33),
        tradeMode: "exactOut",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN(MAX_U64), // partial fill
        expectedPartialFill: true,
      },

      // ExactOut, BtoA, 1 to ...
      {
        figure:
          "(toB) |-----m-----l********************|S****T**************u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: 0,
        poolLiquidity: powBN(2, 63), // to use the remaining 2^63 amount in the trade
        tradeMode: "exactOut",
        tradeDirection: "BtoA",
        tradeTokenAmount: new BN("4604758097518383314"),
        expectedPartialFill: false,
      },

      // ExactOut, AtoB, 1 to ...
      {
        figure:
          "(toB) |-----m-----l**************T****S|********************u-----x-----| (toA)",
        poolTickSpacing: 32768 + 128,
        poolInitialTickIndex: 0,
        poolLiquidity: powBN(2, 63), // to use the remaining 2^63 amount in the trade
        tradeMode: "exactOut",
        tradeDirection: "AtoB",
        tradeTokenAmount: new BN("4604758097518383314"),
        expectedPartialFill: false,
      },
    ];

    testVariations.forEach((variation) => {
      const caseName = `${variation.figure}, mode=${variation.tradeMode}, liq=${variation.poolLiquidity}, amount=${variation.tradeTokenAmount}`;

      it(caseName, async () => {
        const {
          poolTickSpacing,
          poolInitialTickIndex,
          poolLiquidity,
          tradeMode,
          tradeDirection,
          tradeTokenAmount,
        } = variation;
        const tradeAmountSpecifiedIsInput = tradeMode === "exactIn";
        const tradeAToB = tradeDirection === "AtoB";

        const { whirlpoolPda, tokenAccountA, tokenAccountB } =
          await initTestPoolWithTokens(
            testCtx.whirlpoolCtx,
            poolTickSpacing,
            PriceMath.tickIndexToSqrtPriceX64(poolInitialTickIndex),
            MAX_U64,
          );

        const pool = await testCtx.whirlpoolClient.getPool(
          whirlpoolPda.publicKey,
        );

        // SplashPool has only 2 TickArrays for negative and positive ticks
        await (await pool.initTickArrayForTicks([-1, +1]))!.buildAndExecute();

        const fullRange = TickUtil.getFullRangeTickIndex(
          pool.getData().tickSpacing,
        );

        // provide liquidity
        const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
          liquidity: poolLiquidity,
          slippageTolerance: Percentage.fromFraction(0, 100),
          sqrtPrice: pool.getData().sqrtPrice,
          tickCurrentIndex: pool.getData().tickCurrentIndex,
          tickLowerIndex: fullRange[0],
          tickUpperIndex: fullRange[1],
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
        });
        const txAndMint = await pool.openPosition(
          fullRange[0],
          fullRange[1],
          depositQuote,
        );
        await txAndMint.tx.buildAndExecute();
        await pool.refreshData(); // reflect new liquidity

        debug(
          `pool state: tick = ${pool.getData().tickCurrentIndex}, liquidity = ${depositQuote.liquidityAmount.toString()}, tokenA = ${depositQuote.tokenEstA.toString()}, tokenB = ${depositQuote.tokenEstB.toString()}`,
        );

        const swapQuote = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToB,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
              tradeAmountSpecifiedIsInput,
            ),
            sqrtPriceLimit: tradeAToB ? MIN_SQRT_PRICE_BN : MAX_SQRT_PRICE_BN,
            tickArrays: await SwapUtils.getTickArrays(
              pool.getData().tickCurrentIndex,
              pool.getData().tickSpacing,
              tradeAToB,
              testCtx.whirlpoolCtx.program.programId,
              pool.getAddress(),
              testCtx.whirlpoolCtx.fetcher,
              IGNORE_CACHE,
            ),
            tokenAmount: tradeTokenAmount,
            whirlpoolData: pool.getData(),
            tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
            oracleData: NO_ORACLE_DATA,
          },
          Percentage.fromFraction(0, 100),
        );

        const preTickIndex = pool.getData().tickCurrentIndex;
        const [preOwnerA, preOwnerB] = await getTokenBalances(
          tokenAccountA,
          tokenAccountB,
        );
        const [preVaultA, preVaultB] = await getTokenBalances(
          pool.getData().tokenVaultA,
          pool.getData().tokenVaultB,
        );

        await toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapIx(
            testCtx.whirlpoolCtx.program,
            SwapUtils.getSwapParamsFromQuote(
              swapQuote,
              testCtx.whirlpoolCtx,
              pool,
              swapQuote.aToB ? tokenAccountA : tokenAccountB,
              swapQuote.aToB ? tokenAccountB : tokenAccountA,
              testCtx.provider.wallet.publicKey,
            ),
          ),
        ).buildAndExecute();
        await pool.refreshData(); // reflect new tickCurrentIndex

        const postTickIndex = pool.getData().tickCurrentIndex;
        const [postOwnerA, postOwnerB] = await getTokenBalances(
          tokenAccountA,
          tokenAccountB,
        );
        const [postVaultA, postVaultB] = await getTokenBalances(
          pool.getData().tokenVaultA,
          pool.getData().tokenVaultB,
        );

        // display pre & post
        debug(`amount: ${tradeTokenAmount.toString()}`);
        debug(
          `estimate: ${swapQuote.estimatedAmountIn.toString()} --> ${swapQuote.estimatedAmountOut.toString()}`,
        );
        debug(
          `owner: A = ${preOwnerA.toString()} -> ${postOwnerA.toString()}, B = ${preOwnerB.toString()} -> ${postOwnerB.toString()}`,
        );
        debug(
          `vault: A = ${preVaultA.toString()} -> ${postVaultA.toString()}, B = ${preVaultB.toString()} -> ${postVaultB.toString()}`,
        );
        debug(`tick index: ${preTickIndex} --> ${postTickIndex}`);

        // verify: partial fill
        const actualAmount = swapQuote.amountSpecifiedIsInput
          ? swapQuote.estimatedAmountIn
          : swapQuote.estimatedAmountOut;
        if (variation.expectedPartialFill) {
          assert.ok(actualAmount.lt(tradeTokenAmount));
        } else {
          assert.ok(actualAmount.eq(tradeTokenAmount));
        }

        // verify: quote on SDK == realized trade
        const diffOwnerA = postOwnerA.sub(preOwnerA);
        const diffOwnerB = postOwnerB.sub(preOwnerB);
        const diffVaultA = postVaultA.sub(preVaultA);
        const diffVaultB = postVaultB.sub(preVaultB);
        debug(
          `diff: owner A = ${diffOwnerA.toString()}, owner B = ${diffOwnerB.toString()}`,
        );
        debug(
          `estimated: in = ${swapQuote.estimatedAmountIn.toString()}, out = ${swapQuote.estimatedAmountOut.toString()}`,
        );
        debug(
          `sqrtPrice: quote = ${swapQuote.estimatedEndSqrtPrice.toString()}, pool = ${pool.getData().sqrtPrice.toString()}`,
        );

        assert.ok(diffOwnerA.eq(diffVaultA.neg()));
        assert.ok(diffOwnerB.eq(diffVaultB.neg()));
        assert.ok(
          diffOwnerA.eq(
            tradeAToB
              ? swapQuote.estimatedAmountIn.neg()
              : swapQuote.estimatedAmountOut,
          ),
        );
        assert.ok(
          diffOwnerB.eq(
            tradeAToB
              ? swapQuote.estimatedAmountOut
              : swapQuote.estimatedAmountIn.neg(),
          ),
        );
        assert.ok(swapQuote.estimatedEndSqrtPrice.eq(pool.getData().sqrtPrice));
        assert.ok(
          swapQuote.estimatedEndTickIndex === pool.getData().tickCurrentIndex,
        );
      });
    });
  });

  async function getTokenBalances(
    tokenAccountA: PublicKey,
    tokenAccountB: PublicKey,
  ): Promise<[BN, BN]> {
    const tokenVaultA = new anchor.BN(
      await getTokenBalance(provider, tokenAccountA),
    );
    const tokenVaultB = new anchor.BN(
      await getTokenBalance(provider, tokenAccountB),
    );
    return [tokenVaultA, tokenVaultB];
  }

  describe("ExactOut overflow (required input token is over u64 max) (litesvm)", () => {
    // Since trade mode is ExactOut, the outputt amount must be within u64 max, but the input token may over u64 max.
    // It is okay to fail with overflow error because the trade is impossible.

    // B to A (too much tokenB is required)
    it("(toB) |-----m-----l********************|S******************Tu-----x-----| (toA), too much tokenB is required", async () => {
      const poolTickSpacing = 32768 + 128;
      const poolInitialTickIndex = 0;
      const poolLiquidity = powBN(2, 34);
      const tradeAmountSpecifiedIsInput = false;
      const tradeAToB = false;

      const { whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          poolTickSpacing,
          PriceMath.tickIndexToSqrtPriceX64(poolInitialTickIndex),
          MAX_U64,
        );

      const pool = await testCtx.whirlpoolClient.getPool(
        whirlpoolPda.publicKey,
      );

      await (await pool.initTickArrayForTicks([-1, +1]))!.buildAndExecute();

      const fullRange = TickUtil.getFullRangeTickIndex(
        pool.getData().tickSpacing,
      );

      // provide liquidity
      const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity: poolLiquidity,
        slippageTolerance: Percentage.fromFraction(0, 100),
        sqrtPrice: pool.getData().sqrtPrice,
        tickCurrentIndex: pool.getData().tickCurrentIndex,
        tickLowerIndex: fullRange[0],
        tickUpperIndex: fullRange[1],
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      });
      const txAndMint = await pool.openPosition(
        fullRange[0],
        fullRange[1],
        depositQuote,
      );
      await txAndMint.tx.buildAndExecute();
      await pool.refreshData(); // reflect new liquidity

      // try to output all tokenA
      const tradeTokenAmount = depositQuote.tokenEstA;

      await assert.rejects(
        async () =>
          swapQuoteWithParams(
            {
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToB: tradeAToB,
              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
                tradeAmountSpecifiedIsInput,
              ),
              sqrtPriceLimit: tradeAToB ? MIN_SQRT_PRICE_BN : MAX_SQRT_PRICE_BN,
              tickArrays: await SwapUtils.getTickArrays(
                pool.getData().tickCurrentIndex,
                pool.getData().tickSpacing,
                tradeAToB,
                testCtx.whirlpoolCtx.program.programId,
                pool.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
              tokenAmount: tradeTokenAmount,
              whirlpoolData: pool.getData(),
              tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
              oracleData: NO_ORACLE_DATA,
            },
            Percentage.fromFraction(0, 100),
          ),
        /MulShiftRight overflowed u128/, // at getAmountUnfixedDelta for tokenB (too much tokenB is required)
      );

      await assert.rejects(
        toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
            amount: tradeTokenAmount,
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToB,
            otherAmountThreshold: U64_MAX,
            sqrtPriceLimit: tradeAToB ? MIN_SQRT_PRICE_BN : MAX_SQRT_PRICE_BN,
            tokenAuthority: testCtx.provider.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: pool.getData().tokenVaultA,
            tokenVaultB: pool.getData().tokenVaultB,
            whirlpool: pool.getAddress(),
            tickArray0: PDAUtil.getTickArrayFromTickIndex(
              0,
              poolTickSpacing,
              pool.getAddress(),
              testCtx.whirlpoolCtx.program.programId,
            ).publicKey,
            tickArray1: PDAUtil.getTickArrayFromTickIndex(
              0,
              poolTickSpacing,
              pool.getAddress(),
              testCtx.whirlpoolCtx.program.programId,
            ).publicKey,
            tickArray2: PDAUtil.getTickArrayFromTickIndex(
              0,
              poolTickSpacing,
              pool.getAddress(),
              testCtx.whirlpoolCtx.program.programId,
            ).publicKey,
            oracle: PDAUtil.getOracle(
              testCtx.whirlpoolCtx.program.programId,
              pool.getAddress(),
            ).publicKey,
          }),
        ).buildAndExecute(),
        /MultiplicationShiftRightOverflow/, // at get_amount_unfixed_delta for tokenB (too much tokenB is required)
      );
    });

    // A to B (too much tokenA is required)
    it("(toB) |-----m-----lT******************S|********************u-----x-----| (toA), too much tokenA is required", async () => {
      const poolTickSpacing = 32768 + 128;
      const poolInitialTickIndex = 0;
      const poolLiquidity = powBN(2, 34);
      const tradeAmountSpecifiedIsInput = false;
      const tradeAToB = true;

      const { whirlpoolPda, tokenAccountA, tokenAccountB } =
        await initTestPoolWithTokens(
          testCtx.whirlpoolCtx,
          poolTickSpacing,
          PriceMath.tickIndexToSqrtPriceX64(poolInitialTickIndex),
          MAX_U64,
        );

      const pool = await testCtx.whirlpoolClient.getPool(
        whirlpoolPda.publicKey,
      );

      await (await pool.initTickArrayForTicks([-1, +1]))!.buildAndExecute();

      const fullRange = TickUtil.getFullRangeTickIndex(
        pool.getData().tickSpacing,
      );

      // provide liquidity
      const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity: poolLiquidity,
        slippageTolerance: Percentage.fromFraction(0, 100),
        sqrtPrice: pool.getData().sqrtPrice,
        tickCurrentIndex: pool.getData().tickCurrentIndex,
        tickLowerIndex: fullRange[0],
        tickUpperIndex: fullRange[1],
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      });
      const txAndMint = await pool.openPosition(
        fullRange[0],
        fullRange[1],
        depositQuote,
      );
      await txAndMint.tx.buildAndExecute();
      await pool.refreshData(); // reflect new liquidity

      // try to output all tokenB
      const tradeTokenAmount = depositQuote.tokenEstB;

      await assert.rejects(
        async () =>
          swapQuoteWithParams(
            {
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToB: tradeAToB,
              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
                tradeAmountSpecifiedIsInput,
              ),
              sqrtPriceLimit: tradeAToB ? MIN_SQRT_PRICE_BN : MAX_SQRT_PRICE_BN,
              tickArrays: await SwapUtils.getTickArrays(
                pool.getData().tickCurrentIndex,
                pool.getData().tickSpacing,
                tradeAToB,
                testCtx.whirlpoolCtx.program.programId,
                pool.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
              tokenAmount: tradeTokenAmount,
              whirlpoolData: pool.getData(),
              tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
              oracleData: NO_ORACLE_DATA,
            },
            Percentage.fromFraction(0, 100),
          ),
        /Results larger than U64/, // at getAmountUnfixedDelta for tokenA (too much tokenA is required)
      );

      await assert.rejects(
        toTx(
          testCtx.whirlpoolCtx,
          WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
            amount: tradeTokenAmount,
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToB,
            otherAmountThreshold: U64_MAX,
            sqrtPriceLimit: tradeAToB ? MIN_SQRT_PRICE_BN : MAX_SQRT_PRICE_BN,
            tokenAuthority: testCtx.provider.wallet.publicKey,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: pool.getData().tokenVaultA,
            tokenVaultB: pool.getData().tokenVaultB,
            whirlpool: pool.getAddress(),
            tickArray0: PDAUtil.getTickArrayFromTickIndex(
              0,
              poolTickSpacing,
              pool.getAddress(),
              testCtx.whirlpoolCtx.program.programId,
            ).publicKey,
            tickArray1: PDAUtil.getTickArrayFromTickIndex(
              0,
              poolTickSpacing,
              pool.getAddress(),
              testCtx.whirlpoolCtx.program.programId,
              -1,
            ).publicKey,
            tickArray2: PDAUtil.getTickArrayFromTickIndex(
              0,
              poolTickSpacing,
              pool.getAddress(),
              testCtx.whirlpoolCtx.program.programId,
              -1,
            ).publicKey,
            oracle: PDAUtil.getOracle(
              testCtx.whirlpoolCtx.program.programId,
              pool.getAddress(),
            ).publicKey,
          }),
        ).buildAndExecute(),
        /TokenMaxExceeded/, // at get_amount_unfixed_delta for tokenA (too much tokenA is required)
      );
    });
  });

  it("ExactOut Sandwitch attack senario", async () => {
    const tickSpacingSplash128 = 32768 + 128;

    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
      await initTestPoolWithTokens(
        testCtx.whirlpoolCtx,
        tickSpacingSplash128,
        PriceMath.tickIndexToSqrtPriceX64(0), // 1 B/A
        new BN(2_000_000_000),
      );

    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);

    // [-2,894,848   ][0            ][
    await (await pool.initTickArrayForTicks([
      // SplashPool has only 2 TickArrays for negative and positive ticks
      -1, +1,
    ]))!.buildAndExecute();

    const fullRange = TickUtil.getFullRangeTickIndex(
      pool.getData().tickSpacing,
    );

    // create 2 position (small & large)
    const depositQuoteSmall = increaseLiquidityQuoteByInputToken(
      poolInitInfo.tokenMintB,
      DecimalUtil.fromBN(new BN(1), 0), // very thin liquidity
      fullRange[0],
      fullRange[1],
      Percentage.fromFraction(0, 100),
      pool,
      NO_TOKEN_EXTENSION_CONTEXT,
    );
    const small = await pool.openPosition(
      fullRange[0],
      fullRange[1],
      depositQuoteSmall,
    );
    await small.tx.buildAndExecute();

    const depositQuoteLarge = increaseLiquidityQuoteByInputToken(
      poolInitInfo.tokenMintB,
      DecimalUtil.fromBN(new BN(1_000_000_000), 0), // extremely larger than small position
      fullRange[0],
      fullRange[1],
      Percentage.fromFraction(0, 100),
      pool,
      NO_TOKEN_EXTENSION_CONTEXT,
    );
    const large = await pool.openPosition(
      fullRange[0],
      fullRange[1],
      depositQuoteLarge,
    );
    await large.tx.buildAndExecute();

    await pool.refreshData();

    const preLiquidity = pool.getData().liquidity;

    // get quote with small and large position liquidity
    const swapQuote = await swapQuoteByOutputToken(
      pool,
      poolInitInfo.tokenMintB,
      new BN(800_000_000),
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
      testCtx.provider.wallet.publicKey,
    );

    // close large position
    const largePosition = PDAUtil.getPosition(
      testCtx.whirlpoolCtx.program.programId,
      large.positionMint,
    ).publicKey;

    const closeTx = await pool.closePosition(
      largePosition,
      Percentage.fromFraction(0, 100),
    );
    for (const tx of closeTx) {
      await tx.buildAndExecute();
    }

    // liquidity should be decreased
    await pool.refreshData();
    const postLiquidity = pool.getData().liquidity;
    assert.ok(preLiquidity.gt(postLiquidity));

    const [preA, preB] = await getTokenBalances(tokenAccountA, tokenAccountB);

    // with sqrtPriceLimit = 0, partial fill will be rejected
    // so trade will be protected from sandwich attack if sqrtPriceLimit = 0 is used.
    await assert.rejects(
      toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...params,
          sqrtPriceLimit: new BN(0),
        }),
      ).buildAndExecute(),
      /0x17a9/, // PartialFillError
    );

    // with sqrtPriceLimit != 0, partial fill will be allowed
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
        ...params,
        sqrtPriceLimit: MIN_SQRT_PRICE_BN,
      }),
    ).buildAndExecute();

    const [postA, postB] = await getTokenBalances(tokenAccountA, tokenAccountB);

    await pool.refreshData();

    // input (partial)
    assert.ok(preA.sub(postA).lt(swapQuote.estimatedAmountIn));
    // output (partial)
    assert.ok(postB.sub(preB).lt(swapQuote.estimatedAmountOut));
    // hit min
    assert.ok(pool.getData().sqrtPrice.eq(MIN_SQRT_PRICE_BN));
  });
});

function powBN(base: number, exp: number): BN {
  return new BN(base).pow(new BN(exp));
}

function debug(msg: string) {
  if (!DEBUG_OUTPUT) return;
  console.debug(msg);
}
