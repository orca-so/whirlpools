import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext, AccountFetcher, WhirlpoolData, WhirlpoolIx } from "../../src";
import { TickSpacing, systemTransferTx, ONE_SOL, createMint } from "../utils";
import { initTestPool, initializeReward } from "../utils/init-utils";
import { toTx } from "../../src/utils/instructions-util";

describe("initialize_reward", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  it("successfully initializes reward at index 0", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);

    const { params } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      0
    );

    const whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      true
    )) as WhirlpoolData;

    assert.ok(whirlpool.rewardInfos[0].mint.equals(params.rewardMint));
    assert.ok(whirlpool.rewardInfos[0].vault.equals(params.rewardVaultKeypair.publicKey));

    await assert.rejects(
      initializeReward(
        ctx,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        0
      ),
      /custom program error: 0x178a/ // InvalidRewardIndex
    );

    const { params: params2 } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      1
    );

    const whirlpool2 = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      true
    )) as WhirlpoolData;

    assert.ok(whirlpool2.rewardInfos[0].mint.equals(params.rewardMint));
    assert.ok(whirlpool2.rewardInfos[0].vault.equals(params.rewardVaultKeypair.publicKey));
    assert.ok(whirlpool2.rewardInfos[1].mint.equals(params2.rewardMint));
    assert.ok(whirlpool2.rewardInfos[1].vault.equals(params2.rewardVaultKeypair.publicKey));
    assert.ok(whirlpool2.rewardInfos[2].mint.equals(anchor.web3.PublicKey.default));
    assert.ok(whirlpool2.rewardInfos[2].vault.equals(anchor.web3.PublicKey.default));
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
    await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      funderKeypair
    );
  });

  it("fails to initialize reward at index 1", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);

    await assert.rejects(
      initializeReward(
        ctx,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        1
      ),
      /custom program error: 0x178a/ // InvalidRewardIndex
    );
  });

  it("fails to initialize reward at out-of-bound index", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);

    await assert.rejects(
      initializeReward(
        ctx,
        configKeypairs.rewardEmissionsSuperAuthorityKeypair,
        poolInitInfo.whirlpoolPda.publicKey,
        3
      )
    );
  });

  it("fails to initialize if authority signature is missing", async () => {
    const { poolInitInfo, configKeypairs } = await initTestPool(ctx, TickSpacing.Standard);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializeRewardIx(ctx.program, {
          rewardAuthority: configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          funder: provider.wallet.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardMint: await createMint(provider),
          rewardVaultKeypair: anchor.web3.Keypair.generate(),
          rewardIndex: 0,
        })
      ).buildAndExecute()
    );
  });
});
