import { MathUtil } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { u64 } from "@solana/spl-token";
import * as assert from "assert";
import Decimal from "decimal.js";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "../../src";
import { createTokenAccount, getTokenBalance, TickSpacing, ZERO_BN } from "../utils";
import { WhirlpoolTestFixture } from "../utils/fixture";
import { initTestPool } from "../utils/init-utils";

describe("collect_protocol_fees", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  it("successfully collects fees", async () => {
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
      configKeypairs: { feeAuthorityKeypair, collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    await toTx(
      ctx,
      WhirlpoolIx.setProtocolFeeRateIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        protocolFeeRate: 2500,
      })
    )
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    const poolBefore = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolBefore?.protocolFeeOwedA.eq(ZERO_BN));
    assert.ok(poolBefore?.protocolFeeOwedB.eq(ZERO_BN));

    const tickArrayPda = positions[0].tickArrayLower;

    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

    // Accrue fees in token A
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
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
        tickArray0: tickArrayPda,
        tickArray1: tickArrayPda,
        tickArray2: tickArrayPda,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    // Accrue fees in token B
    await toTx(
      ctx,
      WhirlpoolIx.swapIx(ctx.program, {
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
        tickArray0: tickArrayPda,
        tickArray1: tickArrayPda,
        tickArray2: tickArrayPda,
        oracle: oraclePda.publicKey,
      })
    ).buildAndExecute();

    const poolAfter = (await fetcher.getPool(whirlpoolPda.publicKey, true)) as WhirlpoolData;
    assert.ok(poolAfter?.protocolFeeOwedA.eq(new u64(150)));
    assert.ok(poolAfter?.protocolFeeOwedB.eq(new u64(150)));

    const destA = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);
    const destB = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);

    await toTx(
      ctx,
      WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
        whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: destA,
        tokenOwnerAccountB: destB,
      })
    )
      .addSigner(collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();

    const balanceDestA = await getTokenBalance(provider, destA);
    const balanceDestB = await getTokenBalance(provider, destB);
    assert.equal(balanceDestA, "150");
    assert.equal(balanceDestB, "150");
    assert.ok(poolBefore?.protocolFeeOwedA.eq(ZERO_BN));
    assert.ok(poolBefore?.protocolFeeOwedB.eq(ZERO_BN));
  });

  it("fails to collect fees without the authority's signature", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolsConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
        })
      ).buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when collect_protocol_fees_authority is invalid", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
      configInitInfo: { whirlpoolsConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
        })
      )
        .addSigner(rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fails when whirlpool does not match config", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
      ],
    });
    const {
      poolInitInfo: { tokenVaultAKeypair, tokenVaultBKeypair },
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolsConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();
    const {
      poolInitInfo: { whirlpoolPda: whirlpoolPda2 },
    } = await initTestPool(ctx, tickSpacing);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda2.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
        })
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7d1/ // ConstraintHasOne
    );
  });

  it("fails when vaults do not match whirlpool vaults", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
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
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const fakeVaultA = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);
    const fakeVaultB = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: fakeVaultA,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
        })
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: fakeVaultB,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: tokenAccountB,
        })
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fails when destination mints do not match whirlpool mints", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
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
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKepair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const invalidDestA = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);
    const invalidDestB = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKepair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: invalidDestA,
          tokenOwnerAccountB: tokenAccountB,
        })
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.collectProtocolFeesIx(ctx.program, {
          whirlpoolsConfig: whirlpoolsConfigKepair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenOwnerAccountA: tokenAccountA,
          tokenOwnerAccountB: invalidDestB,
        })
      )
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });
});
