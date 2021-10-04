import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { getFeeTierPda, getWhirlpoolPda, InitPoolParams } from "../src";
import { initTestPool } from "./utils/init-utils";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { createInOrderMints, generateDefaultConfigParams } from "./utils/test-builders";
import { TickSpacing } from "./utils";

describe("set_default_fee_rate", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully set_default_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs, feeTierParams } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultFeeRate = 45;

    // Fetch initial whirlpool and check it is default
    let whirlpool_0 = await client.getPool(whirlpoolKey);
    assert.equal(whirlpool_0.feeRate, feeTierParams.defaultFeeRate);

    await client
      .setDefaultFeeRateIx({
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        tickSpacing: TickSpacing.Standard,
        defaultFeeRate: newDefaultFeeRate,
      })
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    // Setting the default rate did not change existing whirlpool fee rate
    whirlpool_0 = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    assert.equal(whirlpool_0.feeRate, feeTierParams.defaultFeeRate);

    // Newly initialized whirlpools have new default fee rate
    const [tokenMintA, tokenMintB] = await createInOrderMints(context);
    const whirlpoolPda = getWhirlpoolPda(
      context.program.programId,
      whirlpoolsConfigKey,
      tokenMintA,
      tokenMintB,
      TickSpacing.Stable
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
      tickSpacing: TickSpacing.Stable,
    };
    await client.initPoolTx(newPoolInitInfo).buildAndExecute();

    const whirlpool_1 = await client.getPool(whirlpoolPda.publicKey);
    assert.equal(whirlpool_1.feeRate, newDefaultFeeRate);
  });

  it("fails when default fee rate exceeds max", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultFeeRate = 20_000;
    await assert.rejects(
      client
        .setDefaultFeeRateIx({
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          tickSpacing: TickSpacing.Standard,
          defaultFeeRate: newDefaultFeeRate,
        })
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178c/ // FeeRateMaxExceeded
    );
  });

  it("fails when fee tier account has not been initialized", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    await assert.rejects(
      client
        .setDefaultFeeRateIx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          tickSpacing: TickSpacing.Standard,
          defaultFeeRate: 500,
        })
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
      /0xbc4/ // AccountNotInitialized
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;
    const feeTierPda = getFeeTierPda(
      context.program.programId,
      configInitInfo.whirlpoolConfigKeypair.publicKey,
      TickSpacing.Standard
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
      /Signature verification failed/
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const { configInitInfo } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const fakeFeeAuthorityKeypair = anchor.web3.Keypair.generate();
    const feeTierPda = getFeeTierPda(
      context.program.programId,
      configInitInfo.whirlpoolConfigKeypair.publicKey,
      TickSpacing.Standard
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
      /An address constraint was violated/ // ConstraintAddress
    );
  });
});
