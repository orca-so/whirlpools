import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { getWhirlpoolPda, InitPoolParams } from "../src";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool } from "./utils/init-utils";
import { createInOrderMints } from "./utils/test-builders";
import { TickSpacing } from "./utils";

describe("set_default_protocol_fee_rate", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully set_default_protocol_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultProtocolFeeRate = 45;

    // Fetch initial whirlpool and check it is default
    let whirlpool_0 = await client.getPool(whirlpoolKey);
    assert.equal(whirlpool_0.protocolFeeRate, configInitInfo.defaultProtocolFeeRate);

    await client
      .setDefaultProtocolFeeRateIx({
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        defaultProtocolFeeRate: newDefaultProtocolFeeRate,
      })
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    // Setting the default rate did not change existing whirlpool fee rate
    whirlpool_0 = await client.getPool(whirlpoolKey);
    assert.equal(whirlpool_0.protocolFeeRate, configInitInfo.defaultProtocolFeeRate);

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
    assert.equal(whirlpool_1.protocolFeeRate, newDefaultProtocolFeeRate);
  });

  it("fails when default fee rate exceeds max", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultProtocolFeeRate = 20_000;
    await assert.rejects(
      client
        .setDefaultProtocolFeeRateIx({
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          defaultProtocolFeeRate: newDefaultProtocolFeeRate,
        })
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178d/ // ProtocolFeeRateMaxExceeded
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(client, TickSpacing.Standard);
    const whirlpoolsConfigKey = configInitInfo.whirlpoolConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultProtocolFeeRate = 1000;
    await assert.rejects(
      program.rpc.setDefaultProtocolFeeRate(newDefaultProtocolFeeRate, {
        accounts: {
          whirlpoolsConfig: whirlpoolsConfigKey,
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

    const newDefaultProtocolFeeRate = 1000;
    await assert.rejects(
      program.rpc.setDefaultProtocolFeeRate(newDefaultProtocolFeeRate, {
        accounts: {
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeAuthority: fakeFeeAuthorityKeypair.publicKey,
        },
        signers: [fakeFeeAuthorityKeypair],
      }),
      /An address constraint was violated/
    );
  });
});
