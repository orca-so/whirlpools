import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "../../src";
import { TickSpacing } from "../utils";
import { initTestPool } from "../utils/init-utils";
import { generateDefaultConfigParams } from "../utils/test-builders";

describe("set_protocol_fee_rate", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully sets_protocol_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newProtocolFeeRate = 50;

    let whirlpool = (await fetcher.getPool(whirlpoolKey, true)) as WhirlpoolData;

    assert.equal(whirlpool.protocolFeeRate, configInitInfo.defaultProtocolFeeRate);

    await program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
      accounts: {
        whirlpoolsConfig: whirlpoolsConfigKey,
        whirlpool: whirlpoolKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
      },
      signers: [feeAuthorityKeypair],
    });

    whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.equal(whirlpool.protocolFeeRate, newProtocolFeeRate);
  });

  it("fails when protocol fee rate exceeds max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolsConfigKeypair.publicKey;
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
        })
      )
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178d/ // ProtocolFeeRateMaxExceeded
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

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setProtocolFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          protocolFeeRate: newProtocolFeeRate,
        })
      ).buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when whirlpool and whirlpools config don't match", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const { configInitInfo: otherConfigInitInfo } = generateDefaultConfigParams(ctx);
    await toTx(
      ctx,
      WhirlpoolIx.initializeConfigIx(ctx.program, otherConfigInitInfo)
    ).buildAndExecute();

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      ctx.program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
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
      /An address constraint was violated/ // ConstraintAddress
    );
  });
});
