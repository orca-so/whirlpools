import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "../../src";
import { PREFER_REFRESH } from "../../src/network/public/account-fetcher";
import { TickSpacing } from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool } from "../utils/init-utils";
import { generateDefaultConfigParams } from "../utils/test-builders";

describe("set_fee_rate", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully sets_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 50;

    let whirlpool = (await fetcher.getPool(whirlpoolKey, PREFER_REFRESH)) as WhirlpoolData;

    assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);

    const setFeeRateTx = toTx(ctx, WhirlpoolIx.setFeeRateIx(program, {
      whirlpool: whirlpoolKey,
      whirlpoolsConfig: whirlpoolsConfigKey,
      feeAuthority: feeAuthorityKeypair.publicKey,
      feeRate: newFeeRate
    })).addSigner(feeAuthorityKeypair);
    await setFeeRateTx.buildAndExecute();

    whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey, PREFER_REFRESH)) as WhirlpoolData;
    assert.equal(whirlpool.feeRate, newFeeRate);
  });

  it("fails when fee rate exceeds max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 20_000;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        })
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178c/ // FeeRateMaxExceeded
    );
  });

  it("fails when fee authority is not signer", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 1000;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        })
      ).buildAndExecute(),
      /.*signature verification fail.*/i
    );
  });

  it("fails when whirlpool and whirlpools config don't match", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const { configInitInfo: otherConfigInitInfo } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, otherConfigInitInfo)
    ).buildAndExecute();

    const newFeeRate = 1000;
    await assert.rejects(
      ctx.program.rpc.setFeeRate(newFeeRate, {
        accounts: {
          whirlpoolsConfig: otherConfigInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
        },
        signers: [configKeypairs.feeAuthorityKeypair],
      }),
      // message have been changed
      // https://github.com/coral-xyz/anchor/pull/2101/files#diff-e564d6832afe5358ef129e96970ba1e5180b5e74aba761831e1923c06d7b839fR412
      /A has[_ ]one constraint was violated/ // ConstraintHasOne
    );
  });

  it("fails when fee authority is invalid", async () => {
    const { poolInitInfo, configInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;

    const fakeAuthorityKeypair = anchor.web3.Keypair.generate();

    const newFeeRate = 1000;
    await assert.rejects(
      ctx.program.rpc.setFeeRate(newFeeRate, {
        accounts: {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolKey,
          feeAuthority: fakeAuthorityKeypair.publicKey,
        },
        signers: [fakeAuthorityKeypair],
      }),
      /An address constraint was violated/ // ConstraintAddress
    );
  });
});
