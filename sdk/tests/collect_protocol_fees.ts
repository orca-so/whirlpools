import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool } from "./utils/init-utils";
import { getOraclePda, toX64 } from "../src";
import { WhirlpoolTestFixture } from "./utils/fixture";
import { u64 } from "@solana/spl-token";
import Decimal from "decimal.js";
import { createTokenAccount, getTokenBalance, TickSpacing, ZERO_BN } from "./utils";

describe("collect_protocol_fees", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully collects fees", async () => {
    // In same tick array - start index 22528
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
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
      configInitInfo: { whirlpoolConfigKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();

    await client
      .setProtocolFeeRateIx({
        whirlpool: whirlpoolPda.publicKey,
        whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
        feeAuthority: feeAuthorityKeypair.publicKey,
        protocolFeeRate: 2500,
      })
      .addSigner(feeAuthorityKeypair)
      .buildAndExecute();

    const poolBefore = await client.getPool(whirlpoolPda.publicKey);
    assert.ok(poolBefore.protocolFeeOwedA.eq(ZERO_BN));
    assert.ok(poolBefore.protocolFeeOwedB.eq(ZERO_BN));

    const tickArrayPda = positions[0].tickArrayLower;

    const oraclePda = getOraclePda(client.context.program.programId, whirlpoolPda.publicKey);

    // Accrue fees in token A
    await client
      .swapTx({
        amount: new u64(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: toX64(new Decimal(4)),
        amountSpecifiedIsInput: true,
        aToB: true,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda,
        tickArray1: tickArrayPda,
        tickArray2: tickArrayPda,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    // Accrue fees in token B
    await client
      .swapTx({
        amount: new u64(200_000),
        otherAmountThreshold: ZERO_BN,
        sqrtPriceLimit: toX64(new Decimal(5)),
        amountSpecifiedIsInput: true,
        aToB: false,
        whirlpool: whirlpoolPda.publicKey,
        tokenAuthority: context.wallet.publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tickArray0: tickArrayPda,
        tickArray1: tickArrayPda,
        tickArray2: tickArrayPda,
        oracle: oraclePda.publicKey,
      })
      .buildAndExecute();

    const poolAfter = await client.getPool(whirlpoolPda.publicKey);
    assert.ok(poolAfter.protocolFeeOwedA.eq(new u64(150)));
    assert.ok(poolAfter.protocolFeeOwedB.eq(new u64(150)));

    const destA = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);
    const destB = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);

    await client
      .collectProtocolFeesTx({
        whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
        whirlpool: whirlpoolPda.publicKey,
        collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        tokenDestinationA: destA,
        tokenDestinationB: destB,
      })
      .addSigner(collectProtocolFeesAuthorityKeypair)
      .buildAndExecute();

    const balanceDestA = await getTokenBalance(provider, destA);
    const balanceDestB = await getTokenBalance(provider, destB);
    assert.equal(balanceDestA, "150");
    assert.equal(balanceDestB, "150");
    assert.ok(poolBefore.protocolFeeOwedA.eq(ZERO_BN));
    assert.ok(poolBefore.protocolFeeOwedB.eq(ZERO_BN));
  });

  it("fails to collect fees without the authority's signature", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenDestinationA: tokenAccountA,
          tokenDestinationB: tokenAccountB,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails when collect_protocol_fees_authority is invalid", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
      configInitInfo: { whirlpoolConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenDestinationA: tokenAccountA,
          tokenDestinationB: tokenAccountB,
        })
        .addSigner(rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fails when whirlpool does not match config", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new u64(10_000_000) },
      ],
    });
    const {
      poolInitInfo: { tokenVaultAKeypair, tokenVaultBKeypair },
      configKeypairs: { collectProtocolFeesAuthorityKeypair },
      configInitInfo: { whirlpoolConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();
    const {
      poolInitInfo: { whirlpoolPda: whirlpoolPda2 },
    } = await initTestPool(client, tickSpacing);

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda2.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenDestinationA: tokenAccountA,
          tokenDestinationB: tokenAccountB,
        })
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7d1/ // ConstraintHasOne
    );
  });

  it("fails when vaults do not match whirlpool vaults", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
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
      configInitInfo: { whirlpoolConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const fakeVaultA = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);
    const fakeVaultB = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: fakeVaultA,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenDestinationA: tokenAccountA,
          tokenDestinationB: tokenAccountB,
        })
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: fakeVaultB,
          tokenDestinationA: tokenAccountA,
          tokenDestinationB: tokenAccountB,
        })
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });

  it("fails when destination mints do not match whirlpool mints", async () => {
    const tickSpacing = TickSpacing.Standard;
    const fixture = await new WhirlpoolTestFixture(client).init({
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
      configInitInfo: { whirlpoolConfigKeypair },
      tokenAccountA,
      tokenAccountB,
    } = fixture.getInfos();

    const invalidDestA = await createTokenAccount(provider, tokenMintB, provider.wallet.publicKey);
    const invalidDestB = await createTokenAccount(provider, tokenMintA, provider.wallet.publicKey);

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenDestinationA: invalidDestA,
          tokenDestinationB: tokenAccountB,
        })
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      client
        .collectProtocolFeesTx({
          whirlpoolsConfig: whirlpoolConfigKeypair.publicKey,
          whirlpool: whirlpoolPda.publicKey,
          collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
          tokenVaultA: tokenVaultAKeypair.publicKey,
          tokenVaultB: tokenVaultBKeypair.publicKey,
          tokenDestinationA: tokenAccountA,
          tokenDestinationB: invalidDestB,
        })
        .addSigner(collectProtocolFeesAuthorityKeypair)
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });
});
