import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { InitPoolParams, WhirlpoolData } from "../../../src";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { TickSpacing } from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { initTestPool } from "../../utils/init-utils";
import { createInOrderMints } from "../../utils/test-builders";

describe("set_default_protocol_fee_rate (litesvm)", () => {
  let provider: anchor.AnchorProvider;

  let program: anchor.Program;

  let ctx: WhirlpoolContext;

  let fetcher: any;


  beforeAll(async () => {

    await startLiteSVM();

    provider = await createLiteSVMProvider();

    const programId = new anchor.web3.PublicKey(

      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"

    );

    const idl = require("../../../src/artifacts/whirlpool.json");

    program = new anchor.Program(idl, programId, provider);

  // program initialized in beforeAll
  ctx = WhirlpoolContext.fromWorkspace(provider, program);
  fetcher = ctx.fetcher;

  });

  it("successfully set_default_protocol_fee_rate", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolKey = poolInitInfo.whirlpoolPda.publicKey;
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultProtocolFeeRate = 45;

    // Fetch initial whirlpool and check it is default
    let whirlpool_0 = (await fetcher.getPool(whirlpoolKey)) as WhirlpoolData;
    assert.equal(
      whirlpool_0.protocolFeeRate,
      configInitInfo.defaultProtocolFeeRate,
    );

    await toTx(
      ctx,
      WhirlpoolIx.setDefaultProtocolFeeRateIx(ctx.program, {
        whirlpoolsConfig: whirlpoolsConfigKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        defaultProtocolFeeRate: newDefaultProtocolFeeRate,
      }),
    )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    // Setting the default rate did not change existing whirlpool fee rate
    whirlpool_0 = (await fetcher.getPool(whirlpoolKey)) as WhirlpoolData;
    assert.equal(
      whirlpool_0.protocolFeeRate,
      configInitInfo.defaultProtocolFeeRate,
    );

    const [tokenMintA, tokenMintB] = await createInOrderMints(ctx);
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      whirlpoolsConfigKey,
      tokenMintA,
      tokenMintB,
      TickSpacing.Standard,
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
      tickSpacing: TickSpacing.Standard,
    };
    await toTx(
      ctx,
      WhirlpoolIx.initializePoolIx(ctx.program, newPoolInitInfo),
    ).buildAndExecute();

    const whirlpool_1 = (await fetcher.getPool(
      whirlpoolPda.publicKey,
    )) as WhirlpoolData;
    assert.equal(whirlpool_1.protocolFeeRate, newDefaultProtocolFeeRate);
  });

  it("fails when default fee rate exceeds max", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultProtocolFeeRate = 20_000;
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setDefaultProtocolFeeRateIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
          defaultProtocolFeeRate: newDefaultProtocolFeeRate,
        }),
      )
        .addSigner(feeAuthorityKeypair)
        .buildAndExecute(),
      /0x178d/, // ProtocolFeeRateMaxExceeded
    );
  });

  it("fails when fee authority is not a signer", async () => {
    const { configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
    const feeAuthorityKeypair = configKeypairs.feeAuthorityKeypair;

    const newDefaultProtocolFeeRate = 1000;
    await assert.rejects(
      program.rpc.setDefaultProtocolFeeRate(newDefaultProtocolFeeRate, {
        accounts: {
          whirlpoolsConfig: whirlpoolsConfigKey,
          feeAuthority: feeAuthorityKeypair.publicKey,
        },
      }),
      /.*signature verification fail.*/i,
    );
  });

  it("fails when invalid fee authority provided", async () => {
    const { configInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const whirlpoolsConfigKey =
      configInitInfo.whirlpoolsConfigKeypair.publicKey;
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
      /An address constraint was violated/,
    );
  });
});
