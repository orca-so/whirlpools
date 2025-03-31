import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import type { PDA} from "@orca-so/common-sdk";
import { Percentage } from "@orca-so/common-sdk";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import type { InitPoolParams, WhirlpoolData } from "../../src";
import {
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
import { ONE_SOL, systemTransferTx } from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import {
  generateDefaultOpenPositionParams,
  generateDefaultOpenPositionWithTokenExtensionsParams,
} from "../utils/test-builders";
import type {
  LockPositionParams,
  OpenPositionWithTokenExtensionsParams,
} from "../../src/instructions";
import { useMaxCU } from "../utils/v2/init-utils-v2";
import { WhirlpoolTestFixtureV2 } from "../utils/v2/fixture-v2";

describe("transfer_position", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);

  const funderKeypair = anchor.web3.Keypair.generate();
  const delegatedAuthority = anchor.web3.Keypair.generate();

  const splashPoolTickSpacing = SPLASH_POOL_TICK_SPACING;
  let splashPoolFixture: WhirlpoolTestFixtureV2;
  let splashPoolInitInfo: InitPoolParams;
  let splashPoolFullRange: [number, number];

  beforeAll(async () => {
    splashPoolFullRange = TickUtil.getFullRangeTickIndex(splashPoolTickSpacing);

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
      rewards: [],
    });

    splashPoolInitInfo = splashPoolFixture.getInfos().poolInitInfo;

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

  async function openLegacyPositionWithLiquidity(
    poolFixture: WhirlpoolTestFixtureV2,
    tickLowerIndex: number,
    tickUpperIndex: number,
    liquidity: BN,
  ) {
    const poolInitInfo = poolFixture.getInfos().poolInitInfo;

    const { params: positionParams, mint } =
      await generateDefaultOpenPositionParams(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );
    await toTx(ctx, WhirlpoolIx.openPositionIx(ctx.program, positionParams))
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
  }

  async function transferPosition(
    positionPda: PDA,
    positionMint: PublicKey,
    positionTokenAccount: PublicKey,
    positionTokenProgram: PublicKey,
    authority?: Keypair,
  ) {
    const destinationWallet = Keypair.generate();
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      positionMint,
      destinationWallet.publicKey,
      false,
      positionTokenProgram,
    );
    await toTx(ctx, {
      instructions: [
        createAssociatedTokenAccountInstruction(
          ctx.wallet.publicKey,
          destinationTokenAccount,
          destinationWallet.publicKey,
          positionMint,
          positionTokenProgram,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    }).buildAndExecute();

    const tx = toTx(
      ctx,
      WhirlpoolIx.transferPositionIx(ctx.program, {
        positionPda,
        positionMint,
        positionTokenAccount,
        positionTokenProgram,
        destinationTokenAccount,
        authority: authority?.publicKey ?? ctx.wallet.publicKey,
      }),
    );

    if (authority) {
      tx.addSigner(authority);
    }

    await tx.buildAndExecute();

    const walletTokenAccountData =
      await ctx.fetcher.getTokenInfo(positionTokenAccount);

    assert.strictEqual(walletTokenAccountData?.amount, 0n);

    const destinationTokenAccountData = await ctx.fetcher.getTokenInfo(
      destinationTokenAccount,
    );

    assert.strictEqual(destinationTokenAccountData?.amount, 1n);
  }

  async function transferTokenToFunder(
    positionMint: PublicKey,
    positionTokenAccount: PublicKey,
    positionTokenProgram: PublicKey,
  ) {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      positionMint,
      funderKeypair.publicKey,
      false,
      positionTokenProgram,
    );

    await toTx(ctx, {
      instructions: [
        createAssociatedTokenAccountInstruction(
          ctx.wallet.publicKey,
          destinationTokenAccount,
          funderKeypair.publicKey,
          positionMint,
          positionTokenProgram,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    }).buildAndExecute();

    await toTx(ctx, {
      instructions: [
        createTransferCheckedInstruction(
          positionTokenAccount,
          positionMint,
          destinationTokenAccount,
          ctx.wallet.publicKey,
          1n,
          0,
          [],
          positionTokenProgram,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    }).buildAndExecute();
  }

  async function approveDelegate(
    positionMint: PublicKey,
    positionTokenAccount: PublicKey,
    positionTokenProgram: PublicKey,
  ) {
    await toTx(ctx, {
      instructions: [
        createApproveCheckedInstruction(
          positionTokenAccount,
          positionMint,
          delegatedAuthority.publicKey,
          ctx.wallet.publicKey,
          1n,
          0,
          [],
          positionTokenProgram,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    }).buildAndExecute();
  }

  it("Should transfer the position token", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await transferPosition(
      positionParams.positionPda,
      positionParams.positionMint,
      positionParams.positionTokenAccount,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  it("Should transfer a locked position token", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );
    await lockPosition(positionParams);

    await transferPosition(
      positionParams.positionPda,
      positionParams.positionMint,
      positionParams.positionTokenAccount,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  it("Should transfer a legacy token position", async () => {
    const positionParams = await openLegacyPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await transferPosition(
      positionParams.positionPda,
      positionParams.positionMintAddress,
      positionParams.positionTokenAccount,
      TOKEN_PROGRAM_ID,
    );
  });

  it("Should not be able to transfer a position not owned by the signer", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );
    await transferTokenToFunder(
      positionParams.positionMint,
      positionParams.positionTokenAccount,
      TOKEN_2022_PROGRAM_ID,
    );
    await assert.rejects(
      transferPosition(
        positionParams.positionPda,
        positionParams.positionMint,
        positionParams.positionTokenAccount,
        TOKEN_2022_PROGRAM_ID,
      ),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("Should not be able to transfer a legacy token position not owned by the signer", async () => {
    const positionParams = await openLegacyPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );

    await transferTokenToFunder(
      positionParams.positionMintAddress,
      positionParams.positionTokenAccount,
      TOKEN_PROGRAM_ID,
    );

    await assert.rejects(
      transferPosition(
        positionParams.positionPda,
        positionParams.positionMintAddress,
        positionParams.positionTokenAccount,
        TOKEN_PROGRAM_ID,
      ),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("Should be able to transfer a delegated position token", async () => {
    const positionParams = await openTokenExtensionsBasedPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );
    await approveDelegate(
      positionParams.positionMint,
      positionParams.positionTokenAccount,
      TOKEN_2022_PROGRAM_ID,
    );

    await transferPosition(
      positionParams.positionPda,
      positionParams.positionMint,
      positionParams.positionTokenAccount,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  it("Should be able to transfer a delegated position legacy token", async () => {
    const positionParams = await openLegacyPositionWithLiquidity(
      splashPoolFixture,
      splashPoolFullRange[0],
      splashPoolFullRange[1],
      new BN(1_000_000),
    );
    await approveDelegate(
      positionParams.positionMintAddress,
      positionParams.positionTokenAccount,
      TOKEN_PROGRAM_ID,
    );

    await transferPosition(
      positionParams.positionPda,
      positionParams.positionMintAddress,
      positionParams.positionTokenAccount,
      TOKEN_PROGRAM_ID,
    );
  });
});
