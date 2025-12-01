import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import type {
  InitPoolParams,
  OpenPositionParams,
  PositionData,
  WhirlpoolContext,
} from "../../../src";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  PDAUtil,
  PriceMath,
  TickUtil,
  WhirlpoolIx,
  toTx,
} from "../../../src";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  createMint,
  createMintInstructions,
  mintToDestination,
  systemTransferTx,
  initializeLiteSVMEnvironment,
  SENTINEL_MIN,
  SENTINEL_MAX,
  snapTickDown,
  snapTickUp,
} from "../../utils";
import { TICK_RENT_AMOUNT } from "../../utils/const";
import { initTestPool, openPosition } from "../../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../../utils/test-builders";
import { pollForCondition } from "../../utils/litesvm";

describe("open_position", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("emit PositionOpened event", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const { whirlpoolPda } = poolInitInfo;
    const tickLowerIndexLocal = 0;
    const tickUpperIndexLocal = 128;
    const hasEvent =
      Array.isArray(ctx.program.idl?.events) &&
      ctx.program.idl.events.some((e) => e.name === "positionOpened");

    const { params, mint } = await generateDefaultOpenPositionParams(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndexLocal,
      tickUpperIndexLocal,
      provider.wallet.publicKey,
    );

    if (!hasEvent) {
      // IDL doesn't include PositionOpened yet; just execute to ensure no regressions.
      await toTx(ctx, WhirlpoolIx.openPositionIx(ctx.program, params))
        .addSigner(mint)
        .buildAndExecute();
      return;
    }

    // event verification
    let eventVerified = false;
    let detectedSignature: string | null = null;
    const listener = ctx.program.addEventListener(
      "positionOpened",
      (event, _slot, signature) => {
        detectedSignature = signature;
        // verify
        assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
        assert.ok(event.position.equals(params.positionPda.publicKey));
        assert.strictEqual(event.tickLowerIndex, tickLowerIndexLocal);
        assert.strictEqual(event.tickUpperIndex, tickUpperIndexLocal);
        eventVerified = true;
      },
    );

    const signature = await toTx(
      ctx,
      WhirlpoolIx.openPositionIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await pollForCondition(
      async () => ({ detectedSignature, eventVerified }),
      (r) => r.detectedSignature === signature && r.eventVerified,
      { maxRetries: 200, delayMs: 5 },
    );
    assert.equal(signature, detectedSignature);
    assert.ok(eventVerified);
    ctx.program.removeEventListener(listener);
  });

  let defaultParams: OpenPositionParams;
  let defaultMint: Keypair;
  const tickLowerIndex = 0;
  const tickUpperIndex = 32768;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  let fullRangeOnlyPoolInitInfo: InitPoolParams;
  let fullRangeOnlyWhirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  beforeAll(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    fullRangeOnlyPoolInitInfo = (
      await initTestPool(ctx, TickSpacing.FullRangeOnly)
    ).poolInitInfo;
    fullRangeOnlyWhirlpoolPda = fullRangeOnlyPoolInitInfo.whirlpoolPda;

    const { params, mint } = await generateDefaultOpenPositionParams(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
    );
    defaultParams = params;
    defaultMint = mint;
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
  });

  it("successfully opens position and verify position address contents", async () => {
    const positionInitInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
    );
    const { positionPda, positionMintAddress } = positionInitInfo.params;

    const position = (await fetcher.getPosition(
      positionPda.publicKey,
    )) as PositionData;

    assert.strictEqual(position.tickLowerIndex, tickLowerIndex);
    assert.strictEqual(position.tickUpperIndex, tickUpperIndex);
    assert.ok(position.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));

    // TODO: Add tests for rewards
  });

  it("successfully open position and verify position address contents for full-range only pool", async () => {
    const [lowerTickIndex, upperTickIndex] = TickUtil.getFullRangeTickIndex(
      TickSpacing.FullRangeOnly,
    );

    const positionInitInfo = await openPosition(
      ctx,
      fullRangeOnlyWhirlpoolPda.publicKey,
      lowerTickIndex,
      upperTickIndex,
    );
    const { positionPda, positionMintAddress } = positionInitInfo.params;

    const position = (await fetcher.getPosition(
      positionPda.publicKey,
    )) as PositionData;

    assert.strictEqual(position.tickLowerIndex, lowerTickIndex);
    assert.strictEqual(position.tickUpperIndex, upperTickIndex);
    assert.ok(
      position.whirlpool.equals(
        fullRangeOnlyPoolInitInfo.whirlpoolPda.publicKey,
      ),
    );
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
      funderKeypair,
    );
  });

  it("open position & verify position mint behavior", async () => {
    const newOwner = web3.Keypair.generate();

    const positionInitInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      newOwner.publicKey,
    );
    const {
      positionMintAddress,
      positionTokenAccount: positionTokenAccountAddress,
    } = positionInitInfo.params;

    const userTokenAccount = await getAccount(
      ctx.connection,
      positionTokenAccountAddress,
    );
    assert.ok(userTokenAccount.amount === 1n);
    assert.ok(userTokenAccount.owner.equals(newOwner.publicKey));

    await assert.rejects(
      mintToDestination(
        provider,
        positionMintAddress,
        positionTokenAccountAddress,
        1,
      ),
      /0x5/, // the total supply of this token is fixed
    );
  });

  it("should reserve some rent for tick initialization", async () => {
    const positionInitInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
    );

    const positionPda = positionInitInfo.params.positionPda.publicKey;
    const position = await ctx.connection.getAccountInfo(positionPda);
    assert.ok(position);
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(
      position.data.length,
    );
    assert.equal(position.lamports, minRent + TICK_RENT_AMOUNT * 2);
  });

  it("user must pass the valid token ATA account", async () => {
    const anotherMintKey = await createMint(
      provider,
      provider.wallet.publicKey,
    );
    const positionTokenAccountAddress = getAssociatedTokenAddressSync(
      anotherMintKey,
      provider.wallet.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionIx(ctx.program, {
          ...defaultParams,
          positionTokenAccount: positionTokenAccountAddress,
        }),
      )
        .addSigner(defaultMint)
        .buildAndExecute(),
      /An account required by the instruction is missing/,
    );
  });

  describe("invalid ticks", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      await assert.rejects(
        openPosition(
          ctx,
          whirlpoolPda.publicKey,
          lowerTick,
          upperTick,
          provider.wallet.publicKey,
          funderKeypair,
        ),
        /0x177a/, // InvalidTickIndex
      );
    }

    it("fail when user pass in an out of bound tick index for upper-index", async () => {
      await assertTicksFail(0, MAX_TICK_INDEX + 1);
    });

    it("fail when user pass in a lower tick index that is higher than the upper-index", async () => {
      await assertTicksFail(-22534, -22534 - 1);
    });

    it("fail when user pass in a lower tick index that equals the upper-index", async () => {
      await assertTicksFail(22365, 22365);
    });

    it("fail when user pass in an out of bound tick index for lower-index", async () => {
      await assertTicksFail(MIN_TICK_INDEX - 1, 0);
    });

    it("fail when user pass in a non-initializable tick index for upper-index", async () => {
      await assertTicksFail(0, 1);
    });

    it("fail when user pass in a non-initializable tick index for lower-index", async () => {
      await assertTicksFail(1, 2);
    });
  });

  it("fail when position mint already exists", async () => {
    const positionMintKeypair = anchor.web3.Keypair.generate();
    const positionPda = PDAUtil.getPosition(
      ctx.program.programId,
      positionMintKeypair.publicKey,
    );

    const positionTokenAccountAddress = getAssociatedTokenAddressSync(
      positionMintKeypair.publicKey,
      provider.wallet.publicKey,
    );

    const tx = new web3.Transaction();
    tx.add(
      ...(await createMintInstructions(
        provider,
        provider.wallet.publicKey,
        positionMintKeypair.publicKey,
      )),
    );

    await provider.sendAndConfirm(tx, [positionMintKeypair], {
      commitment: "confirmed",
    });

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionIx(ctx.program, {
          funder: provider.wallet.publicKey,
          owner: provider.wallet.publicKey,
          positionPda,
          positionMintAddress: positionMintKeypair.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
          whirlpool: whirlpoolPda.publicKey,
          tickLowerIndex: 0,
          tickUpperIndex: 128,
        }),
      )
        .addSigner(positionMintKeypair)
        .buildAndExecute(),
      /0x0/,
    );
  });

  it("fail when opening a non-full range position in an full-range only pool", async () => {
    await assert.rejects(
      openPosition(
        ctx,
        fullRangeOnlyWhirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
        funderKeypair,
      ),
      /0x17a6/, // FullRangeOnlyPool
    );
  });

  describe("one-sided (sentinel) open position", () => {
    it("snaps correctly when current price is exactly on an initializable tick", async () => {
      // Initialize a fresh pool where sqrt price is exactly on tick 0
      const onTickSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(0);
      const { poolInitInfo: onTickPool } = await initTestPool(
        ctx,
        TickSpacing.Standard,
        onTickSqrtPrice,
      );

      const whirlpool = await fetcher.getPool(
        onTickPool.whirlpoolPda.publicKey,
      );
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      // When on-tick, ceil(current) === current and floor(current) === current
      const expectedLower = snapTickUp(curr, spacing);
      const expectedUpper = snapTickDown(curr, spacing);

      // Lower sentinel case
      {
        const upper = expectedLower + spacing;
        const positionInitInfo = await openPosition(
          ctx,
          onTickPool.whirlpoolPda.publicKey,
          SENTINEL_MIN,
          upper,
        );
        const { positionPda } = positionInitInfo.params;
        const position = (await fetcher.getPosition(
          positionPda.publicKey,
        )) as PositionData;
        assert.strictEqual(position.tickLowerIndex, expectedLower);
        assert.strictEqual(position.tickUpperIndex, upper);
      }

      // Upper sentinel case
      {
        const lower = expectedUpper - spacing;
        const positionInitInfo = await openPosition(
          ctx,
          onTickPool.whirlpoolPda.publicKey,
          lower,
          SENTINEL_MAX,
        );
        const { positionPda } = positionInitInfo.params;
        const position = (await fetcher.getPosition(
          positionPda.publicKey,
        )) as PositionData;
        assert.strictEqual(position.tickLowerIndex, lower);
        assert.strictEqual(position.tickUpperIndex, expectedUpper);
      }
    });

    it("snaps lower to ceil(current) when lower sentinel is used", async () => {
      const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey);
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      const expectedLower = snapTickUp(curr, spacing);
      const upper = expectedLower + spacing;

      const positionInitInfo = await openPosition(
        ctx,
        whirlpoolPda.publicKey,
        SENTINEL_MIN,
        upper,
        provider.wallet.publicKey,
        funderKeypair,
      );
      const { positionPda } = positionInitInfo.params;
      const position = (await fetcher.getPosition(
        positionPda.publicKey,
      )) as PositionData;

      assert.strictEqual(position.tickLowerIndex, expectedLower);
      assert.strictEqual(position.tickUpperIndex, upper);
    });

    it("snaps upper to floor(current) when upper sentinel is used", async () => {
      const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey);
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      const expectedUpper = snapTickDown(curr, spacing);
      const lower = expectedUpper - spacing;

      const positionInitInfo = await openPosition(
        ctx,
        whirlpoolPda.publicKey,
        lower,
        SENTINEL_MAX,
        provider.wallet.publicKey,
        funderKeypair,
      );
      const { positionPda } = positionInitInfo.params;
      const position = (await fetcher.getPosition(
        positionPda.publicKey,
      )) as PositionData;

      assert.strictEqual(position.tickLowerIndex, lower);
      assert.strictEqual(position.tickUpperIndex, expectedUpper);
    });

    it("fails if both sentinels are used", async () => {
      await assert.rejects(
        openPosition(
          ctx,
          whirlpoolPda.publicKey,
          SENTINEL_MIN,
          SENTINEL_MAX,
          provider.wallet.publicKey,
          funderKeypair,
        ),
        /0x177a/, // InvalidTickIndex
      );
    });

    it("fails if snapped range collapses (lower >= upper)", async () => {
      const whirlpool = await fetcher.getPool(whirlpoolPda.publicKey);
      if (!whirlpool) throw new Error("whirlpool not found");
      const spacing = whirlpool.tickSpacing;
      const curr = whirlpool.tickCurrentIndex;
      const expectedLower = snapTickUp(curr, spacing);
      const upperEqualsLower = expectedLower;

      await assert.rejects(
        openPosition(
          ctx,
          whirlpoolPda.publicKey,
          SENTINEL_MIN,
          upperEqualsLower,
          provider.wallet.publicKey,
          funderKeypair,
        ),
        /0x177a/, // InvalidTickIndex
      );
    });
  });
});
