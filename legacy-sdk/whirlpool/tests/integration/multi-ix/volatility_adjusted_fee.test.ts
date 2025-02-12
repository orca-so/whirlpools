import * as anchor from "@coral-xyz/anchor";
import { DecimalUtil, Percentage, U64_MAX, ZERO } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import type { WhirlpoolClient } from "../../../src";
import {
  MAX_SQRT_PRICE_BN,
  MAX_TICK_INDEX,
  MIN_SQRT_PRICE_BN,
  MIN_TICK_INDEX,
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
import { defaultConfirmOptions } from "../../utils/const";
import { initTestPoolWithTokens } from "../../utils/init-utils";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import { MAX_U64, getTokenBalance } from "../../utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

const DEBUG_OUTPUT = false;

describe("volatility adjusted fee tests", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  let testCtx: SharedTestContext;

  beforeAll(() => {
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

  it("init oracle", async () => {
    
    const poolTickSpacing = 64;
    const poolInitialTickIndex = 0;
    const poolLiquidity = powBN(2, 20);
    const tradeTokenAmount = new BN(20000);

    const tradeAmountSpecifiedIsInput = true;
    const tradeAToB = true;

    const { whirlpoolPda, tokenAccountA, tokenAccountB, configInitInfo, feeTierParams, configKeypairs } =
      await initTestPoolWithTokens(
        testCtx.whirlpoolCtx,
        poolTickSpacing,
        PriceMath.tickIndexToSqrtPriceX64(poolInitialTickIndex),
        MAX_U64,
      );

    const pool = await testCtx.whirlpoolClient.getPool(
      whirlpoolPda.publicKey,
    );

    await (await pool.initTickArrayForTicks(TickUtil.getFullRangeTickIndex(poolTickSpacing)))!.buildAndExecute();

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

    const whirlpoolsConfig = configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeTier = PDAUtil.getFeeTier(testCtx.whirlpoolCtx.program.programId, whirlpoolsConfig, poolTickSpacing).publicKey;
    const feeAuthority = configKeypairs.feeAuthorityKeypair.publicKey;
    const adaptiveFeeConfigPda = PDAUtil.getAdaptiveFeeConfig(
      testCtx.whirlpoolCtx.program.programId,
      whirlpoolsConfig,
      poolTickSpacing,
    );
    await toTx(testCtx.whirlpoolCtx, WhirlpoolIx.initializeAdaptiveFeeConfigIx(testCtx.whirlpoolCtx.program, {
      whirlpoolsConfig,
      feeTier,
      adaptiveFeeConfigPda,
      feeAuthority,
      funder: testCtx.whirlpoolCtx.provider.wallet.publicKey,
      // default AdaptiveFeeConstants
      defaultFilterPeriod: 30,
      defaultDecayPeriod: 600,
      defaultReductionFactor: 500,
      defaultAdaptiveFeeControlFactor: 4_000,
      defaultMaxVolatilityAccumulator: 350_000,
      defaultTickGroupSize: poolTickSpacing,
    }))
    .addSigner(configKeypairs.feeAuthorityKeypair)
    .buildAndExecute();

    const oraclePda = PDAUtil.getOracle(
      testCtx.whirlpoolCtx.program.programId,
      whirlpoolPda.publicKey,
    );
    await toTx(testCtx.whirlpoolCtx, WhirlpoolIx.initializeOracleIx(testCtx.whirlpoolCtx.program, {
      funder: testCtx.whirlpoolCtx.provider.wallet.publicKey,
      whirlpool: whirlpoolPda.publicKey,
      oraclePda,
      adaptiveFeeConfigPda,
    })).buildAndExecute();

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
      },
      Percentage.fromFraction(0, 100),
    );

    const signature = await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.swapIx(
        testCtx.whirlpoolCtx.program,
        SwapUtils.getSwapParamsFromQuote(
          {
            ...swapQuote,
            otherAmountThreshold: ZERO, // JUST FOR TESTING (This quote didn't consider va fee)
          },
          testCtx.whirlpoolCtx,
          pool,
          swapQuote.aToB ? tokenAccountA : tokenAccountB,
          swapQuote.aToB ? tokenAccountB : tokenAccountA,
          testCtx.provider.wallet.publicKey,
        ),
      ),
    ).buildAndExecute();

    const tx = await testCtx.provider.connection.getTransaction(signature, { 
      maxSupportedTransactionVersion: 0,
    });

    console.log(tx?.meta?.logMessages);
    //console.log("swapQuote est out", swapQuote.estimatedAmountOut.toString());
    //console.log("swapQuote est tick index", swapQuote.estimatedEndTickIndex);

    await pool.refreshData();

    const oppositeAToB = !swapQuote.aToB;
    const oppositeSwapQuote = swapQuoteWithParams(
      {
        amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
        aToB: oppositeAToB,
        otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
          tradeAmountSpecifiedIsInput,
        ),
        sqrtPriceLimit: oppositeAToB ? MIN_SQRT_PRICE_BN : MAX_SQRT_PRICE_BN,
        tickArrays: await SwapUtils.getTickArrays(
          pool.getData().tickCurrentIndex,
          pool.getData().tickSpacing,
          oppositeAToB,
          testCtx.whirlpoolCtx.program.programId,
          pool.getAddress(),
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        ),
        tokenAmount: swapQuote.estimatedAmountOut,
        whirlpoolData: pool.getData(),
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      },
      Percentage.fromFraction(0, 100),
    );

    const oppositeSignature = await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.swapIx(
        testCtx.whirlpoolCtx.program,
        SwapUtils.getSwapParamsFromQuote(
          {
            ...oppositeSwapQuote,
            otherAmountThreshold: ZERO, // JUST FOR TESTING (This quote didn't consider va fee)
          },
          testCtx.whirlpoolCtx,
          pool,
          oppositeSwapQuote.aToB ? tokenAccountA : tokenAccountB,
          oppositeSwapQuote.aToB ? tokenAccountB : tokenAccountA,
          testCtx.provider.wallet.publicKey,
        ),
      ),
    ).buildAndExecute();

    const oppositeTx = await testCtx.provider.connection.getTransaction(oppositeSignature, { 
      maxSupportedTransactionVersion: 0,
    });

    console.log(oppositeTx?.meta?.logMessages);
  });

});

function powBN(base: number, exp: number): BN {
  return new BN(base).pow(new BN(exp));
}

function debug(msg: string) {
  if (!DEBUG_OUTPUT) return;
  console.debug(msg);
}
