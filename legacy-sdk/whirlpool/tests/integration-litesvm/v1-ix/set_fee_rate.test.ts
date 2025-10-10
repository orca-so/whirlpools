import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData } from "../../../src";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { getLocalnetAdminKeypair0, TickSpacing } from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { initTestPool } from "../../utils/init-utils";
import { generateDefaultConfigParams } from "../../utils/test-builders";

describe("set_fee_rate (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);

  // program initialized in beforeAll
  ctx = WhirlpoolContext.fromWorkspace(provider, program);
  fetcher = ctx.fetcher;

  });

  it("successfully sets_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } =
      await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 50;

    let whirlpool = (await fetcher.getPool(
      whirlpoolKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);

    const setFeeRateTx = toTx(
      ctx,
      WhirlpoolIx.setFeeRateIx(program, {
        whirlpool: whirlpoolKey,
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        feeRate: newFeeRate,
      }),
    ).addSigner(feeAuthorityKeypair);
    await setFeeRateTx.buildAndExecute();

    whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;
    assert.equal(whirlpool.feeRate, newFeeRate);
  });

  it("successfully sets_fee_rate max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } =
      await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 60_000;

    let whirlpool = (await fetcher.getPool(
      whirlpoolKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);

    const setFeeRateTx = toTx(
      ctx,
      WhirlpoolIx.setFeeRateIx(program, {
        whirlpool: whirlpoolKey,
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        feeRate: newFeeRate,
      }),
    ).addSigner(feeAuthorityKeypair);
    await setFeeRateTx.buildAndExecute();

    whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;
    assert.equal(whirlpool.feeRate, newFeeRate);
  });

  it("fails when fee rate exceeds max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 60_000 + 1;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178c/, // FeeRateMaxExceeded
    );
  });

  it("fails when fee authority is not signer", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
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
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });

  it("fails when whirlpool and whirlpools config don't match", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const admin = await getLocalnetAdminKeypair0(ctx);
    const { configInitInfo: otherConfigInitInfo } = generateDefaultConfigParams(
      ctx,
      admin.publicKey,
    );
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, otherConfigInitInfo),
    )
      .addSigner(admin)
      .buildAndExecute();

    const newFeeRate = 1000;
    await assert.rejects(
      ctx.program.rpc.setFeeRate(newFeeRate, {
        accounts: {
          whirlpoolsConfig:
            otherConfigInitInfo.whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
        },
        signers: [configKeypairs.feeAuthorityKeypair],
      }),
      // message have been changed
      // https://github.com/coral-xyz/anchor/pull/2101/files#diff-e564d6832afe5358ef129e96970ba1e5180b5e74aba761831e1923c06d7b839fR412
      /A has[_ ]one constraint was violated/, // ConstraintHasOne
    );
  });

  it("fails when fee authority is invalid", async () => {
    const { poolInitInfo, configInitInfo } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
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
      /An address constraint was violated/, // ConstraintAddress
    );
  });
});
