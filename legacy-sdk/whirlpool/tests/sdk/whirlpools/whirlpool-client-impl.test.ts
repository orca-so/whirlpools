import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  buildWhirlpoolClient,
  PDAUtil,
  PriceMath,
  SPLASH_POOL_TICK_SPACING,
  TickUtil,
  WhirlpoolContext,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  ONE_SOL,
  systemTransferTx,
  TEST_TOKEN_2022_PROGRAM_ID,
  TickSpacing,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { buildTestPoolParams, initTestPool } from "../../utils/init-utils";
import { buildTestPoolV2Params } from "../../utils/v2/init-utils-v2";
import {
  getMint,
  getTransferFeeConfig,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  initPosition,
  mintTokensToTestAccount,
} from "../../utils/test-builders";

describe("whirlpool-client-impl", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const client = buildWhirlpoolClient(ctx);

  describe("TokenProgram", () => {
    let funderKeypair: anchor.web3.Keypair;
    beforeEach(async () => {
      funderKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        funderKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();
    });

    it("successfully creates a new whirpool account and initial tick array account", async () => {
      const poolInitInfo = (
        await buildTestPoolParams(
          ctx,
          TickSpacing.Standard,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      const initalTick = TickUtil.getInitializableTickIndex(
        PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
        poolInitInfo.tickSpacing,
      );

      const { poolKey: actualPubkey, tx } = await client.createPool(
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        poolInitInfo.tickSpacing,
        initalTick,
        funderKeypair.publicKey,
      );

      const expectedPda = PDAUtil.getWhirlpool(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        poolInitInfo.tickSpacing,
      );

      const startTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
        initalTick,
        poolInitInfo.tickSpacing,
        expectedPda.publicKey,
        ctx.program.programId,
      );

      assert.ok(expectedPda.publicKey.equals(actualPubkey));

      const [whirlpoolAccountBefore, tickArrayAccountBefore] =
        await Promise.all([
          ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
          ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
        ]);

      assert.ok(whirlpoolAccountBefore === null);
      assert.ok(tickArrayAccountBefore === null);

      await tx.addSigner(funderKeypair).buildAndExecute();

      const [whirlpoolAccountAfter, tickArrayAccountAfter] = await Promise.all([
        ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
      ]);

      assert.ok(whirlpoolAccountAfter !== null);
      assert.ok(tickArrayAccountAfter !== null);

      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalA.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalB.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeRate === 3000);
      assert.ok(whirlpoolAccountAfter.liquidity.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedA.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedB.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeRate === 300);
      assert.ok(whirlpoolAccountAfter.rewardInfos.length === 3);
      assert.ok(whirlpoolAccountAfter.rewardLastUpdatedTimestamp.eqn(0));
      assert.ok(
        whirlpoolAccountAfter.sqrtPrice.eq(
          PriceMath.tickIndexToSqrtPriceX64(initalTick),
        ),
      );
      assert.ok(whirlpoolAccountAfter.tickCurrentIndex === initalTick);
      assert.ok(whirlpoolAccountAfter.tickSpacing === poolInitInfo.tickSpacing);
      assert.ok(
        whirlpoolAccountAfter.tokenMintA.equals(poolInitInfo.tokenMintA),
      );
      assert.ok(
        whirlpoolAccountAfter.tokenMintB.equals(poolInitInfo.tokenMintB),
      );
      assert.ok(whirlpoolAccountAfter.whirlpoolBump[0] === expectedPda.bump);
      assert.ok(
        whirlpoolAccountAfter.whirlpoolsConfig.equals(
          poolInitInfo.whirlpoolsConfig,
        ),
      );

      assert.ok(
        tickArrayAccountAfter.startTickIndex ===
          TickUtil.getStartTickIndex(initalTick, poolInitInfo.tickSpacing),
      );
      assert.ok(tickArrayAccountAfter.ticks.length > 0);
      assert.ok(tickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey));
    });

    it("throws an error when token order is incorrect", async () => {
      const poolInitInfo = (
        await buildTestPoolParams(
          ctx,
          TickSpacing.Standard,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      const initalTick = TickUtil.getInitializableTickIndex(
        PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
        poolInitInfo.tickSpacing,
      );

      const invInitialTick = TickUtil.invertTick(initalTick);

      await assert.rejects(
        client.createPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintB,
          poolInitInfo.tokenMintA,
          poolInitInfo.tickSpacing,
          invInitialTick,
          funderKeypair.publicKey,
        ),
        /Token order needs to be flipped to match the canonical ordering \(i.e. sorted on the byte repr. of the mint pubkeys\)/,
      );
    });

    it("successfully creates a new splash pool whirlpool account and initial tick array account", async () => {
      const poolInitInfo = (
        await buildTestPoolParams(
          ctx,
          SPLASH_POOL_TICK_SPACING,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;
      const [startTick, endTick] = TickUtil.getFullRangeTickIndex(
        SPLASH_POOL_TICK_SPACING,
      );

      const { poolKey: actualPubkey, tx } = await client.createSplashPool(
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
        funderKeypair.publicKey,
      );

      const expectedPda = PDAUtil.getWhirlpool(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        SPLASH_POOL_TICK_SPACING,
      );

      const startTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
        startTick,
        SPLASH_POOL_TICK_SPACING,
        expectedPda.publicKey,
        ctx.program.programId,
      );

      const endTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
        endTick,
        SPLASH_POOL_TICK_SPACING,
        expectedPda.publicKey,
        ctx.program.programId,
      );

      assert.ok(expectedPda.publicKey.equals(actualPubkey));

      const [
        whirlpoolAccountBefore,
        startTickArrayAccountBefore,
        endTickArrayAccountBefore,
      ] = await Promise.all([
        ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(endTickArrayPda.publicKey, IGNORE_CACHE),
      ]);

      assert.ok(whirlpoolAccountBefore === null);
      assert.ok(startTickArrayAccountBefore === null);
      assert.ok(endTickArrayAccountBefore === null);

      await tx.addSigner(funderKeypair).buildAndExecute();

      const [
        whirlpoolAccountAfter,
        startTickArrayAccountAfter,
        endTickArrayAccountAfter,
      ] = await Promise.all([
        ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(endTickArrayPda.publicKey, IGNORE_CACHE),
      ]);

      assert.ok(whirlpoolAccountAfter !== null);
      assert.ok(startTickArrayAccountAfter !== null);
      assert.ok(endTickArrayAccountAfter !== null);

      const startSqrtPrice = PriceMath.priceToSqrtPriceX64(
        PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
        6,
        6,
      );

      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalA.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalB.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeRate === 3000);
      assert.ok(whirlpoolAccountAfter.liquidity.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedA.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedB.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeRate === 300);
      assert.ok(whirlpoolAccountAfter.rewardInfos.length === 3);
      assert.ok(whirlpoolAccountAfter.rewardLastUpdatedTimestamp.eqn(0));
      assert.ok(whirlpoolAccountAfter.sqrtPrice.eq(startSqrtPrice));
      assert.ok(
        whirlpoolAccountAfter.tickCurrentIndex ===
          PriceMath.sqrtPriceX64ToTickIndex(startSqrtPrice),
      );
      assert.ok(whirlpoolAccountAfter.tickSpacing === SPLASH_POOL_TICK_SPACING);
      assert.ok(
        whirlpoolAccountAfter.tokenMintA.equals(poolInitInfo.tokenMintA),
      );
      assert.ok(
        whirlpoolAccountAfter.tokenMintB.equals(poolInitInfo.tokenMintB),
      );
      assert.ok(whirlpoolAccountAfter.whirlpoolBump[0] === expectedPda.bump);
      assert.ok(
        whirlpoolAccountAfter.whirlpoolsConfig.equals(
          poolInitInfo.whirlpoolsConfig,
        ),
      );

      assert.ok(
        startTickArrayAccountAfter.startTickIndex ===
          TickUtil.getStartTickIndex(startTick, SPLASH_POOL_TICK_SPACING),
      );
      assert.ok(startTickArrayAccountAfter.ticks.length > 0);
      assert.ok(
        startTickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey),
      );

      assert.ok(
        endTickArrayAccountAfter.startTickIndex ===
          TickUtil.getStartTickIndex(endTick, SPLASH_POOL_TICK_SPACING),
      );

      assert.ok(endTickArrayAccountAfter.ticks.length > 0);
      assert.ok(
        endTickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey),
      );
    });

    it("throws an error when token order is incorrect while creating splash pool", async () => {
      const poolInitInfo = (
        await buildTestPoolParams(
          ctx,
          SPLASH_POOL_TICK_SPACING,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      await assert.rejects(
        client.createSplashPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintB,
          poolInitInfo.tokenMintA,
          PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
          funderKeypair.publicKey,
        ),
        /Token order needs to be flipped to match the canonical ordering \(i.e. sorted on the byte repr. of the mint pubkeys\)/,
      );
    });
  });

  describe("TokenExtension", () => {
    let funderKeypair: anchor.web3.Keypair;
    beforeEach(async () => {
      funderKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        funderKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();
    });

    it("successfully creates a new whirpool account and initial tick array account (without TokenBadge)", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          { isToken2022: true, hasTransferFeeExtension: true },
          { isToken2022: true, hasTransferFeeExtension: true },
          TickSpacing.Standard,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      // initialized with TransferFee extension
      const mintDataA = await getMint(
        provider.connection,
        poolInitInfo.tokenMintA,
        "confirmed",
        TEST_TOKEN_2022_PROGRAM_ID,
      );
      const mintDataB = await getMint(
        provider.connection,
        poolInitInfo.tokenMintB,
        "confirmed",
        TEST_TOKEN_2022_PROGRAM_ID,
      );
      const transferFeeConfigA = getTransferFeeConfig(mintDataA);
      const transferFeeConfigB = getTransferFeeConfig(mintDataB);
      assert.ok(transferFeeConfigA !== null);
      assert.ok(transferFeeConfigB !== null);

      const initalTick = TickUtil.getInitializableTickIndex(
        PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
        poolInitInfo.tickSpacing,
      );

      const { poolKey: actualPubkey, tx } = await client.createPool(
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        poolInitInfo.tickSpacing,
        initalTick,
        funderKeypair.publicKey,
      );

      const expectedPda = PDAUtil.getWhirlpool(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        poolInitInfo.tickSpacing,
      );

      const startTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
        initalTick,
        poolInitInfo.tickSpacing,
        expectedPda.publicKey,
        ctx.program.programId,
      );

      assert.ok(expectedPda.publicKey.equals(actualPubkey));

      const [whirlpoolAccountBefore, tickArrayAccountBefore] =
        await Promise.all([
          ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
          ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
        ]);

      assert.ok(whirlpoolAccountBefore === null);
      assert.ok(tickArrayAccountBefore === null);

      await tx.addSigner(funderKeypair).buildAndExecute();

      const [whirlpoolAccountAfter, tickArrayAccountAfter] = await Promise.all([
        ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
      ]);

      assert.ok(whirlpoolAccountAfter !== null);
      assert.ok(tickArrayAccountAfter !== null);

      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalA.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalB.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeRate === 3000);
      assert.ok(whirlpoolAccountAfter.liquidity.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedA.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedB.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeRate === 300);
      assert.ok(whirlpoolAccountAfter.rewardInfos.length === 3);
      assert.ok(whirlpoolAccountAfter.rewardLastUpdatedTimestamp.eqn(0));
      assert.ok(
        whirlpoolAccountAfter.sqrtPrice.eq(
          PriceMath.tickIndexToSqrtPriceX64(initalTick),
        ),
      );
      assert.ok(whirlpoolAccountAfter.tickCurrentIndex === initalTick);
      assert.ok(whirlpoolAccountAfter.tickSpacing === poolInitInfo.tickSpacing);
      assert.ok(
        whirlpoolAccountAfter.tokenMintA.equals(poolInitInfo.tokenMintA),
      );
      assert.ok(
        whirlpoolAccountAfter.tokenMintB.equals(poolInitInfo.tokenMintB),
      );
      assert.ok(whirlpoolAccountAfter.whirlpoolBump[0] === expectedPda.bump);
      assert.ok(
        whirlpoolAccountAfter.whirlpoolsConfig.equals(
          poolInitInfo.whirlpoolsConfig,
        ),
      );

      assert.ok(
        tickArrayAccountAfter.startTickIndex ===
          TickUtil.getStartTickIndex(initalTick, poolInitInfo.tickSpacing),
      );
      assert.ok(tickArrayAccountAfter.ticks.length > 0);
      assert.ok(tickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey));
    });

    it("successfully creates a new whirpool account (with TokenBadge)", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          }, // TokenBadge required
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          }, // TokenBadge required
          TickSpacing.Standard,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          ctx.wallet.publicKey,
          true, // initialize TokenBadge
          true, // initialize TokenBadge
        )
      ).poolInitInfo;

      const initialTick = TickUtil.getInitializableTickIndex(
        PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
        poolInitInfo.tickSpacing,
      );

      const tx = (
        await client.createPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintA,
          poolInitInfo.tokenMintB,
          poolInitInfo.tickSpacing,
          initialTick,
          ctx.wallet.publicKey,
        )
      ).tx;

      await tx.buildAndExecute();

      const whirlpool = await client.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );

      assert.ok(whirlpool !== null);
      assert.ok(whirlpool.getData().tokenMintA.equals(poolInitInfo.tokenMintA));
      assert.ok(whirlpool.getData().tokenMintB.equals(poolInitInfo.tokenMintB));
    });

    it("throws an error when token order is incorrect", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          { isToken2022: true, hasTransferFeeExtension: true },
          { isToken2022: true, hasTransferFeeExtension: true },
          TickSpacing.Standard,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      const initialTick = TickUtil.getInitializableTickIndex(
        PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
        poolInitInfo.tickSpacing,
      );

      const invInitialTick = TickUtil.invertTick(initialTick);

      await assert.rejects(
        client.createPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintB,
          poolInitInfo.tokenMintA,
          poolInitInfo.tickSpacing,
          invInitialTick,
          funderKeypair.publicKey,
        ),
        /Token order needs to be flipped to match the canonical ordering \(i.e. sorted on the byte repr. of the mint pubkeys\)/,
      );
    });

    it("throws an error when TokenBadge is not initialized", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          },
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          },
          TickSpacing.Standard,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          ctx.wallet.publicKey,
          false, // not initialize TokenBadge
          false, // not initialize TokenBadge
        )
      ).poolInitInfo;

      const initialTick = TickUtil.getInitializableTickIndex(
        PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
        poolInitInfo.tickSpacing,
      );

      const tx = (
        await client.createPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintA,
          poolInitInfo.tokenMintB,
          poolInitInfo.tickSpacing,
          initialTick,
          ctx.wallet.publicKey,
        )
      ).tx;

      await assert.rejects(
        tx.buildAndExecute(),
        /0x179f/, // UnsupportedTokenMint
      );
    });

    it("successfully creates a new whirpool account and initial tick array account (without TokenBadge) for splash pool", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          { isToken2022: true, hasTransferFeeExtension: true },
          { isToken2022: true, hasTransferFeeExtension: true },
          SPLASH_POOL_TICK_SPACING,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      // initialized with TransferFee extension
      const mintDataA = await getMint(
        provider.connection,
        poolInitInfo.tokenMintA,
        "confirmed",
        TEST_TOKEN_2022_PROGRAM_ID,
      );
      const mintDataB = await getMint(
        provider.connection,
        poolInitInfo.tokenMintB,
        "confirmed",
        TEST_TOKEN_2022_PROGRAM_ID,
      );
      const transferFeeConfigA = getTransferFeeConfig(mintDataA);
      const transferFeeConfigB = getTransferFeeConfig(mintDataB);
      assert.ok(transferFeeConfigA !== null);
      assert.ok(transferFeeConfigB !== null);

      const [startTick, endTick] = TickUtil.getFullRangeTickIndex(
        SPLASH_POOL_TICK_SPACING,
      );

      const { poolKey: actualPubkey, tx } = await client.createSplashPool(
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
        funderKeypair.publicKey,
      );

      const expectedPda = PDAUtil.getWhirlpool(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        poolInitInfo.tokenMintA,
        poolInitInfo.tokenMintB,
        SPLASH_POOL_TICK_SPACING,
      );

      const startTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
        startTick,
        SPLASH_POOL_TICK_SPACING,
        expectedPda.publicKey,
        ctx.program.programId,
      );

      const endTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
        endTick,
        SPLASH_POOL_TICK_SPACING,
        expectedPda.publicKey,
        ctx.program.programId,
      );

      assert.ok(expectedPda.publicKey.equals(actualPubkey));

      const [
        whirlpoolAccountBefore,
        startTickArrayAccountBefore,
        endTickArrayAccountBefore,
      ] = await Promise.all([
        ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(endTickArrayPda.publicKey, IGNORE_CACHE),
      ]);

      assert.ok(whirlpoolAccountBefore === null);
      assert.ok(startTickArrayAccountBefore === null);
      assert.ok(endTickArrayAccountBefore === null);

      await tx.addSigner(funderKeypair).buildAndExecute();

      const [
        whirlpoolAccountAfter,
        startTickArrayAccountAfter,
        endTickArrayAccountAfter,
      ] = await Promise.all([
        ctx.fetcher.getPool(expectedPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(startTickArrayPda.publicKey, IGNORE_CACHE),
        ctx.fetcher.getTickArray(endTickArrayPda.publicKey, IGNORE_CACHE),
      ]);

      assert.ok(whirlpoolAccountAfter !== null);
      assert.ok(startTickArrayAccountAfter !== null);
      assert.ok(endTickArrayAccountAfter !== null);

      const startSqrtPrice = PriceMath.priceToSqrtPriceX64(
        PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
        6,
        6,
      );

      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalA.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeGrowthGlobalB.eqn(0));
      assert.ok(whirlpoolAccountAfter.feeRate === 3000);
      assert.ok(whirlpoolAccountAfter.liquidity.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedA.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeOwedB.eqn(0));
      assert.ok(whirlpoolAccountAfter.protocolFeeRate === 300);
      assert.ok(whirlpoolAccountAfter.rewardInfos.length === 3);
      assert.ok(whirlpoolAccountAfter.rewardLastUpdatedTimestamp.eqn(0));
      assert.ok(whirlpoolAccountAfter.sqrtPrice.eq(startSqrtPrice));
      assert.ok(
        whirlpoolAccountAfter.tickCurrentIndex ===
          PriceMath.sqrtPriceX64ToTickIndex(startSqrtPrice),
      );
      assert.ok(whirlpoolAccountAfter.tickSpacing === SPLASH_POOL_TICK_SPACING);
      assert.ok(
        whirlpoolAccountAfter.tokenMintA.equals(poolInitInfo.tokenMintA),
      );
      assert.ok(
        whirlpoolAccountAfter.tokenMintB.equals(poolInitInfo.tokenMintB),
      );
      assert.ok(whirlpoolAccountAfter.whirlpoolBump[0] === expectedPda.bump);
      assert.ok(
        whirlpoolAccountAfter.whirlpoolsConfig.equals(
          poolInitInfo.whirlpoolsConfig,
        ),
      );

      assert.ok(
        startTickArrayAccountAfter.startTickIndex ===
          TickUtil.getStartTickIndex(startTick, SPLASH_POOL_TICK_SPACING),
      );
      assert.ok(startTickArrayAccountAfter.ticks.length > 0);
      assert.ok(
        startTickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey),
      );

      assert.ok(
        endTickArrayAccountAfter.startTickIndex ===
          TickUtil.getStartTickIndex(endTick, SPLASH_POOL_TICK_SPACING),
      );

      assert.ok(endTickArrayAccountAfter.ticks.length > 0);
      assert.ok(
        endTickArrayAccountAfter.whirlpool.equals(expectedPda.publicKey),
      );
    });

    it("successfully creates a new whirpool account (with TokenBadge) for splash pool", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          }, // TokenBadge required
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          }, // TokenBadge required
          SPLASH_POOL_TICK_SPACING,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          ctx.wallet.publicKey,
          true, // initialize TokenBadge
          true, // initialize TokenBadge
        )
      ).poolInitInfo;

      const tx = (
        await client.createSplashPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintA,
          poolInitInfo.tokenMintB,
          PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
          ctx.wallet.publicKey,
        )
      ).tx;

      await tx.buildAndExecute();

      const whirlpool = await client.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );

      assert.ok(whirlpool !== null);
      assert.ok(whirlpool.getData().tokenMintA.equals(poolInitInfo.tokenMintA));
      assert.ok(whirlpool.getData().tokenMintB.equals(poolInitInfo.tokenMintB));
    });

    it("throws an error when token order is incorrect for splash pool", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          { isToken2022: true, hasTransferFeeExtension: true },
          { isToken2022: true, hasTransferFeeExtension: true },
          SPLASH_POOL_TICK_SPACING,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          funderKeypair.publicKey,
        )
      ).poolInitInfo;

      await assert.rejects(
        client.createSplashPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintB,
          poolInitInfo.tokenMintA,
          PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
          funderKeypair.publicKey,
        ),
        /Token order needs to be flipped to match the canonical ordering \(i.e. sorted on the byte repr. of the mint pubkeys\)/,
      );
    });

    it("throws an error when TokenBadge is not initialized for splash pool", async () => {
      const poolInitInfo = (
        await buildTestPoolV2Params(
          ctx,
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          },
          {
            isToken2022: true,
            hasTransferHookExtension: true,
            hasPermanentDelegate: true,
          },
          SPLASH_POOL_TICK_SPACING,
          3000,
          PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
          ctx.wallet.publicKey,
          false, // not initialize TokenBadge
          false, // not initialize TokenBadge
        )
      ).poolInitInfo;

      const tx = (
        await client.createSplashPool(
          poolInitInfo.whirlpoolsConfig,
          poolInitInfo.tokenMintA,
          poolInitInfo.tokenMintB,
          PriceMath.sqrtPriceX64ToPrice(poolInitInfo.initSqrtPrice, 6, 6),
          ctx.wallet.publicKey,
        )
      ).tx;

      await assert.rejects(
        tx.buildAndExecute(),
        /0x179f/, // UnsupportedTokenMint
      );
    });
  });

  it("getPosition/getPositions for TokenExtensions based Position", async () => {
    const { poolInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
      PriceMath.priceToSqrtPriceX64(new Decimal(100), 6, 6),
    );

    // Create and mint tokens in this wallet
    await mintTokensToTestAccount(
      ctx.provider,
      poolInitInfo.tokenMintA,
      10_000_000_000,
      poolInitInfo.tokenMintB,
      10_000_000_000,
    );

    const pool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    const lowerTick = PriceMath.priceToTickIndex(
      new Decimal(89),
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals,
    );
    const upperTick = PriceMath.priceToTickIndex(
      new Decimal(120),
      pool.getTokenAInfo().decimals,
      pool.getTokenBInfo().decimals,
    );

    // [Action] Initialize Tick Arrays
    const initTickArrayTx = (await pool.initTickArrayForTicks([
      lowerTick,
      upperTick,
    ]))!;
    await initTickArrayTx.buildAndExecute();

    // [Action] Create a position at price 89, 120 with 50 token A
    const lowerPrice = new Decimal(89);
    const upperPrice = new Decimal(120);
    const withTokenExtensions = [true, false, true, false];
    const positions = await Promise.all(
      withTokenExtensions.map((withTokenExtension) =>
        initPosition(
          ctx,
          pool,
          lowerPrice,
          upperPrice,
          poolInitInfo.tokenMintA,
          50,
          undefined,
          withTokenExtension,
        ),
      ),
    );

    // check .getPosition
    const position0 = await client.getPosition(
      positions[0].positionAddress.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(
      position0.getPositionMintTokenProgramId().equals(TOKEN_2022_PROGRAM_ID),
    );
    const position1 = await client.getPosition(
      positions[1].positionAddress.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(
      position1.getPositionMintTokenProgramId().equals(TOKEN_PROGRAM_ID),
    );

    // check .getPositions
    const positionsFetched = await client.getPositions(
      positions.map((p) => p.positionAddress.publicKey),
      IGNORE_CACHE,
    );
    withTokenExtensions.forEach((withTokenExtension, i) => {
      const position =
        positionsFetched[positions[i].positionAddress.publicKey.toBase58()];
      assert.ok(!!position);
      assert.ok(
        position
          .getPositionMintTokenProgramId()
          .equals(
            withTokenExtension ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
          ),
      );
    });
  });
});
