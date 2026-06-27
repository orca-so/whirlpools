import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { AccountWithTokenProgram } from "@orca-so/common-sdk";
import { AddressUtil, Percentage, U64_MAX, ZERO } from "@orca-so/common-sdk";
import type {
  AccountInfo,
  Keypair,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  VersionedTransaction,
} from "@solana/web3.js";
import { PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import type {
  AdaptiveFeeVariablesData,
  InitPoolWithAdaptiveFeeParams,
  WhirlpoolClient,
  WhirlpoolData,
} from "../../../src";
import { AccountName, getAccountSize, OracleData } from "../../../src";
import {
  TICK_ARRAY_SIZE,
  MAX_SQRT_PRICE_BN,
  MIN_SQRT_PRICE_BN,
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
  WHIRLPOOL_IDL,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  warpClock,
  getCurrentTimestamp,
  initializeLiteSVMEnvironment,
  pollForCondition,
} from "../../utils/litesvm";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import {
  createAndMintToAssociatedTokenAccount,
  createMint,
  getLocalnetAdminKeypair0,
  getProviderWalletKeypair,
} from "../../utils";
import { PoolUtil } from "../../../dist/utils/public/pool-utils";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  buildTestPoolV2Params,
  buildTestPoolWithAdaptiveFeeParams,
} from "../../utils/v2/init-utils-v2";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import type { FundedPositionParams } from "../../utils/init-utils";
import {
  buildTestAquariums,
  getDefaultAquarium,
  getTokenAccsForPools,
  useMaxCU,
} from "../../utils/init-utils";
import type { WhirlpoolsError } from "../../../src/errors/errors";
import { SwapErrorCode } from "../../../src/errors/errors";
import { TransactionBuilder } from "@orca-so/common-sdk/dist/web3/transactions/transactions-builder";
import { ParsableWhirlpool } from "../../../dist/network/public/parsing";
import { convertIdlToCamelCase } from "@coral-xyz/anchor/dist/cjs/idl";
import {
  assertPostWritableAccountMatch,
  getWhirlpoolStateSequence,
  parsePreparedSwap,
  parsePrepareSwapV2ReturnData,
  PREPARED_SWAP_LAYOUT_VERSION,
  PREPARED_SWAP_STATE_COMMITTED,
  PREPARED_SWAP_STATE_PREPARED,
  SimulatedTransactionAccessor,
  simulateTransaction,
} from "../../utils/prepare-commit-test-utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

const DEBUG_OUTPUT = false;

describe("prepare/commit swap tests", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let testCtx: SharedTestContext;
  let admin: Keypair;
  const priceDeviation = Percentage.fromFraction(1, 10_000);

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    program = env.program;
    anchor.setProvider(provider);
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    admin = await getLocalnetAdminKeypair0(whirlpoolCtx);
    testCtx = {
      provider,
      whirlpoolCtx,
      whirlpoolClient,
    };
  });

  describe("prepare/commit swap", () => {
    it("normal", async () => {
      const poolInfo = await buildSwapTestPool(false); // non-AF
      const pool = await testCtx.whirlpoolClient.getPool(
        poolInfo.whirlpool,
        IGNORE_CACHE,
      );

      const stateSequence = getWhirlpoolStateSequence(pool.getData());

      const tradeTokenAmount = new BN(5000000);
      const tradeAmountSpecifiedIsInput = true;
      const tradeAToB = true;
      const tradeSqrtPriceLimit = tradeAToB
        ? MIN_SQRT_PRICE_BN
        : MAX_SQRT_PRICE_BN;
      const swapQuote = swapQuoteWithParams(
        {
          amountSpecifiedIsInput: tradeAmountSpecifiedIsInput,
          aToB: tradeAToB,
          otherAmountThreshold: SwapUtils.getDefaultOtherAmountThreshold(
            tradeAmountSpecifiedIsInput,
          ),
          sqrtPriceLimit: tradeSqrtPriceLimit,
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
          oracleData: await SwapUtils.getOracle(
            testCtx.whirlpoolCtx.program.programId,
            pool.getAddress(),
            testCtx.whirlpoolCtx.fetcher,
            IGNORE_CACHE,
          ),
        },
        Percentage.fromFraction(0, 100),
      );

      //console.log("state sequence", stateSequence);
      //console.log("amount", swapQuote.estimatedAmountIn.toString(), "-->", swapQuote.estimatedAmountOut.toString());
      //console.log("tick", pool.getData().tickCurrentIndex, "-->", swapQuote.estimatedEndTickIndex);

      const preparedSwapPda = PDAUtil.getPreparedSwap(
        testCtx.whirlpoolCtx.program.programId,
        0,
      );
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.initializePreparedSwapIx(testCtx.whirlpoolCtx.program, {
          funder: testCtx.whirlpoolCtx.wallet.publicKey,
          nonce: 0,
          preparedSwapPda,
        }),
      ).buildAndExecute();

      const swapIx = WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
        ...swapQuote,
        whirlpool: poolInfo.whirlpool,
        tokenOwnerAccountA: poolInfo.tokenAccountA,
        tokenOwnerAccountB: poolInfo.tokenAccountB,
        tokenVaultA: pool.getData().tokenVaultA,
        tokenVaultB: pool.getData().tokenVaultB,
        tokenAuthority: testCtx.provider.wallet.publicKey,
        tokenMintA: poolInfo.mintA,
        tokenMintB: poolInfo.mintB,
        tokenProgramA: poolInfo.tokenProgramA,
        tokenProgramB: poolInfo.tokenProgramB,
        oracle: poolInfo.oracle,
      });

      const prepareIx = WhirlpoolIx.prepareSwapV2Ix(
        testCtx.whirlpoolCtx.program,
        {
          ...swapQuote,
          preparedSwap: preparedSwapPda.publicKey,
          whirlpool: poolInfo.whirlpool,
          tokenAuthority: testCtx.provider.wallet.publicKey,
          tokenMintA: poolInfo.mintA,
          tokenMintB: poolInfo.mintB,
          oracle: poolInfo.oracle,
        },
      );

      const commitIx = WhirlpoolIx.commitSwapV2Ix(
        testCtx.whirlpoolCtx.program,
        {
          ...swapQuote,
          preparedSwap: preparedSwapPda.publicKey,
          whirlpool: poolInfo.whirlpool,
          tokenOwnerAccountA: poolInfo.tokenAccountA,
          tokenOwnerAccountB: poolInfo.tokenAccountB,
          tokenVaultA: pool.getData().tokenVaultA,
          tokenVaultB: pool.getData().tokenVaultB,
          tokenAuthority: testCtx.provider.wallet.publicKey,
          tokenMintA: poolInfo.mintA,
          tokenMintB: poolInfo.mintB,
          tokenProgramA: poolInfo.tokenProgramA,
          tokenProgramB: poolInfo.tokenProgramB,
          oracle: poolInfo.oracle,
        },
      );

      const swapV2TransactionBuilder = newTransactionBuilder();
      swapV2TransactionBuilder.addInstructions([swapIx]);

      const prepareSwapTransactionBuilder = newTransactionBuilder();
      prepareSwapTransactionBuilder.addInstructions([prepareIx]);

      const prepareAndCommitSwapTransactionBuilder = newTransactionBuilder();
      prepareAndCommitSwapTransactionBuilder.addInstructions([
        prepareIx,
        commitIx,
      ]);

      // check prepareSwapV2
      const prepareSimResult = await simulateTransaction(
        testCtx.provider,
        prepareSwapTransactionBuilder,
      );

      const prepareSwapV2ReturnData = parsePrepareSwapV2ReturnData(
        prepareSimResult.returnData().data,
      );
      assert.ok(
        !!prepareSwapV2ReturnData && "quoteSuccess" in prepareSwapV2ReturnData,
      );
      const onChainSwapQuote = prepareSwapV2ReturnData.quoteSuccess;
      assert.ok(onChainSwapQuote.amount.eq(swapQuote.estimatedAmountIn));
      assert.ok(onChainSwapQuote.otherAmount.eq(swapQuote.estimatedAmountOut));
      assert.ok(
        onChainSwapQuote.nextSqrtPrice.eq(swapQuote.estimatedEndSqrtPrice),
      );
      assert.ok(
        onChainSwapQuote.nextTickIndex === swapQuote.estimatedEndTickIndex,
      );

      const preparedSwapData = parsePreparedSwap(
        prepareSimResult.postWritableAccount(preparedSwapPda.publicKey),
      );
      assert.ok(!!preparedSwapData);
      assert.ok(preparedSwapData.version === PREPARED_SWAP_LAYOUT_VERSION);
      assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
      assert.ok(
        preparedSwapData.precondition.slot.toNumber() ===
          prepareSimResult.slot(),
      );
      assert.ok(
        preparedSwapData.precondition.authority.equals(
          testCtx.provider.wallet.publicKey,
        ),
      );
      assert.ok(
        preparedSwapData.precondition.whirlpool.equals(poolInfo.whirlpool),
      );
      assert.ok(
        preparedSwapData.precondition.whirlpoolStateSequence === stateSequence,
      );
      assert.ok(preparedSwapData.precondition.amount.eq(tradeTokenAmount));
      assert.ok(
        preparedSwapData.precondition.sqrtPriceLimit.eq(tradeSqrtPriceLimit),
      );
      assert.ok(
        preparedSwapData.precondition.amountSpecifiedIsInput ===
          tradeAmountSpecifiedIsInput,
      );
      assert.ok(preparedSwapData.precondition.aToB === tradeAToB);

      // Note: all initializable ticks have been initialized.
      assert.ok(
        pool.getData().tickCurrentIndex === 2848 &&
          swapQuote.estimatedEndTickIndex == -2780,
      );
      const numCrossedInitializableTicks =
        Math.floor(2848 / 64) + 1 + Math.floor(2780 / 64);
      assert.equal(
        preparedSwapData.pendingUpdates.pendingTickUpdatesLen,
        numCrossedInitializableTicks,
      );

      // check commitSwapV2
      const prepareAndCommitSimResult = await simulateTransaction(
        testCtx.provider,
        prepareAndCommitSwapTransactionBuilder,
      );
      const swapV2SimResult = await simulateTransaction(
        testCtx.provider,
        swapV2TransactionBuilder,
      );

      const preparedSwapDataAfterCommit = parsePreparedSwap(
        prepareAndCommitSimResult.postWritableAccount(
          preparedSwapPda.publicKey,
        ),
      );
      assert.ok(!!preparedSwapDataAfterCommit);
      assert.ok(
        preparedSwapDataAfterCommit.version === PREPARED_SWAP_LAYOUT_VERSION,
      );
      assert.ok(
        preparedSwapDataAfterCommit.state === PREPARED_SWAP_STATE_COMMITTED,
      );

      // vs. swapV2 account check
      // whirlpool
      const prepareCommitWhirlpoolAccount =
        prepareAndCommitSimResult.postWritableAccount(poolInfo.whirlpool)!;
      const whirlpoolData = ParsableWhirlpool.parse(
        poolInfo.whirlpool,
        prepareCommitWhirlpoolAccount,
      );
      assert.ok(!!whirlpoolData);
      assert.ok(whirlpoolData.sqrtPrice.eq(swapQuote.estimatedEndSqrtPrice));
      assert.ok(
        whirlpoolData.tickCurrentIndex === swapQuote.estimatedEndTickIndex,
      );
      assert.ok(getWhirlpoolStateSequence(whirlpoolData) === stateSequence + 1);
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        poolInfo.whirlpool,
        getAccountSize(AccountName.Whirlpool),
      );

      // tickarray
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        swapQuote.tickArray0,
        getAccountSize(AccountName.DynamicTickArray),
      );
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        swapQuote.tickArray1,
        getAccountSize(AccountName.DynamicTickArray),
      );
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        swapQuote.tickArray2,
        getAccountSize(AccountName.DynamicTickArray),
      );

      // token accounts
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        poolInfo.tokenAccountA,
        ACCOUNT_SIZE,
      );
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        poolInfo.tokenAccountB,
        ACCOUNT_SIZE,
      );
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        pool.getData().tokenVaultA,
        ACCOUNT_SIZE,
      );
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        pool.getData().tokenVaultB,
        ACCOUNT_SIZE,
      );

      // CU check
      const prepareCommitCU = prepareAndCommitSimResult.unitsConsumed();
      const swapV2CU = swapV2SimResult.unitsConsumed();

      assert.ok(prepareCommitCU > swapV2CU && swapV2CU > 0);
      const overheadPercent =
        Math.floor(((prepareCommitCU - swapV2CU) / swapV2CU) * 10000) / 100;
      assert.ok(overheadPercent < 20); // <20% overhead
      console.info(
        `swapV2 CU: ${swapV2CU} / prepare & commit CU: ${prepareCommitCU} (overhead: ${overheadPercent}%)`,
      );
    });
  });

  function newTransactionBuilder() {
    //
    return (
      new TransactionBuilder(
        testCtx.provider.connection,
        testCtx.provider.wallet,
      )
        // `simulateTransaction` returns the return data from the last program executed in the transaction.
        // To ensure the desired return data is preserved, we place the Compute Budget program instruction at the beginning rather than the end.
        .addInstruction(useMaxCU())
    );
  }

  async function buildSwapTestPoolForLongestTraverse() {
    buildSwapTestPool(false, PriceMath.tickIndexToSqrtPriceX64(64 * 88 - 32));
  }

  async function buildSwapTestPool(
    withAdaptiveFee: boolean = false,
    initialSqrtPrice: BN = PriceMath.tickIndexToSqrtPriceX64(64 * 44 + 32),
    tradeEnableTimestamp?: BN,
  ) {
    // initialized pool layout
    // [ TAfull      ]...[ TAn3      ][ TAn2      ][ TAn1      ][ TA0    p  ][ TAp1      ][ TAp2      ][ TAp3      ]...[ TAfull      ]
    // - The initial price(p) is on TA0.
    // - 2 TickArrays for Full-range liquidity
    // - 3 TickArrays on the both side will be initialized.
    // - Liquidity is concentrated around the initial price and decays by 0.5% for each tick spacing away from the center.

    const poolFlatLiquidity = powBN(2, 22);
    const poolConcentratedLiquidity = powBN(2, 24);
    const tickSpacing = 64;
    const baseFeeRate = 3000; // 0.3%

    let whirlpoolAddress: PublicKey;
    let tokenMintAAddress: PublicKey;
    let tokenMintBAddress: PublicKey;
    if (withAdaptiveFee) {
      const feeTierIndex = 1024 + tickSpacing;
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        testCtx.whirlpoolCtx,
        { isToken2022: false },
        { isToken2022: false },
        feeTierIndex,
        tickSpacing,
        baseFeeRate,
        initialSqrtPrice,
        getDefaultPresetAdaptiveFeeConstants(
          tickSpacing,
          tickSpacing,
          tickSpacing,
        ),
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

      whirlpoolAddress = poolInitInfo.whirlpoolPda.publicKey;
      tokenMintAAddress = poolInitInfo.tokenMintA;
      tokenMintBAddress = poolInitInfo.tokenMintB;
    } else {
      // tradeEnableTime is available only when AdaptiveFee is enabled
      assert.ok(tradeEnableTimestamp === undefined);

      const { poolInitInfo } = await buildTestPoolV2Params(
        testCtx.whirlpoolCtx,
        { isToken2022: false },
        { isToken2022: false },
        tickSpacing,
        baseFeeRate,
        initialSqrtPrice,
      );

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.initializePoolV2Ix(
          testCtx.whirlpoolCtx.program,
          poolInitInfo,
        ),
      ).buildAndExecute();

      whirlpoolAddress = poolInitInfo.whirlpoolPda.publicKey;
      tokenMintAAddress = poolInitInfo.tokenMintA;
      tokenMintBAddress = poolInitInfo.tokenMintB;
    }

    // init TickArrays
    const pool = await testCtx.whirlpoolClient.getPool(whirlpoolAddress);
    const poolData = pool.getData();

    await (await pool.initTickArrayForTicks(
      TickUtil.getFullRangeTickIndex(tickSpacing),
      undefined,
      undefined,
      "dynamic",
    ))!.buildAndExecute();

    const offsets = [-3, -2, -1, 0, 1, 2, 3];
    const tickArrayStartIndexes = offsets.map((offset) =>
      TickUtil.getStartTickIndex(
        poolData.tickCurrentIndex,
        tickSpacing,
        offset,
      ),
    );
    await (await pool.initTickArrayForTicks(
      tickArrayStartIndexes,
      undefined,
      undefined,
      "dynamic",
    ))!.buildAndExecute();

    const leftMostInitializableTickIndex = tickArrayStartIndexes[0];
    const rightMostInitializableTickIndex =
      tickArrayStartIndexes[6] + tickSpacing * (TICK_ARRAY_SIZE - 1);
    const currentInitializableTickIndex =
      Math.floor(poolData.tickCurrentIndex / tickSpacing) * tickSpacing;

    // provide liquidity
    const tokenAccountA = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      tokenMintAAddress,
      U64_MAX,
    );
    const tokenAccountB = await createAndMintToAssociatedTokenAccount(
      testCtx.provider,
      tokenMintBAddress,
      U64_MAX,
    );

    // full range liquidity
    const fullRange = TickUtil.getFullRangeTickIndex(
      pool.getData().tickSpacing,
    );
    const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: poolFlatLiquidity,
      slippageTolerance: Percentage.fromFraction(0, 100),
      sqrtPrice: poolData.sqrtPrice,
      tickCurrentIndex: poolData.tickCurrentIndex,
      tickLowerIndex: fullRange[0],
      tickUpperIndex: fullRange[1],
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });
    const txAndMint = await pool.openPosition(fullRange[0], fullRange[1], {
      ...depositQuote,
      minSqrtPrice: poolData.sqrtPrice,
      maxSqrtPrice: poolData.sqrtPrice,
    });
    await txAndMint.tx.buildAndExecute();

    // concentrated liquidity
    let liquidity;
    function nextLiquidity(l: BN): BN {
      return l.muln(995).divn(1000);
    }

    // b to a (left to right)
    liquidity = poolConcentratedLiquidity;
    for (
      let tickLowerIndex = currentInitializableTickIndex;
      tickLowerIndex < rightMostInitializableTickIndex;
      tickLowerIndex += tickSpacing, liquidity = nextLiquidity(liquidity)
    ) {
      const tickUpperIndex = tickLowerIndex + tickSpacing;

      const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity,
        slippageTolerance: Percentage.fromFraction(0, 100),
        sqrtPrice: poolData.sqrtPrice,
        tickCurrentIndex: poolData.tickCurrentIndex,
        tickLowerIndex,
        tickUpperIndex,
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      });
      const txAndMint = await pool.openPosition(
        tickLowerIndex,
        tickUpperIndex,
        {
          ...depositQuote,
          minSqrtPrice: poolData.sqrtPrice,
          maxSqrtPrice: poolData.sqrtPrice,
        },
      );
      await txAndMint.tx.buildAndExecute();
    }

    // a to b (right to left)
    liquidity = poolConcentratedLiquidity;
    for (
      let tickUpperIndex = currentInitializableTickIndex;
      tickUpperIndex > leftMostInitializableTickIndex;
      tickUpperIndex -= tickSpacing, liquidity = nextLiquidity(liquidity)
    ) {
      const tickLowerIndex = tickUpperIndex - tickSpacing;

      const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity,
        slippageTolerance: Percentage.fromFraction(0, 100),
        sqrtPrice: poolData.sqrtPrice,
        tickCurrentIndex: poolData.tickCurrentIndex,
        tickLowerIndex,
        tickUpperIndex,
        tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      });
      const txAndMint = await pool.openPosition(
        tickLowerIndex,
        tickUpperIndex,
        {
          ...depositQuote,
          minSqrtPrice: poolData.sqrtPrice,
          maxSqrtPrice: poolData.sqrtPrice,
        },
      );
      await txAndMint.tx.buildAndExecute();
    }

    const oraclePda = PDAUtil.getOracle(
      testCtx.whirlpoolCtx.program.programId,
      whirlpoolAddress,
    );
    return {
      whirlpool: whirlpoolAddress,
      oracle: oraclePda.publicKey,
      mintA: tokenMintAAddress,
      mintB: tokenMintBAddress,
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_PROGRAM_ID,
      tokenAccountA,
      tokenAccountB,
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
