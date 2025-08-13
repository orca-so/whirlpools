import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import Decimal from "decimal.js";
import { MathUtil, Percentage, U64_MAX, ZERO } from "@orca-so/common-sdk";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
} from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import type {
  InitPoolParams,
  LockConfigData,
  PositionBundleData,
  WhirlpoolData,
} from "../../src";
import {
  IGNORE_CACHE,
  LockConfigUtil,
  NO_TOKEN_EXTENSION_CONTEXT,
  PDAUtil,
  SPLASH_POOL_TICK_SPACING,
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  increaseLiquidityQuoteByLiquidityWithParams,
  toTx,
} from "../../src";
import {
  ONE_SOL,
  createTokenAccount,
  systemTransferTx,
  transferToken,
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import {
  initializePositionBundle,
  openBundledPosition,
} from "../utils/init-utils";
import {
  generateDefaultOpenPositionParams,
  generateDefaultOpenPositionWithTokenExtensionsParams,
} from "../utils/test-builders";
import type {
  PositionData,
  LockPositionParams,
  OpenPositionWithTokenExtensionsParams,
} from "../../src";
import { useMaxCU } from "../utils/v2/init-utils-v2";
import { WhirlpoolTestFixtureV2 } from "../utils/v2/fixture-v2";
import { approveTokenV2, createTokenAccountV2 } from "../utils/v2/token-2022";

describe("lock_position", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const funderKeypair = anchor.web3.Keypair.generate();
  const delegatedAuthority = anchor.web3.Keypair.generate();

  const splashPoolTickSpacing = SPLASH_POOL_TICK_SPACING;
  let splashPoolFixture: WhirlpoolTestFixtureV2;
  let splashPoolInitInfo: InitPoolParams;
  let splashPoolFullRange: [number, number];
  let splashPoolLowerTickArray: PublicKey;
  let splashPoolUpperTickArray: PublicKey;
  let splashPoolRewardOwnerAccount0: PublicKey;

  const concentratedPoolTickSpacing = 64;
  let concentratedPoolFixture: WhirlpoolTestFixtureV2;
  let concentratedPoolInitInfo: InitPoolParams;
  let concentratedPoolFullRange: [number, number];

  const FROZEN = true;
  const NOT_FROZEN = false;

  beforeAll(async () => {
    splashPoolFullRange = TickUtil.getFullRangeTickIndex(splashPoolTickSpacing);
    concentratedPoolFullRange = TickUtil.getFullRangeTickIndex(
      concentratedPoolTickSpacing,
    );

    // initialize pools
    splashPoolFixture = await new WhirlpoolTestFixtureV2(ctx).init({
      tokenTraitA: { isToken2022: false },
      tokenTraitB: { isToken2022: false },
      tickSpacing: splashPoolTickSpacing,
      positions: [
        // to init TAs
        {
          liquidityAmount: new BN(1_000_000),
          tickLowerIndex: splashPoolFullRange[0],
          tickUpperIndex: splashPoolFullRange[1],
        },
      ],
      rewards: [
        {
          rewardTokenTrait: { isToken2022: false },
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(1_000_000),
        },
      ],
    });
    concentratedPoolFixture = await new WhirlpoolTestFixtureV2(ctx).init({
      tokenTraitA: { isToken2022: false },
      tokenTraitB: { isToken2022: false },
      tickSpacing: concentratedPoolTickSpacing,
      positions: [
        // to init TAs
        {
          liquidityAmount: new BN(1_000_000),
          tickLowerIndex: concentratedPoolFullRange[0],
          tickUpperIndex: concentratedPoolFullRange[1],
        },
      ],
      rewards: [
        {
          rewardTokenTrait: { isToken2022: false },
          emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
          vaultAmount: new BN(1_000_000),
        },
      ],
    });

    splashPoolInitInfo = splashPoolFixture.getInfos().poolInitInfo;
    concentratedPoolInitInfo = concentratedPoolFixture.getInfos().poolInitInfo;

    // derive TA addresses
    splashPoolLowerTickArray = PDAUtil.getTickArrayFromTickIndex(
      splashPoolFullRange[0],
      splashPoolInitInfo.tickSpacing,
      splashPoolInitInfo.whirlpoolPda.publicKey,
      ctx.program.programId,
    ).publicKey;
    splashPoolUpperTickArray = PDAUtil.getTickArrayFromTickIndex(
      splashPoolFullRange[1],
      splashPoolInitInfo.tickSpacing,
      splashPoolInitInfo.whirlpoolPda.publicKey,
      ctx.program.programId,
    ).publicKey;

    // initialize reward owner account
    splashPoolRewardOwnerAccount0 = await createTokenAccount(
      ctx.provider,
      splashPoolFixture.getInfos().rewards[0].rewardMint,
      ctx.wallet.publicKey,
    );

    // setup other wallets
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      100 * ONE_SOL,
    ).buildAndExecute();
    await systemTransferTx(
      provider,
      delegatedAuthority.publicKey,
      100 * ONE_SOL,
    ).buildAndExecute();
  });

  async function checkTokenAccountState(
    positionTokenAccount: PublicKey,
    positionMint: PublicKey,
    owner: PublicKey,
    shouldBeFrozen: boolean,
    shouldBeDelegated: boolean = false,
  ) {
    const tokenAccount = await fetcher.getTokenInfo(
      positionTokenAccount,
      IGNORE_CACHE,
    );

    assert.ok(tokenAccount !== null);
    assert.ok(tokenAccount.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));
    assert.ok(tokenAccount.isInitialized);
    assert.ok(tokenAccount.mint.equals(positionMint));
    assert.ok(tokenAccount.owner.equals(owner));
    assert.ok(tokenAccount.amount === 1n);
    if (shouldBeDelegated) {
      assert.ok(tokenAccount.delegate !== null);
    } else {
      assert.ok(tokenAccount.delegate === null);
    }

    // Frozen = Locked
    assert.ok(tokenAccount.isFrozen === shouldBeFrozen);

    // ATA requires ImmutableOwner extension
    const initializedExtensions = getExtensionTypes(tokenAccount.tlvData);
    assert.ok(initializedExtensions.length === 1);
    assert.ok(initializedExtensions.includes(ExtensionType.ImmutableOwner));
  }

  async function checkLockConfigState(
    params: LockPositionParams,
    positionOwner: PublicKey,
  ) {
    const config = (await fetcher.getLockConfig(
      params.lockConfigPda.publicKey,
    )) as LockConfigData;

    // LockType to LockTypeLabel conversion
    const lockTypeLabel = Object.fromEntries(
      Object.keys(params.lockType).map((key) => [key, {}]),
    );

    assert.ok(config.position.equals(params.position));
    assert.ok(config.positionOwner.equals(positionOwner));
    assert.ok(config.whirlpool.equals(params.whirlpool));
    assert.ok(config.lockType.toString() === lockTypeLabel.toString());

    // within 10 seconds
    const nowInSec = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(config.lockedTimestamp.toNumber() - nowInSec) < 10);
  }

  async function increaseLiquidity(
    poolInitInfo: InitPoolParams,
    positionAddress: PublicKey,
    positionTokenAccount: PublicKey,
    tickLowerIndex: number,
    tickUpperIndex: number,
    liquidity: BN,
    tokenAccountA: PublicKey,
    tokenAccountB: PublicKey,
  ) {
    const poolData = (await ctx.fetcher.getPool(
      poolInitInfo.whirlpoolPda.publicKey,
    )) as WhirlpoolData;
    const depositQuote = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity,
      slippageTolerance: Percentage.fromFraction(0, 1000),
      tickLowerIndex,
      tickUpperIndex,
      sqrtPrice: poolData.sqrtPrice,
      tickCurrentIndex: poolData.tickCurrentIndex,
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount: depositQuote.liquidityAmount,
        tokenMaxA: depositQuote.tokenMaxA,
        tokenMaxB: depositQuote.tokenMaxB,
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        position: positionAddress,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionTokenAccount,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArrayLower: PDAUtil.getTickArrayFromTickIndex(
          tickLowerIndex,
          poolInitInfo.tickSpacing,
          poolInitInfo.whirlpoolPda.publicKey,
          ctx.program.programId,
        ).publicKey,
        tickArrayUpper: PDAUtil.getTickArrayFromTickIndex(
          tickUpperIndex,
          poolInitInfo.tickSpacing,
          poolInitInfo.whirlpoolPda.publicKey,
          ctx.program.programId,
        ).publicKey,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
      }),
    ).buildAndExecute();
  }

  async function openTokenExtensionsBasedPositionWithLiquidity(
    poolFixture: WhirlpoolTestFixtureV2,
    tickLowerIndex: number,
    tickUpperIndex: number,
    liquidity: BN,
  ) {
    const poolInitInfo = poolFixture.getInfos().poolInitInfo;

    const withTokenMetadataExtension = true;
    const { params: positionParams, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        withTokenMetadataExtension,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(
        ctx.program,
        positionParams,
      ),
    )
      .addSigner(mint)
      .prependInstruction(useMaxCU())
      .buildAndExecute();

    // deposit (empty position is not lockable)
    await increaseLiquidity(
      poolInitInfo,
      positionParams.positionPda.publicKey,
      positionParams.positionTokenAccount,
      tickLowerIndex,
      tickUpperIndex,
      liquidity,
      poolFixture.getInfos().tokenAccountA,
      poolFixture.getInfos().tokenAccountB,
    );

    return positionParams;
  }

  async function lockPosition(
    positionParams: OpenPositionWithTokenExtensionsParams,
  ) {
    const lockParams: LockPositionParams = {
      funder: ctx.wallet.publicKey,
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      positionAuthority: ctx.wallet.publicKey,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };

    await toTx(
      ctx,
      WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
    ).buildAndExecute();

    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
    );
  }

  async function isFullRangePosition(
    positionAddress: PublicKey,
  ): Promise<boolean> {
    const position = (await fetcher.getPosition(
      positionAddress,
      IGNORE_CACHE,
    )) as PositionData;

    const pool = (await fetcher.getPool(
      position.whirlpool,
      IGNORE_CACHE,
    )) as WhirlpoolData;

    return TickUtil.isFullRange(
      pool.tickSpacing,
      position.tickLowerIndex,
      position.tickUpperIndex,
    );
  }

  it("successfully locks a position in SplashPool and verify token account and LockConfig state", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    // check TokenAccount state
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      NOT_FROZEN,
    );

    // confirm that position is a FullRange position
    assert.ok(await isFullRangePosition(positionParams.positionPda.publicKey));

    const lockParams: LockPositionParams = {
      funder: ctx.wallet.publicKey,
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      positionAuthority: ctx.wallet.publicKey,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(
      ctx,
      WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
    ).buildAndExecute();

    // check TokenAccount state again
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
    );

    // check LockConfig state
    await checkLockConfigState(lockParams, positionParams.owner);
  });

  it("successfully locks a FullRange position in ConcentratedPool and verify token account and LockConfig state", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      concentratedPoolFixture,
      concentratedPoolFullRange[0],
      concentratedPoolFullRange[1],
      new BN(1_000_000),
    );

    // check TokenAccount state
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      NOT_FROZEN,
    );

    // confirm that position is a FullRange position
    assert.ok(await isFullRangePosition(positionParams.positionPda.publicKey));

    const lockParams: LockPositionParams = {
      funder: ctx.wallet.publicKey,
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      positionAuthority: ctx.wallet.publicKey,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(
      ctx,
      WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
    ).buildAndExecute();

    // check TokenAccount state again
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
    );

    // check LockConfig state
    await checkLockConfigState(lockParams, positionParams.owner);
  });

  it("successfully locks a Concentrated position (not FullRange position) in ConcentratedPool and verify token account and LockConfig state", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      concentratedPoolFixture,
      concentratedPoolFullRange[0],
      concentratedPoolFullRange[0] + concentratedPoolTickSpacing,
      new BN(1_000_000),
    );

    // check TokenAccount state
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      NOT_FROZEN,
    );

    // confirm that position is NOT a FullRange position
    assert.ok(
      !(await isFullRangePosition(positionParams.positionPda.publicKey)),
    );

    const lockParams: LockPositionParams = {
      funder: ctx.wallet.publicKey,
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      positionAuthority: ctx.wallet.publicKey,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(
      ctx,
      WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
    ).buildAndExecute();

    // check TokenAccount state again
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
    );

    // check LockConfig state
    await checkLockConfigState(lockParams, positionParams.owner);
  });

  it("successfully locks a position in SplashPool by delegated authority", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    // check TokenAccount state
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      NOT_FROZEN,
      false,
    );

    await approveTokenV2(
      ctx.provider,
      { isToken2022: true }, // TokenExtensions based position
      positionParams.positionTokenAccount,
      delegatedAuthority.publicKey,
      1,
    );

    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      NOT_FROZEN,
      true, // delegated
    );

    const lockParams: LockPositionParams = {
      // delegated authority
      funder: delegatedAuthority.publicKey,
      positionAuthority: delegatedAuthority.publicKey,
      // normal params
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(ctx, WhirlpoolIx.lockPositionIx(ctx.program, lockParams))
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    // check TokenAccount state again
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
      true, // delegated
    );

    // check LockConfig state
    // owner should be position owner (not delegated authority)
    await checkLockConfigState(lockParams, positionParams.owner);
  });

  it("successfully locks a position in SplashPool with another funder", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      NOT_FROZEN,
    );

    const preBalance = await ctx.provider.connection.getBalance(
      funderKeypair.publicKey,
    );

    const lockParams: LockPositionParams = {
      funder: funderKeypair.publicKey,
      // normal params
      positionAuthority: ctx.wallet.publicKey,
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(ctx, WhirlpoolIx.lockPositionIx(ctx.program, lockParams))
      .addSigner(funderKeypair)
      .buildAndExecute();

    const postBalance = await ctx.provider.connection.getBalance(
      funderKeypair.publicKey,
    );

    const rent = (await ctx.provider.connection.getAccountInfo(
      lockParams.lockConfigPda.publicKey,
    ))!.lamports;

    assert.ok(postBalance === preBalance - rent);

    // check TokenAccount state again
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
    );

    // check LockConfig state
    await checkLockConfigState(lockParams, positionParams.owner);
  });

  it("successfully collect fees and reward from a locked position", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await lockPosition(positionParams);

    // update fees and rewards
    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        tickArrayLower: splashPoolLowerTickArray,
        tickArrayUpper: splashPoolUpperTickArray,
      }),
    ).buildAndExecute();

    // collect fees
    await toTx(
      ctx,
      WhirlpoolIx.collectFeesIx(ctx.program, {
        positionAuthority: ctx.wallet.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: splashPoolFixture.getInfos().tokenAccountA,
        tokenOwnerAccountB: splashPoolFixture.getInfos().tokenAccountB,
      }),
    ).buildAndExecute();

    // collect fees (v2)
    await toTx(
      ctx,
      WhirlpoolIx.collectFeesV2Ix(ctx.program, {
        positionAuthority: ctx.wallet.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: splashPoolFixture.getInfos().tokenAccountA,
        tokenOwnerAccountB: splashPoolFixture.getInfos().tokenAccountB,
        tokenMintA: splashPoolInitInfo.tokenMintA,
        tokenMintB: splashPoolInitInfo.tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      }),
    ).buildAndExecute();

    // collect rewards
    await toTx(
      ctx,
      WhirlpoolIx.collectRewardIx(ctx.program, {
        rewardIndex: 0,
        positionAuthority: ctx.wallet.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        rewardVault:
          splashPoolFixture.getInfos().rewards[0].rewardVaultKeypair.publicKey,
        rewardOwnerAccount: splashPoolRewardOwnerAccount0,
      }),
    ).buildAndExecute();

    // collect rewards (v2)
    await toTx(
      ctx,
      WhirlpoolIx.collectRewardV2Ix(ctx.program, {
        rewardIndex: 0,
        positionAuthority: ctx.wallet.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        rewardVault:
          splashPoolFixture.getInfos().rewards[0].rewardVaultKeypair.publicKey,
        rewardOwnerAccount: splashPoolRewardOwnerAccount0,
        rewardMint: splashPoolFixture.getInfos().rewards[0].rewardMint,
        rewardTokenProgram: TOKEN_PROGRAM_ID,
      }),
    ).buildAndExecute();
  });

  it("successfully collect fees and reward from a locked position by delegated authority", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await approveTokenV2(
      ctx.provider,
      { isToken2022: true }, // TokenExtensions based position
      positionParams.positionTokenAccount,
      delegatedAuthority.publicKey,
      1,
    );

    const lockParams: LockPositionParams = {
      // delegated authority
      funder: delegatedAuthority.publicKey,
      positionAuthority: delegatedAuthority.publicKey,
      // normal params
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(ctx, WhirlpoolIx.lockPositionIx(ctx.program, lockParams))
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    // check TokenAccount state again
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
      true, // delegated
    );

    // update fees and rewards
    await toTx(
      ctx,
      WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        tickArrayLower: splashPoolLowerTickArray,
        tickArrayUpper: splashPoolUpperTickArray,
      }),
    ).buildAndExecute();

    const ataA = await createTokenAccount(
      ctx.provider,
      splashPoolInitInfo.tokenMintA,
      delegatedAuthority.publicKey,
    );
    const ataB = await createTokenAccount(
      ctx.provider,
      splashPoolInitInfo.tokenMintB,
      delegatedAuthority.publicKey,
    );

    // collect fees
    await toTx(
      ctx,
      WhirlpoolIx.collectFeesIx(ctx.program, {
        positionAuthority: delegatedAuthority.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: ataA,
        tokenOwnerAccountB: ataB,
      }),
    )
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    // collect fees (v2)
    await toTx(
      ctx,
      WhirlpoolIx.collectFeesV2Ix(ctx.program, {
        positionAuthority: delegatedAuthority.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tokenOwnerAccountA: ataA,
        tokenOwnerAccountB: ataB,
        tokenMintA: splashPoolInitInfo.tokenMintA,
        tokenMintB: splashPoolInitInfo.tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      }),
    )
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    const ataR0 = await createTokenAccount(
      ctx.provider,
      splashPoolFixture.getInfos().rewards[0].rewardMint,
      delegatedAuthority.publicKey,
    );

    // collect rewards
    await toTx(
      ctx,
      WhirlpoolIx.collectRewardIx(ctx.program, {
        rewardIndex: 0,
        positionAuthority: delegatedAuthority.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        rewardVault:
          splashPoolFixture.getInfos().rewards[0].rewardVaultKeypair.publicKey,
        rewardOwnerAccount: ataR0,
      }),
    )
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    // collect rewards (v2)
    await toTx(
      ctx,
      WhirlpoolIx.collectRewardV2Ix(ctx.program, {
        rewardIndex: 0,
        positionAuthority: delegatedAuthority.publicKey,
        position: positionParams.positionPda.publicKey,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        rewardVault:
          splashPoolFixture.getInfos().rewards[0].rewardVaultKeypair.publicKey,
        rewardOwnerAccount: ataR0,
        rewardMint: splashPoolFixture.getInfos().rewards[0].rewardMint,
        rewardTokenProgram: TOKEN_PROGRAM_ID,
      }),
    )
      .addSigner(delegatedAuthority)
      .buildAndExecute();
  });

  it("successfully increase liquidity of a locked position", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await lockPosition(positionParams);
    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
      false, // not delegated
    );

    const preState = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preState?.liquidity.eqn(1_000_000));

    // increase liquidity
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount: new BN(1_000_000),
        tokenMaxA: U64_MAX,
        tokenMaxB: U64_MAX,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        position: positionParams.positionPda.publicKey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: splashPoolLowerTickArray,
        tickArrayUpper: splashPoolUpperTickArray,
        tokenOwnerAccountA: splashPoolFixture.getInfos().tokenAccountA,
        tokenOwnerAccountB: splashPoolFixture.getInfos().tokenAccountB,
      }),
    ).buildAndExecute();

    const postV1State = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postV1State?.liquidity.eqn(2_000_000));

    // increase liquidity (v2)
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
        liquidityAmount: new BN(1_000_000),
        tokenMaxA: U64_MAX,
        tokenMaxB: U64_MAX,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        position: positionParams.positionPda.publicKey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: splashPoolLowerTickArray,
        tickArrayUpper: splashPoolUpperTickArray,
        tokenOwnerAccountA: splashPoolFixture.getInfos().tokenAccountA,
        tokenOwnerAccountB: splashPoolFixture.getInfos().tokenAccountB,
        tokenMintA: splashPoolInitInfo.tokenMintA,
        tokenMintB: splashPoolInitInfo.tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      }),
    ).buildAndExecute();

    const postV2State = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postV2State?.liquidity.eqn(3_000_000));
  });

  it("successfully increase liquidity of a locked position by delegated authority", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await approveTokenV2(
      ctx.provider,
      { isToken2022: true }, // TokenExtensions based position
      positionParams.positionTokenAccount,
      delegatedAuthority.publicKey,
      1,
    );

    const lockParams: LockPositionParams = {
      // delegated authority
      funder: delegatedAuthority.publicKey,
      positionAuthority: delegatedAuthority.publicKey,
      // normal params
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMint,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };
    await toTx(ctx, WhirlpoolIx.lockPositionIx(ctx.program, lockParams))
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    await checkTokenAccountState(
      positionParams.positionTokenAccount,
      positionParams.positionMint,
      positionParams.owner,
      FROZEN,
      true, // delegated
    );

    const preState = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(preState?.liquidity.eqn(1_000_000));

    const ataA = await createTokenAccount(
      ctx.provider,
      splashPoolInitInfo.tokenMintA,
      delegatedAuthority.publicKey,
    );
    const ataB = await createTokenAccount(
      ctx.provider,
      splashPoolInitInfo.tokenMintB,
      delegatedAuthority.publicKey,
    );
    await transferToken(
      ctx.provider,
      splashPoolFixture.getInfos().tokenAccountA,
      ataA,
      500_000,
    );
    await transferToken(
      ctx.provider,
      splashPoolFixture.getInfos().tokenAccountB,
      ataB,
      20_000_000,
    );

    // increase liquidity
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        liquidityAmount: new BN(1_000_000),
        tokenMaxA: U64_MAX,
        tokenMaxB: U64_MAX,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        position: positionParams.positionPda.publicKey,
        positionAuthority: delegatedAuthority.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: splashPoolLowerTickArray,
        tickArrayUpper: splashPoolUpperTickArray,
        tokenOwnerAccountA: ataA,
        tokenOwnerAccountB: ataB,
      }),
    )
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    const postV1State = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postV1State?.liquidity.eqn(2_000_000));

    // increase liquidity (v2)
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityV2Ix(ctx.program, {
        liquidityAmount: new BN(1_000_000),
        tokenMaxA: U64_MAX,
        tokenMaxB: U64_MAX,
        whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
        position: positionParams.positionPda.publicKey,
        positionAuthority: delegatedAuthority.publicKey,
        positionTokenAccount: positionParams.positionTokenAccount,
        tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
        tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
        tickArrayLower: splashPoolLowerTickArray,
        tickArrayUpper: splashPoolUpperTickArray,
        tokenOwnerAccountA: ataA,
        tokenOwnerAccountB: ataB,
        tokenMintA: splashPoolInitInfo.tokenMintA,
        tokenMintB: splashPoolInitInfo.tokenMintB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_PROGRAM_ID,
      }),
    )
      .addSigner(delegatedAuthority)
      .buildAndExecute();

    const postV2State = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(postV2State?.liquidity.eqn(3_000_000));
  });

  it("should be failed: try to decrease liquidity of a locked position", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await lockPosition(positionParams);

    // decrease liquidity
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
          liquidityAmount: new BN(1_000),
          tokenMinA: ZERO,
          tokenMinB: ZERO,
          whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
          position: positionParams.positionPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          positionTokenAccount: positionParams.positionTokenAccount,
          tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: splashPoolLowerTickArray,
          tickArrayUpper: splashPoolUpperTickArray,
          tokenOwnerAccountA: splashPoolFixture.getInfos().tokenAccountA,
          tokenOwnerAccountB: splashPoolFixture.getInfos().tokenAccountB,
        }),
      ).buildAndExecute(),
      /0x17ab/, // OperationNotAllowedOnLockedPosition
    );

    // decrease liquidity (v2)
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.decreaseLiquidityV2Ix(ctx.program, {
          liquidityAmount: new BN(1_000),
          tokenMinA: ZERO,
          tokenMinB: ZERO,
          whirlpool: splashPoolInitInfo.whirlpoolPda.publicKey,
          position: positionParams.positionPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          positionTokenAccount: positionParams.positionTokenAccount,
          tokenVaultA: splashPoolInitInfo.tokenVaultAKeypair.publicKey,
          tokenVaultB: splashPoolInitInfo.tokenVaultBKeypair.publicKey,
          tickArrayLower: splashPoolLowerTickArray,
          tickArrayUpper: splashPoolUpperTickArray,
          tokenOwnerAccountA: splashPoolFixture.getInfos().tokenAccountA,
          tokenOwnerAccountB: splashPoolFixture.getInfos().tokenAccountB,
          tokenMintA: splashPoolInitInfo.tokenMintA,
          tokenMintB: splashPoolInitInfo.tokenMintB,
          tokenProgramA: TOKEN_PROGRAM_ID,
          tokenProgramB: TOKEN_PROGRAM_ID,
        }),
      ).buildAndExecute(),
      /0x17ab/, // OperationNotAllowedOnLockedPosition
    );
  });

  it("should be failed: try to close a locked position", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await lockPosition(positionParams);

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionMint: positionParams.positionMint,
          receiver: ctx.wallet.publicKey,
          position: positionParams.positionPda.publicKey,
          positionAuthority: ctx.wallet.publicKey,
          positionTokenAccount: positionParams.positionTokenAccount,
        }),
      ).buildAndExecute(),
      /0x17ab/, // OperationNotAllowedOnLockedPosition
    );
  });

  it("should be failed: try to lock an empty position", async () => {
    const withTokenMetadataExtension = true;
    const { params: positionParams, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        splashPoolFixture.getInfos().poolInitInfo.whirlpoolPda.publicKey,
        withTokenMetadataExtension,
        splashPoolFullRange[0],
        splashPoolFullRange[1],
        provider.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(
        ctx.program,
        positionParams,
      ),
    )
      .addSigner(mint)
      .prependInstruction(useMaxCU())
      .buildAndExecute();

    // position is empty
    const position = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
    );
    assert.ok(position?.liquidity.isZero());

    await assert.rejects(
      lockPosition(positionParams),
      /0x17aa/, // PositionNotLockable
    );
  });

  it("should be failed: try to lock an already locked position", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await lockPosition(positionParams);

    await assert.rejects(
      lockPosition(positionParams),
      /already in use/, // cannot initialize LockConfig account
    );
  });

  it("should be failed: try to lock a Token program based position", async () => {
    const poolInitInfo = splashPoolFixture.getInfos().poolInitInfo;

    // open Token based position
    const { params: positionParams, mint } =
      await generateDefaultOpenPositionParams(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        splashPoolFullRange[0],
        splashPoolFullRange[1],
        provider.wallet.publicKey,
      );
    await toTx(ctx, WhirlpoolIx.openPositionIx(ctx.program, positionParams))
      .addSigner(mint)
      .buildAndExecute();

    // deposit (empty position is not lockable)
    await increaseLiquidity(
      poolInitInfo,
      positionParams.positionPda.publicKey,
      positionParams.positionTokenAccount,
      positionParams.tickLowerIndex,
      positionParams.tickUpperIndex,
      new BN(1_000_000),
      splashPoolFixture.getInfos().tokenAccountA,
      splashPoolFixture.getInfos().tokenAccountB,
    );

    // check position state
    const position = await fetcher.getPosition(
      positionParams.positionPda.publicKey,
    );
    assert.ok(position?.liquidity.eq(new BN(1_000_000)));

    const lockParams: LockPositionParams = {
      funder: ctx.wallet.publicKey,
      position: positionParams.positionPda.publicKey,
      positionMint: positionParams.positionMintAddress,
      positionTokenAccount: positionParams.positionTokenAccount,
      whirlpool: positionParams.whirlpool,
      positionAuthority: ctx.wallet.publicKey,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.positionPda.publicKey,
      ),
    };

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
      ).buildAndExecute(),
      /0x7d4/, // ConstraitOwner at position_mint (position_mint is not owned by Token-2022 program)
    );
  });

  it("should be failed: try to lock a bundled position", async () => {
    const poolInitInfo = splashPoolFixture.getInfos().poolInitInfo;

    // open bundled position
    const positionBundleInfo = await initializePositionBundle(ctx);
    const bundleIndex = 0;
    const { params: positionParams } = await openBundledPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
    );

    // deposit (empty position is not lockable)
    await increaseLiquidity(
      poolInitInfo,
      positionParams.bundledPositionPda.publicKey,
      positionParams.positionBundleTokenAccount,
      positionParams.tickLowerIndex,
      positionParams.tickUpperIndex,
      new BN(1_000_000),
      splashPoolFixture.getInfos().tokenAccountA,
      splashPoolFixture.getInfos().tokenAccountB,
    );

    // check position state
    const position = await fetcher.getPosition(
      positionParams.bundledPositionPda.publicKey,
    );
    assert.ok(position?.liquidity.eq(new BN(1_000_000)));

    const positionBundle = (await fetcher.getPositionBundle(
      positionParams.positionBundle,
    )) as PositionBundleData;
    const positionBundleMint = positionBundle.positionBundleMint;

    const lockParams: LockPositionParams = {
      funder: ctx.wallet.publicKey,
      position: positionParams.bundledPositionPda.publicKey,
      positionMint: positionBundleMint,
      positionTokenAccount: positionParams.positionBundleTokenAccount,
      whirlpool: positionParams.whirlpool,
      positionAuthority: ctx.wallet.publicKey,
      lockType: LockConfigUtil.getPermanentLockType(),
      lockConfigPda: PDAUtil.getLockConfig(
        ctx.program.programId,
        positionParams.bundledPositionPda.publicKey,
      ),
    };

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
      ).buildAndExecute(),
      /0x7d6/, // ConstraitSeeds at position (bundled position seed is "bundled_position")
    );
  });

  describe("should be failed: invalid accounts and invalid program data", () => {
    let defaultPositionParams: OpenPositionWithTokenExtensionsParams;
    let anotherPositionParams: OpenPositionWithTokenExtensionsParams;
    let defaultLockPositionParams: LockPositionParams;

    beforeAll(async () => {
      defaultPositionParams =
        await openTokenExtensionsBasedPositionWithLiquidity(
          splashPoolFixture,
          splashPoolFullRange[0],
          splashPoolFullRange[1],
          new BN(1_000_000),
        );

      anotherPositionParams =
        await openTokenExtensionsBasedPositionWithLiquidity(
          splashPoolFixture,
          splashPoolFullRange[0],
          splashPoolFullRange[1],
          new BN(1_000_000),
        );

      defaultLockPositionParams = {
        funder: ctx.wallet.publicKey,
        position: defaultPositionParams.positionPda.publicKey,
        positionMint: defaultPositionParams.positionMint,
        positionTokenAccount: defaultPositionParams.positionTokenAccount,
        whirlpool: defaultPositionParams.whirlpool,
        positionAuthority: ctx.wallet.publicKey,
        lockType: LockConfigUtil.getPermanentLockType(),
        lockConfigPda: PDAUtil.getLockConfig(
          ctx.program.programId,
          defaultPositionParams.positionPda.publicKey,
        ),
      };
    });

    it("no signature of funder", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        funder: funderKeypair.publicKey,
      };
      const ix = WhirlpoolIx.lockPositionIx(ctx.program, lockParams)
        .instructions[0];

      // drop isSigner flag
      const keysWithoutSign = ix.keys.map((key) => {
        if (key.pubkey.equals(funderKeypair.publicKey)) {
          return {
            pubkey: key.pubkey,
            isSigner: false,
            isWritable: key.isWritable,
          };
        }
        return key;
      });
      const ixWithoutSign = {
        ...ix,
        keys: keysWithoutSign,
      };

      await assert.rejects(
        toTx(ctx, {
          instructions: [ixWithoutSign],
          cleanupInstructions: [],
          signers: [],
        })
          // no signature of funder
          .buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });

    it("no signature of position authority", async () => {
      const positionParams =
        await openTokenExtensionsBasedPositionWithLiquidity(
          splashPoolFixture,
          splashPoolFullRange[0],
          splashPoolFullRange[1],
          new BN(1_000_000),
        );

      // transfer position to funderKeypair
      const funderPositionTokenAccount = await createTokenAccountV2(
        ctx.provider,
        { isToken2022: true },
        positionParams.positionMint,
        funderKeypair.publicKey,
      );
      await transferToken(
        ctx.provider,
        positionParams.positionTokenAccount,
        funderPositionTokenAccount,
        1,
        TOKEN_2022_PROGRAM_ID,
      );

      const lockParams: LockPositionParams = {
        funder: ctx.wallet.publicKey,
        positionAuthority: funderKeypair.publicKey,
        position: positionParams.positionPda.publicKey,
        positionMint: positionParams.positionMint,
        positionTokenAccount: funderPositionTokenAccount,
        lockConfigPda: PDAUtil.getLockConfig(
          ctx.program.programId,
          positionParams.positionPda.publicKey,
        ),
        lockType: LockConfigUtil.getPermanentLockType(),
        whirlpool: positionParams.whirlpool,
      };
      const ix = WhirlpoolIx.lockPositionIx(ctx.program, lockParams)
        .instructions[0];

      // drop isSigner flag
      const keysWithoutSign = ix.keys.map((key) => {
        if (key.pubkey.equals(funderKeypair.publicKey)) {
          return {
            pubkey: key.pubkey,
            isSigner: false,
            isWritable: key.isWritable,
          };
        }
        return key;
      });
      const ixWithoutSign = {
        ...ix,
        keys: keysWithoutSign,
      };

      await assert.rejects(
        toTx(ctx, {
          instructions: [ixWithoutSign],
          cleanupInstructions: [],
          signers: [],
        })
          // no signature of funder (position_authority)
          .buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );
    });

    it("invalid position authority", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        positionAuthority: funderKeypair.publicKey,
      };

      await assert.rejects(
        toTx(ctx, WhirlpoolIx.lockPositionIx(ctx.program, lockParams))
          .addSigner(funderKeypair)
          .buildAndExecute(),
        /0x1783/, // MissingOrInvalidDelegate
      );
    });

    it("invalid position account (another position)", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        position: anotherPositionParams.positionPda.publicKey,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0x7d6/, // ConstraitSeeds at position (PDA unmatch)
      );
    });

    it("invalid position account (not position account)", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        // invalid position account (Whirlpool account)
        position: defaultPositionParams.whirlpool,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0xbba/, // AccountDiscriminatorMismatch
      );
    });

    it("invalid position mint", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        positionMint: anotherPositionParams.positionMint,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0x7d6/, // ConstraitSeeds at position (PDA unmatch)
      );
    });

    it("invalid position token account (another mint)", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        positionTokenAccount: anotherPositionParams.positionTokenAccount,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0x7d3/, // ConstraitRaw at position_token_account (mint unmatch)
      );
    });

    it("invalid position token account (balance is zero)", async () => {
      // this token account is not ATA
      const anotherTokenAccount = await createTokenAccountV2(
        ctx.provider,
        { isToken2022: true },
        defaultPositionParams.positionMint,
        ctx.wallet.publicKey,
      );

      const tokenAccountState = await fetcher.getTokenInfo(anotherTokenAccount);
      assert.ok(
        tokenAccountState?.mint.equals(defaultPositionParams.positionMint),
      );
      assert.ok(tokenAccountState?.amount === 0n);

      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        positionTokenAccount: anotherTokenAccount,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0x7d3/, // ConstraitRaw at position_token_account (amount is not one)
      );
    });

    it("invalid LockConfig PDA address", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        lockConfigPda: PDAUtil.getLockConfig(
          ctx.program.programId,
          Keypair.generate().publicKey,
        ),
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0x7d6/, // ConstraitSeeds at lock_config (PDA unmatch)
      );
    });

    it("invalid whirlpool account", async () => {
      const lockParams: LockPositionParams = {
        ...defaultLockPositionParams,
        whirlpool: concentratedPoolInitInfo.whirlpoolPda.publicKey,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.lockPositionIx(ctx.program, lockParams),
        ).buildAndExecute(),
        /0x7d1/, // ConstraintHasOne at position
      );
    });

    it("invalid token 2022 program", async () => {
      const ix = WhirlpoolIx.lockPositionIx(
        ctx.program,
        defaultLockPositionParams,
      ).instructions[0];
      const ixWithWrongAccount = {
        ...ix,
        keys: ix.keys.map((key) => {
          if (key.pubkey.equals(TOKEN_2022_PROGRAM_ID)) {
            return { ...key, pubkey: TOKEN_PROGRAM_ID };
          }
          return key;
        }),
      };

      await assert.rejects(
        toTx(ctx, {
          instructions: [ixWithWrongAccount],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("invalid system program", async () => {
      const ix = WhirlpoolIx.lockPositionIx(
        ctx.program,
        defaultLockPositionParams,
      ).instructions[0];
      const ixWithWrongAccount = {
        ...ix,
        keys: ix.keys.map((key) => {
          if (key.pubkey.equals(SystemProgram.programId)) {
            return { ...key, pubkey: TOKEN_PROGRAM_ID };
          }
          return key;
        }),
      };

      await assert.rejects(
        toTx(ctx, {
          instructions: [ixWithWrongAccount],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    it("invalid program data (lock_type)", async () => {
      const ix = WhirlpoolIx.lockPositionIx(
        ctx.program,
        defaultLockPositionParams,
      ).instructions[0];

      // discriminator of lock_position ix and LockType::Permanent (0)
      assert.ok(ix.data.length === 8 + 1);
      assert.ok(ix.data[8] === 0);

      // change lock_type (no variant for 1u8)
      ix.data[8] = 1;

      await assert.rejects(
        toTx(ctx, {
          instructions: [ix],
          cleanupInstructions: [],
          signers: [],
        }).buildAndExecute(),
        /0x66/, // InstructionDidNotDeserialize (fails to deserialize LockType enum)
      );
    });
  });
});
