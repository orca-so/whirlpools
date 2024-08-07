import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData } from "../../src";
import { toTx, WhirlpoolContext, WhirlpoolIx } from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import {
  createAndMintToTokenAccount,
  mintToDestination,
  TickSpacing,
  ZERO_BN,
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initializeReward, initTestPool } from "../utils/init-utils";

describe("set_reward_emissions", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const emissionsPerSecondX64 = new anchor.BN(10_000)
    .shln(64)
    .div(new anchor.BN(60 * 60 * 24));

  it("successfully set_reward_emissions", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const rewardIndex = 0;

    const {
      params: { rewardVaultKeypair, rewardMint },
    } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex,
    );

    await mintToDestination(
      provider,
      rewardMint,
      rewardVaultKeypair.publicKey,
      10000,
    );

    await toTx(
      ctx,
      WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardIndex,
        rewardVaultKey: rewardVaultKeypair.publicKey,
        emissionsPerSecondX64,
      }),
    )
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    let whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;
    assert.ok(
      whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(emissionsPerSecondX64),
    );

    // Successfuly set emissions back to zero
    await toTx(
      ctx,
      WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
        rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        rewardIndex,
        rewardVaultKey: rewardVaultKeypair.publicKey,
        emissionsPerSecondX64: ZERO_BN,
      }),
    )
      .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
      .buildAndExecute();

    whirlpool = (await fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
      IGNORE_CACHE,
    )) as WhirlpoolData;
    assert.ok(whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(ZERO_BN));
  });

  it("fails when token vault does not contain at least 1 day of emission runway", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const rewardIndex = 0;

    const {
      params: { rewardVaultKeypair },
    } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardIndex,
          rewardVaultKey: rewardVaultKeypair.publicKey,
          emissionsPerSecondX64,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x178b/, // RewardVaultAmountInsufficient
    );
  });

  it("fails if provided reward vault does not match whirlpool reward vault", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const rewardIndex = 0;
    const {
      params: { rewardMint },
    } = await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex,
    );

    const fakeVault = await createAndMintToTokenAccount(
      provider,
      rewardMint,
      10000,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          rewardVaultKey: fakeVault,
          rewardIndex,
          emissionsPerSecondX64,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/, // An address constraint was violated
    );
  });

  it("cannot set emission for an uninitialized reward", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const rewardIndex = 0;

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          rewardVaultKey: anchor.web3.PublicKey.default,
          rewardIndex: rewardIndex,
          emissionsPerSecondX64,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0xbbf/, // AccountOwnedByWrongProgram
    );
  });

  it("cannot set emission without the authority's signature", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } = await initTestPool(
      ctx,
      TickSpacing.Standard,
    );

    const rewardIndex = 0;

    await initializeReward(
      ctx,
      configKeypairs.rewardEmissionsSuperAuthorityKeypair,
      poolInitInfo.whirlpoolPda.publicKey,
      rewardIndex,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.setRewardEmissionsIx(ctx.program, {
          rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardIndex,
          rewardVaultKey: provider.wallet.publicKey, // TODO fix
          emissionsPerSecondX64,
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });
});
