import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { generateDefaultConfigParams } from "./utils/test-builders";

describe("set_collect_protocol_fee_authority", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully set_collect_protocol_fee_authority", async () => {
    const {
      configInitInfo,
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
    } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();
    await client
      .setCollectProtocolFeesAuthorityTx({
        whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
        collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
        newCollectProtocolFeesAuthority: newAuthorityKeypair.publicKey,
      })
      .addSigner(collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();
    const config = await client.getConfig(configInitInfo.whirlpoolConfigKeypair.publicKey);
    assert.ok(config.collectProtocolFeesAuthority.equals(newAuthorityKeypair.publicKey));
  });

  it("fails if current collect_protocol_fee_authority is not a signer", async () => {
    const {
      configInitInfo,
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
    } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    await assert.rejects(
      client
        .setCollectProtocolFeesAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          newCollectProtocolFeesAuthority: provider.wallet.publicKey,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails if invalid collect_protocol_fee_authority provided", async () => {
    const { configInitInfo } = generateDefaultConfigParams(context);
    await client.initConfigTx(configInitInfo).buildAndExecute();

    await assert.rejects(
      client
        .setCollectProtocolFeesAuthorityTx({
          whirlpoolsConfig: configInitInfo.whirlpoolConfigKeypair.publicKey,
          collectProtocolFeesAuthority: provider.wallet.publicKey,
          newCollectProtocolFeesAuthority: provider.wallet.publicKey,
        })
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });
});
