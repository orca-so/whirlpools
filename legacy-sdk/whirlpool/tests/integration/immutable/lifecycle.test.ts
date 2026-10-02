import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import type {
  PositionData,
  TickArrayData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../src";
import {
  collectFeesQuote,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE,
  PDAUtil,
  TickArrayUtil,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { decreaseLiquidityQuoteByLiquidityWithParams } from "../../../src/quotes/public/decrease-liquidity-quote";
import { increaseLiquidityQuoteByLiquidityWithParams } from "../../../src/quotes/public/increase-liquidity-quote";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import {
  createTokenAccount,
  getTokenBalance,
  TickSpacing,
  ZERO_BN,
} from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { resetAndInitializeLiteSVMEnvironment } from "../../utils/litesvm";
import type { PublicKey } from "@solana/web3.js";

// Run the full pool lifecycle against both the mutable and the immutable Whirlpool
// program. The immutable program is byte-for-byte identical to the mutable one but is
// deployed at a different program id, so this proves that PDA derivation and instruction
// dispatch resolve correctly when the context is bound to it. Every test util derives
// PDAs from `ctx.program.programId`, so binding the context (via the optional `programId`
// passed to the litesvm environment) flows through automatically.
const DEPLOYMENTS = [
  { label: "mutable", programId: ORCA_WHIRLPOOL_PROGRAM_ID },
  { label: "immutable", programId: ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE },
];

describe.each(DEPLOYMENTS)(
  "whirlpool lifecycle ($label)",
  ({ programId }: { programId: PublicKey }) => {
    let provider: anchor.AnchorProvider;
    let ctx: WhirlpoolContext;
    let fetcher: WhirlpoolContext["fetcher"];

    beforeAll(async () => {
      const env = await resetAndInitializeLiteSVMEnvironment(programId);
      provider = env.provider;
      ctx = env.ctx;
      fetcher = env.fetcher;
    });

    it("binds the context to the expected program", () => {
      assert.ok(ctx.program.programId.equals(programId));
    });

    it("runs open position -> add liquidity -> swap -> collect fees -> decrease some -> decrease all -> close", async () => {
      // init config + fee tier + pool, then open an empty position (no liquidity yet)
      const tickSpacing = TickSpacing.Standard;
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const liquidityAmount = new anchor.BN(10_000_000);
      const slippageTolerance = Percentage.fromFraction(1, 100);
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      // The pool and position accounts must be owned by the deployment's program.
      const poolAccount = await ctx.connection.getAccountInfo(
        whirlpoolPda.publicKey,
      );
      assert.ok(poolAccount);
      assert.ok(poolAccount.owner.equals(programId));
      const positionAccount = await ctx.connection.getAccountInfo(
        positions[0].publicKey,
      );
      assert.ok(positionAccount);
      assert.ok(positionAccount.owner.equals(programId));

      // the freshly opened position starts empty
      const positionAfterOpen = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionAfterOpen.liquidity.isZero());

      // add liquidity
      const poolBeforeIncrease = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      const increaseQuote = increaseLiquidityQuoteByLiquidityWithParams({
        liquidity: liquidityAmount,
        sqrtPrice: poolBeforeIncrease.sqrtPrice,
        slippageTolerance,
        tickCurrentIndex: poolBeforeIncrease.tickCurrentIndex,
        tickLowerIndex,
        tickUpperIndex,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          poolBeforeIncrease,
          IGNORE_CACHE,
        ),
      });

      await toTx(
        ctx,
        WhirlpoolIx.increaseLiquidityIx(ctx.program, {
          ...increaseQuote,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArrayLower: positions[0].tickArrayLower,
          tickArrayUpper: positions[0].tickArrayUpper,
        }),
      ).buildAndExecute();

      const positionAfterIncrease = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionAfterIncrease.liquidity.eq(liquidityAmount));

      // swap both directions to accrue fees in token A and token B
      const tickArrayPda = PDAUtil.getTickArray(
        ctx.program.programId,
        whirlpoolPda.publicKey,
        22528,
      );
      const oraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        whirlpoolPda.publicKey,
      );

      const positionBeforeSwap = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionBeforeSwap.feeOwedA.eq(ZERO_BN));
      assert.ok(positionBeforeSwap.feeOwedB.eq(ZERO_BN));

      // accrue fees in token A (a -> b)
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(200_000),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
          amountSpecifiedIsInput: true,
          aToB: true,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }),
      ).buildAndExecute();

      // accrue fees in token B (b -> a)
      await toTx(
        ctx,
        WhirlpoolIx.swapIx(ctx.program, {
          amount: new BN(200_000),
          otherAmountThreshold: ZERO_BN,
          sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
          amountSpecifiedIsInput: true,
          aToB: false,
          whirlpool: whirlpoolPda.publicKey,
          tokenAuthority: ctx.wallet.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArray0: tickArrayPda.publicKey,
          tickArray1: tickArrayPda.publicKey,
          tickArray2: tickArrayPda.publicKey,
          oracle: oraclePda.publicKey,
        }),
      ).buildAndExecute();

      // sync the position's owed fees so they can be collected
      await toTx(
        ctx,
        WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          position: positions[0].publicKey,
          tickArrayLower: tickArrayPda.publicKey,
          tickArrayUpper: tickArrayPda.publicKey,
        }),
      ).buildAndExecute();

      const positionBeforeCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      // both swaps should have accrued fees on the in-range position
      assert.ok(positionBeforeCollect.feeOwedA.gt(ZERO_BN));
      assert.ok(positionBeforeCollect.feeOwedB.gt(ZERO_BN));

      // collect fees into fresh token accounts and verify the on-chain payout
      const feeAccountA = await createTokenAccount(
        provider,
        tokenMintA,
        provider.wallet.publicKey,
      );
      const feeAccountB = await createTokenAccount(
        provider,
        tokenMintB,
        provider.wallet.publicKey,
      );

      const poolBeforeCollect = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      const tickArrayData = (await fetcher.getTickArray(
        tickArrayPda.publicKey,
        IGNORE_CACHE,
      )) as TickArrayData;
      const lowerTick = TickArrayUtil.getTickFromArray(
        tickArrayData,
        tickLowerIndex,
        tickSpacing,
      );
      const upperTick = TickArrayUtil.getTickFromArray(
        tickArrayData,
        tickUpperIndex,
        tickSpacing,
      );
      const feeExpectation = collectFeesQuote({
        whirlpool: poolBeforeCollect,
        position: positionBeforeCollect,
        tickLower: lowerTick,
        tickUpper: upperTick,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          poolBeforeCollect,
          IGNORE_CACHE,
        ),
      });

      await toTx(
        ctx,
        WhirlpoolIx.collectFeesIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          tokenOwnerAccountA: feeAccountA,
          tokenOwnerAccountB: feeAccountB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
        }),
      ).buildAndExecute();

      const feeBalanceA = await getTokenBalance(provider, feeAccountA);
      const feeBalanceB = await getTokenBalance(provider, feeAccountB);
      assert.equal(feeBalanceA, feeExpectation.feeOwedA);
      assert.equal(feeBalanceB, feeExpectation.feeOwedB);

      const positionAfterCollect = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionAfterCollect.feeOwedA.eq(ZERO_BN));
      assert.ok(positionAfterCollect.feeOwedB.eq(ZERO_BN));

      // decrease some liquidity (partial)
      const poolBeforeDecrease = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: new anchor.BN(1_000_000),
        sqrtPrice: poolBeforeDecrease.sqrtPrice,
        slippageTolerance,
        tickCurrentIndex: poolBeforeDecrease.tickCurrentIndex,
        tickLowerIndex,
        tickUpperIndex,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          poolBeforeDecrease,
          IGNORE_CACHE,
        ),
      });

      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          ...removalQuote,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArrayLower: positions[0].tickArrayLower,
          tickArrayUpper: positions[0].tickArrayUpper,
        }),
      ).buildAndExecute();

      const positionAfterDecrease = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      // liquidity after the decrease should be ~9_000_000 (10_000_000 - 1_000_000),
      // within the slippage tolerance used for the removal quote.
      const expectedLiquidity = new anchor.BN(9_000_000);
      const liquidityTolerance = expectedLiquidity
        .mul(slippageTolerance.numerator)
        .div(slippageTolerance.denominator);
      assert.ok(
        positionAfterDecrease.liquidity.gte(
          expectedLiquidity.sub(liquidityTolerance),
        ),
      );
      assert.ok(
        positionAfterDecrease.liquidity.lte(
          expectedLiquidity.add(liquidityTolerance),
        ),
      );

      // decrease all remaining liquidity so the position can be closed
      const poolBeforeClose = (await fetcher.getPool(
        whirlpoolPda.publicKey,
        IGNORE_CACHE,
      )) as WhirlpoolData;
      const fullRemovalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
        liquidity: positionAfterDecrease.liquidity,
        sqrtPrice: poolBeforeClose.sqrtPrice,
        slippageTolerance,
        tickCurrentIndex: poolBeforeClose.tickCurrentIndex,
        tickLowerIndex,
        tickUpperIndex,
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
          fetcher,
          poolBeforeClose,
          IGNORE_CACHE,
        ),
      });

      await toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          ...fullRemovalQuote,
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tickArrayLower: positions[0].tickArrayLower,
          tickArrayUpper: positions[0].tickArrayUpper,
        }),
      ).buildAndExecute();

      const positionAfterFullRemoval = (await fetcher.getPosition(
        positions[0].publicKey,
        IGNORE_CACHE,
      )) as PositionData;
      assert.ok(positionAfterFullRemoval.liquidity.isZero());

      // close the (now empty) position
      await toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
          position: positions[0].publicKey,
          positionMint: positions[0].mintKeypair.publicKey,
          positionTokenAccount: positions[0].tokenAccount,
        }),
      ).buildAndExecute();

      const closedPosition = await ctx.connection.getAccountInfo(
        positions[0].publicKey,
      );
      assert.ok(closedPosition === null);
    });
  },
);
