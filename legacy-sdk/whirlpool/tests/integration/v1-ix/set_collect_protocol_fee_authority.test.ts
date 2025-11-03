import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolsConfigData, WhirlpoolContext } from "../../../src";
import { toTx, WhirlpoolIx } from "../../../src";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import { generateDefaultConfigParams } from "../../utils/test-builders";
import { getLocalnetAdminKeypair0 } from "../../utils";

describe("set_collect_protocol_fee_authority", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully set_collect_protocol_fee_authority", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const {
      configInitInfo,
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
    } = generateDefaultConfigParams(ctx, admin.publicKey);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();
    const newAuthorityKeypair = anchor.web3.Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.setCollectProtocolFeesAuthorityIx(ctx.program, {
        whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
        collectProtocolFeesAuthority:
          collectProtocolFeesAuthorityKeypair.publicKey,
        newCollectProtocolFeesAuthority: newAuthorityKeypair.publicKey,
      }),
    )
      .addSigner(collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();
    const config = (await fetcher.getConfig(
      configInitInfo.whirlpoolsConfigKeypair.publicKey,
    )) as WhirlpoolsConfigData;
    assert.ok(
      config.collectProtocolFeesAuthority.equals(newAuthorityKeypair.publicKey),
    );
  });

  it("fails if current collect_protocol_fee_authority is not a signer", async () => {
    const admin = await getLocalnetAdminKeypair0(ctx);
    const {
      configInitInfo,
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
    } = generateDefaultConfigParams(ctx, admin.publicKey);
    await toTx(ctx, WhirlpoolIx.initializeConfigIx(ctx.program, configInitInfo))
      .addSigner(admin)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setCollectProtocolFeesAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          collectProtocolFeesAuthority:
            collectProtocolFeesAuthorityKeypair.publicKey,
          newCollectProtocolFeesAuthority: provider.wallet.publicKey,
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });

  it("fails if invalid collect_protocol_fee_authority provided", async () => {
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
        WhirlpoolIx.setCollectProtocolFeesAuthorityIx(ctx.program, {
          whirlpoolsConfig: configInitInfo.whirlpoolsConfigKeypair.publicKey,
          collectProtocolFeesAuthority: provider.wallet.publicKey,
          newCollectProtocolFeesAuthority: provider.wallet.publicKey,
        }),
      ).buildAndExecute(),
      /0x7dc/, // An address constraint was violated
    );
  });
});
