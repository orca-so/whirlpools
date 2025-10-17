import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import type {
  InitPoolV2Params,
  InitPoolWithAdaptiveFeeParams,
} from "../../../src";
import {
  PDAUtil,
  PoolUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  transferToken,
} from "../../utils";
import {
  pollForCondition,
  initializeLiteSVMEnvironment,
} from "../../utils/litesvm";
import type { TestConfigExtensionParams } from "../../utils/v2/init-utils-v2";
import {
  buildTestPoolV2Params,
  buildTestPoolWithAdaptiveFeeParams,
  fundPositionsV2,
} from "../../utils/v2/init-utils-v2";
import {
  initializePositionBundle,
  initTickArrayRange,
} from "../../utils/init-utils";
import {
  getAssociatedTokenAddressSync,
  getMint,
  getNonTransferable,
} from "@solana/spl-token";
import {
  createAndMintToAssociatedTokenAccountV2,
  createTokenAccountV2,
} from "../../utils/v2/token-2022";
import Decimal from "decimal.js";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";
import { PublicKey } from "@solana/web3.js";

describe("non transferable position", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    program = env.program;
    anchor.setProvider(provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    fetcher = ctx.fetcher;
  });

  async function buildTestPool(
    tokenARequiresNonTransferablePosition: boolean,
    tokenBRequiresNonTransferablePosition: boolean,
    withAdaptiveFee: boolean,
  ) {
    const tokenTrait = { isToken2022: true, hasPermanentDelegate: true };
    const mintAmount = new anchor.BN("15000000000");

    let poolInitInfo: InitPoolV2Params | InitPoolWithAdaptiveFeeParams;
    let configExtension: TestConfigExtensionParams;

    if (!withAdaptiveFee) {
      const params = await buildTestPoolV2Params(
        ctx,
        tokenTrait,
        tokenTrait,
        TickSpacing.Standard,
        3000,
        MathUtil.toX64(new Decimal(5)),
      );
      poolInitInfo = params.poolInitInfo;
      configExtension = params.configExtension;
    } else {
      const params = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        tokenTrait,
        tokenTrait,
        1024,
        TickSpacing.Standard,
        3000,
        MathUtil.toX64(new Decimal(5)),
        getDefaultPresetAdaptiveFeeConstants(
          TickSpacing.Standard,
          TickSpacing.Standard,
          TickSpacing.Standard,
        ),
        PublicKey.default,
        PublicKey.default,
      );
      poolInitInfo = params.poolInitInfo;
      configExtension = params.configExtension;
    }

    const whirlpoolsConfig = poolInitInfo.whirlpoolsConfig;
    const whirlpoolsConfigExtension =
      configExtension.configExtensionInitInfo.whirlpoolsConfigExtensionPda
        .publicKey;
    const tokenBadgeAuthorityKeypair =
      configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair;

    const tokenAccountA = await createAndMintToAssociatedTokenAccountV2(
      provider,
      tokenTrait,
      poolInitInfo.tokenMintA,
      mintAmount,
    );

    const tokenAccountB = await createAndMintToAssociatedTokenAccountV2(
      provider,
      tokenTrait,
      poolInitInfo.tokenMintB,
      mintAmount,
    );

    if (tokenARequiresNonTransferablePosition) {
      await toTx(
        ctx,
        WhirlpoolIx.setTokenBadgeAttributeIx(ctx.program, {
          whirlpoolsConfig,
          whirlpoolsConfigExtension,
          tokenMint: poolInitInfo.tokenMintA,
          tokenBadge: poolInitInfo.tokenBadgeA,
          tokenBadgeAuthority: tokenBadgeAuthorityKeypair.publicKey,
          attribute: {
            requireNonTransferablePosition: [true],
          },
        }),
      )
        .addSigner(tokenBadgeAuthorityKeypair)
        .buildAndExecute();
    }

    if (tokenBRequiresNonTransferablePosition) {
      await toTx(
        ctx,
        WhirlpoolIx.setTokenBadgeAttributeIx(ctx.program, {
          whirlpoolsConfig,
          whirlpoolsConfigExtension,
          tokenMint: poolInitInfo.tokenMintB,
          tokenBadge: poolInitInfo.tokenBadgeB,
          tokenBadgeAuthority: tokenBadgeAuthorityKeypair.publicKey,
          attribute: {
            requireNonTransferablePosition: [true],
          },
        }),
      )
        .addSigner(tokenBadgeAuthorityKeypair)
        .buildAndExecute();
    }

    if (!withAdaptiveFee) {
      await toTx(
        ctx,
        WhirlpoolIx.initializePoolV2Ix(
          ctx.program,
          poolInitInfo as InitPoolV2Params,
        ),
      ).buildAndExecute();
    } else {
      await toTx(
        ctx,
        WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
          ctx.program,
          poolInitInfo as InitPoolWithAdaptiveFeeParams,
        ),
      ).buildAndExecute();
    }

    const resultPoolInitInfo: InitPoolV2Params = {
      ...poolInitInfo,
      feeTierKey: PublicKey.default, // dummy (not used)
      tickSpacing: TickSpacing.Standard,
    };

    return {
      poolInitInfo: resultPoolInitInfo,
      tokenAccountA,
      tokenAccountB,
    };
  }

  describe("create non transferable position", () => {
    const variations = [
      [false, false, false],
      [false, false, true],
      [false, true, false],
      [false, true, true],
      [true, false, false],
      [true, false, true],
      [true, true, false],
      [true, true, true],
    ];

    variations.forEach(
      ([
        withAdaptiveFee,
        tokenARequiresNonTransferablePosition,
        tokenBRequiresNonTransferablePosition,
      ]) => {
        it(`withAF: ${withAdaptiveFee}, tokenA requires NTP: ${tokenARequiresNonTransferablePosition}, tokenB requires NTP: ${tokenBRequiresNonTransferablePosition}`, async () => {
          const poolRequiresNonTransferablePosition =
            tokenARequiresNonTransferablePosition ||
            tokenBRequiresNonTransferablePosition;

          const { poolInitInfo, tokenAccountA, tokenAccountB } =
            await buildTestPool(
              tokenARequiresNonTransferablePosition,
              tokenBRequiresNonTransferablePosition,
              withAdaptiveFee,
            );

          // verify TokenBadge attributes
          const tokenBadgeA = await ctx.fetcher.getTokenBadge(
            poolInitInfo.tokenBadgeA,
            IGNORE_CACHE,
          );
          const tokenBadgeB = await ctx.fetcher.getTokenBadge(
            poolInitInfo.tokenBadgeB,
            IGNORE_CACHE,
          );
          assert.ok(
            tokenBadgeA?.attributeRequireNonTransferablePosition ===
              tokenARequiresNonTransferablePosition,
          );
          assert.ok(
            tokenBadgeB?.attributeRequireNonTransferablePosition ===
              tokenBRequiresNonTransferablePosition,
          );

          // control flags should be set correctly
          const whirlpoolPda = poolInitInfo.whirlpoolPda;
          const whirlpool = await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          );
          assert.ok(whirlpool);
          assert.ok(
            whirlpool.rewardInfos[2].extension.every((b: number) => b === 0),
          );
          assert.ok(
            whirlpool.rewardInfos[1].extension.every(
              (b: number, i: number) => i === 0 || b === 0,
            ),
          );
          assert.ok(
            whirlpool.rewardInfos[1].extension[0] ===
              (poolRequiresNonTransferablePosition ? 1 : 0),
          );

          // utility check
          assert.ok(
            PoolUtil.getExtensionSegmentPrimary(whirlpool).controlFlags
              .requireNonTransferablePosition ===
              poolRequiresNonTransferablePosition,
          );

          // adaptive fee is enabled if required
          assert.ok(
            PoolUtil.isInitializedWithAdaptiveFee(whirlpool) ===
              withAdaptiveFee,
          );

          // open position (open_position_with_token_extensions)
          const aToB = false;
          await initTickArrayRange(
            ctx,
            whirlpoolPda.publicKey,
            22528, // to 33792
            3,
            TickSpacing.Standard,
            aToB,
          );
          const liquidityAmount = new anchor.BN(10_000_000);
          const positions = await fundPositionsV2(
            ctx,
            poolInitInfo,
            tokenAccountA,
            tokenAccountB,
            [
              {
                liquidityAmount,
                tickLowerIndex: 29440,
                tickUpperIndex: 33536,
              },
            ],
            true,
          );
          const positionMintPubkey = positions[0].mintKeypair.publicKey;
          const positionPubkey = positions[0].publicKey;
          const positionTokenAccount = positions[0].tokenAccount;

          // position must be initialized
          const position = await fetcher.getPosition(
            positionPubkey,
            IGNORE_CACHE,
          );
          assert.ok(position);
          assert.ok(position.liquidity.eq(liquidityAmount));
          const whirlpoolWithLiquidity = await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          );
          assert.ok(whirlpoolWithLiquidity);
          assert.ok(whirlpoolWithLiquidity.liquidity.eq(liquidityAmount));

          // position mint should have non-transferable extension if it is required by the pool
          const positionMint = await getMint(
            provider.connection,
            positionMintPubkey,
            undefined,
            TEST_TOKEN_2022_PROGRAM_ID,
          );
          const nonTransferable = getNonTransferable(positionMint);
          if (poolRequiresNonTransferablePosition) {
            assert.ok(nonTransferable);
          } else {
            assert.ok(!nonTransferable);
          }

          // check transferability of the position
          const newOwner = anchor.web3.Keypair.generate();
          const newOwnerPositionTokenAccountPubkey = await createTokenAccountV2(
            provider,
            { isToken2022: true },
            positionMintPubkey,
            newOwner.publicKey,
          );
          const transferTokenPromise = transferToken(
            provider,
            positionTokenAccount,
            newOwnerPositionTokenAccountPubkey,
            1,
            TEST_TOKEN_2022_PROGRAM_ID,
          );
          if (poolRequiresNonTransferablePosition) {
            // not transferred
            await assert.rejects(
              transferTokenPromise,
              /Transfer is disabled for this mint/,
            );
            const newOwnerPositionTokenAccount = await ctx.fetcher.getTokenInfo(
              newOwnerPositionTokenAccountPubkey,
              IGNORE_CACHE,
            );
            assert.ok(newOwnerPositionTokenAccount);
            assert.ok(newOwnerPositionTokenAccount.amount === 0n);
          } else {
            // transferred
            await transferTokenPromise;
            const newOwnerPositionTokenAccount = await ctx.fetcher.getTokenInfo(
              newOwnerPositionTokenAccountPubkey,
              IGNORE_CACHE,
            );
            assert.ok(newOwnerPositionTokenAccount);
            assert.ok(newOwnerPositionTokenAccount.amount === 1n);
          }
        });
      },
    );
  });

  describe("block opening position w/o TE", () => {
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    let poolInitInfo: InitPoolV2Params;

    beforeAll(async () => {
      const params = await buildTestPool(
        true, // tokenARequiresNonTransferablePosition
        true, // tokenBRequiresNonTransferablePosition
        false, // no AF pool
      );
      poolInitInfo = params.poolInitInfo;

      const whirlpool = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(whirlpool);
      assert.ok(
        PoolUtil.getExtensionSegmentPrimary(whirlpool).controlFlags
          .requireNonTransferablePosition,
      );
    });

    it("should block opening position with open_position", async () => {
      const positionMintKeypair = anchor.web3.Keypair.generate();
      const positionPda = PDAUtil.getPosition(
        ctx.program.programId,
        positionMintKeypair.publicKey,
      );
      const positionTokenAccount = getAssociatedTokenAddressSync(
        positionMintKeypair.publicKey,
        provider.wallet.publicKey,
        false,
        TEST_TOKEN_PROGRAM_ID,
      );
      const openPositionIx = WhirlpoolIx.openPositionIx(ctx.program, {
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        funder: provider.wallet.publicKey,
        owner: provider.wallet.publicKey,
        positionMintAddress: positionMintKeypair.publicKey,
        positionPda,
        positionTokenAccount,
        tickLowerIndex,
        tickUpperIndex,
      });

      await assert.rejects(
        toTx(ctx, openPositionIx)
          .addSigner(positionMintKeypair)
          .buildAndExecute(),
        /0x17b3/, // PositionWithTokenExtensionsRequired
      );
    });

    it("should block opening position with open_position_with_metadata", async () => {
      const positionMintKeypair = anchor.web3.Keypair.generate();
      const positionPda = PDAUtil.getPosition(
        ctx.program.programId,
        positionMintKeypair.publicKey,
      );
      const metadataPda = PDAUtil.getPositionMetadata(
        positionMintKeypair.publicKey,
      );
      const positionTokenAccount = getAssociatedTokenAddressSync(
        positionMintKeypair.publicKey,
        provider.wallet.publicKey,
        false,
        TEST_TOKEN_PROGRAM_ID,
      );
      const openPositionWithMetadataIx = WhirlpoolIx.openPositionWithMetadataIx(
        ctx.program,
        {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          funder: provider.wallet.publicKey,
          owner: provider.wallet.publicKey,
          positionMintAddress: positionMintKeypair.publicKey,
          positionPda,
          positionTokenAccount,
          tickLowerIndex,
          tickUpperIndex,
          metadataPda,
        },
      );

      await assert.rejects(
        toTx(ctx, openPositionWithMetadataIx)
          .addSigner(positionMintKeypair)
          .buildAndExecute(),
        /0x17b3/, // PositionWithTokenExtensionsRequired
      );
    });

    it("should block opening position with open_bundled_position", async () => {
      const positionBundleInfo = await initializePositionBundle(ctx);
      const bundleIndex = 0;

      const bundledPositionPda = PDAUtil.getBundledPosition(
        ctx.program.programId,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
      );

      const openBundledPositionIx = WhirlpoolIx.openBundledPositionIx(
        ctx.program,
        {
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          funder: provider.wallet.publicKey,
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleTokenAccount:
            positionBundleInfo.positionBundleTokenAccount,
          positionBundleAuthority: ctx.wallet.publicKey,
          bundleIndex,
          bundledPositionPda,
          tickLowerIndex,
          tickUpperIndex,
        },
      );

      await assert.rejects(
        toTx(ctx, openBundledPositionIx).buildAndExecute(),
        /0x17b3/, // PositionWithTokenExtensionsRequired
      );
    });
  });

  it("successfully open and close non transferable position", async () => {
    const tickLowerIndex = 29440;
    const tickUpperIndex = 33536;

    const { poolInitInfo } = await buildTestPool(true, true, false);

    const positionMintKeypair = anchor.web3.Keypair.generate();
    const positionPda = PDAUtil.getPosition(
      ctx.program.programId,
      positionMintKeypair.publicKey,
    );
    const positionTokenAccount = getAssociatedTokenAddressSync(
      positionMintKeypair.publicKey,
      provider.wallet.publicKey,
      false,
      TEST_TOKEN_2022_PROGRAM_ID,
    );
    const openPositionWithTokenExtensionsIx =
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
        whirlpool: poolInitInfo.whirlpoolPda.publicKey,
        funder: provider.wallet.publicKey,
        owner: provider.wallet.publicKey,
        positionMint: positionMintKeypair.publicKey,
        positionPda,
        positionTokenAccount,
        tickLowerIndex,
        tickUpperIndex,
        withTokenMetadataExtension: true,
      });

    await toTx(ctx, openPositionWithTokenExtensionsIx)
      .addSigner(positionMintKeypair)
      .buildAndExecute();

    // NonTransferable extension should be set on the position mint
    const positionMint = await getMint(
      provider.connection,
      positionMintKeypair.publicKey,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID,
    );
    const nonTransferable = getNonTransferable(positionMint);
    assert.ok(nonTransferable);

    // position must be initialized
    const position = await fetcher.getPosition(
      positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(position);
    assert.ok(position.tickLowerIndex === tickLowerIndex);
    assert.ok(position.tickUpperIndex === tickUpperIndex);

    const closePositionWithTokenExtensions =
      WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
        positionAuthority: provider.wallet.publicKey,
        position: positionPda.publicKey,
        receiver: provider.wallet.publicKey,
        positionMint: positionMintKeypair.publicKey,
        positionTokenAccount,
      });

    await toTx(ctx, closePositionWithTokenExtensions).buildAndExecute();

    // position should be closed
    const closedPosition = await pollForCondition(
      () => fetcher.getPosition(positionPda.publicKey, IGNORE_CACHE),
      (account) => account === null,
      {
        accountToReload: positionPda.publicKey,
        connection: ctx.connection,
      },
    );
    assert.ok(!closedPosition);
  });
});
