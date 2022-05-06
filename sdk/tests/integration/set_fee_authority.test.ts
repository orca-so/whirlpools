import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext, AccountFetcher, WhirlpoolsConfigData, WhirlpoolIx } from "../../src";
import { generateDefaultConfigParams } from "../utils/test-builders";

describe("set_fee_authority", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  it("successfully set_fee_authority", async () => {
    const {
      configInitInfo,
      configKeypairs: { feeAuthorityKeypair },
    } = generateDefaultConfigParams(ctx);
    await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();
    await WhirlpoolIx.setFeeAuthorityIx(ctx, {
      whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
      feeAuthority: feeAuthorityKeypair.publicKey,
      newFeeAuthority: newAuthorityKeypair.publicKey,
    })
      .toTx()
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();
    const config = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey
    )) as WhirlpoolsConfigData;
    assert.ok(config.feeAuthority.equals(newAuthorityKeypair.publicKey));
  });

  it("fails if current fee_authority is not a signer", async () => {
    const {
      configInitInfo,
      configKeypairs: { feeAuthorityKeypair },
    } = generateDefaultConfigParams(ctx);
    await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();

    await assert.rejects(
      WhirlpoolIx.setFeeAuthorityIx(ctx, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        newFeeAuthority: provider.wallet.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails if invalid fee_authority provided", async () => {
    const { configInitInfo } = generateDefaultConfigParams(ctx);
    await WhirlpoolIx.initializeConfigIx(ctx, configInitInfo).toTx().buildAndExecute();

    await assert.rejects(
      WhirlpoolIx.setFeeAuthorityIx(ctx, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        feeAuthority: provider.wallet.publicKey,
        newFeeAuthority: provider.wallet.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });
});
