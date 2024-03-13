import * as anchor from "@coral-xyz/anchor";
import { MathUtil, PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  IGNORE_CACHE,
  InitPoolParams,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PDAUtil,
  PriceMath,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx,
  toTx
} from "../../src";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  asyncAssertTokenVault,
  createMint,
  systemTransferTx
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { buildTestPoolParams, initFeeTier, initTestPool } from "../utils/init-utils";

describe("initialize_pool", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully init a Standard account", async () => {
    const price = MathUtil.toX64(new Decimal(5));
    const { configInitInfo, poolInitInfo, feeTierParams } = await initTestPool(
      ctx,
      TickSpacing.Standard,
      price
    );
    const whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey)) as WhirlpoolData;

    const expectedWhirlpoolPda = PDAUtil.getWhirlpool(
      program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintB,
      TickSpacing.Standard
    );

    assert.ok(poolInitInfo.whirlpoolPda.publicKey.equals(expectedWhirlpoolPda.publicKey));
    assert.equal(expectedWhirlpoolPda.bump, whirlpool.whirlpoolBump[0]);

    assert.ok(whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig));
    assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
    assert.ok(whirlpool.tokenVaultA.equals(poolInitInfo.tokenVaultAKeypair.publicKey));

    assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
    assert.ok(whirlpool.tokenVaultB.equals(poolInitInfo.tokenVaultBKeypair.publicKey));

    assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);
    assert.equal(whirlpool.protocolFeeRate, configInitInfo.defaultProtocolFeeRate);

    assert.ok(whirlpool.sqrtPrice.eq(new anchor.BN(poolInitInfo.initSqrtPrice.toString())));
    assert.ok(whirlpool.liquidity.eq(ZERO_BN));

    assert.equal(
      whirlpool.tickCurrentIndex,
      PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice)
    );

    assert.ok(whirlpool.protocolFeeOwedA.eq(ZERO_BN));
    assert.ok(whirlpool.protocolFeeOwedB.eq(ZERO_BN));
    assert.ok(whirlpool.feeGrowthGlobalA.eq(ZERO_BN));
    assert.ok(whirlpool.feeGrowthGlobalB.eq(ZERO_BN));

    assert.ok(whirlpool.tickSpacing === TickSpacing.Standard);

    await asyncAssertTokenVault(program, poolInitInfo.tokenVaultAKeypair.publicKey, {
      expectedOwner: poolInitInfo.whirlpoolPda.publicKey,
      expectedMint: poolInitInfo.tokenMintA,
    });
    await asyncAssertTokenVault(program, poolInitInfo.tokenVaultBKeypair.publicKey, {
      expectedOwner: poolInitInfo.whirlpoolPda.publicKey,
      expectedMint: poolInitInfo.tokenMintB,
    });

    whirlpool.rewardInfos.forEach((rewardInfo) => {
      assert.equal(rewardInfo.emissionsPerSecondX64, 0);
      assert.equal(rewardInfo.growthGlobalX64, 0);
      assert.ok(rewardInfo.authority.equals(configInitInfo.rewardEmissionsSuperAuthority));
      assert.ok(rewardInfo.mint.equals(anchor.web3.PublicKey.default));
      assert.ok(rewardInfo.vault.equals(anchor.web3.PublicKey.default));
    });
  });

  it("successfully init a Stable account", async () => {
    const price = MathUtil.toX64(new Decimal(5));
    const { configInitInfo, poolInitInfo, feeTierParams } = await initTestPool(
      ctx,
      TickSpacing.Stable,
      price
    );
    const whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey)) as WhirlpoolData;

    assert.ok(whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig));
    assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
    assert.ok(whirlpool.tokenVaultA.equals(poolInitInfo.tokenVaultAKeypair.publicKey));

    assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
    assert.ok(whirlpool.tokenVaultB.equals(poolInitInfo.tokenVaultBKeypair.publicKey));

    assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);
    assert.equal(whirlpool.protocolFeeRate, configInitInfo.defaultProtocolFeeRate);

    assert.ok(whirlpool.sqrtPrice.eq(new anchor.BN(poolInitInfo.initSqrtPrice.toString())));
    assert.ok(whirlpool.liquidity.eq(ZERO_BN));

    assert.equal(
      whirlpool.tickCurrentIndex,
      PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice)
    );

    assert.ok(whirlpool.protocolFeeOwedA.eq(ZERO_BN));
    assert.ok(whirlpool.protocolFeeOwedB.eq(ZERO_BN));
    assert.ok(whirlpool.feeGrowthGlobalA.eq(ZERO_BN));
    assert.ok(whirlpool.feeGrowthGlobalB.eq(ZERO_BN));

    assert.ok(whirlpool.tickSpacing === TickSpacing.Stable);

    await asyncAssertTokenVault(program, poolInitInfo.tokenVaultAKeypair.publicKey, {
      expectedOwner: poolInitInfo.whirlpoolPda.publicKey,
      expectedMint: poolInitInfo.tokenMintA,
    });
    await asyncAssertTokenVault(program, poolInitInfo.tokenVaultBKeypair.publicKey, {
      expectedOwner: poolInitInfo.whirlpoolPda.publicKey,
      expectedMint: poolInitInfo.tokenMintB,
    });

    whirlpool.rewardInfos.forEach((rewardInfo) => {
      assert.equal(rewardInfo.emissionsPerSecondX64, 0);
      assert.equal(rewardInfo.growthGlobalX64, 0);
      assert.ok(rewardInfo.authority.equals(configInitInfo.rewardEmissionsSuperAuthority));
      assert.ok(rewardInfo.mint.equals(anchor.web3.PublicKey.default));
      assert.ok(rewardInfo.vault.equals(anchor.web3.PublicKey.default));
    });
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    await initTestPool(ctx, TickSpacing.Standard, MathUtil.toX64(new Decimal(5)), funderKeypair);
  });

  it("fails when tokenVaultA mint does not match tokenA mint", async () => {
    const { poolInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);
    const otherTokenPublicKey = await createMint(provider);

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      tokenMintA: otherTokenPublicKey,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x7d6/ // ConstraintSeeds
    );
  });

  it("fails when tokenVaultB mint does not match tokenB mint", async () => {
    const { poolInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);
    const otherTokenPublicKey = await createMint(provider);

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      tokenMintB: otherTokenPublicKey,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x7d6/ // ConstraintSeeds
    );
  });

  it("fails when token mints are in the wrong order", async () => {
    const { poolInitInfo, configInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);

    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      poolInitInfo.tokenMintB,
      poolInitInfo.tokenMintA,
      TickSpacing.Standard
    );

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      whirlpoolPda,
      tickSpacing: TickSpacing.Standard,
      tokenMintA: poolInitInfo.tokenMintB,
      tokenMintB: poolInitInfo.tokenMintA,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x1788/ // InvalidTokenMintOrder
    );
  });

  it("fails when the same token mint is passed in", async () => {
    const { poolInitInfo, configInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);

    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintA,
      TickSpacing.Standard
    );

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      whirlpoolPda,
      tickSpacing: TickSpacing.Standard,
      tokenMintB: poolInitInfo.tokenMintA,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x1788/ // InvalidTokenMintOrder
    );
  });

  it("fails when sqrt-price exceeds max", async () => {
    const { poolInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);
    const otherTokenPublicKey = await createMint(provider);

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      initSqrtPrice: new anchor.BN(MAX_SQRT_PRICE).add(new anchor.BN(1)),
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x177b/ // SqrtPriceOutOfBounds
    );
  });

  it("fails when sqrt-price subceeds min", async () => {
    const { poolInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      initSqrtPrice: new anchor.BN(MIN_SQRT_PRICE).sub(new anchor.BN(1)),
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x177b/ // SqrtPriceOutOfBounds
    );
  });

  it("fails when FeeTier and tick_spacing passed unmatch", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await buildTestPoolParams(
      ctx,
      TickSpacing.Standard
    );

    // now FeeTier for TickSpacing.Standard is initialized, but not for TickSpacing.Stable
    const config = poolInitInfo.whirlpoolsConfig;
    const feeTierStandardPda = PDAUtil.getFeeTier(ctx.program.programId, config, TickSpacing.Standard)
    const feeTierStablePda = PDAUtil.getFeeTier(ctx.program.programId, config, TickSpacing.Stable);

    const feeTierStandard = await fetcher.getFeeTier(feeTierStandardPda.publicKey, IGNORE_CACHE);
    const feeTierStable = await fetcher.getFeeTier(feeTierStablePda.publicKey, IGNORE_CACHE);
    assert.ok(feeTierStandard !== null); // should be initialized
    assert.ok(feeTierStable === null);  // shoud be NOT initialized

    const whirlpoolWithStableTickSpacing = PDAUtil.getWhirlpool(
      ctx.program.programId,
      config,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintB,
      TickSpacing.Stable,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePoolIx(ctx.program, {
          ...poolInitInfo,
          whirlpoolPda: whirlpoolWithStableTickSpacing,
          tickSpacing: TickSpacing.Stable,
          feeTierKey: feeTierStandardPda.publicKey, // tickSpacing is Stable, but FeeTier is standard    
        })
      ).buildAndExecute(),
      /custom program error: 0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePoolIx(ctx.program, {
          ...poolInitInfo,
          whirlpoolPda: whirlpoolWithStableTickSpacing,
          tickSpacing: TickSpacing.Stable,
          feeTierKey: feeTierStablePda.publicKey, // FeeTier is stable, but not initialized
        })
      ).buildAndExecute(),
      /custom program error: 0xbc4/ // AccountNotInitialized
    );

    await initFeeTier(ctx, configInitInfo, configKeypairs.feeAuthorityKeypair, TickSpacing.Stable, 3000);
    const feeTierStableAfterInit = await fetcher.getFeeTier(feeTierStablePda.publicKey, IGNORE_CACHE);
    assert.ok(feeTierStableAfterInit !== null);

    // Now it should work because FeeTier for stable have been initialized
    await toTx(
      ctx,
      WhirlpoolIx.initializePoolIx(ctx.program, {
        ...poolInitInfo,
        whirlpoolPda: whirlpoolWithStableTickSpacing,
        tickSpacing: TickSpacing.Stable,
        feeTierKey: feeTierStablePda.publicKey,
      })
    ).buildAndExecute();
  })

  it("ignore passed bump", async () => {
    const { poolInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);

    const whirlpoolPda = poolInitInfo.whirlpoolPda;
    const validBump = whirlpoolPda.bump;
    const invalidBump = (validBump + 1) % 256; // +1 shift mod 256
    const modifiedWhirlpoolPda: PDA = {
      publicKey: whirlpoolPda.publicKey,
      bump: invalidBump,
    };

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      whirlpoolPda: modifiedWhirlpoolPda,
    };

    await toTx(ctx, WhirlpoolIx.initializePoolIx(ctx.program, modifiedPoolInitInfo)).buildAndExecute();

    // check if passed invalid bump was ignored
    const whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey)) as WhirlpoolData;
    assert.equal(whirlpool.whirlpoolBump, validBump);
    assert.notEqual(whirlpool.whirlpoolBump, invalidBump);
  });

});
