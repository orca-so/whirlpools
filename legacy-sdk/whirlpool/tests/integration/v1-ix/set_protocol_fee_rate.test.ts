import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData, WhirlpoolContext } from "../../../src";
import { toTx, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { getLocalnetAdminKeypair0, TickSpacing } from "../../utils";
import {
  initializeLiteSVMEnvironment,
  pollForCondition,
} from "../../utils/litesvm";
import { initTestPool } from "../../utils/init-utils";
import { generateDefaultConfigParams } from "../../utils/test-builders";
import type { Whirlpool } from "../../../dist/artifacts/whirlpool";

describe("set_protocol_fee_rate", () => {
  let program: anchor.Program<Whirlpool>;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    program = env.program as unknown as anchor.Program<Whirlpool>;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully sets_protocol_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newProtocolFeeRate = 50;

    let whirlpool = (await fetcher.getPool(
      whirlpoolKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    assert.equal(
      whirlpool.protocolFeeRate,
      configInitInfo.defaultProtocolFeeRate,
    );

    const txBuilder = toTx(
      ctx,
      WhirlpoolIx.setProtocolFeeRateIx(program, {
        whirlpool: whirlpoolKey,
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        protocolFeeRate: newProtocolFeeRate,
      }),
    ).addSigner(feeAuthorityKeypair);
    await txBuilder.buildAndExecute();

    whirlpool = await pollForCondition(
      async () =>
        (await fetcher.getPool(
          poolInitInfo.whirlpoolPda.publicKey,
          IGNORE_CACHE,
        )) as WhirlpoolData,
      (p) => p.protocolFeeRate === newProtocolFeeRate,
      { maxRetries: 50, delayMs: 10 },
    );
    assert.equal(whirlpool.protocolFeeRate, newProtocolFeeRate);
  });

  it("fails when protocol fee rate exceeds max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newProtocolFeeRate = 3_000;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setProtocolFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          protocolFeeRate: newProtocolFeeRate,
        }),
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178d/, // ProtocolFeeRateMaxExceeded
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

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setProtocolFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          protocolFeeRate: newProtocolFeeRate,
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

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      ctx.program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
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

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      ctx.program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
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
