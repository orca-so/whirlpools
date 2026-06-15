import * as anchor from "@coral-xyz/anchor";
import { Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import type {
  PositionData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../src";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { decreaseLiquidityQuoteByLiquidityWithParams } from "../../../src/quotes/public/decrease-liquidity-quote";
import { increaseLiquidityQuoteByLiquidityWithParams } from "../../../src/quotes/public/increase-liquidity-quote";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { TickSpacing, ZERO_BN } from "../../utils";
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
    let ctx: WhirlpoolContext;
    let fetcher: WhirlpoolContext["fetcher"];

    beforeAll(async () => {
      const env = await resetAndInitializeLiteSVMEnvironment(programId);
      ctx = env.ctx;
      fetcher = env.fetcher;
    });

    it("binds the context to the expected program", () => {
      assert.ok(ctx.program.programId.equals(programId));
    });

    it("runs open position -> add liquidity -> decrease some -> decrease all -> close", async () => {
      // init config + fee tier + pool, then open an empty position (no liquidity yet)
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const liquidityAmount = new anchor.BN(10_000_000);
      const slippageTolerance = Percentage.fromFraction(1, 100);
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing: TickSpacing.Standard,
        positions: [
          { tickLowerIndex, tickUpperIndex, liquidityAmount: ZERO_BN },
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
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
