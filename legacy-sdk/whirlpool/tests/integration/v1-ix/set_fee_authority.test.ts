import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolsConfigData } from "../../../src";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { defaultConfirmOptions } from "../../utils/const";
import { generateDefaultConfigParams } from "../../utils/test-builders";
import { getLocalnetAdminKeypair0 } from "../../utils";

describe("set_fee_authority", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully set_fee_authority", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const {
      configInitInfo,
      configKeypairs: { feeAuthorityKeypair },
    } = generateDefaultConfigParams(ctx, admin.publicKey);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.setFeeAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        newFeeAuthority: newAuthorityKeypair.publicKey,
      }),
    )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();
    const config = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
    )) as WhirlpoolsConfigData;
    assert.ok(config.feeAuthority.equals(newAuthorityKeypair.publicKey));
  });

  it("fails if current fee_authority is not a signer", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const {
      configInitInfo,
      configKeypairs: { feeAuthorityKeypair },
    } = generateDefaultConfigParams(ctx, admin.publicKey);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          newFeeAuthority: provider.wallet.publicKey,
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });

  it("fails if invalid fee_authority provided", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const { configInitInfo } = generateDefaultConfigParams(
      ctx,
      admin.publicKey,
    );
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setFeeAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          feeAuthority: provider.wallet.publicKey,
          newFeeAuthority: provider.wallet.publicKey,
        }),
      ).buildAndExecute(),
      /0x7dc/, // An address constraint was violated
    );
  });
});
