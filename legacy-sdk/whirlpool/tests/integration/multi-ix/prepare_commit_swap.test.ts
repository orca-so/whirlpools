import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { AccountWithTokenProgram } from "@orca-so/common-sdk";
import { AddressUtil, Percentage, U64_MAX, ZERO } from "@orca-so/common-sdk";
import {
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
  CommitSwapV2Params,
  InitPoolWithAdaptiveFeeParams,
  SwapV2Params,
  WhirlpoolClient,
  WhirlpoolData,
} from "../../../src";
import {
  AccountName,
  getAccountSize,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  NO_ORACLE_DATA,
  OracleData,
} from "../../../src";
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
  setComputeUnitLimit,
} from "../../utils/litesvm";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import {
  createAndMintToAssociatedTokenAccount,
  createMint,
  getLocalnetAdminKeypair0,
  getProviderWalletKeypair,
  MAX_U64,
  mintToDestination,
  ZERO_BN,
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
  initTestPoolWithTokens,
  useCU,
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
  verifyPrepareAndCommitSwapV2Equivalence,
} from "../../utils/prepare-commit-test-utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

const DEBUG_OUTPUT = false;

const MAX_COMPUTE_UNIT_FOR_TEST = 10_000_000;

describe("prepare/commit swap tests", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let testCtx: SharedTestContext;

  let poolInfoNonAF: SwapTestPoolInfo;
  let poolInfoAF: SwapTestPoolInfo;
  let poolInfoLongestTraverse: SwapTestPoolInfo;
  let preparedSwap: PublicKey;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();

    // unlimit compute unit limit for the test.
    // We need to test 88*3 pending tick updates for the prepare/commit swap test, which exceeds the default compute unit limit of 1.4M.
    setComputeUnitLimit(BigInt(MAX_COMPUTE_UNIT_FOR_TEST));

    provider = env.provider;
    program = env.program;
    anchor.setProvider(provider);
    const whirlpoolCtx = WhirlpoolContext.fromWorkspace(provider, program);
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);

    testCtx = {
      provider,
      whirlpoolCtx,
      whirlpoolClient,
    };

    poolInfoNonAF = await buildSwapTestPool(false);
    poolInfoAF = await buildSwapTestPool(true);
    poolInfoLongestTraverse = await buildSwapTestPoolForLongestTraverse();

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
    preparedSwap = preparedSwapPda.publicKey;
  }, 30 * 1000 /* 30s: This beforeAll hook takes a long time to execute (~15s + buffer) */);

  describe("prepare/commit swap", () => {
    async function tryPrepareCommitSwap(tryParams: {
      poolInfo: SwapTestPoolInfo;
      tradeTokenAmount: BN;
      tradeAmountSpecifiedIsInput: boolean;
      tradeAToB: boolean;
      tradeSqrtPriceLimit?: BN;
      expectedInitialTickCurrentIndex: number;
      expectedEstimatedEndTickIndex: number;
      expectedNumCrossedInitializableTicks: number;
      allowPartialFill?: boolean;
    }) {
      const {
        poolInfo,
        tradeTokenAmount,
        tradeAmountSpecifiedIsInput,
        tradeAToB,
        tradeSqrtPriceLimit = SwapUtils.getDefaultSqrtPriceLimit(
          tryParams.tradeAToB,
        ),
        expectedInitialTickCurrentIndex,
        expectedEstimatedEndTickIndex,
        expectedNumCrossedInitializableTicks,
        allowPartialFill = false,
      } = tryParams;

      const pool = await testCtx.whirlpoolClient.getPool(
        poolInfo.whirlpool,
        IGNORE_CACHE,
      );

      const stateSequence = getWhirlpoolStateSequence(pool.getData());

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

      console.log("state sequence", stateSequence);
      console.log(
        "amount",
        swapQuote.estimatedAmountIn.toString(),
        "-->",
        swapQuote.estimatedAmountOut.toString(),
      );
      console.log(
        "tick",
        pool.getData().tickCurrentIndex,
        "-->",
        swapQuote.estimatedEndTickIndex,
      );

      const params: CommitSwapV2Params & SwapV2Params = {
        ...swapQuote,
        preparedSwap,
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
      };

      const swapIx = WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, params);
      const prepareIx = WhirlpoolIx.prepareSwapV2Ix(
        testCtx.whirlpoolCtx.program,
        params,
      );
      const commitIx = WhirlpoolIx.commitSwapV2Ix(
        testCtx.whirlpoolCtx.program,
        params,
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
      if (tradeAmountSpecifiedIsInput) {
        assert.ok(onChainSwapQuote.amount.eq(swapQuote.estimatedAmountIn));
        assert.ok(
          onChainSwapQuote.otherAmount.eq(swapQuote.estimatedAmountOut),
        );
      } else {
        assert.ok(onChainSwapQuote.amount.eq(swapQuote.estimatedAmountOut));
        assert.ok(onChainSwapQuote.otherAmount.eq(swapQuote.estimatedAmountIn));
      }
      if (!allowPartialFill) {
        assert.ok(onChainSwapQuote.amount.eq(tradeTokenAmount));
      }

      assert.ok(
        onChainSwapQuote.nextSqrtPrice.eq(swapQuote.estimatedEndSqrtPrice),
      );
      assert.ok(
        onChainSwapQuote.nextTickIndex === swapQuote.estimatedEndTickIndex,
      );

      const preparedSwapData = parsePreparedSwap(
        prepareSimResult.postWritableAccount(preparedSwap),
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

      // check tick index change / pending tick updates
      assert.equal(
        pool.getData().tickCurrentIndex,
        expectedInitialTickCurrentIndex,
      );
      assert.equal(
        swapQuote.estimatedEndTickIndex,
        expectedEstimatedEndTickIndex,
      );
      assert.equal(
        preparedSwapData.pendingUpdates.pendingTickUpdatesLen,
        expectedNumCrossedInitializableTicks,
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

      assert.ok(prepareAndCommitSimResult.isSuccessful());
      assert.ok(swapV2SimResult.isSuccessful());

      const preparedSwapDataAfterCommit = parsePreparedSwap(
        prepareAndCommitSimResult.postWritableAccount(preparedSwap),
      );
      assert.ok(!!preparedSwapDataAfterCommit);
      assert.equal(
        preparedSwapDataAfterCommit.version,
        PREPARED_SWAP_LAYOUT_VERSION,
      );
      assert.equal(
        preparedSwapDataAfterCommit.state,
        PREPARED_SWAP_STATE_COMMITTED,
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
      assert.equal(
        whirlpoolData.tickCurrentIndex,
        swapQuote.estimatedEndTickIndex,
      );
      assert.equal(getWhirlpoolStateSequence(whirlpoolData), stateSequence + 1);
      assertPostWritableAccountMatch(
        prepareAndCommitSimResult,
        swapV2SimResult,
        poolInfo.whirlpool,
        getAccountSize(AccountName.Whirlpool),
      );

      // tickarray
      const tickArrays = [
        swapQuote.tickArray0,
        swapQuote.tickArray1,
        swapQuote.tickArray2,
      ];
      for (const tickArray of tickArrays) {
        const tickArrayAccountInfo =
          await testCtx.whirlpoolCtx.connection.getAccountInfo(tickArray);
        if (!tickArrayAccountInfo) continue;

        assert.ok(tickArrayAccountInfo.data.length > 0);
        assertPostWritableAccountMatch(
          prepareAndCommitSimResult,
          swapV2SimResult,
          tickArray,
          tickArrayAccountInfo.data.length,
        );
      }

      // oracle
      if (PoolUtil.isInitializedWithAdaptiveFee(whirlpoolData)) {
        assertPostWritableAccountMatch(
          prepareAndCommitSimResult,
          swapV2SimResult,
          poolInfo.oracle,
          getAccountSize(AccountName.Oracle),
        );
      }

      // token accounts
      const tokenAccounts = [
        poolInfo.tokenAccountA,
        poolInfo.tokenAccountB,
        pool.getData().tokenVaultA,
        pool.getData().tokenVaultB,
      ];
      for (const tokenAccount of tokenAccounts) {
        assertPostWritableAccountMatch(
          prepareAndCommitSimResult,
          swapV2SimResult,
          tokenAccount,
          ACCOUNT_SIZE,
        );
      }

      // CU check
      const prepareCommitCU = prepareAndCommitSimResult.unitsConsumed();
      const swapV2CU = swapV2SimResult.unitsConsumed();

      assert.ok(prepareCommitCU > swapV2CU && swapV2CU > 0);
      const overheadPercent =
        Math.floor(((prepareCommitCU - swapV2CU) / swapV2CU) * 10000) / 100;
      //assert.ok(overheadPercent < 20); // <20% overhead
      console.info(
        `swapV2 CU: ${swapV2CU} / prepare & commit CU: ${prepareCommitCU} (overhead: ${overheadPercent}%)`,
      );
    }

    describe("successfully execute prepare / commit swap on non-AF pool", () => {
      it("ExactIn, tick: 2848 -> -8614 (A to B), pending tick updates: 179", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -8614;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 179);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(10000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> -2780 (A to B), pending tick updates: 88", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -2780;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 88);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2793 (A to B), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2793;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2842 (A to B), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2842;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2848 (A to B), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2848;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(1), // 1u64 will be consumed as fee
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 11438 (B to A), pending tick updates: 134", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 11438;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 134);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(10000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 7069 (B to A), pending tick updates: 66", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 7069;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 66);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2889 (B to A), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2889;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2852 (B to A), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2852;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2848 (B to A), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2848;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(1), // 1u64 will be consumed as fee
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> -8771 (A to B), pending tick updates: 182", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -8771;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 182);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(8000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> -2656 (A to B), pending tick updates: 86", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -2656;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 86);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2806 (A to B), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2806;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2843 (A to B), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2843;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 14483 (B to A), pending tick updates: 182", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 14483;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 182);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(6000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 11282 (B to A), pending tick updates: 132", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 11282;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 132);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2903 (B to A), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2903;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2853 (B to A), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2853;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });
    });

    describe("successfully execute prepare / commit swap on AF pool", () => {
      it("ExactIn, tick: 2848 -> -7583 (A to B), pending tick updates: 163", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -7583;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 163);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(10000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> -2327 (A to B), pending tick updates: 81", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -2327;
        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 81);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2793 (A to B), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2793;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2842 (A to B), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2842;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2848 (A to B), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2848;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(1), // 1u64 will be consumed as fee
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 14678 (B to A), pending tick updates: 185", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 14678;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 185);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(15000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 6757 (B to A), pending tick updates: 61", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 6757;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 61);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2889 (B to A), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2889;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2852 (B to A), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2852;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 2848 -> 2848 (B to A), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2848;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(1), // 1u64 will be consumed as fee
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> -8771 (A to B), pending tick updates: 182", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -8771;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 182);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(8000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> -2656 (A to B), pending tick updates: 86", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = -2656;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedInitialTickCurrentIndex / 64) +
          1 +
          Math.floor(Math.abs(expectedEstimatedEndTickIndex) / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 86);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2806 (A to B), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2806;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2843 (A to B), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2843;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: true,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 14483 (B to A), pending tick updates: 182", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 14483;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 182);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoNonAF,
          tradeTokenAmount: new BN(6000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 11282 (B to A), pending tick updates: 132", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 11282;

        const expectedNumCrossedInitializableTicks =
          Math.floor(expectedEstimatedEndTickIndex / 64) -
          Math.floor(expectedInitialTickCurrentIndex / 64);
        assert.equal(expectedNumCrossedInitializableTicks, 132);

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2903 (B to A), pending tick updates: 1", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2903;
        const expectedNumCrossedInitializableTicks = 1;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(50000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactOut, tick: 2848 -> 2853 (B to A), pending tick updates: 0", async () => {
        const expectedInitialTickCurrentIndex = 2848;
        const expectedEstimatedEndTickIndex = 2853;
        const expectedNumCrossedInitializableTicks = 0;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoAF,
          tradeTokenAmount: new BN(5000),
          tradeAmountSpecifiedIsInput: false,
          tradeAToB: false,
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });
    });

    describe("longest traverse prepare / commit swap", () => {
      it("ExactIn, tick: 5600 -> -11264 (A to B), pending tick updates: 264(88 x 3)", async () => {
        const expectedInitialTickCurrentIndex = 5600;
        const expectedEstimatedEndTickIndex = -11264 - 1; // -1 shift
        const expectedNumCrossedInitializableTicks = 88 * 3;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoLongestTraverse,
          tradeTokenAmount: MAX_U64,
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: true,
          tradeSqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(-11264),
          allowPartialFill: true, // allow partial fill for this test
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });

      it("ExactIn, tick: 5600 -> 22464 (B to A), pending tick updates: 264(88 x 3)", async () => {
        const expectedInitialTickCurrentIndex = 5600;
        const expectedEstimatedEndTickIndex = 22464;
        const expectedNumCrossedInitializableTicks = 88 * 3;

        await tryPrepareCommitSwap({
          poolInfo: poolInfoLongestTraverse,
          tradeTokenAmount: MAX_U64,
          tradeAmountSpecifiedIsInput: true,
          tradeAToB: false,
          tradeSqrtPriceLimit: PriceMath.tickIndexToSqrtPriceX64(
            expectedEstimatedEndTickIndex,
          ),
          allowPartialFill: true, // allow partial fill for this test
          expectedInitialTickCurrentIndex,
          expectedEstimatedEndTickIndex,
          expectedNumCrossedInitializableTicks,
        });
      });
    });

    describe("prepare / commit swap on splash pool", () => {
      type TestVariation = {
        figure: string;
        poolTickSpacing: number;
        poolInitialTickIndex: number;
        poolLiquidity: BN;
        tradeMode: "exactIn" | "exactOut";
        tradeDirection: "AtoB" | "BtoA";
        tradeTokenAmount: BN;
        expectedPartialFill: boolean;
        expectedEstimatedEndTickIndex: number;
        expectedNumCrossedInitializableTicks: number;
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
          expectedEstimatedEndTickIndex: -259476,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: 62897,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: 443636,
          expectedNumCrossedInitializableTicks: 2,
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
          expectedEstimatedEndTickIndex: 259475,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: -62898,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: -443637, // -1 shift
          expectedNumCrossedInitializableTicks: 2,
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
          expectedEstimatedEndTickIndex: 13833,
          expectedNumCrossedInitializableTicks: 0,
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
          expectedEstimatedEndTickIndex: -13834,
          expectedNumCrossedInitializableTicks: 0,
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
          expectedEstimatedEndTickIndex: -259476,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: 62897,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: 443636,
          expectedNumCrossedInitializableTicks: 2,
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
          expectedEstimatedEndTickIndex: 259475,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: -62898,
          expectedNumCrossedInitializableTicks: 1,
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
          expectedEstimatedEndTickIndex: -443637, // -1 shift
          expectedNumCrossedInitializableTicks: 2,
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
          expectedEstimatedEndTickIndex: 13833,
          expectedNumCrossedInitializableTicks: 0,
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
          expectedEstimatedEndTickIndex: -13834,
          expectedNumCrossedInitializableTicks: 0,
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
            expectedPartialFill,
            expectedEstimatedEndTickIndex,
            expectedNumCrossedInitializableTicks,
          } = variation;
          const tradeAmountSpecifiedIsInput = tradeMode === "exactIn";
          const tradeAToB = tradeDirection === "AtoB";

          const { whirlpoolPda, tokenAccountA, tokenAccountB, configKeypairs } =
            await initTestPoolWithTokens(
              testCtx.whirlpoolCtx,
              poolTickSpacing,
              PriceMath.tickIndexToSqrtPriceX64(poolInitialTickIndex),
              MAX_U64,
            );

          const pool = await testCtx.whirlpoolClient.getPool(
            whirlpoolPda.publicKey,
          );
          const poolData = pool.getData();
          const priceDeviation = Percentage.fromFraction(1, 10_000);
          const { lowerBound, upperBound } =
            PriceMath.getSlippageBoundForSqrtPrice(
              poolData.sqrtPrice,
              priceDeviation,
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
            sqrtPrice: poolData.sqrtPrice,
            tickCurrentIndex: poolData.tickCurrentIndex,
            tickLowerIndex: fullRange[0],
            tickUpperIndex: fullRange[1],
            tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
          });
          const txAndMint = await pool.openPosition(
            fullRange[0],
            fullRange[1],
            {
              ...depositQuote,
              minSqrtPrice: lowerBound[0],
              maxSqrtPrice: upperBound[0],
            },
          );
          await txAndMint.tx.buildAndExecute();
          await pool.refreshData(); // reflect new liquidity

          debug(
            `pool state: tick = ${pool.getData().tickCurrentIndex}, liquidity = ${depositQuote.liquidityAmount.toString()}, tokenA = ${depositQuote.tokenEstA.toString()}, tokenB = ${depositQuote.tokenEstB.toString()}`,
          );

          const poolInfo: SwapTestPoolInfo = {
            tokenProgramA: TOKEN_PROGRAM_ID,
            tokenProgramB: TOKEN_PROGRAM_ID,
            whirlpool: whirlpoolPda.publicKey,
            tokenAccountA,
            tokenAccountB,
            mintA: poolData.tokenMintA,
            mintB: poolData.tokenMintB,
            oracle: PDAUtil.getOracle(
              testCtx.whirlpoolCtx.program.programId,
              whirlpoolPda.publicKey,
            ).publicKey,
            rewardAuthorityKeypair:
              configKeypairs.rewardEmissionsSuperAuthorityKeypair,
          };

          const expectedInitialTickCurrentIndex = poolInitialTickIndex;

          await tryPrepareCommitSwap({
            poolInfo,
            tradeTokenAmount,
            tradeAmountSpecifiedIsInput,
            tradeAToB,
            expectedInitialTickCurrentIndex,
            expectedEstimatedEndTickIndex,
            expectedNumCrossedInitializableTicks,
            allowPartialFill: expectedPartialFill,
          });
        });
      });
    });

    it(
      "long run with reward distribution",
      async () => {
        const poolInfo = await buildSwapTestPool(false);

        // initialize 3 reward
        const rewardMints = await Promise.all([
          createMint(testCtx.provider, testCtx.provider.wallet.publicKey),
          createMint(testCtx.provider, testCtx.provider.wallet.publicKey),
          createMint(testCtx.provider, testCtx.provider.wallet.publicKey),
        ]);
        for (let i = 0; i < rewardMints.length; i++) {
          const rewardVaultKeypair = Keypair.generate();
          const emissionsPerSecondX64 = new BN(1_000_000 * (i + 1)).shln(64); // 1M * (i + 1) tokens per second

          await toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.initializeRewardIx(testCtx.whirlpoolCtx.program, {
              funder: testCtx.provider.wallet.publicKey,
              whirlpool: poolInfo.whirlpool,
              rewardAuthority: poolInfo.rewardAuthorityKeypair.publicKey,
              rewardIndex: i,
              rewardMint: rewardMints[i],
              rewardVaultKeypair,
            }),
          )
            .addSigner(poolInfo.rewardAuthorityKeypair)
            .buildAndExecute();

          await mintToDestination(
            testCtx.provider,
            rewardMints[i],
            rewardVaultKeypair.publicKey,
            U64_MAX,
          );

          await toTx(
            testCtx.whirlpoolCtx,
            WhirlpoolIx.setRewardEmissionsIx(testCtx.whirlpoolCtx.program, {
              whirlpool: poolInfo.whirlpool,
              rewardIndex: i,
              rewardAuthority: poolInfo.rewardAuthorityKeypair.publicKey,
              rewardVaultKey: rewardVaultKeypair.publicKey,
              emissionsPerSecondX64,
            }),
          )
            .addSigner(poolInfo.rewardAuthorityKeypair)
            .buildAndExecute();
        }

        const tickSpacing = 64;
        const tickUpperBound = tickSpacing * TICK_ARRAY_SIZE * 3 - 32; // 16864
        const tickLowerBound = -tickUpperBound; // -16864
        let tickCurrentIndex =
          tickSpacing * (TICK_ARRAY_SIZE / 2) + tickSpacing / 2; // 2848

        assert.equal(tickUpperBound, 16864);
        assert.equal(tickLowerBound, -16864);
        assert.equal(tickCurrentIndex, 2848);

        const initialPoolState = await testCtx.whirlpoolCtx.fetcher.getPool(
          poolInfo.whirlpool,
          IGNORE_CACHE,
        );
        assert.ok(initialPoolState);

        assert.equal(initialPoolState.tickCurrentIndex, tickCurrentIndex);
        assert.ok(
          initialPoolState.rewardInfos.every(
            (r) => !r.emissionsPerSecondX64.isZero(),
          ),
        );
        assert.ok(
          initialPoolState.rewardInfos.every((r) => r.growthGlobalX64.isZero()),
        );

        const randBlockTimeDelta = () => Math.floor(Math.random() * 21); // return 0, 1, 2, ..., or 20;
        const randTickIndexDelta = () => Math.floor(Math.random() * 5) + 1; // return 1, 2, 3, 4 or 5;

        const baseParams = {
          preparedSwap,
          whirlpool: poolInfo.whirlpool,
          tokenOwnerAccountA: poolInfo.tokenAccountA,
          tokenOwnerAccountB: poolInfo.tokenAccountB,
          tokenVaultA: initialPoolState.tokenVaultA,
          tokenVaultB: initialPoolState.tokenVaultB,
          tokenAuthority: testCtx.provider.wallet.publicKey,
          tokenMintA: poolInfo.mintA,
          tokenMintB: poolInfo.mintB,
          tokenProgramA: poolInfo.tokenProgramA,
          tokenProgramB: poolInfo.tokenProgramB,
          oracle: poolInfo.oracle,
        };

        const NUM_ITERATION = 10;
        const tickCurrentIndexHistory = [];
        for (let iteration = 0; iteration < NUM_ITERATION; iteration++) {
          // left to right
          while (tickCurrentIndex < tickUpperBound) {
            warpClock(randBlockTimeDelta()); // accrue rewards

            const state = (await testCtx.whirlpoolCtx.fetcher.getPool(
              poolInfo.whirlpool,
              IGNORE_CACHE,
            )) as WhirlpoolData;
            assert.equal(state.tickCurrentIndex, tickCurrentIndex);
            tickCurrentIndexHistory.push(tickCurrentIndex);

            const delta = tickSpacing * randTickIndexDelta();
            const tickNextIndex = tickCurrentIndex + delta;
            console.log(
              "trying",
              tickCurrentIndex,
              "->",
              tickNextIndex,
              `delta: ${delta}`,
            );

            const aToB = false;
            const quote = swapQuoteWithParams(
              {
                amountSpecifiedIsInput: true,
                aToB,
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit:
                  PriceMath.tickIndexToSqrtPriceX64(tickNextIndex),
                tickArrays: await SwapUtils.getTickArrays(
                  state.tickCurrentIndex,
                  state.tickSpacing,
                  aToB,
                  testCtx.whirlpoolCtx.program.programId,
                  poolInfo.whirlpool,
                  testCtx.whirlpoolCtx.fetcher,
                  IGNORE_CACHE,
                ),
                tokenAmount: U64_MAX, // partial-fill
                whirlpoolData: state,
                tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
                oracleData: null, // non-AF pool
              },
              Percentage.fromFraction(0, 100),
            );

            const params = { ...baseParams, ...quote };
            await verifyPrepareAndCommitSwapV2Equivalence(
              testCtx.whirlpoolCtx,
              params,
              quote,
            );

            await toTx(
              testCtx.whirlpoolCtx,
              WhirlpoolIx.prepareSwapV2Ix(testCtx.whirlpoolCtx.program, params),
            )
              .addInstruction(
                WhirlpoolIx.commitSwapV2Ix(
                  testCtx.whirlpoolCtx.program,
                  params,
                ),
              )
              .buildAndExecute();

            tickCurrentIndex = tickNextIndex;
          }

          // right to left
          while (tickCurrentIndex > tickLowerBound) {
            warpClock(randBlockTimeDelta()); // accrue rewards

            const state = (await testCtx.whirlpoolCtx.fetcher.getPool(
              poolInfo.whirlpool,
              IGNORE_CACHE,
            )) as WhirlpoolData;
            assert.equal(state.tickCurrentIndex, tickCurrentIndex);
            tickCurrentIndexHistory.push(tickCurrentIndex);

            const delta = tickSpacing * randTickIndexDelta();
            const tickNextIndex = tickCurrentIndex - delta;
            console.log(
              "trying",
              tickNextIndex,
              "<-",
              tickCurrentIndex,
              `delta: ${delta}`,
            );

            const aToB = true;
            const quote = swapQuoteWithParams(
              {
                amountSpecifiedIsInput: true,
                aToB,
                otherAmountThreshold: ZERO_BN,
                sqrtPriceLimit:
                  PriceMath.tickIndexToSqrtPriceX64(tickNextIndex),
                tickArrays: await SwapUtils.getTickArrays(
                  state.tickCurrentIndex,
                  state.tickSpacing,
                  aToB,
                  testCtx.whirlpoolCtx.program.programId,
                  poolInfo.whirlpool,
                  testCtx.whirlpoolCtx.fetcher,
                  IGNORE_CACHE,
                ),
                tokenAmount: U64_MAX, // partial-fill
                whirlpoolData: state,
                tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
                oracleData: null, // non-AF pool
              },
              Percentage.fromFraction(0, 100),
            );

            const params = { ...baseParams, ...quote };
            await verifyPrepareAndCommitSwapV2Equivalence(
              testCtx.whirlpoolCtx,
              params,
              quote,
            );

            await toTx(
              testCtx.whirlpoolCtx,
              WhirlpoolIx.prepareSwapV2Ix(testCtx.whirlpoolCtx.program, params),
            )
              .addInstruction(
                WhirlpoolIx.commitSwapV2Ix(
                  testCtx.whirlpoolCtx.program,
                  params,
                ),
              )
              .buildAndExecute();

            tickCurrentIndex = tickNextIndex;
          }
        }

        console.info("tickCurrentIndex hist", tickCurrentIndexHistory);

        const lastPoolState = await testCtx.whirlpoolCtx.fetcher.getPool(
          poolInfo.whirlpool,
          IGNORE_CACHE,
        );
        assert.ok(lastPoolState);
        assert.ok(
          lastPoolState.rewardInfos.every((r) => !r.growthGlobalX64.isZero()),
        );

        console.info(
          "reward growth",
          lastPoolState.rewardInfos.map((r, i) => r.growthGlobalX64.toString()),
        );

        const traversedTickArrayStartIndexes = [
          -16896, -11264, -5632, 0, 5632, 11264,
        ];
        const tickArrayAddresses = traversedTickArrayStartIndexes.map(
          (startTick) =>
            PDAUtil.getTickArray(
              testCtx.whirlpoolCtx.program.programId,
              poolInfo.whirlpool,
              startTick,
            ).publicKey,
        );
        const tickArrays =
          await testCtx.whirlpoolCtx.fetcher.getTickArrays(tickArrayAddresses);
        for (const tickArray of tickArrays) {
          assert.ok(tickArray);

          const nonZeroGrowthTicks = tickArray.ticks.filter((tick) => {
            return tick.rewardGrowthsOutside.every((g) => !g.isZero());
          });

          assert.ok(nonZeroGrowthTicks.length > TICK_ARRAY_SIZE * 0.8); // we use rand, but 0.8 should be safe.
        }
      },
      { timeout: 120 * 1000 /* 120s */ },
    );
  });

  function newTransactionBuilder() {
    return (
      new TransactionBuilder(
        testCtx.provider.connection,
        testCtx.provider.wallet,
      )
        // `simulateTransaction` returns the return data from the last program executed in the transaction.
        // To ensure the desired return data is preserved, we place the Compute Budget program instruction at the beginning rather than the end.
        .addInstruction(useCU(MAX_COMPUTE_UNIT_FOR_TEST))
    );
  }

  async function buildSwapTestPoolForLongestTraverse() {
    return buildSwapTestPool(
      false,
      PriceMath.tickIndexToSqrtPriceX64(64 * 88 - 32),
    );
  }

  async function buildSwapTestPool(
    withAdaptiveFee: boolean = false,
    initialSqrtPrice: BN = PriceMath.tickIndexToSqrtPriceX64(64 * 44 + 32),
    fullRangeLiquidity: boolean = true,
    concentratedLiquidity: boolean = true,
  ): Promise<SwapTestPoolInfo> {
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
    let rewardAuthorityKeypair: Keypair;
    if (withAdaptiveFee) {
      const feeTierIndex = 1024 + tickSpacing;
      const { poolInitInfo, configKeypairs } =
        await buildTestPoolWithAdaptiveFeeParams(
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

      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
          testCtx.whirlpoolCtx.program,
          poolInitInfo,
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
      rewardAuthorityKeypair =
        configKeypairs.rewardEmissionsSuperAuthorityKeypair;
    } else {
      const { poolInitInfo, configKeypairs } = await buildTestPoolV2Params(
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
      rewardAuthorityKeypair =
        configKeypairs.rewardEmissionsSuperAuthorityKeypair;
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
    if (fullRangeLiquidity) {
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
    }

    // concentrated liquidity
    if (concentratedLiquidity) {
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
      rewardAuthorityKeypair,
    };
  }
});

function powBN(base: number, exp: number): BN {
  return new BN(base).pow(new BN(exp));
}

function debug(msg: string) {
  if (!DEBUG_OUTPUT) return;
  console.debug(msg);
}

type SwapTestPoolInfo = {
  whirlpool: PublicKey;
  oracle: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
  tokenAccountA: PublicKey;
  tokenAccountB: PublicKey;
  rewardAuthorityKeypair: Keypair;
};
