import * as anchor from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import type { InitPoolParams, PositionData } from "../../src";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx,
} from "../../src";
import { ONE_SOL, TickSpacing, ZERO_BN, systemTransferTx } from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import {
  initializePositionBundle,
  initTestPool,
  openBundledPosition,
  openPosition,
} from "../utils/init-utils";
import type { PublicKey } from "@solana/web3.js";
import { generateDefaultOpenPositionWithTokenExtensionsParams } from "../utils/test-builders";
import { useMaxCU } from "../utils/v2/init-utils-v2";

describe("reset_position_range", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tickLowerIndex = 0;
  const tickUpperIndex = 32768;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  let fullRangeOnlyPoolInitInfo: InitPoolParams;
  let fullRangeOnlyWhirlpoolPda: PDA;
  let funderKeypair: anchor.web3.Keypair;

  beforeAll(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    fullRangeOnlyPoolInitInfo = (
      await initTestPool(ctx, TickSpacing.FullRangeOnly)
    ).poolInitInfo;
    fullRangeOnlyWhirlpoolPda = fullRangeOnlyPoolInitInfo.whirlpoolPda;
  });

  beforeEach(async () => {
    funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
  });

  async function initializeDefaultPosition(
    whirlpool: PublicKey,
    lowerTick: number = tickLowerIndex,
    upperTick: number = tickUpperIndex,
  ) {
    const positionInitInfo = await openPosition(
      ctx,
      whirlpool,
      lowerTick,
      upperTick,
    );
    const { positionPda, positionMintAddress } = positionInitInfo.params;

    await validatePosition(
      positionPda.publicKey,
      positionMintAddress,
      whirlpool,
      0,
      lowerTick,
      upperTick,
    );

    return positionInitInfo;
  }

  async function validatePosition(
    positionKey: PublicKey,
    positionMintAddress: PublicKey,
    whirlpool: PublicKey = whirlpoolPda.publicKey,
    tickSpacingDiff: number = poolInitInfo.tickSpacing,
    lowerIndex: number = tickLowerIndex,
    upperIndex: number = tickUpperIndex,
  ) {
    const position = (await fetcher.getPosition(positionKey, {
      maxAge: 0,
    })) as PositionData;

    assert.strictEqual(position.tickLowerIndex, lowerIndex + tickSpacingDiff);
    assert.strictEqual(position.tickUpperIndex, upperIndex - tickSpacingDiff);
    assert.ok(position.whirlpool.equals(whirlpool));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));
  }

  it("successfully resets position and verify position address contents", async () => {
    const { positionPda, positionMintAddress, positionTokenAccount } = (
      await initializeDefaultPosition(whirlpoolPda.publicKey)
    ).params;

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: funderKeypair.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: positionPda.publicKey,
        positionTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    )
      .addSigner(funderKeypair)
      .buildAndExecute();

    await validatePosition(positionPda.publicKey, positionMintAddress);
  });

  it("successfully resets position when funder and position authority are the same", async () => {
    const { positionPda, positionMintAddress, positionTokenAccount } = (
      await initializeDefaultPosition(whirlpoolPda.publicKey)
    ).params;

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: provider.wallet.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: positionPda.publicKey,
        positionTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    ).buildAndExecute();

    await validatePosition(positionPda.publicKey, positionMintAddress);
  });

  it("successfully resets token extensions position", async () => {
    const withTokenMetadataExtension = true;

    // open position
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        withTokenMetadataExtension,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .prependInstruction(useMaxCU())
      .buildAndExecute();

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: funderKeypair.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: params.positionPda.publicKey,
        positionTokenAccount: params.positionTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    )
      .addSigner(funderKeypair)
      .buildAndExecute();

    await validatePosition(params.positionPda.publicKey, params.positionMint);
  });

  it("fails to reset range for full-range only pool", async () => {
    const [lowerTickIndex, upperTickIndex] = TickUtil.getFullRangeTickIndex(
      TickSpacing.FullRangeOnly,
    );

    const positionInitInfo = await initializeDefaultPosition(
      fullRangeOnlyWhirlpoolPda.publicKey,
      lowerTickIndex,
      upperTickIndex,
    );
    const { positionPda, positionTokenAccount } = positionInitInfo.params;

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.resetPositionRangeIx(ctx.program, {
          funder: funderKeypair.publicKey,
          positionAuthority: provider.wallet.publicKey,
          whirlpool: fullRangeOnlyWhirlpoolPda.publicKey,
          position: positionPda.publicKey,
          positionTokenAccount,
          tickLowerIndex: lowerTickIndex - TickSpacing.FullRangeOnly,
          tickUpperIndex: upperTickIndex + TickSpacing.FullRangeOnly,
        }),
      )
        .addSigner(funderKeypair)
        .buildAndExecute(),
      /0x177a/, // InvalidTickIndex
    );
  });

  it("successfully opens bundled position and verify position address contents", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex,
    );
    const { params } = positionInitInfo;
    const { bundledPositionPda } = params;

    await validatePosition(
      bundledPositionPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      whirlpoolPda.publicKey,
      0,
    );

    await toTx(
      ctx,
      WhirlpoolIx.resetPositionRangeIx(ctx.program, {
        funder: funderKeypair.publicKey,
        positionAuthority: provider.wallet.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        position: bundledPositionPda.publicKey,
        positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        tickLowerIndex: tickLowerIndex + poolInitInfo.tickSpacing,
        tickUpperIndex: tickUpperIndex - poolInitInfo.tickSpacing,
      }),
    )
      .addSigner(funderKeypair)
      .buildAndExecute();

    await validatePosition(
      bundledPositionPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
    );
  });

  describe("invalid ticks for reset range", () => {
    async function assertResetRangeFails(lowerTick: number, upperTick: number) {
      const { positionPda, positionTokenAccount } = (
        await initializeDefaultPosition(whirlpoolPda.publicKey)
      ).params;
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.resetPositionRangeIx(ctx.program, {
            funder: funderKeypair.publicKey,
            positionAuthority: provider.wallet.publicKey,
            whirlpool: whirlpoolPda.publicKey,
            position: positionPda.publicKey,
            positionTokenAccount,
            tickLowerIndex: lowerTick,
            tickUpperIndex: upperTick,
          }),
        )
          .addSigner(funderKeypair)
          .buildAndExecute(),
        /0x177a/, // InvalidTickIndex
      );
    }

    it("fail when user pass in an out of bound tick index for upper-index", async () => {
      await assertResetRangeFails(
        0,
        (Math.ceil(MAX_TICK_INDEX / TickSpacing.Standard) + 1) *
          TickSpacing.Standard,
      );
    });

    it("fail when user pass in a lower tick index that is higher than the upper-index", async () => {
      await assertResetRangeFails(
        -TickSpacing.Standard,
        -TickSpacing.Standard * 2,
      );
    });

    it("fail when user pass in a lower tick index that equals the upper-index", async () => {
      await assertResetRangeFails(-TickSpacing.Standard, -TickSpacing.Standard);
    });

    it("fail when user pass in an out of bound tick index for lower-index", async () => {
      await assertResetRangeFails(
        Math.floor(MIN_TICK_INDEX / TickSpacing.Standard - 1) *
          TickSpacing.Standard,
        0,
      );
    });

    it("fail when user pass in a non-initializable tick index for upper-index", async () => {
      await assertResetRangeFails(0, TickSpacing.Standard - 1);
    });

    it("fail when user pass in a non-initializable tick index for lower-index", async () => {
      await assertResetRangeFails(1, TickSpacing.Standard);
    });
  });
});
