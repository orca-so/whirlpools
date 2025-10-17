import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData } from "../../../src";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  createMint,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
} from "../../utils";
import { startLiteSVM, createLiteSVMProvider } from "../../utils/litesvm";
import { initializeReward, initTestPool } from "../../utils/init-utils";

describe("initialize_reward (litesvm)", () => {
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

  it("successfully initializes reward at index 0", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const { params } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
    );

    const whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    assert.ok(whirlpool.rewardInfos[0].mint.equals(params.rewardMint));
    assert.ok(
      whirlpool.rewardInfos[0].vault.equals(
        params.rewardVaultKeypair.publicKey,
      ),
    );

    await assert.rejects(
      initializeReward(
        ctx,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        0,
      ),
      /custom program error: 0x178a/, // InvalidRewardIndex
    );

    const { params: params2 } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      1,
    );

    const whirlpool2 = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    assert.ok(whirlpool2.rewardInfos[0].mint.equals(params.rewardMint));
    assert.ok(
      whirlpool2.rewardInfos[0].vault.equals(
        params.rewardVaultKeypair.publicKey,
      ),
    );
    assert.ok(whirlpool2.rewardInfos[1].mint.equals(params2.rewardMint));
    assert.ok(
      whirlpool2.rewardInfos[1].vault.equals(
        params2.rewardVaultKeypair.publicKey,
      ),
    );
    assert.ok(
      whirlpool2.rewardInfos[2].mint.equals(anchor.web3.PublicKey.default),
    );
    assert.ok(
      whirlpool2.rewardInfos[2].vault.equals(anchor.web3.PublicKey.default),
    );
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
    await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      funderKeypair,
    );
  });

  it("fails to initialize reward at index 1", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    await assert.rejects(
      initializeReward(
        ctx,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        1,
      ),
      /custom program error: 0x178a/, // InvalidRewardIndex
    );
  });

  it("fails to initialize reward at out-of-bound index", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    await assert.rejects(
      initializeReward(
        ctx,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        3,
      ),
    );
  });

  it("fails to initialize if authority signature is missing", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializeRewardIx(ctx.program, {
          rewardAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          funder: provider.wallet.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardMint: await createMint(provider),
          rewardVaultKeypair: anchor.web3.Keypair.generate(),
          rewardIndex: 0,
        }),
      ).buildAndExecute(),
    );
  });
});
