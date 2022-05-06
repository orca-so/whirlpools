import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext, AccountFetcher, WhirlpoolData, WhirlpoolIx } from "../../src";
import { TickSpacing } from "../utils";
import { initTestPool } from "../utils/init-utils";
import { generateDefaultConfigParams } from "../utils/test-builders";

describe("set_protocol_fee_rate", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

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
      WhirlpoolIx.setProtocolFeeRateIx(ctx, {
        whirlpoolsConfig: whirlpoolsConfigKey,
        whirlpool: whirlpoolKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        protocolFeeRate: newProtocolFeeRate,
      })
        .toTx()
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
      WhirlpoolIx.setProtocolFeeRateIx(ctx, {
        whirlpoolsConfig: whirlpoolsConfigKey,
        whirlpool: whirlpoolKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        protocolFeeRate: newProtocolFeeRate,
      })
        .toTx()
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when whirlpool and whirlpools config don't match", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const { configInitInfo: otherConfigInitInfo } = generateDefaultConfigParams(ctx);
    await WhirlpoolIx.initializeConfigIx(ctx, otherConfigInitInfo).toTx().buildAndExecute();

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
      /A has_one constraint was violated/ // ConstraintHasOne
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
