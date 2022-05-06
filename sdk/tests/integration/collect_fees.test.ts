import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import Decimal from "decimal.js";
import {
  WhirlpoolContext,
  AccountFetcher,
  PositionData,
  collectFeesQuote,
  TickArrayData,
  TickUtil,
  WhirlpoolData,
  WhirlpoolIx,
  PDAUtil,
  TickArrayUtil,
} from "../../src";
import {
  TickSpacing,
  ZERO_BN,
  createTokenAccount,
  getTokenBalance,
  approveToken,
  transfer,
} from "../utils";
import { WhirlpoolTestFixture } from "../utils/fixture";
import { initTestPool } from "../utils/init-utils";
import { MathUtil } from "@orca-so/common-sdk";

describe("collect_fees", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  it("successfully collect fees", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }, // In range position
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new u64(1_000_000) }, // Out of range position
      ],
    });
    const {
      poolInitInfo: {
        whirlpoolPda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        tokenMintA,
        tokenMintB,
      },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
    const positionBeforeSwap = (await fetcher.getPosition(positions[0].publicKey)) as PositionData;
    assert.ok(positionBeforeSwap.feeOwedA.eq(ZERO_BN));
    assert.ok(positionBeforeSwap.feeOwedB.eq(ZERO_BN));

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    // Accrue fees in token A
    await WhirlpoolIx.swapIx(ctx, {
      amount: new u64(200_000),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: tokenVaultBKeypair.publicKey,
      tickArray0: tickArrayPda.publicKey,
      tickArray1: tickArrayPda.publicKey,
      tickArray2: tickArrayPda.publicKey,
      oracle: oraclePda.publicKey,
    })
      .toTx()
      .buildAndExecute();

    // Accrue fees in token B
    await WhirlpoolIx.swapIx(ctx, {
      amount: new u64(200_000),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
      amountSpecifiedIsInput: true,
      aToB: false,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: tokenVaultBKeypair.publicKey,
      tickArray0: tickArrayPda.publicKey,
      tickArray1: tickArrayPda.publicKey,
      tickArray2: tickArrayPda.publicKey,
      oracle: oraclePda.publicKey,
    })
      .toTx()
      .buildAndExecute();

    await WhirlpoolIx.updateFeesAndRewardsIx(ctx, {
      whirlpool: whirlpoolPda.publicKey,
      position: positions[0].publicKey,
      tickArrayLower: tickArrayPda.publicKey,
      tickArrayUpper: tickArrayPda.publicKey,
    })
      .toTx()
      .buildAndExecute();

    const positionBeforeCollect = (await fetcher.getPosition(
      positions[0].publicKey,
      true
    )) as PositionData;
    assert.ok(positionBeforeCollect.feeOwedA.eq(new u64(581)));
    assert.ok(positionBeforeCollect.feeOwedB.eq(new u64(581)));

    const feeAccountA = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);
    const feeAccountB = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);

    // Generate collect fees expectation
    const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;
    const tickArrayData = (await fetcher.getTickArray(tickArrayPda.publicKey)) as TickArrayData;
    const lowerTick = TickArrayUtil.getTickFromArray(tickArrayData, tickLowerIndex, tickSpacing);
    const upperTick = TickArrayUtil.getTickFromArray(tickArrayData, tickUpperIndex, tickSpacing);
    const expectation = collectFeesQuote({
      whirlpool: whirlpoolData,
      position: positionBeforeCollect,
      tickLower: lowerTick,
      tickUpper: upperTick,
    });

    // Perform collect fees tx
    await WhirlpoolIx.collectFeesIx(ctx, {
      whirlpool: whirlpoolPda.publicKey,
      positionAuthority: provider.wallet.publicKey,
      position: positions[0].publicKey,
      positionTokenAccount: positions[0].tokenAccount,
      tokenOwnerAccountA: feeAccountA,
      tokenOwnerAccountB: feeAccountB,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
    })
      .toTx()
      .buildAndExecute();
    const positionAfter = (await fetcher.getPosition(positions[0].publicKey, true)) as PositionData;
    const feeBalanceA = await getTokenBalance(provider, feeAccountA);
    const feeBalanceB = await getTokenBalance(provider, feeAccountB);

    assert.equal(feeBalanceA, expectation.feeOwedA);
    assert.equal(feeBalanceB, expectation.feeOwedB);
    assert.ok(positionAfter.feeOwedA.eq(ZERO_BN));
    assert.ok(positionAfter.feeOwedB.eq(ZERO_BN));

    // Assert out of range position values
    await WhirlpoolIx.updateFeesAndRewardsIx(ctx, {
      whirlpool: whirlpoolPda.publicKey,
      position: positions[1].publicKey,
      tickArrayLower: positions[1].tickArrayLower,
      tickArrayUpper: positions[1].tickArrayUpper,
    })
      .toTx()
      .buildAndExecute();
    const outOfRangePosition = await fetcher.getPosition(positions[1].publicKey, true);
    assert.ok(outOfRangePosition?.feeOwedA.eq(ZERO_BN));
    assert.ok(outOfRangePosition?.feeOwedB.eq(ZERO_BN));
  });

  it("successfully collect fees with approved delegate", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new u64(10_000_000) }, // In range position
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      positions,
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();
    const position = positions[0];

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, position.tokenAccount, delegate.publicKey, 1);

    await WhirlpoolIx.collectFeesIx(ctx, {
      whirlpool: whirlpoolPda.publicKey,
      positionAuthority: delegate.publicKey,
      position: position.publicKey,
      positionTokenAccount: position.tokenAccount,
      tokenOwnerAccountA: tokenAccountA,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
    })
      .toTx()
      .addSigner(delegate)
      .buildAndExecute();
  });

  it("successfully collect fees with owner even if there is approved delegate", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new u64(10_000_000) }, // In range position
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      positions,
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();
    const position = positions[0];

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, position.tokenAccount, delegate.publicKey, 1);

    await WhirlpoolIx.collectFeesIx(ctx, {
      whirlpool: whirlpoolPda.publicKey,
      positionAuthority: provider.wallet.publicKey,
      position: position.publicKey,
      positionTokenAccount: position.tokenAccount,
      tokenOwnerAccountA: tokenAccountA,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
    })
      .toTx()
      .buildAndExecute();
  });

  it("successfully collect fees with transferred position token", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new u64(10_000_000) }, // In range position
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      positions,
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();
    const position = positions[0];

    const newOwner = anchor.web3.Keypair.generate();
    const newOwnerPositionTokenAccount = await createTokenAccount(
      provider,
      position.mintKeypair.publicKey,
      newOwner.publicKey
    );

    await transfer(provider, position.tokenAccount, newOwnerPositionTokenAccount, 1);

    await WhirlpoolIx.collectFeesIx(ctx, {
      whirlpool: whirlpoolPda.publicKey,
      positionAuthority: newOwner.publicKey,
      position: position.publicKey,
      positionTokenAccount: newOwnerPositionTokenAccount,
      tokenOwnerAccountA: tokenAccountA,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
    })
      .toTx()
      .addSigner(newOwner)
      .buildAndExecute();
  });

  it("fails when position does not match whirlpool", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: { tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const {
      poolInitInfo: { whirlpoolPda: whirlpoolPda2 },
    } = await initTestPool(ctx, tickSpacing);

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda2.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7d1/ // ConstraintHasOne
    );
  });

  it("fails when position token account does not contain exactly one token", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const positionTokenAccount2 = await createTokenAccount(
      provider,
      positions[0].mintKeypair.publicKey,
      provider.wallet.publicKey
    );

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positionTokenAccount2,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await transfer(provider, positions[0].tokenAccount, positionTokenAccount2, 1);

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when position authority is not approved delegate for position token account", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const delegate = anchor.web3.Keypair.generate();

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails when position authority is not authorized to transfer exactly one token", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 2);

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/ // InvalidPositionTokenAmount
    );
  });

  it("fails when position authority is not a signer", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const delegate = anchor.web3.Keypair.generate();
    await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: delegate.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when position token account mint does not equal position mint", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair, tokenMintA },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const fakePositionTokenAccount = await createTokenAccount(
      provider,
      tokenMintA,
      provider.wallet.publicKey
    );

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: fakePositionTokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails when token vault does not match whirlpool token vault", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: {
        whirlpoolPda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        tokenMintA,
        tokenMintB,
      },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const fakeVaultA = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);
    const fakeVaultB = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: fakeVaultA,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: fakeVaultB,
      })
        .toTx()
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fails when owner token account mint does not match whirlpool token mint", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new u64(10_000_000) }],
    });
    const {
      poolInitInfo: {
        whirlpoolPda,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
        tokenMintA,
        tokenMintB,
      },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    const invalidOwnerAccountA = await createTokenAccount(
      provider,
      tokenMintB,
      provider.wallet.publicKey
    );
    const invalidOwnerAccountB = await createTokenAccount(
      provider,
      tokenMintA,
      provider.wallet.publicKey
    );

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: invalidOwnerAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      WhirlpoolIx.collectFeesIx(ctx, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: provider.wallet.publicKey,
        position: positions[0].publicKey,
        positionTokenAccount: positions[0].tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: invalidOwnerAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })
        .toTx()
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });
});
