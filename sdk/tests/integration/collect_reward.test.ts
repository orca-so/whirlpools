import { MathUtil } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  collectRewardsQuote, NUM_REWARDS, PositionData,
  TickArrayData, TickArrayUtil,
  toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx
} from "../../src";
import {
  approveToken, createAndMintToTokenAccount, createMint, createTokenAccount,
  getTokenBalance, sleep, TickSpacing, transfer, ZERO_BN
} from "../utils";
import { WhirlpoolTestFixture } from "../utils/fixture";
import { initTestPool } from "../utils/init-utils";

describe("collect_reward", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, provider.wallet, program);
  const fetcher = ctx.fetcher;

  it("successfully collect rewards", async () => {
    const vaultStartBalance = 1_000_000;
    const lowerTickIndex = -1280,
      upperTickIndex = 1280,
      tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: tickSpacing,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        {
          tickLowerIndex: lowerTickIndex,
          tickUpperIndex: upperTickIndex,
          liquidityAmount: new anchor.BN(1_000_000),
        },
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new u64(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new u64(vaultStartBalance),
        },
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new u64(vaultStartBalance),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    await sleep(500);
    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: positions[0].tickArrayLower,
        tickArrayUpper: positions[0].tickArrayUpper,
      })
    ).buildAndExecute();

    // Generate collect reward expectation
    const pool = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    const positionPreCollect = (await fetcher.getPosition(
      positions[0].publicKey,
      true
    )) as PositionData;
    const tickArrayLower = (await fetcher.getTickArray(
      positions[0].tickArrayLower,
      true
    )) as TickArrayData;

    const tickArrayUpper = (await fetcher.getTickArray(
      positions[0].tickArrayUpper,
      true
    )) as TickArrayData;
    const lowerTick = TickArrayUtil.getTickFromArray(tickArrayLower, lowerTickIndex, tickSpacing);
    const upperTick = TickArrayUtil.getTickFromArray(tickArrayUpper, upperTickIndex, tickSpacing);

    const expectation = collectRewardsQuote({
      whirlpool: pool,
      position: positionPreCollect,
      tickLower: lowerTick,
      tickUpper: upperTick,
    });

    // Perform collect rewards tx
    for (let i = 0; i < NUM_REWARDS; i++) {
      const rewardOwnerAccount = await createTokenAccount(
        provider,
        rewards[i].rewardMint,
        provider.wallet.publicKey
      );

      await toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount: rewardOwnerAccount,
          rewardVault: rewards[i].rewardVaultKeypair.publicKey,
          rewardIndex: i,
        })
      ).buildAndExecute();

      const collectedBalance = parseInt(await getTokenBalance(provider, rewardOwnerAccount));
      assert.ok(collectedBalance === expectation[i]?.toNumber());
      const vaultBalance = parseInt(
        await getTokenBalance(provider, rewards[i].rewardVaultKeypair.publicKey)
      );
      assert.equal(vaultStartBalance - collectedBalance, vaultBalance);
      const position = await fetcher.getPosition(positions[0].publicKey, true);
      assert.equal(position?.rewardInfos[i].amountOwed, 0);
      assert.ok(position?.rewardInfos[i].growthInsideCheckpoint.gte(ZERO_BN));
    }
  });

  it("successfully collect reward with a position authority delegate", async () => {
    const vaultStartBalance = 1_000_000;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
          vaultAmount: new u64(vaultStartBalance),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );

    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: positions[0].tickArrayLower,
        tickArrayUpper: positions[0].tickArrayUpper,
      })
    ).buildAndExecute();

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);

    await toTx(
      ctx,
      WhirlpoolIx.collectRewardIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        rewardOwnerAccount,
        rewardVault: rewards[0].rewardVaultKeypair.publicKey,
        rewardIndex: 0,
      })
    )
      .addSigner(delegate)
      .buildAndExecute();
  });

  it("successfully collect reward with transferred position token", async () => {
    const vaultStartBalance = 1_000_000;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
          vaultAmount: new u64(vaultStartBalance),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );

    const delegate = anchor.web3.Keypair.generate();
    const delegatePositionAccount = await createTokenAccount(
      provider,
      positions[0].mintKeypair.publicKey,
      delegate.publicKey
    );
    await transfer(provider, positions[0].tokenAccount, delegatePositionAccount, 1);

    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: positions[0].tickArrayLower,
        tickArrayUpper: positions[0].tickArrayUpper,
      })
    ).buildAndExecute();

    await toTx(
      ctx,
      WhirlpoolIx.collectRewardIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: delegatePositionAccount,
        rewardOwnerAccount,
        rewardVault: rewards[0].rewardVaultKeypair.publicKey,
        rewardIndex: 0,
      })
    )
      .addSigner(delegate)
      .buildAndExecute();
  });

  it("successfully collect reward with owner even when there is a delegate", async () => {
    const vaultStartBalance = 1_000_000;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        {
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
          vaultAmount: new u64(vaultStartBalance),
        },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );

    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: positions[0].publicKey,
        tickArrayLower: positions[0].tickArrayLower,
        tickArrayUpper: positions[0].tickArrayUpper,
      })
    ).buildAndExecute();

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);

    await toTx(
      ctx,
      WhirlpoolIx.collectRewardIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        rewardOwnerAccount,
        rewardVault: rewards[0].rewardVaultKeypair.publicKey,
        rewardIndex: 0,
      })
    ).buildAndExecute();
  });

  it("fails when reward index references an uninitialized reward", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
    } = fixture.getInfos();
    const fakeRewardMint = await createMint(provider);
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      fakeRewardMint,
      provider.wallet.publicKey
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: anchor.web3.PublicKey.default,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /0xbbf/ // AccountNotInitialized
    );
  });

  it("fails when position does not match whirlpool", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const { positions, rewards } = fixture.getInfos();

    const {
      poolInitInfo: { whirlpoolPda },
    } = await initTestPool(ctx, TickSpacing.Standard);
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /0x7d1/ // ConstraintHasOne
    );
  });

  it("fails when position token account does not have exactly one token", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();

    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );
    const otherPositionAcount = await createTokenAccount(
      provider,
      positions[0].mintKeypair.publicKey,
      provider.wallet.publicKey
    );
    await transfer(provider, positions[0].tokenAccount, otherPositionAcount, 1);
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position token account mint does not match position mint", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenMintA },
      positions,
      rewards,
    } = fixture.getInfos();

    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );

    const fakePositionTokenAccount = await createAndMintToTokenAccount(provider, tokenMintA, 1);
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: fakePositionTokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position authority is not approved delegate for position token account", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );
    const delegate = anchor.web3.Keypair.generate();
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails when position authority is not authorized for exactly one token", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );
    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 2);
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/ // InvalidPositionTokenAmount
    );
  });

  it("fails when position authority was not a signer", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );
    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: delegate.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when reward vault does not match whirlpool reward vault", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      rewards[0].rewardMint,
      provider.wallet.publicKey
    );
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewardOwnerAccount,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fails when reward owner account mint does not match whirlpool reward mint", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenMintA },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      tokenMintA,
      provider.wallet.publicKey
    );
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 0,
        })
      ).buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when reward index is out of bounds", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
      positions: [
        { tickLowerIndex: -1280, tickUpperIndex: 1280, liquidityAmount: new anchor.BN(1_000_000) },
      ],
      rewards: [
        { emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)), vaultAmount: new u64(1_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenMintA },
      positions,
      rewards,
    } = fixture.getInfos();
    const rewardOwnerAccount = await createTokenAccount(
      provider,
      tokenMintA,
      provider.wallet.publicKey
    );
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectRewardIx(ctx.program, {
          whirlpool: whirlpoolPda.publicKey,
          positionAuthority: provider.wallet.publicKey,
          position: positions[0].publicKey,
          positionTokenAccount: positions[0].tokenAccount,
          rewardOwnerAccount,
          rewardVault: rewards[0].rewardVaultKeypair.publicKey,
          rewardIndex: 4,
        })
      ).buildAndExecute(),
      /Program failed to complete/ // index out of bounds
    );
  });
});
