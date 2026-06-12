import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil, Percentage } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import type {
  PositionData,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../src";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE,
  PDAUtil,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { decreaseLiquidityQuoteByLiquidityWithParams } from "../../../src/quotes/public/decrease-liquidity-quote";
import { TokenExtensionUtil } from "../../../src/utils/public/token-extension-util";
import { TickSpacing, ZERO_BN } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import { openPosition } from "../../utils/init-utils";
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

describe.each(DEPLOYMENTS)("whirlpool lifecycle ($label)", ({ programId }: {programId: PublicKey}) => {
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

  it("runs init pool -> open/increase -> swap -> decrease -> close", async () => {
    // init config + fee tier + pool, open position, and fund liquidity
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const liquidityAmount = new anchor.BN(10_000_000);
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount }],
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

    const tickArrayPda = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPda.publicKey,
      22528,
    );
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    const poolBeforeSwap = (await fetcher.getPool(
      whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    // swap A -> B
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

    const poolAfterSwap = (await fetcher.getPool(
      whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;
    assert.ok(!poolAfterSwap.sqrtPrice.eq(poolBeforeSwap.sqrtPrice));

    // decrease liquidity (partial)
    const removalQuote = decreaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new anchor.BN(1_000_000),
      sqrtPrice: poolAfterSwap.sqrtPrice,
      slippageTolerance: Percentage.fromFraction(1, 100),
      tickCurrentIndex: poolAfterSwap.tickCurrentIndex,
      tickLowerIndex,
      tickUpperIndex,
      tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
        fetcher,
        poolAfterSwap,
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
    assert.ok(positionAfterDecrease.liquidity.lt(liquidityAmount));

    // open a fresh (empty) position and close it
    const { params: openParams } = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
    );

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: ctx.wallet.publicKey,
        receiver: ctx.wallet.publicKey,
        position: openParams.positionPda.publicKey,
        positionMint: openParams.positionMintAddress,
        positionTokenAccount: openParams.positionTokenAccount,
      }),
    ).buildAndExecute();

    const closedPosition = await ctx.connection.getAccountInfo(
      openParams.positionPda.publicKey,
    );
    assert.ok(closedPosition === null);
  });
});
