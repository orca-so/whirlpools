import * as anchor from "@coral-xyz/anchor";
import { DecimalUtil, Percentage, U64_MAX } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { AccountMeta, PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import type {
  SwapQuote,
  TwoHopSwapV2Params,
  WhirlpoolClient,
  WhirlpoolData,
} from "../../../src";
import {
  MAX_SQRT_PRICE,
  MEMO_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE,
  MIN_SQRT_PRICE_BN,
  PDAUtil,
  PriceMath,
  SwapUtils,
  TickUtil,
  WhirlpoolIx,
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputToken,
  swapQuoteByInputToken,
  swapQuoteByOutputToken,
  swapQuoteWithParams,
  toTx,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { defaultConfirmOptions } from "../../utils/const";
import {
  buildTestAquariums,
  getDefaultAquarium,
  initTestPoolWithTokens,
} from "../../utils/init-utils";
import { NO_TOKEN_EXTENSION_CONTEXT } from "../../../src/utils/public/token-extension-util";
import { buildTickArrayData } from "../../utils/testDataTypes";
import type { SwapV2Params } from "../../../src/instructions";
import {
  RemainingAccountsBuilder,
  RemainingAccountsType,
} from "../../../src/utils/remaining-accounts-util";
import { getTokenBalance } from "../../utils";

interface SharedTestContext {
  provider: anchor.AnchorProvider;
  whirlpoolCtx: WhirlpoolContext;
  whirlpoolClient: WhirlpoolClient;
}

describe("splash pool tests", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

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

  // TODO: add u64 related test cases when we update the math logic

  const tickSpacingSplash128 = 32768 + 128;

  async function getTokenBalances(tokenAccountA: PublicKey, tokenAccountB: PublicKey): Promise<[BN, BN]> {
    const tokenVaultA = new anchor.BN(
      await getTokenBalance(
        provider,
        tokenAccountA,
      ),
    );
    const tokenVaultB = new anchor.BN(
      await getTokenBalance(
        provider,
        tokenAccountB,
      ),
    );
    return [tokenVaultA, tokenVaultB];
  }

  it("ExactOut Sandwitch attack senario", async () => {
    const { poolInitInfo, whirlpoolPda, tokenAccountA, tokenAccountB } =
    await initTestPoolWithTokens(
      testCtx.whirlpoolCtx,
      tickSpacingSplash128,
      PriceMath.tickIndexToSqrtPriceX64(0), // 1 B/A
      new BN(2_000_000_000),
    );

    const pool = await testCtx.whirlpoolClient.getPool(
      whirlpoolPda.publicKey,
    );

    // [-2,894,848   ][0            ][
    await (await pool.initTickArrayForTicks([
      // SplashPool has only 2 TickArrays for negative and positive ticks
      -1, +1
    ]))!.buildAndExecute();

    const fullRange = TickUtil.getFullRangeTickIndex(pool.getData().tickSpacing);

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
    const small = await pool.openPosition(fullRange[0], fullRange[1], depositQuoteSmall);
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
    const large = await pool.openPosition(fullRange[0], fullRange[1], depositQuoteLarge);
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
    const largePosition = PDAUtil.getPosition(testCtx.whirlpoolCtx.program.programId, large.positionMint).publicKey;

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
