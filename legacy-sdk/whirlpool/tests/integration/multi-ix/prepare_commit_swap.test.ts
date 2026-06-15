import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { AccountWithTokenProgram } from "@orca-so/common-sdk";
import { AddressUtil, Percentage, U64_MAX, ZERO } from "@orca-so/common-sdk";
import { AccountInfo, Keypair, PublicKey, RpcResponseAndContext, SimulatedTransactionResponse, Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import {
  AccountName,
  AdaptiveFeeVariablesData,
  InitPoolWithAdaptiveFeeParams,
  OracleData,
  WhirlpoolClient,
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
} from "../../utils/litesvm";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import {
  createAndMintToAssociatedTokenAccount,
  createMint,
  getLocalnetAdminKeypair0,
  getProviderWalletKeypair,
} from "../../utils";
import { PoolUtil } from "../../../dist/utils/public/pool-utils";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { buildTestPoolV2Params, buildTestPoolWithAdaptiveFeeParams } from "../../utils/v2/init-utils-v2";
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
    it("test", async () => {
      const poolInfo = await buildSwapTestPool(false); // non-AF
      const pool = await testCtx.whirlpoolClient.getPool(
        poolInfo.whirlpool,
        IGNORE_CACHE,
      );

      const tradeTokenAmount = new BN(5000000);
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
          oracleData: await SwapUtils.getOracle(
            testCtx.whirlpoolCtx.program.programId,
            pool.getAddress(),
            testCtx.whirlpoolCtx.fetcher,
            IGNORE_CACHE,
          ),
        },
        Percentage.fromFraction(0, 100),
      );

      console.log("amount", swapQuote.estimatedAmountIn.toString(), "-->", swapQuote.estimatedAmountOut.toString());
      console.log("tick", pool.getData().tickCurrentIndex, "-->", swapQuote.estimatedEndTickIndex);
/*
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.swapV2Ix(testCtx.whirlpoolCtx.program, {
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
        }),
      )
      .addInstruction(useMaxCU())
      .buildAndExecute();

      const postWhirlpool = await pool.refreshData();
      console.log("post tick", postWhirlpool.tickCurrentIndex);
      console.log("post sqrt price", postWhirlpool.sqrtPrice.toString(), "expect", swapQuote.estimatedEndSqrtPrice.toString());
*/

      const preparedSwapPda = PDAUtil.getPreparedSwap(testCtx.whirlpoolCtx.program.programId, 0);
      await toTx(
        testCtx.whirlpoolCtx,
        WhirlpoolIx.initializePreparedSwapIx(testCtx.whirlpoolCtx.program, {
          funder: testCtx.whirlpoolCtx.wallet.publicKey,
          nonce: 0,
          preparedSwapPda,
        })
      )
      .buildAndExecute();

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

      const prepareIx = WhirlpoolIx.prepareSwapV2Ix(testCtx.whirlpoolCtx.program, {
        ...swapQuote,
        preparedSwap: preparedSwapPda.publicKey,
        whirlpool: poolInfo.whirlpool,
        //tokenOwnerAccountA: poolInfo.tokenAccountA,
        //tokenOwnerAccountB: poolInfo.tokenAccountB,
        //tokenVaultA: pool.getData().tokenVaultA,
        //tokenVaultB: pool.getData().tokenVaultB,
        tokenAuthority: testCtx.provider.wallet.publicKey,
        tokenMintA: poolInfo.mintA,
        tokenMintB: poolInfo.mintB,
        //tokenProgramA: poolInfo.tokenProgramA,
        //tokenProgramB: poolInfo.tokenProgramB,
        oracle: poolInfo.oracle,
      });

      const commitIx = WhirlpoolIx.commitSwapV2Ix(testCtx.whirlpoolCtx.program, {
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
      });

      const swapTransactionBuilder = newTransactionBuilder();
      swapTransactionBuilder.addInstructions([swapIx]);

      const prepareSwapTransactionBuilder = newTransactionBuilder();
      prepareSwapTransactionBuilder.addInstructions([prepareIx]);

      const prepareAndCommitSwapTransactionBuilder = newTransactionBuilder();
      prepareAndCommitSwapTransactionBuilder.addInstructions([prepareIx, commitIx]);

      const simResult1 = await simulateTransaction(swapTransactionBuilder);
      console.log("simResult1", simResult1);

      const simResult2 = await simulateTransaction(prepareSwapTransactionBuilder);
      console.log("simResult2", simResult2);

      console.log("simResult2 compute units", simResult2.unitsConsumed());
      console.log("simResult2 return data", simResult2.returnData());

      const prepareSwapV2ReturnData = parsePrepareSwapV2ReturnData(simResult2.returnData().data);
      console.log("simResult2 return data (parsed)", prepareSwapV2ReturnData);

      const preparedSwapData = parsePreparedSwap(simResult2.postWritableAccount(preparedSwapPda.publicKey));
      console.log("simResult2 prepared swap (parsed)", preparedSwapData);

      const simResult3 = await simulateTransaction(prepareAndCommitSwapTransactionBuilder);
      console.log("simResult3", simResult3);
    });
  });

  /*
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
              oracleData: await SwapUtils.getOracle(
                testCtx.whirlpoolCtx.program.programId,
                pool.getAddress(),
                testCtx.whirlpoolCtx.fetcher,
                IGNORE_CACHE,
              ),
            },
            Percentage.fromFraction(0, 100),
          );

          assert.ok(swapQuote.estimatedFeeRateMin === pool.getData().feeRate);
          assert.ok(swapQuote.estimatedFeeRateMax > pool.getData().feeRate);

          const swapParams = SwapUtils.getSwapParamsFromQuote(
            swapQuote,
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

          const preTokenAccountIn =
            (await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
              swapQuote.aToB ? poolInfo.tokenAccountA : poolInfo.tokenAccountB,
              IGNORE_CACHE,
            )) as AccountWithTokenProgram;
          const preTokenAccountOut =
            (await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
              swapQuote.aToB ? poolInfo.tokenAccountB : poolInfo.tokenAccountA,
              IGNORE_CACHE,
            )) as AccountWithTokenProgram;

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
          const postOracle = (await pollForCondition(
            async () =>
              (await testCtx.whirlpoolCtx.fetcher.getOracle(
                poolInfo.oracle,
                IGNORE_CACHE,
              )) as OracleData,
            (o) =>
              o.adaptiveFeeVariables.lastReferenceUpdateTimestamp.gtn(0) &&
              o.adaptiveFeeVariables.lastReferenceUpdateTimestamp
                .sub(new BN(getCurrentTimestamp()))
                .abs()
                .lten(10),
            { maxRetries: 50, delayMs: 10 },
          )) as OracleData;

          const postVars = postOracle.adaptiveFeeVariables;
          const currentSystemTimestamp = new BN(getCurrentTimestamp());
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

          const postTokenAccountIn =
            (await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
              swapQuote.aToB ? poolInfo.tokenAccountA : poolInfo.tokenAccountB,
              IGNORE_CACHE,
            )) as AccountWithTokenProgram;
          const postTokenAccountOut =
            (await testCtx.whirlpoolCtx.fetcher.getTokenInfo(
              swapQuote.aToB ? poolInfo.tokenAccountB : poolInfo.tokenAccountA,
              IGNORE_CACHE,
            )) as AccountWithTokenProgram;
          assert.ok(
            postTokenAccountIn.amount ===
              preTokenAccountIn.amount -
                BigInt(swapQuote.estimatedAmountIn.toString()),
          );
          assert.ok(
            postTokenAccountOut.amount ===
              preTokenAccountOut.amount +
                BigInt(swapQuote.estimatedAmountOut.toString()),
          );
        });
      }
    });
  });
*/
  function newTransactionBuilder() {
    // 
    return new TransactionBuilder(testCtx.provider.connection, testCtx.provider.wallet)
      // `simulateTransaction` returns the return data from the last program executed in the transaction.
      // To ensure the desired return data is preserved, we place the Compute Budget program instruction at the beginning rather than the end.
      .addInstruction(useMaxCU());
  }

  async function simulateTransaction(tb: TransactionBuilder) {
    const tx = await tb.build();
    const vtx = tx.transaction as VersionedTransaction;
    vtx.sign([getProviderWalletKeypair(testCtx.provider)]);
    return new SimulatedTransactionAccessor(await testCtx.provider.connection.simulateTransaction(vtx));
  }

  async function buildSwapTestPoolForLongestTraverse() {
    buildSwapTestPool(false, PriceMath.tickIndexToSqrtPriceX64(64 * 88 - 32))
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
        getDefaultPresetAdaptiveFeeConstants(tickSpacing, tickSpacing, tickSpacing),
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
    const pool = await testCtx.whirlpoolClient.getPool(
      whirlpoolAddress,
    );
    const poolData = pool.getData();

    await (await pool.initTickArrayForTicks(
      TickUtil.getFullRangeTickIndex(tickSpacing),
    ))!.buildAndExecute();

    const offsets = [-3, -2, -1, 0, 1, 2, 3];
    const tickArrayStartIndexes = offsets.map((offset) => TickUtil.getStartTickIndex(poolData.tickCurrentIndex, tickSpacing, offset));
    await (await pool.initTickArrayForTicks(tickArrayStartIndexes))!.buildAndExecute();

    const leftMostInitializableTickIndex = tickArrayStartIndexes[0];
    const rightMostInitializableTickIndex = tickArrayStartIndexes[6] + tickSpacing * (TICK_ARRAY_SIZE - 1);
    const currentInitializableTickIndex = Math.floor(poolData.tickCurrentIndex / tickSpacing) * tickSpacing;

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
      return l.muln(995).divn(1000)
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
      const txAndMint = await pool.openPosition(tickLowerIndex, tickUpperIndex, {
        ...depositQuote,
        minSqrtPrice: poolData.sqrtPrice,
        maxSqrtPrice: poolData.sqrtPrice,
      });
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
      const txAndMint = await pool.openPosition(tickLowerIndex, tickUpperIndex, {
        ...depositQuote,
        minSqrtPrice: poolData.sqrtPrice,
        maxSqrtPrice: poolData.sqrtPrice,
      });
      await txAndMint.tx.buildAndExecute();
    }

    const oraclePda = PDAUtil.getOracle(testCtx.whirlpoolCtx.program.programId, whirlpoolAddress);
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

type ReturnData = {
  programId: PublicKey,
  data: Buffer,
}
class SimulatedTransactionAccessor {
  constructor(private simResult: RpcResponseAndContext<SimulatedTransactionResponse>) {}

  unitsConsumed(): number {
    return this.simResult.value.unitsConsumed!
  }

  returnData(): ReturnData {
    const programId = new PublicKey(this.simResult.value.returnData!.programId);
    const data = Buffer.from(this.simResult.value.returnData!.data[0], "base64");
    return { programId, data };
  }

  postWritableAccount(pubkey: PublicKey): AccountInfo<Buffer> | null {
    for (let account of this.simResult.value.accounts!) {
      // HACK: liteSVM based simulation only
      const accountPubkey = (account as any)["_pubkey"] as PublicKey;

      if (pubkey.equals(accountPubkey)) {
        return {
          executable: account!.executable,
          lamports: account!.lamports,
          owner: new PublicKey(account!.owner),
          data: Buffer.from(account!.data[0], "base64"),
        };
      }
    }
    return null;
  }
}

const WhirlpoolCoder = new anchor.BorshCoder(convertIdlToCamelCase(WHIRLPOOL_IDL));

function parseAnchorAccount(
  accountName: AccountName,
  accountData: AccountInfo<Buffer>,
) {
  const data = accountData.data;
  const discriminator = WhirlpoolCoder.accounts.accountDiscriminator(accountName);
  if (discriminator.compare(data.subarray(0, 8))) {
    console.error("incorrect account name during parsing");
    return null;
  }

  try {
    return WhirlpoolCoder.accounts.decode(accountName, data);
  } catch (_e) {
    console.error("unknown account name during parsing");
    return null;
  }
}

const MAX_PENDING_TICK_UPDATES_LEN = TICK_ARRAY_SIZE * 3;
type InternalPreparedSwapData = {
  version: number,
  state: number,
  precondition: {
    slot: BN,
    authority: PublicKey,
    whirlpool: PublicKey,
    whirlpoolStateVersion: number,
    amount: BN,
    sqrtPriceLimit: BN,
    amountSpecifiedIsInput: boolean,
    aToB: boolean,
  },
  pendingWhirlpoolUpdate: {
    amountA: BN,
    amountB: BN,
    lpFee: BN,
    nextLiquidity: BN,
    nextTickIndex: number,
    nextSqrtPrice: BN,
    nextFeeGrowthGlobal: BN,
    nextRewardGrowthGlobal: [BN, BN, BN],
    nextProtocolFee: BN,
  },
  pendingOracleUpdate: {
    nextAdaptiveFeeVariablesIsSome: boolean,
    nextAdaptiveFeeVariables: AdaptiveFeeVariablesData,
  },
  pendingTickUpdatesLen: number,
  pendingTickUpdates: {
    arrayIndex: number,
    tickIndex: number,
    nextFeeGrowthOutsideA: BN,
    nextFeeGrowthOutsideB: BN,
  }[],
};

function parsePreparedSwap(
    accountData: AccountInfo<Buffer> | undefined | null,
): InternalPreparedSwapData | null {
  if (!accountData?.data) {
    return null;
  }

  try {
    return parseAnchorAccount(AccountName.PreparedSwap, accountData);
  } catch (e) {
    console.error(`error while parsing PreparedSwap: ${e}`);
    return null;
  }
}

type PrepareSwapV2ReturnData = PrepareSwapV2ReturnDataQuoteSuccess | PrepareSwapV2ReturnDataQuoteError;
type PrepareSwapV2ReturnDataQuoteSuccess = {
  quoteSuccess: {
    amount: BN,
    otherAmount: BN,
    nextSqrtPrice: BN,
    nextTickIndex: number,
  },
};
type PrepareSwapV2ReturnDataQuoteError = {
  quoteError: {
    errorCode: BN;
  },
};

function parsePrepareSwapV2ReturnData(
  returnData: Buffer
): PrepareSwapV2ReturnData | null {
  try {
    return WhirlpoolCoder.types.decode("prepareSwapV2ReturnData", returnData);
  } catch (e) {
    console.error("failed during parsing:", e);
    return null;
  }
}
