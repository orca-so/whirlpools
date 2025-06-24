import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData } from "../../../src";
import {
  METADATA_PROGRAM_ADDRESS,
  PDAUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { ONE_SOL, systemTransferTx, TickSpacing } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import type { TokenTrait } from "../../utils/v2/init-utils-v2";
import {
  initTestPoolV2,
  initializeRewardV2,
} from "../../utils/v2/init-utils-v2";
import {
  asyncAssertOwnerProgram,
  createMintV2,
} from "../../utils/v2/token-2022";
import { TEST_TOKEN_2022_PROGRAM_ID, TEST_TOKEN_PROGRAM_ID } from "../../utils";
import { AccountState } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";

describe("initialize_reward_v2", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  describe("v1 parity", () => {
    const tokenTraitVariations: {
      tokenTraitAB: TokenTrait;
      tokenTraitR: TokenTrait;
    }[] = [
      {
        tokenTraitAB: { isToken2022: false },
        tokenTraitR: { isToken2022: false },
      },
      {
        tokenTraitAB: { isToken2022: true },
        tokenTraitR: { isToken2022: false },
      },
      {
        tokenTraitAB: { isToken2022: false },
        tokenTraitR: { isToken2022: true },
      },
      {
        tokenTraitAB: { isToken2022: true },
        tokenTraitR: { isToken2022: true },
      },
    ];
    tokenTraitVariations.forEach((tokenTraits) => {
      describe(`tokenTraitA/B: ${
        tokenTraits.tokenTraitAB.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitReward: ${tokenTraits.tokenTraitR.isToken2022 ? "Token2022" : "Token"}`, () => {
        it("successfully initializes reward at index 0", async () => {
          const { poolInitInfo, configKeypairs, configExtension } =
            await initTestPoolV2(
              ctx,
              tokenTraits.tokenTraitAB,
              tokenTraits.tokenTraitAB,
              TickSpacing.Standard,
            );

          const { params } = await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            0,
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          );

          const whirlpool = (await fetcher.getPool(
            poolInitInfo.whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          assert.ok(whirlpool.rewardInfos[0].mint.equals(params.rewardMint));
          assert.ok(
            whirlpool.rewardInfos[0].vault.equals(
              params.rewardVaultKeypair.publicKey,
            ),
          );

          await assert.rejects(
            initializeRewardV2(
              ctx,
              tokenTraits.tokenTraitR,
              poolInitInfo.whirlpoolsConfig,
              configKeypairs.rewardEmissionsSuperAuthorityKeypair,
              poolInitInfo.whirlpoolPda.publicKey,
              0,
              configExtension.configExtensionKeypairs
                .tokenBadgeAuthorityKeypair,
            ),
            /custom program error: 0x178a/, // InvalidRewardIndex
          );

          const { params: params2 } = await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            1,
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          );

          const whirlpool2 = (await fetcher.getPool(
            poolInitInfo.whirlpoolPda.publicKey,
            IGNORE_CACHE,
          )) as WhirlpoolData;

          assert.ok(whirlpool2.rewardInfos[0].mint.equals(params.rewardMint));
          assert.ok(
            whirlpool2.rewardInfos[0].vault.equals(
              params.rewardVaultKeypair.publicKey,
            ),
          );
          await asyncAssertOwnerProgram(
            provider,
            whirlpool2.rewardInfos[0].vault,
            tokenTraits.tokenTraitR.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID,
          );
          assert.ok(whirlpool2.rewardInfos[1].mint.equals(params2.rewardMint));
          assert.ok(
            whirlpool2.rewardInfos[1].vault.equals(
              params2.rewardVaultKeypair.publicKey,
            ),
          );
          await asyncAssertOwnerProgram(
            provider,
            whirlpool2.rewardInfos[1].vault,
            tokenTraits.tokenTraitR.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID,
          );
          assert.ok(
            whirlpool2.rewardInfos[2].mint.equals(
              anchor.web3.PublicKey.default,
            ),
          );
          assert.ok(
            whirlpool2.rewardInfos[2].vault.equals(
              anchor.web3.PublicKey.default,
            ),
          );
        });

        it("succeeds when funder is different than account paying for transaction fee", async () => {
          const { poolInitInfo, configKeypairs } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitAB,
            tokenTraits.tokenTraitAB,
            TickSpacing.Standard,
          );
          const funderKeypair = anchor.web3.Keypair.generate();
          await systemTransferTx(
            provider,
            funderKeypair.publicKey,
            ONE_SOL,
          ).buildAndExecute();
          await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            0,
            funderKeypair,
          );
        });

        it("fails to initialize reward at index 1", async () => {
          const { poolInitInfo, configKeypairs, configExtension } =
            await initTestPoolV2(
              ctx,
              tokenTraits.tokenTraitAB,
              tokenTraits.tokenTraitAB,
              TickSpacing.Standard,
            );

          await assert.rejects(
            initializeRewardV2(
              ctx,
              tokenTraits.tokenTraitR,
              poolInitInfo.whirlpoolsConfig,
              configKeypairs.rewardEmissionsSuperAuthorityKeypair,
              poolInitInfo.whirlpoolPda.publicKey,
              1,
              configExtension.configExtensionKeypairs
                .tokenBadgeAuthorityKeypair,
            ),
            /custom program error: 0x178a/, // InvalidRewardIndex
          );
        });

        it("fails to initialize reward at out-of-bound index", async () => {
          const { poolInitInfo, configKeypairs, configExtension } =
            await initTestPoolV2(
              ctx,
              tokenTraits.tokenTraitAB,
              tokenTraits.tokenTraitAB,
              TickSpacing.Standard,
            );

          await assert.rejects(
            initializeRewardV2(
              ctx,
              tokenTraits.tokenTraitR,
              poolInitInfo.whirlpoolsConfig,
              configKeypairs.rewardEmissionsSuperAuthorityKeypair,
              poolInitInfo.whirlpoolPda.publicKey,
              3,
              configExtension.configExtensionKeypairs
                .tokenBadgeAuthorityKeypair,
            ),
          );
        });

        it("fails to initialize if authority signature is missing", async () => {
          const { poolInitInfo, configKeypairs } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitAB,
            tokenTraits.tokenTraitAB,
            TickSpacing.Standard,
          );

          const rewardMint = await createMintV2(
            provider,
            tokenTraits.tokenTraitR,
          );

          const rewardTokenBadgePda = PDAUtil.getTokenBadge(
            ctx.program.programId,
            poolInitInfo.whirlpoolsConfig,
            rewardMint,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
                rewardAuthority:
                  configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
                funder: provider.wallet.publicKey,
                whirlpool: poolInitInfo.whirlpoolPda.publicKey,
                rewardMint,
                rewardTokenBadge: rewardTokenBadgePda.publicKey,
                rewardTokenProgram: tokenTraits.tokenTraitR.isToken2022
                  ? TEST_TOKEN_2022_PROGRAM_ID
                  : TEST_TOKEN_PROGRAM_ID,
                rewardVaultKeypair: anchor.web3.Keypair.generate(),
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
          );
        });
      });
    });
  });

  describe("v2 specific accounts", () => {
    it("fails when passed reward_token_program is not token program (token-2022 is passed)", async () => {
      const { poolInitInfo, configKeypairs } = await initTestPoolV2(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard,
      );

      const rewardMint = await createMintV2(provider, { isToken2022: false });

      const rewardTokenBadgePda = PDAUtil.getTokenBadge(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        rewardMint,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
            rewardAuthority:
              configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
            funder: provider.wallet.publicKey,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            rewardMint,
            rewardTokenBadge: rewardTokenBadgePda.publicKey,
            rewardTokenProgram: TEST_TOKEN_2022_PROGRAM_ID,
            rewardVaultKeypair: anchor.web3.Keypair.generate(),
            rewardIndex: 0,
          }),
        )
          .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
          .buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed reward_token_program is not token-2022 program (token is passed)", async () => {
      const { poolInitInfo, configKeypairs } = await initTestPoolV2(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard,
      );

      const rewardMint = await createMintV2(provider, { isToken2022: true });

      const rewardTokenBadgePda = PDAUtil.getTokenBadge(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        rewardMint,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
            rewardAuthority:
              configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
            funder: provider.wallet.publicKey,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            rewardMint,
            rewardTokenBadge: rewardTokenBadgePda.publicKey,
            rewardTokenProgram: TEST_TOKEN_PROGRAM_ID,
            rewardVaultKeypair: anchor.web3.Keypair.generate(),
            rewardIndex: 0,
          }),
        )
          .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
          .buildAndExecute(),
        /0x7dc/, // ConstraintAddress
      );
    });

    it("fails when passed reward_token_program is token_metadata", async () => {
      const { poolInitInfo, configKeypairs } = await initTestPoolV2(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard,
      );

      const rewardMint = await createMintV2(provider, { isToken2022: true });

      const rewardTokenBadgePda = PDAUtil.getTokenBadge(
        ctx.program.programId,
        poolInitInfo.whirlpoolsConfig,
        rewardMint,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
            rewardAuthority:
              configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
            funder: provider.wallet.publicKey,
            whirlpool: poolInitInfo.whirlpoolPda.publicKey,
            rewardMint,
            rewardTokenBadge: rewardTokenBadgePda.publicKey,
            rewardTokenProgram: METADATA_PROGRAM_ADDRESS,
            rewardVaultKeypair: anchor.web3.Keypair.generate(),
            rewardIndex: 0,
          }),
        )
          .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
          .buildAndExecute(),
        /0xbc0/, // InvalidProgramId
      );
    });

    describe("invalid badge account", () => {
      it("fails when reward_token_badge address invalid (uninitialized)", async () => {
        const { poolInitInfo, configKeypairs } = await initTestPoolV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
          TickSpacing.Standard,
        );

        const rewardMint = await createMintV2(provider, {
          isToken2022: true,
          hasPermanentDelegate: true,
        });
        const fakeAddress = Keypair.generate().publicKey;

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
              rewardAuthority:
                configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
              funder: provider.wallet.publicKey,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              rewardMint,
              rewardTokenBadge: fakeAddress,
              rewardTokenProgram: TEST_TOKEN_2022_PROGRAM_ID,
              rewardVaultKeypair: anchor.web3.Keypair.generate(),
              rewardIndex: 0,
            }),
          )
            .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
            .buildAndExecute(),
          /custom program error: 0x7d6/, // ConstraintSeeds
        );
      });

      it("fails when reward_token_badge address invalid (initialized, same config / different mint)", async () => {
        const { poolInitInfo, configKeypairs, configExtension } =
          await initTestPoolV2(
            ctx,
            { isToken2022: true },
            { isToken2022: true },
            TickSpacing.Standard,
          );

        const rewardMint = await createMintV2(provider, {
          isToken2022: true,
          hasPermanentDelegate: true,
        });
        const anotherMint = await createMintV2(provider, {
          isToken2022: true,
          hasPermanentDelegate: true,
        });

        // initialize another badge
        const config = poolInitInfo.whirlpoolsConfig;
        const configExtensionPda = PDAUtil.getConfigExtension(
          ctx.program.programId,
          config,
        );
        const anotherMintTokenBadgePda = PDAUtil.getTokenBadge(
          ctx.program.programId,
          config,
          anotherMint,
        );
        const tokenBadgeAuthority =
          configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair;
        await toTx(
          ctx,
          WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
            whirlpoolsConfig: config,
            whirlpoolsConfigExtension: configExtensionPda.publicKey,
            funder: provider.wallet.publicKey,
            tokenBadgeAuthority: tokenBadgeAuthority.publicKey,
            tokenBadgePda: anotherMintTokenBadgePda,
            tokenMint: anotherMint,
          }),
        )
          .addSigner(tokenBadgeAuthority)
          .buildAndExecute();
        const badge = fetcher.getTokenBadge(
          anotherMintTokenBadgePda.publicKey,
          IGNORE_CACHE,
        );
        assert.ok(badge !== null);

        const fakeAddress = anotherMintTokenBadgePda.publicKey;

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
              rewardAuthority:
                configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
              funder: provider.wallet.publicKey,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              rewardMint,
              rewardTokenBadge: fakeAddress,
              rewardTokenProgram: TEST_TOKEN_2022_PROGRAM_ID,
              rewardVaultKeypair: anchor.web3.Keypair.generate(),
              rewardIndex: 0,
            }),
          )
            .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
            .buildAndExecute(),
          /custom program error: 0x7d6/, // ConstraintSeeds
        );
      });

      it("fails when reward_token_badge address invalid (initialized, account owned by WhirlpoolProgram)", async () => {
        const { poolInitInfo, configKeypairs } = await initTestPoolV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
          TickSpacing.Standard,
        );

        const rewardMint = await createMintV2(provider, {
          isToken2022: true,
          hasPermanentDelegate: true,
        });
        const fakeAddress = poolInitInfo.whirlpoolPda.publicKey;

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
              rewardAuthority:
                configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
              funder: provider.wallet.publicKey,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              rewardMint,
              rewardTokenBadge: fakeAddress,
              rewardTokenProgram: TEST_TOKEN_2022_PROGRAM_ID,
              rewardVaultKeypair: anchor.web3.Keypair.generate(),
              rewardIndex: 0,
            }),
          )
            .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
            .buildAndExecute(),
          /custom program error: 0x7d6/, // ConstraintSeeds
        );
      });
    });
  });

  describe("Supported Tokens", () => {
    async function runTest(params: {
      supported: boolean;
      createTokenBadge: boolean;
      tokenTrait: TokenTrait;
    }) {
      const { poolInitInfo, configKeypairs, configExtension } =
        await initTestPoolV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
          TickSpacing.Standard,
        );
      const config = poolInitInfo.whirlpoolsConfig;

      const rewardToken = await createMintV2(provider, params.tokenTrait);
      const tokenProgram = (await provider.connection.getAccountInfo(
        rewardToken,
      ))!.owner;

      // create token badge if wanted
      const tokenBadgePda = PDAUtil.getTokenBadge(
        ctx.program.programId,
        config,
        rewardToken,
      );
      if (params.createTokenBadge) {
        await toTx(
          ctx,
          WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
            whirlpoolsConfig: config,
            whirlpoolsConfigExtension:
              configExtension.configExtensionInitInfo
                .whirlpoolsConfigExtensionPda.publicKey,
            funder: provider.wallet.publicKey,
            tokenBadgeAuthority:
              configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair
                .publicKey,
            tokenBadgePda,
            tokenMint: rewardToken,
          }),
        )
          .addSigner(
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          )
          .buildAndExecute();
      }

      // try to initialize reward
      const promise = toTx(
        ctx,
        WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
          rewardAuthority:
            configKeypairs.rewardEmissionsSuperAuthorityKeypair.publicKey,
          funder: provider.wallet.publicKey,
          whirlpool: poolInitInfo.whirlpoolPda.publicKey,
          rewardMint: rewardToken,
          rewardTokenBadge: tokenBadgePda.publicKey,
          rewardTokenProgram: tokenProgram,
          rewardVaultKeypair: anchor.web3.Keypair.generate(),
          rewardIndex: 0,
        }),
      )
        .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
        .buildAndExecute();

      if (params.supported) {
        await promise;
        const whirlpoolData = await fetcher.getPool(
          poolInitInfo.whirlpoolPda.publicKey,
          IGNORE_CACHE,
        );
        assert.ok(whirlpoolData!.rewardInfos[0].mint.equals(rewardToken));
      } else {
        await assert.rejects(
          promise,
          /0x179f/, // UnsupportedTokenMint
        );
      }
    }

    it("Token: mint without FreezeAuthority", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: false,
        },
      });
    });

    it("Token: mint with FreezeAuthority", async () => {
      // not good, but allowed for compatibility to initialize_pool
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: false,
          hasFreezeAuthority: true,
        },
      });
    });

    it("Token: native mint (WSOL)", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: false,
          isNativeMint: true,
        },
      });
    });

    it("Token-2022: with TransferFeeConfig", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasTransferFeeExtension: true,
        },
      });
    });

    it("Token-2022: with InterestBearingConfig", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasInterestBearingExtension: true,
        },
      });
    });

    it("Token-2022: with ScaledUiAmount", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasScaledUiAmountExtension: true,
          scaledUiAmountMultiplier: 2,
        },
      });
    });

    it("Token-2022: with MetadataPointer & TokenMetadata", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasTokenMetadataExtension: true,
          hasMetadataPointerExtension: true,
        },
      });
    });

    it("Token-2022: with ConfidentialTransferMint", async () => {
      await runTest({
        supported: true,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasConfidentialTransferExtension: true,
        },
      });
    });

    it("Token-2022: with TokenBadge with FreezeAuthority", async () => {
      await runTest({
        supported: true,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasFreezeAuthority: true,
        },
      });
    });

    it("Token-2022: with TokenBadge with PermanentDelegate", async () => {
      await runTest({
        supported: true,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasPermanentDelegate: true,
        },
      });
    });

    it("Token-2022: with TokenBadge with Pausable", async () => {
      await runTest({
        supported: true,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasPausableExtension: true,
        },
      });
    });

    it("Token-2022: with TokenBadge with TransferHook", async () => {
      await runTest({
        supported: true,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasTransferHookExtension: true,
        },
      });
    });

    it("Token-2022: with TokenBadge with MintCloseAuthority", async () => {
      await runTest({
        supported: true,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasMintCloseAuthorityExtension: true,
        },
      });
    });

    it("Token-2022: with TokenBadge with DefaultAccountState(Initialized)", async () => {
      await runTest({
        supported: true,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasDefaultAccountStateExtension: true,
          defaultAccountInitialState: AccountState.Initialized,
        },
      });
    });

    it("Token-2022: with TokenBadge with DefaultAccountState(Frozen)", async () => {
      await runTest({
        supported: true, // relaxed
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          hasFreezeAuthority: true, // needed to set initial state to Frozen
          hasDefaultAccountStateExtension: true,
          defaultAccountInitialState: AccountState.Frozen,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with FreezeAuthority", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasFreezeAuthority: true,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with PermanentDelegate", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasPermanentDelegate: true,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with Pausable", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasPausableExtension: true,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with TransferHook", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasTransferHookExtension: true,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with MintCloseAuthority", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasMintCloseAuthorityExtension: true,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with DefaultAccountState(Initialized)", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasDefaultAccountStateExtension: true,
          defaultAccountInitialState: AccountState.Initialized,
        },
      });
    });

    it("Token-2022: [FAIL] without TokenBadge with DefaultAccountState(Frozen)", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          hasFreezeAuthority: true, // needed to set initial state to Frozen
          hasDefaultAccountStateExtension: true,
          defaultAccountInitialState: AccountState.Frozen,
        },
      });
    });

    it("Token-2022: [FAIL] with/without TokenBadge, native mint (WSOL-2022)", async () => {
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait: {
          isToken2022: true,
          isNativeMint: true,
        },
      });
      await runTest({
        supported: false,
        createTokenBadge: true,
        tokenTrait: {
          isToken2022: true,
          isNativeMint: true,
        },
      });
    });

    // [11 Mar, 2024] NOT IMPLEMENTED / I believe this extension is not stable yet
    it.skip("Token-2022: [FAIL] with/without TokenBadge with Group", async () => {
      const tokenTrait: TokenTrait = {
        isToken2022: true,
        hasGroupExtension: true,
      };
      await runTest({
        supported: false,
        createTokenBadge: true,
        tokenTrait,
      });
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait,
      });
    });

    it("Token-2022: [FAIL] with/without TokenBadge with GroupPointer", async () => {
      const tokenTrait: TokenTrait = {
        isToken2022: true,
        hasGroupPointerExtension: true,
      };
      await runTest({
        supported: false,
        createTokenBadge: true,
        tokenTrait,
      });
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait,
      });
    });

    //[11 Mar, 2024] NOT IMPLEMENTED / I believe this extension is not stable yet
    it.skip("Token-2022: [FAIL] with/without TokenBadge with Member", async () => {
      const tokenTrait: TokenTrait = {
        isToken2022: true,
        hasGroupMemberExtension: true,
      };
      await runTest({
        supported: false,
        createTokenBadge: true,
        tokenTrait,
      });
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait,
      });
    });

    it("Token-2022: [FAIL] with/without TokenBadge with MemberPointer", async () => {
      const tokenTrait: TokenTrait = {
        isToken2022: true,
        hasGroupMemberPointerExtension: true,
      };
      await runTest({
        supported: false,
        createTokenBadge: true,
        tokenTrait,
      });
      await runTest({
        supported: false,
        createTokenBadge: false,
        tokenTrait,
      });
    });

    it("Token-2022: [FAIL] with/without TokenBadge with NonTransferable", async () => {
      const tokenTrait: TokenTrait = {
        isToken2022: true,
        hasNonTransferableExtension: true,
      };
      await runTest({ supported: false, createTokenBadge: true, tokenTrait });
      await runTest({ supported: false, createTokenBadge: false, tokenTrait });
    });
  });
});
