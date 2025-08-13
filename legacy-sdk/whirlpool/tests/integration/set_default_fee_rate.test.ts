import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { InitPoolParams, WhirlpoolData } from "../../src";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../src";
import { getLocalnetAdminKeypair0, TickSpacing } from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool } from "../utils/init-utils";
import {
  createInOrderMints,
  generateDefaultConfigParams,
} from "../utils/test-builders";

describe("set_default_fee_rate", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully set_default_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } =
      await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultFeeRate = 45;

    // Fetch initial whirlpool and check it is default
    let whirlpool_0 = (await fetcher.getPool(whirlpoolKey)) as WhirlpoolData;
    assert.equal(whirlpool_0.feeRate, feeTierParams.defaultFeeRate);

    await toTx(
      ctx,
      WhirlpoolIx.setDefaultFeeRateIx(ctx.program, {
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        tickSpacing: TickSpacing.Standard,
        defaultFeeRate: newDefaultFeeRate,
      }),
    )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    // Setting the default rate did not change existing whirlpool fee rate
    whirlpool_0 = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
    )) as WhirlpoolData;
    assert.equal(whirlpool_0.feeRate, feeTierParams.defaultFeeRate);

    // Newly initialized whirlpools have new default fee rate
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      whirlpoolsConfigKey,
      tokenMintA,
      tokenMintB,
      TickSpacing.Standard,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();

    const newPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      tokenMintA,
      tokenMintB,
      whirlpoolPda,
      tokenVaultAKeypair,
      tokenVaultBKeypair,
      tickSpacing: TickSpacing.Standard,
    };
    await toTx(
      ctx,
      WhirlpoolIx.initializePoolIx(ctx.program, newPoolInitInfo),
    ).buildAndExecute();

    const whirlpool_1 = (await fetcher.getPool(
      whirlpoolPda.publicKey,
    )) as WhirlpoolData;
    assert.equal(whirlpool_1.feeRate, newDefaultFeeRate);
  });

  it("successfully set_default_fee_rate max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultFeeRate = 60_000;

    await toTx(
      ctx,
      WhirlpoolIx.setDefaultFeeRateIx(ctx.program, {
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        tickSpacing: TickSpacing.Standard,
        defaultFeeRate: newDefaultFeeRate,
      }),
    )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    // Newly initialized whirlpools have new default fee rate
    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      whirlpoolsConfigKey,
      tokenMintA,
      tokenMintB,
      TickSpacing.Standard,
    );
    const tokenVaultAKeypair = anchor.web3.Keypair.generate();
    const tokenVaultBKeypair = anchor.web3.Keypair.generate();

    const newPoolInitInfo: InitPoolParams = {
      ...poolInitInfo,
      tokenMintA,
      tokenMintB,
      whirlpoolPda,
      tokenVaultAKeypair,
      tokenVaultBKeypair,
      tickSpacing: TickSpacing.Standard,
    };
    await toTx(
      ctx,
      WhirlpoolIx.initializePoolIx(ctx.program, newPoolInitInfo),
    ).buildAndExecute();

    const whirlpool_1 = (await fetcher.getPool(
      whirlpoolPda.publicKey,
    )) as WhirlpoolData;
    assert.equal(whirlpool_1.feeRate, newDefaultFeeRate);
  });

  it("fails when default fee rate exceeds max", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultFeeRate = 60_000 + 1;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDefaultFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          tickSpacing: TickSpacing.Standard,
          defaultFeeRate: newDefaultFeeRate,
        }),
      )
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178c/, // FeeRateMaxExceeded
    );
  });

  it("fails when fee tier account has not been initialized", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(
      ctx,
      admin.publicKey,
    );
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDefaultFeeRateIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          tickSpacing: TickSpacing.Standard,
          defaultFeeRate: 500,
        }),
      )
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
      /0xbc4/, // AccountNotInitialized
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;
    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      TickSpacing.Standard,
    );

    const newDefaultFeeRate = 1000;
    await assert.rejects(
      program.rpc.setDefaultFeeRate(newDefaultFeeRate, {
        accounts: {
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeTier: feeTierPda.publicKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
        },
      }),
      /.*signature verification fail.*/i,
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const { configInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const fakeFeeAuthorityKeypair = anchor.web3.Keypair.generate();
    const feeTierPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
      TickSpacing.Standard,
    );

    const newDefaultFeeRate = 1000;
    await assert.rejects(
      program.rpc.setDefaultFeeRate(newDefaultFeeRate, {
        accounts: {
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeTier: feeTierPda.publicKey,
          feeAuthority: fakeFeeAuthorityKeypair.publicKey,
        },
        signers: [fakeFeeAuthorityKeypair],
      }),
      /An address constraint was violated/, // ConstraintAddress
    );
  });
});
