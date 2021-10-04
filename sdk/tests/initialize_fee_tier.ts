import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initFeeTier } from "./utils/init-utils";
import {
  generateDefaultConfigParams,
  generateDefaultInitFeeTierParams,
} from "./utils/test-builders";
import { getFeeTierPda } from "../src";
import { systemTransferTx, ONE_SOL, TickSpacing } from "./utils";

describe("initialize_fee_tier", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully init a FeeRate stable account", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    const testTickSpacing = TickSpacing.Stable;
    const { params } = await initFeeTier(
      client,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      testTickSpacing,
      800
    );

    const generatedPda = getFeeTierPda(
      client.context.program.programId,
      configInitInfo.whirlpoolConfigKeypair.publicKey,
      testTickSpacing
    );

    const feeTierAccount = await client.getFeeTier(generatedPda.publicKey);

    assert.ok(feeTierAccount.tickSpacing == params.tickSpacing);
    assert.ok(feeTierAccount.defaultFeeRate == params.defaultFeeRate);
  });

  it("successfully init a FeeRate standard account", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    const testTickSpacing = TickSpacing.Standard;
    const { params } = await initFeeTier(
      client,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      testTickSpacing,
      3000
    );

    const feeTierAccount = await client.getFeeTier(params.feeTierPda.publicKey);

    assert.ok(feeTierAccount.tickSpacing == params.tickSpacing);
    assert.ok(feeTierAccount.defaultFeeRate == params.defaultFeeRate);
  });

  it("successfully init a FeeRate with another funder wallet", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();

    await initFeeTier(
      client,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      TickSpacing.Stable,
      3000,
      funderKeypair
    );
  });

  it("fails when default fee rate exceeds max", async () => {
    const { configInitInfo, configKeypairs } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    await assert.rejects(
      initFeeTier(
        client,
        configInitInfo,
        configKeypairs.feeAuthorityKeypair,
        TickSpacing.Stable,
        20_000
      ),
      /0x178c/ // FeeRateMaxExceeded
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    await assert.rejects(
      client
        .initFeeTierTx(
          generateDefaultInitFeeTierParams(
            client.context,
            configInitInfo.whirlpoolConfigKeypair.publicKey,
            configInitInfo.feeAuthority,
            TickSpacing.Stable,
            3000
          )
        )
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const { configInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();
    const fakeFeeAuthorityKeypair = anchor.web3.Keypair.generate();

    await assert.rejects(
      client
        .initFeeTierTx(
          generateDefaultInitFeeTierParams(
            client.context,
            configInitInfo.whirlpoolConfigKeypair.publicKey,
            fakeFeeAuthorityKeypair.publicKey,
            TickSpacing.Stable,
            3000
          )
        )
        .addSigner(fakeFeeAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });
});
