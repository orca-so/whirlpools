import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { WhirlpoolContext, AccountFetcher, WhirlpoolData, WhirlpoolIx } from "../../src";
import { TickSpacing, mintToByAuthority, ZERO_BN, createAndMintToTokenAccount } from "../utils";
import { initTestPool, initializeReward } from "../utils/init-utils";

describe("set_reward_emissions", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  const emissionsPerSecondX64 = new anchor.BN(10_000).shln(64).div(new anchor.BN(60 * 60 * 24));

  it("successfully set_reward_emissions", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    const {
      params: { rewardVaultKeypair, rewardMint },
    } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    await mintToByAuthority(provider, rewardMint, rewardVaultKeypair.publicKey, 10000);

    await WhirlpoolIx.setRewardEmissionsIx(ctx, {
      rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
      whirlpool: poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex,
      rewardVaultKey: rewardVaultKeypair.publicKey,
      emissionsPerSecondX64,
    })
      .toTx()
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    let whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      true
    )) as WhirlpoolData;
    assert.ok(whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(emissionsPerSecondX64));

    // Successfuly set emissions back to zero
    await WhirlpoolIx.setRewardEmissionsIx(ctx, {
      rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
      whirlpool: poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex,
      rewardVaultKey: rewardVaultKeypair.publicKey,
      emissionsPerSecondX64: ZERO_BN,
    })
      .toTx()
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    whirlpool = (await fetcher.getPool(poolInitInfo.whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(ZERO_BN));
  });

  it("fails when token vault does not contain at least 1 day of emission runway", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    const {
      params: { rewardVaultKeypair },
    } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    await assert.rejects(
      WhirlpoolIx.setRewardEmissionsIx(ctx, {
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardIndex,
        rewardVaultKey: rewardVaultKeypair.publicKey,
        emissionsPerSecondX64,
      })
        .toTx()
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x178b/ // RewardVaultAmountInsufficient
    );
  });

  it("fails if provided reward vault does not match whirlpool reward vault", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );

    const rewardIndex = 0;
    const {
      params: { rewardVaultKeypair, rewardMint },
    } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    const fakeVault = await createAndMintToTokenAccount(provider, rewardMint, 10000);

    await assert.rejects(
      WhirlpoolIx.setRewardEmissionsIx(ctx, {
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        rewardVaultKey: fakeVault,
        rewardIndex,
        emissionsPerSecondX64,
      })
        .toTx()
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });

  it("cannot set emission for an uninitialized reward", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    await assert.rejects(
      WhirlpoolIx.setRewardEmissionsIx(ctx, {
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        rewardVaultKey: anchor.web3.PublicKey.default,
        rewardIndex: rewardIndex,
        emissionsPerSecondX64,
      })
        .toTx()
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });

  it("cannot set emission without the authority's signature", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    await assert.rejects(
      WhirlpoolIx.setRewardEmissionsIx(ctx, {
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardIndex,
        rewardVaultKey: provider.wallet.publicKey, // TODO fix
        emissionsPerSecondX64,
      })
        .toTx()
        .buildAndExecute(),
      /Signature verification failed/
    );
  });
});
