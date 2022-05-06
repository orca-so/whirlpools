import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import Decimal from "decimal.js";
import {
  WhirlpoolContext,
  AccountFetcher,
  WhirlpoolData,
  InitPoolParams,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PriceMath,
  WhirlpoolIx,
  PDAUtil,
} from "../../src";
import {
  TickSpacing,
  ZERO_BN,
  asyncAssertTokenVault,
  systemTransferTx,
  ONE_SOL,
  createMint,
} from "../utils";
import { initTestPool, buildTestPoolParams } from "../utils/init-utils";
import { MathUtil } from "@orca-so/common-sdk";

describe("initialize_pool", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

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
      WhirlpoolIx.initializePoolIx(ctx, modifiedPoolInitInfo).toTx().buildAndExecute(),
      /failed to complete|seeds|unauthorized/
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
      WhirlpoolIx.initializePoolIx(ctx, modifiedPoolInitInfo).toTx().buildAndExecute(),
      /failed to complete|seeds|unauthorized/
    );
  });

  it("fails when token mints are in the wrong order", async () => {
    const { poolInitInfo, configInitInfo } = await buildTestPoolParams(ctx, TickSpacing.Standard);

    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      poolInitInfo.tokenMintB,
      poolInitInfo.tokenMintA,
      TickSpacing.Stable
    );

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      whirlpoolPda,
      tickSpacing: TickSpacing.Stable,
      tokenMintA: poolInitInfo.tokenMintB,
      tokenMintB: poolInitInfo.tokenMintA,
    };

    await assert.rejects(
      WhirlpoolIx.initializePoolIx(ctx, modifiedPoolInitInfo).toTx().buildAndExecute(),
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
      TickSpacing.Stable
    );

    const modifiedPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      whirlpoolPda,
      tickSpacing: TickSpacing.Stable,
      tokenMintB: poolInitInfo.tokenMintA,
    };

    await assert.rejects(
      WhirlpoolIx.initializePoolIx(ctx, modifiedPoolInitInfo).toTx().buildAndExecute(),
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
      WhirlpoolIx.initializePoolIx(ctx, modifiedPoolInitInfo).toTx().buildAndExecute(),
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
      WhirlpoolIx.initializePoolIx(ctx, modifiedPoolInitInfo).toTx().buildAndExecute(),
      /custom program error: 0x177b/ // SqrtPriceOutOfBounds
    );
  });
});
