import * as anchor from "@coral-xyz/anchor";
import {
  ACCOUNT_SIZE,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as assert from "assert";
import BN from "bn.js";
import type { WhirlpoolClient } from "../../../src";
import {
  PDAUtil,
  PriceMath,
  WhirlpoolIx,
  buildWhirlpoolClient,
  toTx,
} from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import { createMint, createTokenAccount, ZERO_BN } from "../../utils";
import {
  getLiteSVM,
  initializeLiteSVMEnvironment,
  requestAirdropLiteSVM,
  resetLiteSVM,
} from "../../utils/litesvm";
import { WhirlpoolTestFixture } from "../../utils/fixture";

describe("SIMD-0437 rent reduction and SIMD-0438 fallback tests", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let client: WhirlpoolClient;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    program = env.program;

    anchor.setProvider(provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    client = buildWhirlpoolClient(ctx);
  });

  const LEGACY_LAMPORTS_PER_BYTE = 6960;
  const REDUCTED_LAMPORTS_PER_BYTE = 696;

  beforeEach(async () => {
    await resetLiteSVM();
    requestAirdropLiteSVM(provider.wallet.publicKey, BigInt(100e9));
  });

  it("precondition: simulate rent reduction (mint)", async () => {
    setLamportsPerByte(LEGACY_LAMPORTS_PER_BYTE);
    assertLamportsPerByte(LEGACY_LAMPORTS_PER_BYTE);
    const mintLegacyRent = await createMint(provider);
    const mintLegacyRentExpectedLamports = calcMinimumBalanceForRentExemption(
      MINT_SIZE,
      LEGACY_LAMPORTS_PER_BYTE,
    );
    assert.equal(mintLegacyRentExpectedLamports, 1_461_600);
    assertLamportsBalance(mintLegacyRent, mintLegacyRentExpectedLamports);

    setLamportsPerByte(REDUCTED_LAMPORTS_PER_BYTE);
    assertLamportsPerByte(REDUCTED_LAMPORTS_PER_BYTE);
    const mintReductedRent = await createMint(provider);
    const mintReductedRentExpectedLamports = calcMinimumBalanceForRentExemption(
      MINT_SIZE,
      REDUCTED_LAMPORTS_PER_BYTE,
    );
    assert.equal(mintReductedRentExpectedLamports, 146_160);
    assertLamportsBalance(mintReductedRent, mintReductedRentExpectedLamports);
  });

  it("precondition: simulate rent reduction (token account)", async () => {
    const mint = await createMint(provider);

    setLamportsPerByte(LEGACY_LAMPORTS_PER_BYTE);
    assertLamportsPerByte(LEGACY_LAMPORTS_PER_BYTE);
    const tokenLegacyRent = await createTokenAccount(
      provider,
      mint,
      ctx.wallet.publicKey,
    );
    const tokenLegacyRentExpectedLamports = calcMinimumBalanceForRentExemption(
      ACCOUNT_SIZE,
      LEGACY_LAMPORTS_PER_BYTE,
    );
    assert.equal(tokenLegacyRentExpectedLamports, 2_039_280);
    assertLamportsBalance(tokenLegacyRent, tokenLegacyRentExpectedLamports);

    setLamportsPerByte(REDUCTED_LAMPORTS_PER_BYTE);
    assertLamportsPerByte(REDUCTED_LAMPORTS_PER_BYTE);
    const tokenReductedRent = await createTokenAccount(
      provider,
      mint,
      ctx.wallet.publicKey,
    );
    const tokenReductedRentExpectedLamports =
      calcMinimumBalanceForRentExemption(
        ACCOUNT_SIZE,
        REDUCTED_LAMPORTS_PER_BYTE,
      );
    assert.equal(tokenReductedRentExpectedLamports, 203_928);
    assertLamportsBalance(tokenReductedRent, tokenReductedRentExpectedLamports);
  });

  it("lamports_per_byte=6960 (legacy)", async () => {
    await testWhirlpoolOps(6960);
  });

  it("lamports_per_byte=6333 (reduction step 1)", async () => {
    await testWhirlpoolOps(6333);
  });

  it("lamports_per_byte=2575 (reduction step 3)", async () => {
    await testWhirlpoolOps(2575);
  });

  it("lamports_per_byte=696 (goal)", async () => {
    await testWhirlpoolOps(696);
  });

  async function testWhirlpoolOps(lamportsPerByte: number) {
    setLamportsPerByte(lamportsPerByte);
    assertLamportsPerByte(lamportsPerByte);

    const tickSpacing = 64;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(32),
      positions: [],
      rewards: [],
      tokenAIsNative: true,
    });

    const whirlpoolPubkey =
      fixture.getInfos().poolInitInfo.whirlpoolPda.publicKey;
    const whirlpool = await client.getPool(whirlpoolPubkey);

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the Whirlpool account
    ////////////////////////////////////////////////////////////////////////////////
    // lamports of Whirlpool is calculated based on the effective lamports per byte config.
    assertDataSizeAndLamportsBalance(
      whirlpoolPubkey,
      653,
      calcMinimumBalanceForRentExemption(653, lamportsPerByte),
    );

    const rewardAuthorityKeypair =
      fixture.getInfos().configKeypairs.rewardEmissionsSuperAuthorityKeypair;
    const rewardVaultKeypair0 = Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.initializeRewardIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        whirlpool: whirlpoolPubkey,
        rewardAuthority: rewardAuthorityKeypair.publicKey,
        rewardIndex: 0,
        rewardMint: whirlpool.getData().tokenMintA, // SOL
        rewardVaultKeypair: rewardVaultKeypair0,
      }),
    )
      .addSigner(rewardVaultKeypair0)
      .addSigner(rewardAuthorityKeypair)
      .buildAndExecute();

    const rewardVaultKeypair1 = Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.initializeRewardIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        whirlpool: whirlpoolPubkey,
        rewardAuthority: rewardAuthorityKeypair.publicKey,
        rewardIndex: 1,
        rewardMint: whirlpool.getData().tokenMintB,
        rewardVaultKeypair: rewardVaultKeypair1,
      }),
    )
      .addSigner(rewardVaultKeypair1)
      .addSigner(rewardAuthorityKeypair)
      .buildAndExecute();

    await whirlpool.refreshData();

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the vault token accounts
    ////////////////////////////////////////////////////////////////////////////////
    // lamports of WSOL token vault is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().tokenVaultA,
      165,
      calcMinimumBalanceForRentExemption(165, LEGACY_LAMPORTS_PER_BYTE),
    );

    // lamports of non WSOL token vault is calculated based on the effective lamports per byte config.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().tokenVaultB,
      165,
      calcMinimumBalanceForRentExemption(165, lamportsPerByte),
    );

    // lamports of WSOL token vault is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().rewardInfos[0].vault,
      165,
      calcMinimumBalanceForRentExemption(165, LEGACY_LAMPORTS_PER_BYTE),
    );

    // lamports of non WSOL token vault is calculated based on the effective lamports per byte config.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().rewardInfos[1].vault,
      165,
      calcMinimumBalanceForRentExemption(165, lamportsPerByte),
    );

    const tickArrayLowerPubkey = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPubkey,
      -5632,
    ).publicKey;
    const tickArrayUpperPubkey = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPubkey,
      0,
    ).publicKey;

    await (
      await whirlpool.initTickArrayForTicks(
        [-1, 1],
        undefined,
        undefined,
        "dynamic",
      )
    )?.buildAndExecute();

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the DynamicTickArray accounts
    ////////////////////////////////////////////////////////////////////////////////
    // lamports of DynamicTickArray is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );

    // lamports of DynamicTickArray is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the Position account
    ////////////////////////////////////////////////////////////////////////////////
    const rentForTick = calcMinimumBalanceForRentExemptionForSlice(
      112,
      LEGACY_LAMPORTS_PER_BYTE,
    );
    const tokenBasedPositionMintKeypair = Keypair.generate();
    const tokenBasedPositionPda = PDAUtil.getPosition(
      ctx.program.programId,
      tokenBasedPositionMintKeypair.publicKey,
    );
    const tokenBasedPositionATA = getAssociatedTokenAddressSync(
      tokenBasedPositionMintKeypair.publicKey,
      ctx.wallet.publicKey,
      true,
      TOKEN_PROGRAM_ID,
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        owner: ctx.wallet.publicKey,
        positionMintAddress: tokenBasedPositionMintKeypair.publicKey,
        positionPda: tokenBasedPositionPda,
        positionTokenAccount: tokenBasedPositionATA,
        tickLowerIndex: -64,
        tickUpperIndex: 64,
        whirlpool: whirlpoolPubkey,
      }),
    )
      .addSigner(tokenBasedPositionMintKeypair)
      .buildAndExecute();
    await assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick * 2,
    );

    const liquidityAmount = new BN(100_000_000);
    const liquidityIxParams = {
      position: tokenBasedPositionPda.publicKey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount: tokenBasedPositionATA,
      tickArrayLower: tickArrayLowerPubkey,
      tickArrayUpper: tickArrayUpperPubkey,
      tokenMaxA: new BN(1_000_000_000),
      tokenMaxB: new BN(1_000_000_000),
      tokenMinA: new BN(0),
      tokenMinB: new BN(0),
      tokenMintA: whirlpool.getData().tokenMintA,
      tokenMintB: whirlpool.getData().tokenMintB,
      tokenOwnerAccountA: fixture.getInfos().tokenAccountA,
      tokenOwnerAccountB: fixture.getInfos().tokenAccountB,
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_PROGRAM_ID,
      tokenVaultA: whirlpool.getData().tokenVaultA,
      tokenVaultB: whirlpool.getData().tokenVaultB,
      whirlpool: whirlpoolPubkey,
      liquidityAmount,
    };

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on increase_liquidity (V1)
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, liquidityIxParams),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on decrease_liquidity (V1)
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, liquidityIxParams),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick * 2,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on increase_liquidity (V2)
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, liquidityIxParams),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on decrease_liquidity (V2)
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, liquidityIxParams),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick * 2,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on increase_liquidity_by_token_amounts
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix(ctx.program, {
        ...liquidityIxParams,
        maxSqrtPrice: whirlpool.getData().sqrtPrice,
        minSqrtPrice: whirlpool.getData().sqrtPrice,
      }),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on reposition_liquidity
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.repositionLiquidityV2Ix(ctx.program, {
        ...liquidityIxParams,
        funder: ctx.wallet.publicKey,
        existingRangeTokenMinA: ZERO_BN,
        existingRangeTokenMinB: ZERO_BN,
        existingTickArrayLower: tickArrayLowerPubkey,
        existingTickArrayUpper: tickArrayUpperPubkey,
        newLiquidityAmount: liquidityAmount,
        newRangeTokenMaxA: new BN(1_000_000_000),
        newRangeTokenMaxB: new BN(1_000_000_000),
        newTickArrayLower: tickArrayUpperPubkey,
        newTickArrayUpper: tickArrayUpperPubkey,
        newTickLowerIndex: 64,
        newTickUpperIndex: 128,
      }),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148 + 112 * 2,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick * 2,
    );
  }

  it("fallback: lamports_per_byte=696 -> 6960", async () => {
    let lamportsPerByte = REDUCTED_LAMPORTS_PER_BYTE;
    setLamportsPerByte(lamportsPerByte);
    assertLamportsPerByte(lamportsPerByte);

    const tickSpacing = 64;
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(32),
      positions: [],
      rewards: [],
      tokenAIsNative: true,
    });

    const whirlpoolPubkey =
      fixture.getInfos().poolInitInfo.whirlpoolPda.publicKey;
    const whirlpool = await client.getPool(whirlpoolPubkey);

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the Whirlpool account
    ////////////////////////////////////////////////////////////////////////////////
    // lamports of Whirlpool is calculated based on the effective lamports per byte config.
    assertDataSizeAndLamportsBalance(
      whirlpoolPubkey,
      653,
      calcMinimumBalanceForRentExemption(653, lamportsPerByte),
    );

    const rewardAuthorityKeypair =
      fixture.getInfos().configKeypairs.rewardEmissionsSuperAuthorityKeypair;
    const rewardVaultKeypair0 = Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.initializeRewardIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        whirlpool: whirlpoolPubkey,
        rewardAuthority: rewardAuthorityKeypair.publicKey,
        rewardIndex: 0,
        rewardMint: whirlpool.getData().tokenMintA, // SOL
        rewardVaultKeypair: rewardVaultKeypair0,
      }),
    )
      .addSigner(rewardVaultKeypair0)
      .addSigner(rewardAuthorityKeypair)
      .buildAndExecute();

    const rewardVaultKeypair1 = Keypair.generate();
    await toTx(
      ctx,
      WhirlpoolIx.initializeRewardIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        whirlpool: whirlpoolPubkey,
        rewardAuthority: rewardAuthorityKeypair.publicKey,
        rewardIndex: 1,
        rewardMint: whirlpool.getData().tokenMintB,
        rewardVaultKeypair: rewardVaultKeypair1,
      }),
    )
      .addSigner(rewardVaultKeypair1)
      .addSigner(rewardAuthorityKeypair)
      .buildAndExecute();

    await whirlpool.refreshData();

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the vault token accounts
    ////////////////////////////////////////////////////////////////////////////////
    // lamports of WSOL token vault is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().tokenVaultA,
      165,
      calcMinimumBalanceForRentExemption(165, LEGACY_LAMPORTS_PER_BYTE),
    );

    // lamports of non WSOL token vault is calculated based on the effective lamports per byte config.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().tokenVaultB,
      165,
      calcMinimumBalanceForRentExemption(165, lamportsPerByte),
    );

    // lamports of WSOL token vault is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().rewardInfos[0].vault,
      165,
      calcMinimumBalanceForRentExemption(165, LEGACY_LAMPORTS_PER_BYTE),
    );

    // lamports of non WSOL token vault is calculated based on the effective lamports per byte config.
    assertDataSizeAndLamportsBalance(
      whirlpool.getData().rewardInfos[1].vault,
      165,
      calcMinimumBalanceForRentExemption(165, lamportsPerByte),
    );

    const tickArrayLowerPubkey = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPubkey,
      -5632,
    ).publicKey;
    const tickArrayUpperPubkey = PDAUtil.getTickArray(
      ctx.program.programId,
      whirlpoolPubkey,
      0,
    ).publicKey;

    await (
      await whirlpool.initTickArrayForTicks(
        [-1, 1],
        undefined,
        undefined,
        "dynamic",
      )
    )?.buildAndExecute();

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the DynamicTickArray accounts
    ////////////////////////////////////////////////////////////////////////////////
    // lamports of DynamicTickArray is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );

    // lamports of DynamicTickArray is ALWAYS calculated based on LEGACY_LAMPORTS_PER_BYTE.
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent on the Position account
    ////////////////////////////////////////////////////////////////////////////////
    const rentForTick = calcMinimumBalanceForRentExemptionForSlice(
      112,
      LEGACY_LAMPORTS_PER_BYTE,
    );
    const tokenBasedPositionMintKeypair = Keypair.generate();
    const tokenBasedPositionPda = PDAUtil.getPosition(
      ctx.program.programId,
      tokenBasedPositionMintKeypair.publicKey,
    );
    const tokenBasedPositionATA = getAssociatedTokenAddressSync(
      tokenBasedPositionMintKeypair.publicKey,
      ctx.wallet.publicKey,
      true,
      TOKEN_PROGRAM_ID,
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        owner: ctx.wallet.publicKey,
        positionMintAddress: tokenBasedPositionMintKeypair.publicKey,
        positionPda: tokenBasedPositionPda,
        positionTokenAccount: tokenBasedPositionATA,
        tickLowerIndex: -64,
        tickUpperIndex: 64,
        whirlpool: whirlpoolPubkey,
      }),
    )
      .addSigner(tokenBasedPositionMintKeypair)
      .buildAndExecute();
    await assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick * 2,
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Fallback
    ////////////////////////////////////////////////////////////////////////////////
    lamportsPerByte = LEGACY_LAMPORTS_PER_BYTE;
    setLamportsPerByte(lamportsPerByte);
    assertLamportsPerByte(lamportsPerByte);

    const liquidityAmount = new BN(100_000_000);
    const liquidityIxParams = {
      position: tokenBasedPositionPda.publicKey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount: tokenBasedPositionATA,
      tickArrayLower: tickArrayLowerPubkey,
      tickArrayUpper: tickArrayUpperPubkey,
      tokenMaxA: new BN(1_000_000_000),
      tokenMaxB: new BN(1_000_000_000),
      tokenMinA: new BN(0),
      tokenMinB: new BN(0),
      tokenMintA: whirlpool.getData().tokenMintA,
      tokenMintB: whirlpool.getData().tokenMintB,
      tokenOwnerAccountA: fixture.getInfos().tokenAccountA,
      tokenOwnerAccountB: fixture.getInfos().tokenAccountB,
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_PROGRAM_ID,
      tokenVaultA: whirlpool.getData().tokenVaultA,
      tokenVaultB: whirlpool.getData().tokenVaultB,
      whirlpool: whirlpoolPubkey,
      liquidityAmount,
    };

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on increase_liquidity (V1)
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, liquidityIxParams),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148 + 112,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick,
    );

    ////////////////////////////////////////////////////////////////////////////////
    // Check rent changes on decrease_liquidity (V1)
    ////////////////////////////////////////////////////////////////////////////////
    await toTx(
      ctx,
      WhirlpoolIx.decreaseLiquidityIx(ctx.program, liquidityIxParams),
    ).buildAndExecute();

    assertDataSizeAndLamportsBalance(
      tokenBasedPositionPda.publicKey,
      216,
      calcMinimumBalanceForRentExemption(216, LEGACY_LAMPORTS_PER_BYTE) +
        rentForTick * 2,
    );
    assertDataSizeAndLamportsBalance(
      tickArrayLowerPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );
    assertDataSizeAndLamportsBalance(
      tickArrayUpperPubkey,
      148,
      calcMinimumBalanceForRentExemption(148, LEGACY_LAMPORTS_PER_BYTE),
    );
  });

  async function assertLamportsPerByte(expected: number) {
    const rent = await provider.connection.getAccountInfo(SYSVAR_RENT_PUBKEY);
    assert.ok(rent);

    const lamportsPerByte = new BN(rent.data.subarray(0, 8), undefined, "le");
    const rentExemptThreshold = new BN(
      rent.data.subarray(8, 16),
      undefined,
      "le",
    );

    assert.ok(lamportsPerByte.toNumber() == expected);
    assert.ok(rentExemptThreshold.eq(new BN(0x3ff00000_00000000n.toString()))); // 1.0f64
  }

  async function setLamportsPerByte(newLamportsPerByte: number) {
    const svm = getLiteSVM();
    const rent = svm.getRent();
    rent.lamportsPerByteYear = BigInt(newLamportsPerByte);
    svm.setRent(rent);
  }

  async function assertLamportsBalance(
    accountPubkey: PublicKey,
    expectedLamports: number,
  ) {
    const accountInfo = await provider.connection.getAccountInfo(accountPubkey);
    assert.equal(accountInfo?.lamports, expectedLamports);
  }

  async function assertDataSizeAndLamportsBalance(
    accountPubkey: PublicKey,
    expectedDataSize: number,
    expectedLamports: number,
  ) {
    const accountInfo = await provider.connection.getAccountInfo(accountPubkey);
    assert.ok(accountInfo);
    assert.equal(accountInfo.data.length, expectedDataSize);
    assert.equal(accountInfo.lamports, expectedLamports);
  }

  function calcMinimumBalanceForRentExemption(
    dataSize: number,
    lamportsPerByte: number,
  ): number {
    // https://github.com/anza-xyz/solana-sdk/blob/5190ff456079d17b64669bcb5eeac48dd595b91e/rent/src/lib.rs#L86
    const ACCOUNT_STORAGE_OVERHEAD = 128;
    return (ACCOUNT_STORAGE_OVERHEAD + dataSize) * lamportsPerByte;
  }

  function calcMinimumBalanceForRentExemptionForSlice(
    sliceSize: number,
    lamportsPerByte: number,
  ): number {
    return sliceSize * lamportsPerByte;
  }
});
