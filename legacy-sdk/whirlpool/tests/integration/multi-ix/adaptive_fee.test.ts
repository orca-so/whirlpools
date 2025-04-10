import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { AddressUtil, Percentage, U64_MAX, ZERO } from "@orca-so/common-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type {
  InitPoolWithAdaptiveFeeParams,
  OracleData,
  WhirlpoolClient,
} from "../../../src";
import {
  MAX_SQRT_PRICE_BN,
  MIN_SQRT_PRICE_BN,
  NO_ADAPTIVE_FEE_INFO,
  PDAUtil,
  PriceMath,
  SwapUtils,
  TickUtil,
  WhirlpoolIx,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByLiquidityWithParams,
  swapQuoteByInputToken,
  swapQuoteWithParams,
  toTx,
  twoHopSwapQuoteFromSwapQuotes,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { defaultConfirmOptions } from "../../utils/const";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import {
  createAndMintToAssociatedTokenAccount,
  createMint,
  sleep,
} from "../../utils";
import { PoolUtil } from "../../../dist/utils/public/pool-utils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { buildTestPoolWithAdaptiveFeeParams } from "../../utils/v2/init-utils-v2";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import type { FundedPositionParams } from "../../utils/init-utils";
import {
  buildTestAquariums,
  getDefaultAquarium,
  getTokenAccsForPools,
} from "../../utils/init-utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

const DEBUG_OUTPUT = false;

describe("adaptive fee tests", () => {
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
  /*
  it("init oracle", async () => {
    const poolInitialTickIndex = 0;
    const poolLiquidity = powBN(2, 20);
    const tradeTokenAmount = new BN(20000);
    const tradeAmountSpecifiedIsInput = true;
    const tradeAToB = true;

    // init config
    const authorityWhirlpoolsConfigKeypair = Keypair.generate();
    const configKeypair = Keypair.generate();
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializeConfigIx(testCtx.whirlpoolCtx.program, {
        collectProtocolFeesAuthority:
          authorityWhirlpoolsConfigKeypair.publicKey,
        feeAuthority: authorityWhirlpoolsConfigKeypair.publicKey,
        rewardEmissionsSuperAuthority:
          authorityWhirlpoolsConfigKeypair.publicKey,
        defaultProtocolFeeRate: 300,
        funder: provider.wallet.publicKey,
        whirlpoolsConfigKeypair: configKeypair,
      }),
    )
      .addSigner(configKeypair)
      .buildAndExecute();

    // init mints
    const mintX = await createMint(testCtx.provider);
    const mintY = await createMint(testCtx.provider);
    const [mintA, mintB] = AddressUtil.toPubKeys(
      PoolUtil.orderMints(mintX, mintY),
    );
    const tokenAccountA = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintA,
      U64_MAX,
    );
    const tokenAccountB = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintB,
      U64_MAX,
    );

    // init AdaptiveFeeTier
    const feeTierIndex = 1024 + 64;
    const tickSpacing = 64;
    const feeTierPda = PDAUtil.getFeeTier(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      feeTierIndex,
    );
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializeAdaptiveFeeTierIx(testCtx.whirlpoolCtx.program, {
        whirlpoolsConfig: configKeypair.publicKey,
        defaultBaseFeeRate: 3000,
        feeTierIndex,
        tickSpacing,
        feeTierPda,
        funder: provider.wallet.publicKey,
        feeAuthority: authorityWhirlpoolsConfigKeypair.publicKey,
        initializePoolAuthority: undefined,
        delegatedFeeAuthority: undefined,
        // AdaptiveFeeConstants
        presetFilterPeriod: 30,
        presetDecayPeriod: 600,
        presetReductionFactor: 500,
        presetAdaptiveFeeControlFactor: 4_000,
        presetMaxVolatilityAccumulator: 350_000,
        presetTickGroupSize: tickSpacing,
      }),
    )
      .addSigner(authorityWhirlpoolsConfigKeypair)
      .buildAndExecute();

    // init whirlpool with AdaptiveFeeTier
    const whirlpoolPda = PDAUtil.getWhirlpool(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintA,
      mintB,
      feeTierIndex,
    );

    const oraclePda = PDAUtil.getOracle(
      testCtx.whirlpoolCtx.program.programId,
      whirlpoolPda.publicKey,
    );

    const tokenBadgeAPda = PDAUtil.getTokenBadge(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintA,
    );
    const tokenBadgeBPda = PDAUtil.getTokenBadge(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintB,
    );
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
        testCtx.whirlpoolCtx.program,
        {
          whirlpoolsConfig: configKeypair.publicKey,
          adaptiveFeeTierKey: feeTierPda.publicKey,
          whirlpoolPda,
          oraclePda,
          funder: provider.wallet.publicKey,
          initializePoolAuthority: provider.wallet.publicKey,
          initSqrtPrice:
            PriceMath.tickIndexToSqrtPriceX64(poolInitialTickIndex),
          tokenMintA: mintA,
          tokenMintB: mintB,
          tokenBadgeA: tokenBadgeAPda.publicKey,
          tokenBadgeB: tokenBadgeBPda.publicKey,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
          tokenVaultAKeypair: Keypair.generate(),
          tokenVaultBKeypair: Keypair.generate(),
        },
      ),
    ).buildAndExecute();

    // init TickArrays
    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolPda.publicKey);
    await (await pool.initTickArrayForTicks(
      TickUtil.getFullRangeTickIndex(tickSpacing),
    ))!.buildAndExecute();
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

    console.info(tx?.meta?.logMessages);
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

    const oppositeTx = await testCtx.provider.connection.getTransaction(
      oppositeSignature,
      {
        maxSupportedTransactionVersion: 0,
      },
    );

    console.info(oppositeTx?.meta?.logMessages);
  });
*/
  describe("trade with AdaptiveFee", () => {
    describe("swap", () => {
      const versions = [1, 2];
      for (const version of versions) {
        it(`swap V${version}`, async () => {
          const poolInfo = await buildSwapTestPool(
            undefined,
            PriceMath.tickIndexToSqrtPriceX64(150),
          ); // tick_group_index = 2
          const pool = await testCtx.whirlpoolClient.getPool(
            poolInfo.whirlpool,
            IGNORE_CACHE,
          );

          const tradeTokenAmount = new BN(20000);
          const tradeAmountSpecifiedIsInput = true;
          const tradeAToB = true;
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
              adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(0, 100),
          );

          const swapParams = SwapUtils.getSwapParamsFromQuote(
            {
              ...swapQuote,
              otherAmountThreshold: ZERO, // JUST FOR TESTING
            },
            testCtx.whirlpoolCtx,
            pool,
            swapQuote.aToB ? poolInfo.tokenAccountA : poolInfo.tokenAccountB,
            swapQuote.aToB ? poolInfo.tokenAccountB : poolInfo.tokenAccountA,
            testCtx.provider.wallet.publicKey,
          );

          const preWhirlpool = await pool.refreshData();
          const preOracle = (await testCtx.whirlpoolCtx.fetcher.getOracle(
            poolInfo.oracle,
            IGNORE_CACHE,
          )) as OracleData;

          // initial state
          const preVars = preOracle.adaptiveFeeVariables;
          assert.ok(preVars.lastReferenceUpdateTimestamp.isZero());
          assert.ok(preVars.lastMajorSwapTimestamp.isZero());
          assert.ok(preVars.tickGroupIndexReference == 0);
          assert.ok(preVars.volatilityReference == 0);
          assert.ok(preVars.volatilityAccumulator == 0);

          if (version == 1) {
            await toTx(
              testCtx.whirlpoolCtx,
              WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, swapParams),
            ).buildAndExecute();
          } else {
            await toTx(
              testCtx.whirlpoolCtx,
              WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
                ...swapParams,
                tokenMintA: poolInfo.mintA,
                tokenMintB: poolInfo.mintB,
                tokenProgramA: TOKEN_PROGRAM_ID,
                tokenProgramB: TOKEN_PROGRAM_ID,
              }),
            ).buildAndExecute();
          }

          const postWhirlpool = await pool.refreshData();
          const postOracle = (await testCtx.whirlpoolCtx.fetcher.getOracle(
            poolInfo.oracle,
            IGNORE_CACHE,
          )) as OracleData;

          const postVars = postOracle.adaptiveFeeVariables;
          const currentSystemTimestamp = new BN(Math.floor(Date.now() / 1000));
          assert.ok(postVars.lastReferenceUpdateTimestamp.gtn(0));
          assert.ok(
            postVars.lastReferenceUpdateTimestamp
              .sub(currentSystemTimestamp)
              .abs()
              .lten(10),
          ); // margin 10s
          assert.ok(
            postVars.lastMajorSwapTimestamp.eq(
              postVars.lastReferenceUpdateTimestamp,
            ),
          );
          assert.ok(
            postVars.tickGroupIndexReference ==
              Math.floor(
                preWhirlpool.tickCurrentIndex / preWhirlpool.tickSpacing,
              ),
          );
          assert.ok(postVars.tickGroupIndexReference == 2);
          assert.ok(postVars.volatilityReference == 0);

          const updatedTickGroupIndex = Math.floor(
            PriceMath.sqrtPriceX64ToTickIndex(postWhirlpool.sqrtPrice) /
              postWhirlpool.tickSpacing,
          );
          const tickGroupIndexDelta = Math.abs(
            updatedTickGroupIndex - postVars.tickGroupIndexReference,
          );
          assert.ok(tickGroupIndexDelta > 0);
          assert.ok(
            postVars.volatilityAccumulator == tickGroupIndexDelta * 10000,
          );
        });
      }
    });

    describe("twoHopSwap", () => {
      const versions = [1, 2];
      for (const version of versions) {
        it(`twoHopSwap V${version}`, async () => {
          const {
            whirlpoolOne,
            whirlpoolTwo,
            oracleOne,
            oracleTwo,
            tokenAccountIn,
            tokenAccountMid,
            tokenAccountOut,
          } = await buildTwoHopSwapTestPools(
            undefined,
            undefined,
            PriceMath.tickIndexToSqrtPriceX64(192 + 50),
            PriceMath.tickIndexToSqrtPriceX64(-128 + 10),
          );

          const poolOne = await testCtx.whirlpoolClient.getPool(
            whirlpoolOne,
            IGNORE_CACHE,
          );
          const poolTwo = await testCtx.whirlpoolClient.getPool(
            whirlpoolTwo,
            IGNORE_CACHE,
          );

          const tradeTokenAmount = new BN(80000);
          const tradeAmountSpecifiedIsInput = true;
          const tradeAToBOne = true;
          const tradeAToBTwo = true;
          const swapQuoteOne = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToB: tradeAToBOne,
              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
                tradeAmountSpecifiedIsInput,
              ),
              sqrtPriceLimit: tradeAToBOne
                ? MIN_SQRT_PRICE_BN
                : MAX_SQRT_PRICE_BN,
              tickArrays: await SwapUtils.getTickArrays(
                poolOne.getData().tickCurrentIndex,
                poolOne.getData().tickSpacing,
                tradeAToBOne,
                testCtx.whirlpoolCtx.program.programId,
                poolOne.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
              tokenAmount: tradeTokenAmount,
              whirlpoolData: poolOne.getData(),
              tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
              adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(0, 100),
          );

          const swapQuoteTwo = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToB: tradeAToBOne,
              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
                tradeAmountSpecifiedIsInput,
              ),
              sqrtPriceLimit: tradeAToBOne
                ? MIN_SQRT_PRICE_BN
                : MAX_SQRT_PRICE_BN,
              tickArrays: await SwapUtils.getTickArrays(
                poolTwo.getData().tickCurrentIndex,
                poolTwo.getData().tickSpacing,
                tradeAToBTwo,
                testCtx.whirlpoolCtx.program.programId,
                poolTwo.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
              tokenAmount: swapQuoteOne.estimatedAmountOut,
              whirlpoolData: poolTwo.getData(),
              tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
              adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(0, 100),
          );

          const twoHopSwapIx = WhirlpoolIx.twoHopSwapIx(
            testCtx.whirlpoolCtx.program,
            {
              amount: tradeTokenAmount,
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToBOne: tradeAToBOne,
              aToBTwo: tradeAToBTwo,
              oracleOne,
              oracleTwo,
              otherAmountThreshold: ZERO,
              sqrtPriceLimitOne: ZERO,
              sqrtPriceLimitTwo: ZERO,
              tickArrayOne0: swapQuoteOne.tickArray0,
              tickArrayOne1: swapQuoteOne.tickArray1,
              tickArrayOne2: swapQuoteOne.tickArray2,
              tickArrayTwo0: swapQuoteTwo.tickArray0,
              tickArrayTwo1: swapQuoteTwo.tickArray1,
              tickArrayTwo2: swapQuoteTwo.tickArray2,
              tokenAuthority: testCtx.provider.wallet.publicKey,
              tokenOwnerAccountOneA: tokenAccountIn,
              tokenOwnerAccountOneB: tokenAccountMid,
              tokenOwnerAccountTwoA: tokenAccountMid,
              tokenOwnerAccountTwoB: tokenAccountOut,
              tokenVaultOneA: poolOne.getData().tokenVaultA,
              tokenVaultOneB: poolOne.getData().tokenVaultB,
              tokenVaultTwoA: poolTwo.getData().tokenVaultA,
              tokenVaultTwoB: poolTwo.getData().tokenVaultB,
              whirlpoolOne,
              whirlpoolTwo,
            },
          );

          const twoHopSwapV2Ix = WhirlpoolIx.twoHopSwapV2Ix(
            testCtx.whirlpoolCtx.program,
            {
              amount: tradeTokenAmount,
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToBOne: tradeAToBOne,
              aToBTwo: tradeAToBTwo,
              oracleOne,
              oracleTwo,
              otherAmountThreshold: ZERO,
              sqrtPriceLimitOne: ZERO,
              sqrtPriceLimitTwo: ZERO,
              tickArrayOne0: swapQuoteOne.tickArray0,
              tickArrayOne1: swapQuoteOne.tickArray1,
              tickArrayOne2: swapQuoteOne.tickArray2,
              tickArrayTwo0: swapQuoteTwo.tickArray0,
              tickArrayTwo1: swapQuoteTwo.tickArray1,
              tickArrayTwo2: swapQuoteTwo.tickArray2,
              tokenAuthority: testCtx.provider.wallet.publicKey,
              tokenMintInput: poolOne.getData().tokenMintA,
              tokenMintIntermediate: poolOne.getData().tokenMintB,
              tokenMintOutput: poolTwo.getData().tokenMintB,
              tokenOwnerAccountInput: tokenAccountIn,
              tokenOwnerAccountOutput: tokenAccountOut,
              tokenProgramInput: TOKEN_PROGRAM_ID,
              tokenProgramIntermediate: TOKEN_PROGRAM_ID,
              tokenProgramOutput: TOKEN_PROGRAM_ID,
              tokenVaultOneInput: poolOne.getData().tokenVaultA,
              tokenVaultOneIntermediate: poolOne.getData().tokenVaultB,
              tokenVaultTwoIntermediate: poolTwo.getData().tokenVaultA,
              tokenVaultTwoOutput: poolTwo.getData().tokenVaultB,
              whirlpoolOne,
              whirlpoolTwo,
            },
          );

          const preWhirlpoolOne = await poolOne.refreshData();
          const preOracleOne = (await testCtx.whirlpoolCtx.fetcher.getOracle(
            oracleOne,
            IGNORE_CACHE,
          )) as OracleData;
          const preWhirlpoolTwo = await poolTwo.refreshData();
          const preOracleTwo = (await testCtx.whirlpoolCtx.fetcher.getOracle(
            oracleTwo,
            IGNORE_CACHE,
          )) as OracleData;

          // initial state
          const preVarsOne = preOracleOne.adaptiveFeeVariables;
          assert.ok(preVarsOne.lastReferenceUpdateTimestamp.isZero());
          assert.ok(preVarsOne.lastMajorSwapTimestamp.isZero());
          assert.ok(preVarsOne.tickGroupIndexReference == 0);
          assert.ok(preVarsOne.volatilityReference == 0);
          assert.ok(preVarsOne.volatilityAccumulator == 0);
          const preVarsTwo = preOracleTwo.adaptiveFeeVariables;
          assert.ok(preVarsTwo.lastReferenceUpdateTimestamp.isZero());
          assert.ok(preVarsTwo.lastMajorSwapTimestamp.isZero());
          assert.ok(preVarsTwo.tickGroupIndexReference == 0);
          assert.ok(preVarsTwo.volatilityReference == 0);
          assert.ok(preVarsTwo.volatilityAccumulator == 0);

          if (version == 1) {
            await toTx(testCtx.whirlpoolCtx, twoHopSwapIx).buildAndExecute();
          } else {
            await toTx(testCtx.whirlpoolCtx, twoHopSwapV2Ix).buildAndExecute();
          }

          const postWhirlpoolOne = await poolOne.refreshData();
          const postOracleOne = (await testCtx.whirlpoolCtx.fetcher.getOracle(
            oracleOne,
            IGNORE_CACHE,
          )) as OracleData;
          const postWhirlpoolTwo = await poolTwo.refreshData();
          const postOracleTwo = (await testCtx.whirlpoolCtx.fetcher.getOracle(
            oracleTwo,
            IGNORE_CACHE,
          )) as OracleData;

          const postVarsOne = postOracleOne.adaptiveFeeVariables;
          const postVarsTwo = postOracleTwo.adaptiveFeeVariables;
          const currentSystemTimestamp = new BN(Math.floor(Date.now() / 1000));

          assert.ok(postVarsOne.lastReferenceUpdateTimestamp.gtn(0));
          assert.ok(
            postVarsOne.lastReferenceUpdateTimestamp
              .sub(currentSystemTimestamp)
              .abs()
              .lten(10),
          ); // margin 10s
          assert.ok(
            postVarsOne.lastMajorSwapTimestamp.eq(
              postVarsOne.lastReferenceUpdateTimestamp,
            ),
          );
          assert.ok(
            postVarsOne.tickGroupIndexReference ==
              Math.floor(
                preWhirlpoolOne.tickCurrentIndex / preWhirlpoolOne.tickSpacing,
              ),
          );
          assert.ok(postVarsOne.tickGroupIndexReference == 3);
          assert.ok(postVarsOne.volatilityReference == 0);

          const updatedTickGroupIndexOne = Math.floor(
            PriceMath.sqrtPriceX64ToTickIndex(postWhirlpoolOne.sqrtPrice) /
              postWhirlpoolOne.tickSpacing,
          );
          const tickGroupIndexDeltaOne = Math.abs(
            updatedTickGroupIndexOne - postVarsOne.tickGroupIndexReference,
          );
          assert.ok(tickGroupIndexDeltaOne > 0);
          assert.ok(
            postVarsOne.volatilityAccumulator == tickGroupIndexDeltaOne * 10000,
          );

          assert.ok(postVarsTwo.lastReferenceUpdateTimestamp.gtn(0));
          assert.ok(
            postVarsTwo.lastReferenceUpdateTimestamp
              .sub(currentSystemTimestamp)
              .abs()
              .lten(10),
          ); // margin 10s
          assert.ok(
            postVarsTwo.lastMajorSwapTimestamp.eq(
              postVarsTwo.lastReferenceUpdateTimestamp,
            ),
          );
          assert.ok(
            postVarsTwo.tickGroupIndexReference ==
              Math.floor(
                preWhirlpoolTwo.tickCurrentIndex / preWhirlpoolTwo.tickSpacing,
              ),
          );
          assert.ok(postVarsTwo.tickGroupIndexReference == -2);
          assert.ok(postVarsTwo.volatilityReference == 0);

          const updatedTickGroupIndexTwo = Math.floor(
            PriceMath.sqrtPriceX64ToTickIndex(postWhirlpoolTwo.sqrtPrice) /
              postWhirlpoolTwo.tickSpacing,
          );
          const tickGroupIndexDeltaTwo = Math.abs(
            updatedTickGroupIndexTwo - postVarsTwo.tickGroupIndexReference,
          );
          assert.ok(tickGroupIndexDeltaTwo > 0);
          assert.ok(
            postVarsTwo.volatilityAccumulator == tickGroupIndexDeltaTwo * 10000,
          );
        });
      }
    });
  });

  describe("trade enable timestamp", () => {
    it("swap/swapV2 should be blocked until trade enable timestamp", async () => {
      const currentTimeInSec = new anchor.BN(Math.floor(Date.now() / 1000));
      const tradeEnableTimestamp = currentTimeInSec.addn(20); // 20 seconds from now

      const poolInfo = await buildSwapTestPool(tradeEnableTimestamp, undefined);
      const pool = await testCtx.whirlpoolClient.getPool(
        poolInfo.whirlpool,
        IGNORE_CACHE,
      );

      const tradeTokenAmount = new BN(20000);
      const tradeAmountSpecifiedIsInput = true;
      const tradeAToB = true;
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
          adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
        },
        Percentage.fromFraction(0, 100),
      );

      const swapParams = SwapUtils.getSwapParamsFromQuote(
        {
          ...swapQuote,
          otherAmountThreshold: ZERO, // JUST FOR TESTING
        },
        testCtx.whirlpoolCtx,
        pool,
        swapQuote.aToB ? poolInfo.tokenAccountA : poolInfo.tokenAccountB,
        swapQuote.aToB ? poolInfo.tokenAccountB : poolInfo.tokenAccountA,
        testCtx.provider.wallet.publicKey,
      );

      const swapIx = WhirlpoolIx.swapIx(
        testCtx.whirlpoolCtx.program,
        swapParams,
      );
      const swapV2Ix = WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
        ...swapParams,
        tokenMintA: poolInfo.mintA,
        tokenMintB: poolInfo.mintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        toTx(testCtx.whirlpoolCtx, swapIx).buildAndExecute(),
        /0x17b0/, // TradeIsNotEnabled.
      );

      await assert.rejects(
        toTx(testCtx.whirlpoolCtx, swapV2Ix).buildAndExecute(),
        /0x17b0/, // TradeIsNotEnabled.
      );

      // wait until trade enable timestamp (margin: 5s)
      await sleep((20 + 5) * 1000);

      // now it should be successful
      await toTx(testCtx.whirlpoolCtx, swapIx).buildAndExecute();
      await toTx(testCtx.whirlpoolCtx, swapV2Ix).buildAndExecute();
    });

    describe("twoHopSwap/twoHopSwapV2", () => {
      const variants = [
        {
          oneOrTwo: "One",
          useTradeEnableTimestampOne: true,
          useTradeEnableTimestampTwo: false,
        },
        {
          oneOrTwo: "Two",
          useTradeEnableTimestampOne: false,
          useTradeEnableTimestampTwo: true,
        },
        {
          oneOrTwo: "One & Two",
          useTradeEnableTimestampOne: true,
          useTradeEnableTimestampTwo: true,
        },
      ];

      for (const variant of variants) {
        const {
          oneOrTwo,
          useTradeEnableTimestampOne,
          useTradeEnableTimestampTwo,
        } = variant;

        it(`twoHopSwap/twoHopSwapV2 should be blocked until trade enable timestamp of whirlpool ${oneOrTwo}`, async () => {
          const currentTimeInSec = new anchor.BN(Math.floor(Date.now() / 1000));
          const tradeEnableTimestamp = currentTimeInSec.addn(20); // 20 seconds from now

          const {
            whirlpoolOne,
            whirlpoolTwo,
            oracleOne,
            oracleTwo,
            tokenAccountIn,
            tokenAccountMid,
            tokenAccountOut,
          } = await buildTwoHopSwapTestPools(
            useTradeEnableTimestampOne ? tradeEnableTimestamp : undefined,
            useTradeEnableTimestampTwo ? tradeEnableTimestamp : undefined,
            undefined,
            undefined,
          );

          const poolOne = await testCtx.whirlpoolClient.getPool(
            whirlpoolOne,
            IGNORE_CACHE,
          );
          const poolTwo = await testCtx.whirlpoolClient.getPool(
            whirlpoolTwo,
            IGNORE_CACHE,
          );

          const tradeTokenAmount = new BN(20000);
          const tradeAmountSpecifiedIsInput = true;
          const tradeAToBOne = true;
          const tradeAToBTwo = true;
          const swapQuoteOne = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToB: tradeAToBOne,
              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
                tradeAmountSpecifiedIsInput,
              ),
              sqrtPriceLimit: tradeAToBOne
                ? MIN_SQRT_PRICE_BN
                : MAX_SQRT_PRICE_BN,
              tickArrays: await SwapUtils.getTickArrays(
                poolOne.getData().tickCurrentIndex,
                poolOne.getData().tickSpacing,
                tradeAToBOne,
                testCtx.whirlpoolCtx.program.programId,
                poolOne.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
              tokenAmount: tradeTokenAmount,
              whirlpoolData: poolOne.getData(),
              tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
              adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(0, 100),
          );

          const swapQuoteTwo = swapQuoteWithParams(
            {
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToB: tradeAToBOne,
              otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
                tradeAmountSpecifiedIsInput,
              ),
              sqrtPriceLimit: tradeAToBOne
                ? MIN_SQRT_PRICE_BN
                : MAX_SQRT_PRICE_BN,
              tickArrays: await SwapUtils.getTickArrays(
                poolTwo.getData().tickCurrentIndex,
                poolTwo.getData().tickSpacing,
                tradeAToBTwo,
                testCtx.whirlpoolCtx.program.programId,
                poolTwo.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
              tokenAmount: swapQuoteOne.estimatedAmountOut,
              whirlpoolData: poolTwo.getData(),
              tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
              adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
            },
            Percentage.fromFraction(0, 100),
          );

          const twoHopSwapIx = WhirlpoolIx.twoHopSwapIx(
            testCtx.whirlpoolCtx.program,
            {
              amount: tradeTokenAmount,
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToBOne: tradeAToBOne,
              aToBTwo: tradeAToBTwo,
              oracleOne,
              oracleTwo,
              otherAmountThreshold: ZERO,
              sqrtPriceLimitOne: ZERO,
              sqrtPriceLimitTwo: ZERO,
              tickArrayOne0: swapQuoteOne.tickArray0,
              tickArrayOne1: swapQuoteOne.tickArray1,
              tickArrayOne2: swapQuoteOne.tickArray2,
              tickArrayTwo0: swapQuoteTwo.tickArray0,
              tickArrayTwo1: swapQuoteTwo.tickArray1,
              tickArrayTwo2: swapQuoteTwo.tickArray2,
              tokenAuthority: testCtx.provider.wallet.publicKey,
              tokenOwnerAccountOneA: tokenAccountIn,
              tokenOwnerAccountOneB: tokenAccountMid,
              tokenOwnerAccountTwoA: tokenAccountMid,
              tokenOwnerAccountTwoB: tokenAccountOut,
              tokenVaultOneA: poolOne.getData().tokenVaultA,
              tokenVaultOneB: poolOne.getData().tokenVaultB,
              tokenVaultTwoA: poolTwo.getData().tokenVaultA,
              tokenVaultTwoB: poolTwo.getData().tokenVaultB,
              whirlpoolOne,
              whirlpoolTwo,
            },
          );

          const twoHopSwapV2Ix = WhirlpoolIx.twoHopSwapV2Ix(
            testCtx.whirlpoolCtx.program,
            {
              amount: tradeTokenAmount,
              amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
              aToBOne: tradeAToBOne,
              aToBTwo: tradeAToBTwo,
              oracleOne,
              oracleTwo,
              otherAmountThreshold: ZERO,
              sqrtPriceLimitOne: ZERO,
              sqrtPriceLimitTwo: ZERO,
              tickArrayOne0: swapQuoteOne.tickArray0,
              tickArrayOne1: swapQuoteOne.tickArray1,
              tickArrayOne2: swapQuoteOne.tickArray2,
              tickArrayTwo0: swapQuoteTwo.tickArray0,
              tickArrayTwo1: swapQuoteTwo.tickArray1,
              tickArrayTwo2: swapQuoteTwo.tickArray2,
              tokenAuthority: testCtx.provider.wallet.publicKey,
              tokenMintInput: poolOne.getData().tokenMintA,
              tokenMintIntermediate: poolOne.getData().tokenMintB,
              tokenMintOutput: poolTwo.getData().tokenMintB,
              tokenOwnerAccountInput: tokenAccountIn,
              tokenOwnerAccountOutput: tokenAccountOut,
              tokenProgramInput: TOKEN_PROGRAM_ID,
              tokenProgramIntermediate: TOKEN_PROGRAM_ID,
              tokenProgramOutput: TOKEN_PROGRAM_ID,
              tokenVaultOneInput: poolOne.getData().tokenVaultA,
              tokenVaultOneIntermediate: poolOne.getData().tokenVaultB,
              tokenVaultTwoIntermediate: poolTwo.getData().tokenVaultA,
              tokenVaultTwoOutput: poolTwo.getData().tokenVaultB,
              whirlpoolOne,
              whirlpoolTwo,
            },
          );

          await assert.rejects(
            toTx(testCtx.whirlpoolCtx, twoHopSwapIx).buildAndExecute(),
            /0x17b0/, // TradeIsNotEnabled.
          );

          await assert.rejects(
            toTx(testCtx.whirlpoolCtx, twoHopSwapV2Ix).buildAndExecute(),
            /0x17b0/, // TradeIsNotEnabled.
          );

          // wait until trade enable timestamp (margin: 5s)
          await sleep((20 + 5) * 1000);

          // now it should be successful
          await toTx(testCtx.whirlpoolCtx, twoHopSwapIx).buildAndExecute();
          await toTx(testCtx.whirlpoolCtx, twoHopSwapV2Ix).buildAndExecute();
        });
      }
    });
  });

  describe("swapV1 / twoHopSwapV1 compatibility", () => {
    describe("works on a pool with static fee (FeeTier)", () => {
      const tickSpacing = 128;
      const aqConfig = getDefaultAquarium();
      aqConfig.initMintParams.push({});
      aqConfig.initTokenAccParams.push({ mintIndex: 2 });
      aqConfig.initPoolParams.push({
        mintIndices: [1, 2],
        tickSpacing,
      });
      aqConfig.initTickArrayRangeParams.push({
        poolIndex: 0,
        startTickIndex: 22528,
        arrayCount: 3,
        aToB: false,
      });
      aqConfig.initTickArrayRangeParams.push({
        poolIndex: 1,
        startTickIndex: 22528,
        arrayCount: 3,
        aToB: false,
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

      it("swapV1", async () => {
        // build pool with FeeTier
        const aquarium = (
          await buildTestAquariums(testCtx.whirlpoolCtx, [aqConfig])
        )[0];
        const {
          tokenAccounts: tokenAccountsUnsorted,
          mintKeys,
          pools,
        } = aquarium;
        const tokenAccounts = getTokenAccsForPools(
          pools,
          tokenAccountsUnsorted,
        );
        const whirlpoolKey = pools[0].whirlpoolPda.publicKey;
        const whirlpool = await testCtx.whirlpoolClient.getPool(
          whirlpoolKey,
          IGNORE_CACHE,
        );
        const [inputToken] = mintKeys;

        const quote = await swapQuoteByInputToken(
          whirlpool,
          inputToken,
          new BN(1000),
          Percentage.fromFraction(1, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const oracle = PDAUtil.getOracle(
          testCtx.whirlpoolCtx.program.programId,
          whirlpoolKey,
        ).publicKey;

        const swapIx = WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...quote,
          whirlpool: whirlpoolKey,
          oracle,
          tokenOwnerAccountA: tokenAccounts[0],
          tokenOwnerAccountB: tokenAccounts[1],
          tokenVaultA: whirlpool.getData().tokenVaultA,
          tokenVaultB: whirlpool.getData().tokenVaultB,
          tokenAuthority: testCtx.provider.wallet.publicKey,
        }).instructions[0];

        // try to execute swap ix on a pool WITHOUT adaptive fee WITHOUT isWritable flag on oracle account

        // oracle: readonly
        assert.equal(swapIx.keys[10].pubkey, oracle);
        swapIx.keys[10] = {
          pubkey: oracle,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.equal(swapIx.keys.length, 11);

        const preSqrtPrice = (await whirlpool.refreshData()).sqrtPrice;
        await toTx(testCtx.whirlpoolCtx, {
          instructions: [swapIx],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute();
        const postSqrtPrice = (await whirlpool.refreshData()).sqrtPrice;
        assert.ok(!preSqrtPrice.eq(postSqrtPrice));
      });

      it("twoHopSwapV1", async () => {
        // build pools with FeeTier
        const aquarium = (
          await buildTestAquariums(testCtx.whirlpoolCtx, [aqConfig])
        )[0];
        const {
          tokenAccounts: tokenAccountsUnsorted,
          mintKeys,
          pools,
        } = aquarium;
        const tokenAccounts = getTokenAccsForPools(
          pools,
          tokenAccountsUnsorted,
        );

        const whirlpoolOneKey = pools[0].whirlpoolPda.publicKey;
        const whirlpoolOne = await testCtx.whirlpoolClient.getPool(
          whirlpoolOneKey,
          IGNORE_CACHE,
        );
        const whirlpoolTwoKey = pools[1].whirlpoolPda.publicKey;
        const whirlpoolTwo = await testCtx.whirlpoolClient.getPool(
          whirlpoolTwoKey,
          IGNORE_CACHE,
        );
        const [inputToken, midToken] = mintKeys;

        const quoteOne = await swapQuoteByInputToken(
          whirlpoolOne,
          inputToken,
          new BN(1000),
          Percentage.fromFraction(1, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );
        const quoteTwo = await swapQuoteByInputToken(
          whirlpoolTwo,
          midToken,
          quoteOne.estimatedAmountOut,
          Percentage.fromFraction(1, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );
        const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteOne, quoteTwo);

        const oracleOne = PDAUtil.getOracle(
          testCtx.whirlpoolCtx.program.programId,
          whirlpoolOneKey,
        ).publicKey;
        const oracleTwo = PDAUtil.getOracle(
          testCtx.whirlpoolCtx.program.programId,
          whirlpoolTwoKey,
        ).publicKey;

        const twoHopSwapIx = WhirlpoolIx.twoHopSwapIx(
          testCtx.whirlpoolCtx.program,
          {
            ...twoHopQuote,
            whirlpoolOne: whirlpoolOneKey,
            whirlpoolTwo: whirlpoolTwoKey,
            oracleOne: oracleOne,
            oracleTwo: oracleTwo,
            tokenOwnerAccountOneA: tokenAccounts[0],
            tokenOwnerAccountOneB: tokenAccounts[1],
            tokenOwnerAccountTwoA: tokenAccounts[2],
            tokenOwnerAccountTwoB: tokenAccounts[3],
            tokenVaultOneA: whirlpoolOne.getData().tokenVaultA,
            tokenVaultOneB: whirlpoolOne.getData().tokenVaultB,
            tokenVaultTwoA: whirlpoolTwo.getData().tokenVaultA,
            tokenVaultTwoB: whirlpoolTwo.getData().tokenVaultB,
            tokenAuthority: testCtx.provider.wallet.publicKey,
          },
        ).instructions[0];

        // try to execute twoHopSwap ix on pools WITHOUT adaptive fee WITHOUT isWritable flags on oracle accounts

        // oracle_one: readonly
        assert.equal(twoHopSwapIx.keys[18].pubkey, oracleOne);
        twoHopSwapIx.keys[18] = {
          pubkey: oracleOne,
          isSigner: false,
          isWritable: false,
        };
        // oracle_two: readonly
        assert.equal(twoHopSwapIx.keys[19].pubkey, oracleTwo);
        twoHopSwapIx.keys[19] = {
          pubkey: oracleTwo,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.equal(twoHopSwapIx.keys.length, 20);

        const preSqrtPriceOne = (await whirlpoolOne.refreshData()).sqrtPrice;
        const preSqrtPriceTwo = (await whirlpoolTwo.refreshData()).sqrtPrice;
        await toTx(testCtx.whirlpoolCtx, {
          instructions: [twoHopSwapIx],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute();
        const postSqrtPriceOne = (await whirlpoolOne.refreshData()).sqrtPrice;
        const postSqrtPriceTwo = (await whirlpoolTwo.refreshData()).sqrtPrice;
        assert.ok(!preSqrtPriceOne.eq(postSqrtPriceOne));
        assert.ok(!preSqrtPriceTwo.eq(postSqrtPriceTwo));
      });
    });

    describe("works on a pool with adaptive fee (AdaptiveFeeTier), modify isWritable hack", () => {
      it("swapV1", async () => {
        const poolInfo = await buildSwapTestPool(undefined, undefined);
        const whirlpool = await testCtx.whirlpoolClient.getPool(
          poolInfo.whirlpool,
          IGNORE_CACHE,
        );

        const tradeTokenAmount = new BN(20000);
        const quote = await swapQuoteByInputToken(
          whirlpool,
          poolInfo.mintA,
          tradeTokenAmount,
          Percentage.fromFraction(1, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const oracle = PDAUtil.getOracle(
          testCtx.whirlpoolCtx.program.programId,
          whirlpool.getAddress(),
        ).publicKey;

        const swapIx = WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...quote,
          whirlpool: whirlpool.getAddress(),
          oracle,
          tokenOwnerAccountA: poolInfo.tokenAccountA,
          tokenOwnerAccountB: poolInfo.tokenAccountB,
          tokenVaultA: whirlpool.getData().tokenVaultA,
          tokenVaultB: whirlpool.getData().tokenVaultB,
          tokenAuthority: testCtx.provider.wallet.publicKey,
        }).instructions[0];

        // try to execute swap ix on a pool WITH adaptive fee WITHOUT isWritable flag on oracle account

        // oracle: readonly
        assert.equal(swapIx.keys[10].pubkey, oracle);
        swapIx.keys[10] = {
          pubkey: oracle,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.ok(swapIx.keys.length == 11);

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [swapIx],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // now try with isWritable flag on oracle account (this is a hacky way)

        // oracle: readonly
        assert.equal(swapIx.keys[10].pubkey, oracle);
        swapIx.keys[10] = { pubkey: oracle, isSigner: false, isWritable: true };
        // no remaining accounts
        assert.equal(swapIx.keys.length, 11);

        const preSqrtPrice = (await whirlpool.refreshData()).sqrtPrice;
        await toTx(testCtx.whirlpoolCtx, {
          instructions: [swapIx],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute();
        const postSqrtPrice = (await whirlpool.refreshData()).sqrtPrice;
        assert.ok(!preSqrtPrice.eq(postSqrtPrice));
      });

      it("twoHopSwapV1", async () => {
        const {
          whirlpoolOne,
          whirlpoolTwo,
          oracleOne,
          oracleTwo,
          tokenAccountIn,
          tokenAccountMid,
          tokenAccountOut,
        } = await buildTwoHopSwapTestPools(
          undefined,
          undefined,
          PriceMath.tickIndexToSqrtPriceX64(0),
          PriceMath.tickIndexToSqrtPriceX64(0),
        );

        const poolOne = await testCtx.whirlpoolClient.getPool(
          whirlpoolOne,
          IGNORE_CACHE,
        );
        const poolTwo = await testCtx.whirlpoolClient.getPool(
          whirlpoolTwo,
          IGNORE_CACHE,
        );

        const tradeTokenAmount = new BN(20000);
        const tradeAmountSpecifiedIsInput = true;
        const tradeAToBOne = true;
        const tradeAToBTwo = true;
        const swapQuoteOne = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToBOne,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
              tradeAmountSpecifiedIsInput,
            ),
            sqrtPriceLimit: tradeAToBOne
              ? MIN_SQRT_PRICE_BN
              : MAX_SQRT_PRICE_BN,
            tickArrays: await SwapUtils.getTickArrays(
              poolOne.getData().tickCurrentIndex,
              poolOne.getData().tickSpacing,
              tradeAToBOne,
              testCtx.whirlpoolCtx.program.programId,
              poolOne.getAddress(),
              testCtx.whirlpoolCtx.fetcher,
              IGNORE_CACHE,
            ),
            tokenAmount: tradeTokenAmount,
            whirlpoolData: poolOne.getData(),
            tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
            adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
          },
          Percentage.fromFraction(0, 100),
        );

        const swapQuoteTwo = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToBOne,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
              tradeAmountSpecifiedIsInput,
            ),
            sqrtPriceLimit: tradeAToBOne
              ? MIN_SQRT_PRICE_BN
              : MAX_SQRT_PRICE_BN,
            tickArrays: await SwapUtils.getTickArrays(
              poolTwo.getData().tickCurrentIndex,
              poolTwo.getData().tickSpacing,
              tradeAToBTwo,
              testCtx.whirlpoolCtx.program.programId,
              poolTwo.getAddress(),
              testCtx.whirlpoolCtx.fetcher,
              IGNORE_CACHE,
            ),
            tokenAmount: swapQuoteOne.estimatedAmountOut,
            whirlpoolData: poolTwo.getData(),
            tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
            adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
          },
          Percentage.fromFraction(0, 100),
        );

        const twoHopSwapIx = WhirlpoolIx.twoHopSwapIx(
          testCtx.whirlpoolCtx.program,
          {
            amount: tradeTokenAmount,
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToBOne: tradeAToBOne,
            aToBTwo: tradeAToBTwo,
            oracleOne,
            oracleTwo,
            otherAmountThreshold: ZERO,
            sqrtPriceLimitOne: ZERO,
            sqrtPriceLimitTwo: ZERO,
            tickArrayOne0: swapQuoteOne.tickArray0,
            tickArrayOne1: swapQuoteOne.tickArray1,
            tickArrayOne2: swapQuoteOne.tickArray2,
            tickArrayTwo0: swapQuoteTwo.tickArray0,
            tickArrayTwo1: swapQuoteTwo.tickArray1,
            tickArrayTwo2: swapQuoteTwo.tickArray2,
            tokenAuthority: testCtx.provider.wallet.publicKey,
            tokenOwnerAccountOneA: tokenAccountIn,
            tokenOwnerAccountOneB: tokenAccountMid,
            tokenOwnerAccountTwoA: tokenAccountMid,
            tokenOwnerAccountTwoB: tokenAccountOut,
            tokenVaultOneA: poolOne.getData().tokenVaultA,
            tokenVaultOneB: poolOne.getData().tokenVaultB,
            tokenVaultTwoA: poolTwo.getData().tokenVaultA,
            tokenVaultTwoB: poolTwo.getData().tokenVaultB,
            whirlpoolOne,
            whirlpoolTwo,
          },
        ).instructions[0];

        // try to execute twoHopSwap ix on pools WITH adaptive fee WITHOUT isWritable flags on oracle accounts

        // oracle_one: readonly
        assert.equal(twoHopSwapIx.keys[18].pubkey, oracleOne);
        twoHopSwapIx.keys[18] = {
          pubkey: oracleOne,
          isSigner: false,
          isWritable: false,
        };
        // oracle_two: readonly
        assert.equal(twoHopSwapIx.keys[19].pubkey, oracleTwo);
        twoHopSwapIx.keys[19] = {
          pubkey: oracleTwo,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.equal(twoHopSwapIx.keys.length, 20);

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [twoHopSwapIx],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // oracle_one: writable
        assert.equal(twoHopSwapIx.keys[18].pubkey, oracleOne);
        twoHopSwapIx.keys[18] = {
          pubkey: oracleOne,
          isSigner: false,
          isWritable: true,
        };
        // oracle_two: readonly
        assert.equal(twoHopSwapIx.keys[19].pubkey, oracleTwo);
        twoHopSwapIx.keys[19] = {
          pubkey: oracleTwo,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.equal(twoHopSwapIx.keys.length, 20);

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [twoHopSwapIx],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // oracle_one: readonly
        assert.equal(twoHopSwapIx.keys[18].pubkey, oracleOne);
        twoHopSwapIx.keys[18] = {
          pubkey: oracleOne,
          isSigner: false,
          isWritable: false,
        };
        // oracle_two: writable
        assert.equal(twoHopSwapIx.keys[19].pubkey, oracleTwo);
        twoHopSwapIx.keys[19] = {
          pubkey: oracleTwo,
          isSigner: false,
          isWritable: true,
        };
        // no remaining accounts
        assert.equal(twoHopSwapIx.keys.length, 20);

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [twoHopSwapIx],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // now try with isWritable flags on oracle accounts (this is a hacky way)

        // oracle_one: writable
        assert.equal(twoHopSwapIx.keys[18].pubkey, oracleOne);
        twoHopSwapIx.keys[18] = {
          pubkey: oracleOne,
          isSigner: false,
          isWritable: true,
        };
        // oracle_two: writable
        assert.equal(twoHopSwapIx.keys[19].pubkey, oracleTwo);
        twoHopSwapIx.keys[19] = {
          pubkey: oracleTwo,
          isSigner: false,
          isWritable: true,
        };
        // no remaining accounts
        assert.equal(twoHopSwapIx.keys.length, 20);

        const preSqrtPriceOne = (await poolOne.refreshData()).sqrtPrice;
        const preSqrtPriceTwo = (await poolTwo.refreshData()).sqrtPrice;
        await toTx(testCtx.whirlpoolCtx, {
          instructions: [twoHopSwapIx],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute();
        const postSqrtPriceOne = (await poolOne.refreshData()).sqrtPrice;
        const postSqrtPriceTwo = (await poolTwo.refreshData()).sqrtPrice;
        assert.ok(!preSqrtPriceOne.eq(postSqrtPriceOne));
        assert.ok(!preSqrtPriceTwo.eq(postSqrtPriceTwo));
      });
    });

    describe("works on a pool with adaptive fee (AdaptiveFeeTier), add writable Oracle in remaining accounts (official way)", () => {
      it("swapV1", async () => {
        const poolInfo = await buildSwapTestPool(undefined, undefined);
        const whirlpool = await testCtx.whirlpoolClient.getPool(
          poolInfo.whirlpool,
          IGNORE_CACHE,
        );

        const tradeTokenAmount = new BN(20000);
        const quote = await swapQuoteByInputToken(
          whirlpool,
          poolInfo.mintA,
          tradeTokenAmount,
          Percentage.fromFraction(1, 100),
          testCtx.whirlpoolCtx.program.programId,
          testCtx.whirlpoolCtx.fetcher,
          IGNORE_CACHE,
        );

        const oracle = PDAUtil.getOracle(
          testCtx.whirlpoolCtx.program.programId,
          whirlpool.getAddress(),
        ).publicKey;

        const swapIx = WhirlpoolIx.swapIx(testCtx.whirlpoolCtx.program, {
          ...quote,
          whirlpool: whirlpool.getAddress(),
          oracle,
          tokenOwnerAccountA: poolInfo.tokenAccountA,
          tokenOwnerAccountB: poolInfo.tokenAccountB,
          tokenVaultA: whirlpool.getData().tokenVaultA,
          tokenVaultB: whirlpool.getData().tokenVaultB,
          tokenAuthority: testCtx.provider.wallet.publicKey,
        }).instructions[0];

        // try to execute swap ix on a pool WITH adaptive fee WITHOUT isWritable flag on oracle account

        // oracle: readonly
        assert.equal(swapIx.keys[10].pubkey, oracle);
        swapIx.keys[10] = {
          pubkey: oracle,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.equal(swapIx.keys.length, 11);

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [swapIx],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // now try with writable account in remaining accounts (this is an official way)

        // oracle: readonly
        assert.equal(swapIx.keys[10].pubkey, oracle);
        swapIx.keys[10] = { pubkey: oracle, isSigner: false, isWritable: true };
        // additional oracle: writable
        swapIx.keys.push({ pubkey: oracle, isSigner: false, isWritable: true });
        // 1 remaining accounts
        assert.equal(swapIx.keys.length, 12);

        const preSqrtPrice = (await whirlpool.refreshData()).sqrtPrice;
        await toTx(testCtx.whirlpoolCtx, {
          instructions: [swapIx],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute();
        const postSqrtPrice = (await whirlpool.refreshData()).sqrtPrice;
        assert.ok(!preSqrtPrice.eq(postSqrtPrice));
      });

      it("twoHopSwapV1", async () => {
        const {
          whirlpoolOne,
          whirlpoolTwo,
          oracleOne,
          oracleTwo,
          tokenAccountIn,
          tokenAccountMid,
          tokenAccountOut,
        } = await buildTwoHopSwapTestPools(
          undefined,
          undefined,
          PriceMath.tickIndexToSqrtPriceX64(0),
          PriceMath.tickIndexToSqrtPriceX64(0),
        );

        const poolOne = await testCtx.whirlpoolClient.getPool(
          whirlpoolOne,
          IGNORE_CACHE,
        );
        const poolTwo = await testCtx.whirlpoolClient.getPool(
          whirlpoolTwo,
          IGNORE_CACHE,
        );

        const tradeTokenAmount = new BN(20000);
        const tradeAmountSpecifiedIsInput = true;
        const tradeAToBOne = true;
        const tradeAToBTwo = true;
        const swapQuoteOne = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToBOne,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
              tradeAmountSpecifiedIsInput,
            ),
            sqrtPriceLimit: tradeAToBOne
              ? MIN_SQRT_PRICE_BN
              : MAX_SQRT_PRICE_BN,
            tickArrays: await SwapUtils.getTickArrays(
              poolOne.getData().tickCurrentIndex,
              poolOne.getData().tickSpacing,
              tradeAToBOne,
              testCtx.whirlpoolCtx.program.programId,
              poolOne.getAddress(),
              testCtx.whirlpoolCtx.fetcher,
              IGNORE_CACHE,
            ),
            tokenAmount: tradeTokenAmount,
            whirlpoolData: poolOne.getData(),
            tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
            adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
          },
          Percentage.fromFraction(0, 100),
        );

        const swapQuoteTwo = swapQuoteWithParams(
          {
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToB: tradeAToBOne,
            otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
              tradeAmountSpecifiedIsInput,
            ),
            sqrtPriceLimit: tradeAToBOne
              ? MIN_SQRT_PRICE_BN
              : MAX_SQRT_PRICE_BN,
            tickArrays: await SwapUtils.getTickArrays(
              poolTwo.getData().tickCurrentIndex,
              poolTwo.getData().tickSpacing,
              tradeAToBTwo,
              testCtx.whirlpoolCtx.program.programId,
              poolTwo.getAddress(),
              testCtx.whirlpoolCtx.fetcher,
              IGNORE_CACHE,
            ),
            tokenAmount: swapQuoteOne.estimatedAmountOut,
            whirlpoolData: poolTwo.getData(),
            tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
            adaptiveFeeInfo: NO_ADAPTIVE_FEE_INFO,
          },
          Percentage.fromFraction(0, 100),
        );

        const twoHopSwapIx = WhirlpoolIx.twoHopSwapIx(
          testCtx.whirlpoolCtx.program,
          {
            amount: tradeTokenAmount,
            amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
            aToBOne: tradeAToBOne,
            aToBTwo: tradeAToBTwo,
            oracleOne,
            oracleTwo,
            otherAmountThreshold: ZERO,
            sqrtPriceLimitOne: ZERO,
            sqrtPriceLimitTwo: ZERO,
            tickArrayOne0: swapQuoteOne.tickArray0,
            tickArrayOne1: swapQuoteOne.tickArray1,
            tickArrayOne2: swapQuoteOne.tickArray2,
            tickArrayTwo0: swapQuoteTwo.tickArray0,
            tickArrayTwo1: swapQuoteTwo.tickArray1,
            tickArrayTwo2: swapQuoteTwo.tickArray2,
            tokenAuthority: testCtx.provider.wallet.publicKey,
            tokenOwnerAccountOneA: tokenAccountIn,
            tokenOwnerAccountOneB: tokenAccountMid,
            tokenOwnerAccountTwoA: tokenAccountMid,
            tokenOwnerAccountTwoB: tokenAccountOut,
            tokenVaultOneA: poolOne.getData().tokenVaultA,
            tokenVaultOneB: poolOne.getData().tokenVaultB,
            tokenVaultTwoA: poolTwo.getData().tokenVaultA,
            tokenVaultTwoB: poolTwo.getData().tokenVaultB,
            whirlpoolOne,
            whirlpoolTwo,
          },
        ).instructions[0];

        // try to execute twoHopSwap ix on pools WITH adaptive fee WITHOUT isWritable flags on oracle accounts and WITHOUT writable oracle accounts in remaining accounts

        // oracle_one: readonly
        assert.equal(twoHopSwapIx.keys[18].pubkey, oracleOne);
        twoHopSwapIx.keys[18] = {
          pubkey: oracleOne,
          isSigner: false,
          isWritable: false,
        };
        // oracle_two: readonly
        assert.equal(twoHopSwapIx.keys[19].pubkey, oracleTwo);
        twoHopSwapIx.keys[19] = {
          pubkey: oracleTwo,
          isSigner: false,
          isWritable: false,
        };
        // no remaining accounts
        assert.equal(twoHopSwapIx.keys.length, 20);

        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [twoHopSwapIx],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // add writable oracle_one only
        const keysWithAdditionalOracleOneOnly = [
          ...twoHopSwapIx.keys,
          { pubkey: oracleOne, isSigner: false, isWritable: true },
        ];
        assert.equal(keysWithAdditionalOracleOneOnly.length, 20 + 1);
        const twoHopSwapIxWithAdditionalOracleOneOnly = {
          ...twoHopSwapIx,
          keys: keysWithAdditionalOracleOneOnly,
        };
        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [twoHopSwapIxWithAdditionalOracleOneOnly],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // add writable oracle_two only
        const keysWithAdditionalOracleTwoOnly = [
          ...twoHopSwapIx.keys,
          { pubkey: oracleTwo, isSigner: false, isWritable: true },
        ];
        assert.equal(keysWithAdditionalOracleTwoOnly.length, 20 + 1);
        const twoHopSwapIxWithAdditionalOracleTwoOnly = {
          ...twoHopSwapIx,
          keys: keysWithAdditionalOracleTwoOnly,
        };
        await assert.rejects(
          toTx(testCtx.whirlpoolCtx, {
            instructions: [twoHopSwapIxWithAdditionalOracleTwoOnly],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute(),
          /0xbbe/, // AccountNotMutable
        );

        // add both writable oracle_one and oracle_two
        const keysWithAdditionalOracleOneAndTwo = [
          ...twoHopSwapIx.keys,
          { pubkey: oracleOne, isSigner: false, isWritable: true },
          { pubkey: oracleTwo, isSigner: false, isWritable: true },
        ];
        assert.equal(keysWithAdditionalOracleOneAndTwo.length, 20 + 2);
        const twoHopSwapIxWithAdditionalOracleOneAndTwo = {
          ...twoHopSwapIx,
          keys: keysWithAdditionalOracleOneAndTwo,
        };

        const preSqrtPriceOne = (await poolOne.refreshData()).sqrtPrice;
        const preSqrtPriceTwo = (await poolTwo.refreshData()).sqrtPrice;
        await toTx(testCtx.whirlpoolCtx, {
          instructions: [twoHopSwapIxWithAdditionalOracleOneAndTwo],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute();
        const postSqrtPriceOne = (await poolOne.refreshData()).sqrtPrice;
        const postSqrtPriceTwo = (await poolTwo.refreshData()).sqrtPrice;
        assert.ok(!preSqrtPriceOne.eq(postSqrtPriceOne));
        assert.ok(!preSqrtPriceTwo.eq(postSqrtPriceTwo));
      });
    });
  });

  async function buildSwapTestPool(
    tradeEnableTimestamp: BN | undefined,
    initialSqrtPrice: BN | undefined,
  ) {
    const poolLiquidity = powBN(2, 24);
    const tickSpacing = 64;
    const feeTierIndex = 1024 + tickSpacing;
    const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
      testCtx.whirlpoolCtx,
      { isToken2022: false },
      { isToken2022: false },
      feeTierIndex,
      tickSpacing,
      undefined,
      initialSqrtPrice ?? PriceMath.tickIndexToSqrtPriceX64(0),
      getDefaultPresetAdaptiveFeeConstants(tickSpacing, tickSpacing, 1),
      provider.wallet.publicKey, // permissioned
      PublicKey.default,
    );

    const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
      ...poolInitInfo,
      tradeEnableTimestamp,
    };
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
        testCtx.whirlpoolCtx.program,
        modifiedPoolInitInfo,
      ),
    ).buildAndExecute();

    const oracleData = await testCtx.whirlpoolCtx.fetcher.getOracle(
      poolInitInfo.oraclePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(oracleData);

    // init TickArrays
    const pool = await testCtx.whirlpoolClient.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
    );
    await (await pool.initTickArrayForTicks(
      TickUtil.getFullRangeTickIndex(tickSpacing),
    ))!.buildAndExecute();
    const fullRange = TickUtil.getFullRangeTickIndex(
      pool.getData().tickSpacing,
    );

    // provide liquidity
    const mintA = poolInitInfo.tokenMintA;
    const mintB = poolInitInfo.tokenMintB;
    const tokenAccountA = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintA,
      U64_MAX,
    );
    const tokenAccountB = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintB,
      U64_MAX,
    );
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

    return {
      whirlpool: poolInitInfo.whirlpoolPda.publicKey,
      oracle: poolInitInfo.oraclePda.publicKey,
      mintA,
      mintB,
      tokenAccountA,
      tokenAccountB,
    };
  }

  async function buildTwoHopSwapTestPools(
    tradeEnableTimestampOne: BN | undefined,
    tradeEnableTimestampTwo: BN | undefined,
    initialSqrtPriceOne: BN | undefined,
    initialSqrtPriceTwo: BN | undefined,
  ) {
    const poolLiquidity = powBN(2, 24);

    // init config
    const authorityWhirlpoolsConfigKeypair = Keypair.generate();
    const configKeypair = Keypair.generate();
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializeConfigIx(testCtx.whirlpoolCtx.program, {
        collectProtocolFeesAuthority:
          authorityWhirlpoolsConfigKeypair.publicKey,
        feeAuthority: authorityWhirlpoolsConfigKeypair.publicKey,
        rewardEmissionsSuperAuthority:
          authorityWhirlpoolsConfigKeypair.publicKey,
        defaultProtocolFeeRate: 300,
        funder: provider.wallet.publicKey,
        whirlpoolsConfigKeypair: configKeypair,
      }),
    )
      .addSigner(configKeypair)
      .buildAndExecute();

    // init mints
    const mintX = await createMint(testCtx.provider);
    const mintY = await createMint(testCtx.provider);
    const mintZ = await createMint(testCtx.provider);
    const [mintIn, mintMid, mintOut] = AddressUtil.toPubKeys(
      [mintX, mintY, mintZ].sort((a, b) => PoolUtil.compareMints(a, b)),
    );
    const tokenAccountIn = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintIn,
      U64_MAX,
    );
    const tokenAccountMid = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintMid,
      U64_MAX,
    );
    const tokenAccountOut = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      mintOut,
      U64_MAX,
    );

    // init AdaptiveFeeTier
    const feeTierIndex = 1024 + 64;
    const tickSpacing = 64;
    const feeTierPda = PDAUtil.getFeeTier(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      feeTierIndex,
    );
    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializeAdaptiveFeeTierIx(testCtx.whirlpoolCtx.program, {
        whirlpoolsConfig: configKeypair.publicKey,
        defaultBaseFeeRate: 3000,
        feeTierIndex,
        tickSpacing,
        feeTierPda,
        funder: provider.wallet.publicKey,
        feeAuthority: authorityWhirlpoolsConfigKeypair.publicKey,
        initializePoolAuthority: provider.wallet.publicKey, // permissioned
        delegatedFeeAuthority: undefined,
        // AdaptiveFeeConstants
        presetFilterPeriod: 30,
        presetDecayPeriod: 600,
        presetReductionFactor: 500,
        presetAdaptiveFeeControlFactor: 4_000,
        presetMaxVolatilityAccumulator: 350_000,
        presetTickGroupSize: tickSpacing,
        presetMajorSwapThresholdTicks: 1,
      }),
    )
      .addSigner(authorityWhirlpoolsConfigKeypair)
      .buildAndExecute();

    // init whirlpool with AdaptiveFeeTier
    const whirlpoolPdaOne = PDAUtil.getWhirlpool(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintIn,
      mintMid,
      feeTierIndex,
    );
    const whirlpoolPdaTwo = PDAUtil.getWhirlpool(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintMid,
      mintOut,
      feeTierIndex,
    );

    const oraclePdaOne = PDAUtil.getOracle(
      testCtx.whirlpoolCtx.program.programId,
      whirlpoolPdaOne.publicKey,
    );
    const oraclePdaTwo = PDAUtil.getOracle(
      testCtx.whirlpoolCtx.program.programId,
      whirlpoolPdaTwo.publicKey,
    );

    const tokenBadgeInPda = PDAUtil.getTokenBadge(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintIn,
    );
    const tokenBadgeMidPda = PDAUtil.getTokenBadge(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintMid,
    );
    const tokenBadgeOutPda = PDAUtil.getTokenBadge(
      testCtx.whirlpoolCtx.program.programId,
      configKeypair.publicKey,
      mintOut,
    );

    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
        testCtx.whirlpoolCtx.program,
        {
          whirlpoolsConfig: configKeypair.publicKey,
          adaptiveFeeTierKey: feeTierPda.publicKey,
          whirlpoolPda: whirlpoolPdaOne,
          oraclePda: oraclePdaOne,
          funder: provider.wallet.publicKey,
          initializePoolAuthority: provider.wallet.publicKey,
          initSqrtPrice:
            initialSqrtPriceOne ?? PriceMath.tickIndexToSqrtPriceX64(0),
          tokenMintA: mintIn,
          tokenMintB: mintMid,
          tokenBadgeA: tokenBadgeInPda.publicKey,
          tokenBadgeB: tokenBadgeMidPda.publicKey,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
          tokenVaultAKeypair: Keypair.generate(),
          tokenVaultBKeypair: Keypair.generate(),
          tradeEnableTimestamp: tradeEnableTimestampOne,
        },
      ),
    ).buildAndExecute();

    await toTx(
      testCtx.whirlpoolCtx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
        testCtx.whirlpoolCtx.program,
        {
          whirlpoolsConfig: configKeypair.publicKey,
          adaptiveFeeTierKey: feeTierPda.publicKey,
          whirlpoolPda: whirlpoolPdaTwo,
          oraclePda: oraclePdaTwo,
          funder: provider.wallet.publicKey,
          initializePoolAuthority: provider.wallet.publicKey,
          initSqrtPrice:
            initialSqrtPriceTwo ?? PriceMath.tickIndexToSqrtPriceX64(0),
          tokenMintA: mintMid,
          tokenMintB: mintOut,
          tokenBadgeA: tokenBadgeMidPda.publicKey,
          tokenBadgeB: tokenBadgeOutPda.publicKey,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
          tokenVaultAKeypair: Keypair.generate(),
          tokenVaultBKeypair: Keypair.generate(),
          tradeEnableTimestamp: tradeEnableTimestampTwo,
        },
      ),
    ).buildAndExecute();

    // init TickArrays
    const fullRange = TickUtil.getFullRangeTickIndex(tickSpacing);
    const poolOne = await testCtx.whirlpoolClient.getPool(
      whirlpoolPdaOne.publicKey,
    );
    const poolTwo = await testCtx.whirlpoolClient.getPool(
      whirlpoolPdaTwo.publicKey,
    );
    await (await poolOne.initTickArrayForTicks(fullRange))!.buildAndExecute();
    await (await poolTwo.initTickArrayForTicks(fullRange))!.buildAndExecute();

    // provide liquidity
    const depositQuoteOne = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: poolLiquidity,
      slippageTolerance: Percentage.fromFraction(0, 100),
      sqrtPrice: poolOne.getData().sqrtPrice,
      tickCurrentIndex: poolOne.getData().tickCurrentIndex,
      tickLowerIndex: fullRange[0],
      tickUpperIndex: fullRange[1],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });
    const depositQuoteTwo = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: poolLiquidity,
      slippageTolerance: Percentage.fromFraction(0, 100),
      sqrtPrice: poolTwo.getData().sqrtPrice,
      tickCurrentIndex: poolTwo.getData().tickCurrentIndex,
      tickLowerIndex: fullRange[0],
      tickUpperIndex: fullRange[1],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });

    const txAndMintOne = await poolOne.openPosition(
      fullRange[0],
      fullRange[1],
      depositQuoteOne,
    );
    await txAndMintOne.tx.buildAndExecute();
    const txAndMintTwo = await poolTwo.openPosition(
      fullRange[0],
      fullRange[1],
      depositQuoteTwo,
    );
    await txAndMintTwo.tx.buildAndExecute();

    return {
      whirlpoolOne: whirlpoolPdaOne.publicKey,
      whirlpoolTwo: whirlpoolPdaTwo.publicKey,
      oracleOne: oraclePdaOne.publicKey,
      oracleTwo: oraclePdaTwo.publicKey,
      tokenAccountIn,
      tokenAccountMid,
      tokenAccountOut,
    };
  }
});

function powBN(base: number, exp: number): BN {
  return new BN(base).pow(new BN(exp));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function debug(msg: string) {
  if (!DEBUG_OUTPUT) return;
  console.debug(msg);
}
