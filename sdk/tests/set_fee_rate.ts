import * as assert from "assert";
import * as anchor from "@project-serum/anchor";

import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool } from "./utils/init-utils";
import { generateDefaultConfigParams } from "./utils/test-builders";
import { TickSpacing } from "./utils";

describe("set_fee_rate", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully sets_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 50;

    let whirlpool = await client.getPool(whirlpoolKey);

    assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);

    await program.rpc.setFeeRate(newFeeRate, {
      accounts: {
        whirlpoolsConfig: whirlpoolsConfigKey,
        whirlpool: whirlpoolKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
      },
      signers: [feeAuthorityKeypair],
    });

    whirlpool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    assert.equal(whirlpool.feeRate, newFeeRate);
  });

  it("fails when fee rate exceeds max", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newFeeRate = 20_000;
    await assert.rejects(
      client
        .setFeeRateIx({
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        })
        .addSigner(configKeypairs.feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178c/ // FeeRateMaxExceeded
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

    const newFeeRate = 1000;
    await assert.rejects(
      client
        .setFeeRateIx({
          whirlpoolsConfig: whirlpoolsConfigKey,
          whirlpool: whirlpoolKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          feeRate: newFeeRate,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when whirlpool and whirlpools config don't match", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const { configInitInfo: otherConfigInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(otherConfigInitInfo).buildAndExecute();

    const newFeeRate = 1000;
    await assert.rejects(
      context.program.rpc.setFeeRate(newFeeRate, {
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

    const newFeeRate = 1000;
    await assert.rejects(
      context.program.rpc.setFeeRate(newFeeRate, {
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
