import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool } from "./utils/init-utils";
import { generateDefaultConfigParams } from "./utils/test-builders";
import { TickSpacing } from "./utils";

describe("set_protocol_fee_rate", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully sets_protocol_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newProtocolFeeRate = 50;

    let whirlpool = await client.getPool(whirlpoolKey);

    assert.equal(whirlpool.protocolFeeRate, configInitInfo.defaultProtocolFeeRate);

    await program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
      accounts: {
        whirlpoolsConfig: whirlpoolsConfigKey,
        whirlpool: whirlpoolKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
      },
      signers: [feeAuthorityKeypair],
    });

    whirlpool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    assert.equal(whirlpool.protocolFeeRate, newProtocolFeeRate);
  });

  it("fails when protocol fee rate exceeds max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newProtocolFeeRate = 3_000;
    await assert.rejects(
      client
        .setProtocolFeeRateIx({
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          protocolFeeRate: newProtocolFeeRate,
        })
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178d/ // ProtocolFeeRateMaxExceeded
    );
  });

  it("fails when fee authority is not signer", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      client
        .setProtocolFeeRateIx({
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          protocolFeeRate: newProtocolFeeRate,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when whirlpool and whirlpools config don't match", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const { configInitInfo: otherConfigInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(otherConfigInitInfo).buildAndExecute();

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      context.program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
        accounts: {
          whirlpoolsConfig: otherConfigInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
        },
        signers: [configKeypairs.feeAuthorityKeypair],
      }),
      /A has_one constraint was violated/ // ConstraintHasOne
    );
  });

  it("fails when fee authority is invalid", async () => {
    const { poolInitInfo, configInitInfo } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const fakeAuthorityKeypair = anchor.web3.Keypair.generate();

    const newProtocolFeeRate = 1000;
    await assert.rejects(
      context.program.rpc.setProtocolFeeRate(newProtocolFeeRate, {
        accounts: {
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolKey,
          feeAuthority: fakeAuthorityKeypair.publicKey,
        },
        signers: [fakeAuthorityKeypair],
      }),
      /An address constraint was violated/ // ConstraintAddress
    );
  });
});
