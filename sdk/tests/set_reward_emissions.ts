import * as anchor from "@project-serum/anchor";
import * as assert from "assert";
import { WhirlpoolClient } from "../src/client";
import { WhirlpoolContext } from "../src/context";
import { createAndMintToTokenAccount, mintToByAuthority, TickSpacing, ZERO_BN } from "./utils";
import { initializeReward, initTestPool } from "./utils/init-utils";

describe("set_reward_emissions", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  const emissionsPerSecondX64 = new anchor.BN(10_000).shln(64).div(new anchor.BN(60 * 60 * 24));

  it("successfully set_reward_emissions", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    const {
      params: { rewardVaultKeypair, rewardMint },
    } = await initializeReward(
      client,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    await mintToByAuthority(provider, rewardMint, rewardVaultKeypair.publicKey, 10000);

    await client
      .setRewardEmissionsTx({
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardIndex,
        rewardVault: rewardVaultKeypair.publicKey,
        emissionsPerSecondX64,
      })
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    let whirlpool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    assert.ok(whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(emissionsPerSecondX64));

    // Successfuly set emissions back to zero
    await client
      .setRewardEmissionsTx({
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardIndex,
        rewardVault: rewardVaultKeypair.publicKey,
        emissionsPerSecondX64: ZERO_BN,
      })
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    whirlpool = await client.getPool(poolInitInfo.whirlpoolPda.publicKey);
    assert.ok(whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(ZERO_BN));
  });

  it("fails when token vault does not contain at least 1 day of emission runway", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    const {
      params: { rewardVaultKeypair },
    } = await initializeReward(
      client,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    await assert.rejects(
      client
        .setRewardEmissionsTx({
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardIndex,
          rewardVault: rewardVaultKeypair.publicKey,
          emissionsPerSecondX64,
        })
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x178b/ // RewardVaultAmountInsufficient
    );
  });

  it("fails if provided reward vault does not match whirlpool reward vault", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    const rewardIndex = 0;
    const {
      params: { rewardVaultKeypair, rewardMint },
    } = await initializeReward(
      client,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    const fakeVault = await createAndMintToTokenAccount(provider, rewardMint, 10000);

    await assert.rejects(
      client
        .setRewardEmissionsTx({
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          rewardVault: fakeVault,
          rewardIndex,
          emissionsPerSecondX64,
        })
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // An address constraint was violated
    );
  });

  it("cannot set emission for an uninitialized reward", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    await assert.rejects(
      client
        .setRewardEmissionsTx({
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          rewardVault: anchor.web3.PublicKey.default,
          rewardIndex: rewardIndex,
          emissionsPerSecondX64,
        })
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0xbbf/ // AccountOwnedByWrongProgram
    );
  });

  it("cannot set emission without the authority's signature", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      client,
      TickSpacing.Standard
    );

    const rewardIndex = 0;

    await initializeReward(
      client,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex
    );

    await assert.rejects(
      client
        .setRewardEmissionsTx({
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardIndex,
          rewardVault: provider.wallet.publicKey, // TODO fix
          emissionsPerSecondX64,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });
});
