import * as anchor from "@coral-xyz/anchor";
import { MathUtil, PDA } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  InitPoolV2Params,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PDAUtil,
  PriceMath,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx,
  toTx
} from "../../../src";
import {
  ONE_SOL,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  asyncAssertTokenVault,
  systemTransferTx
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { buildTestPoolV2Params, initTestPoolV2 } from "../../utils/v2/init-utils-v2";
import { TokenTrait } from "../../utils/v2/init-utils-v2";
import { asyncAssertOwnerProgram, asyncAssertTokenVaultV2, createMintV2 } from "../../utils/v2/token-2022";

describe("initialize_pool_v2", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tokenTraitVariations: {tokenTraitA: TokenTrait, tokenTraitB: TokenTrait}[] = [
    {tokenTraitA: {isToken2022: false}, tokenTraitB: {isToken2022: false} },
    {tokenTraitA: {isToken2022: true}, tokenTraitB: {isToken2022: false} },
    {tokenTraitA: {isToken2022: false}, tokenTraitB: {isToken2022: true} },
    {tokenTraitA: {isToken2022: true}, tokenTraitB: {isToken2022: true} },
  ];
  tokenTraitVariations.forEach((tokenTraits) => {
    describe(`tokenTraitA: ${tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"}, tokenTraitB: ${tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"}`, () => {


  it("successfully init a Standard account", async () => {
    const price = MathUtil.toX64(new Decimal(5));
    const { configInitInfo, poolInitInfo, feeTierParams } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
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
    await asyncAssertOwnerProgram(provider, whirlpool.tokenMintA, tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);

    assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
    assert.ok(whirlpool.tokenVaultB.equals(poolInitInfo.tokenVaultBKeypair.publicKey));
    await asyncAssertOwnerProgram(provider, whirlpool.tokenMintB, tokenTraits.tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);

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

    await asyncAssertTokenVaultV2(
      provider,
      poolInitInfo.tokenVaultAKeypair.publicKey,
      poolInitInfo.tokenMintA,
      poolInitInfo.whirlpoolPda.publicKey,
      tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID
    );
    await asyncAssertTokenVaultV2(
      provider,
      poolInitInfo.tokenVaultBKeypair.publicKey,
      poolInitInfo.tokenMintB,
      poolInitInfo.whirlpoolPda.publicKey,
      tokenTraits.tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID
    );

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
    const { configInitInfo, poolInitInfo, feeTierParams } = await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Stable,
      price
    );
    const whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey)) as WhirlpoolData;

    assert.ok(whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig));

    assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
    assert.ok(whirlpool.tokenVaultA.equals(poolInitInfo.tokenVaultAKeypair.publicKey));
    await asyncAssertOwnerProgram(provider, whirlpool.tokenMintA, tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);

    assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
    assert.ok(whirlpool.tokenVaultB.equals(poolInitInfo.tokenVaultBKeypair.publicKey));
    await asyncAssertOwnerProgram(provider, whirlpool.tokenMintB, tokenTraits.tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID);

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

    await asyncAssertTokenVaultV2(
      provider,
      poolInitInfo.tokenVaultAKeypair.publicKey,
      poolInitInfo.tokenMintA,
      poolInitInfo.whirlpoolPda.publicKey,
      tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID
    );
    await asyncAssertTokenVaultV2(
      provider,
      poolInitInfo.tokenVaultBKeypair.publicKey,
      poolInitInfo.tokenMintB,
      poolInitInfo.whirlpoolPda.publicKey,
      tokenTraits.tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID
    );

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
    await initTestPoolV2(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard,
      MathUtil.toX64(new Decimal(5)),
      funderKeypair
    );
  });

  it("fails when tokenVaultA mint does not match tokenA mint", async () => {
    const { poolInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );
    const otherTokenPublicKey = await createMintV2(provider, tokenTraits.tokenTraitA);

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      tokenMintA: otherTokenPublicKey,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x7d6/ // ConstraintSeeds
    );
  });

  it("fails when tokenVaultB mint does not match tokenB mint", async () => {
    const { poolInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );
    const otherTokenPublicKey = await createMintV2(provider, tokenTraits.tokenTraitB);

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      tokenMintB: otherTokenPublicKey,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x7d6/ // ConstraintSeeds
    );
  });

  it("fails when token mints are in the wrong order", async () => {
    const { poolInitInfo, configInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );

    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      poolInitInfo.tokenMintB,
      poolInitInfo.tokenMintA,
      TickSpacing.Stable
    );

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      whirlpoolPda,
      tickSpacing: TickSpacing.Stable,
      tokenMintA: poolInitInfo.tokenMintB,
      tokenBadgeA: poolInitInfo.tokenBadgeB,
      tokenProgramA: tokenTraits.tokenTraitB.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
      tokenMintB: poolInitInfo.tokenMintA,
      tokenBadgeB: poolInitInfo.tokenBadgeA,
      tokenProgramB: tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x1788/ // InvalidTokenMintOrder
    );
  });

  it("fails when the same token mint is passed in", async () => {
    const { poolInitInfo, configInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );

    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintA,
      TickSpacing.Stable
    );

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      whirlpoolPda,
      tickSpacing: TickSpacing.Stable,
      tokenMintB: poolInitInfo.tokenMintA,
      tokenBadgeB: poolInitInfo.tokenBadgeA,
      tokenProgramB: tokenTraits.tokenTraitA.isToken2022 ? TEST_TOKEN_2022_PROGRAM_ID : TEST_TOKEN_PROGRAM_ID,
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x1788/ // InvalidTokenMintOrder
    );
  });

  it("fails when sqrt-price exceeds max", async () => {
    const { poolInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      initSqrtPrice: new anchor.BN(MAX_SQRT_PRICE).add(new anchor.BN(1)),
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x177b/ // SqrtPriceOutOfBounds
    );
  });

  it("fails when sqrt-price subceeds min", async () => {
    const { poolInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      initSqrtPrice: new anchor.BN(MIN_SQRT_PRICE).sub(new anchor.BN(1)),
    };

    await assert.rejects(
      toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute(),
      /custom program error: 0x177b/ // SqrtPriceOutOfBounds
    );
  });

  it("ignore passed bump", async () => {
    const { poolInitInfo } = await buildTestPoolV2Params(
      ctx,
      tokenTraits.tokenTraitA,
      tokenTraits.tokenTraitB,
      TickSpacing.Standard
    );

    const whirlpoolPda = poolInitInfo.whirlpoolPda;
    const validBump = whirlpoolPda.bump;
    const invalidBump = (validBump + 1) % 256; // +1 shift mod 256
    const modifiedWhirlpoolPda: PDA = {
      publicKey: whirlpoolPda.publicKey,
      bump: invalidBump,
    };

    const modifiedPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      whirlpoolPda: modifiedWhirlpoolPda,
    };

    await toTx(ctx, WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)).buildAndExecute();

    // check if passed invalid bump was ignored
    const whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey)) as WhirlpoolData;
    assert.equal(whirlpool.whirlpoolBump, validBump);
    assert.notEqual(whirlpool.whirlpoolBump, invalidBump);
  });

  });
  });

});
