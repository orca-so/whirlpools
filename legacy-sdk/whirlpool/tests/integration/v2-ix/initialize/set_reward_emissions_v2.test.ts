import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolData, WhirlpoolContext } from "../../../../src";
import { toTx, WhirlpoolIx } from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  TickSpacing,
  ZERO_BN,
  initializeLiteSVMEnvironment,
} from "../../../utils";
import {
  initTestPoolV2,
  initializeRewardV2,
} from "../../../utils/v2/init-utils-v2";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";
import {
  createAndMintToTokenAccountV2,
  mintToDestinationV2,
} from "../../../utils/v2/token-2022";
import { pollForCondition } from "../../../utils/litesvm";

describe("set_reward_emissions_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  const emissionsPerSecondX64 = new anchor.BN(10_000)
    .shln(64)
    .div(new anchor.BN(60 * 60 * 24));

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
        it("successfully set_reward_emissions", async () => {
          const {
            poolInitInfo,
            configInitInfo,
            configKeypairs,
            configExtension,
          } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitAB,
            tokenTraits.tokenTraitAB,
            TickSpacing.Standard,
          );

          const rewardIndex = 0;

          const {
            params: { rewardVaultKeypair, rewardMint },
          } = await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            rewardIndex,
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          );

          await mintToDestinationV2(
            provider,
            tokenTraits.tokenTraitR,
            rewardMint,
            rewardVaultKeypair.publicKey,
            10000,
          );

          await toTx(
            ctx,
            WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
              rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              rewardIndex,
              rewardVaultKey: rewardVaultKeypair.publicKey,
              emissionsPerSecondX64,
            }),
          )
            .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
            .buildAndExecute();

          let whirlpool = (await pollForCondition(
            () =>
              fetcher.getPool(
                poolInitInfo.whirlpoolPda.publicKey,
                IGNORE_CACHE,
              ),
            (wp) =>
              !!wp &&
              wp.rewardInfos[0].emissionsPerSecondX64.eq(emissionsPerSecondX64),
            {
              accountToReload: poolInitInfo.whirlpoolPda.publicKey,
              connection: ctx.connection,
            },
          )) as WhirlpoolData;
          assert.ok(
            whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(
              emissionsPerSecondX64,
            ),
          );

          // Successfuly set emissions back to zero
          await toTx(
            ctx,
            WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
              rewardAuthority: configInitInfo.rewardEmissionsSuperAuthority,
              whirlpool: poolInitInfo.whirlpoolPda.publicKey,
              rewardIndex,
              rewardVaultKey: rewardVaultKeypair.publicKey,
              emissionsPerSecondX64: ZERO_BN,
            }),
          )
            .addSigner(configKeypairs.rewardEmissionsSuperAuthorityKeypair)
            .buildAndExecute();

          whirlpool = await (async () => {
            // LiteSVM may delay state propagation; poll until emissions reach 0
            for (let i = 0; i < 100; i++) {
              const wp = (await fetcher.getPool(
                poolInitInfo.whirlpoolPda.publicKey,
                IGNORE_CACHE,
              )) as WhirlpoolData;
              if (wp.rewardInfos[0].emissionsPerSecondX64.eq(ZERO_BN)) {
                return wp;
              }
              await new Promise((r) => setTimeout(r, 10));
            }
            return (await fetcher.getPool(
              poolInitInfo.whirlpoolPda.publicKey,
              IGNORE_CACHE,
            )) as WhirlpoolData;
          })();
          assert.ok(whirlpool.rewardInfos[0].emissionsPerSecondX64.eq(ZERO_BN));
        });

        it("fails when token vault does not contain at least 1 day of emission runway", async () => {
          const {
            poolInitInfo,
            configInitInfo,
            configKeypairs,
            configExtension,
          } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitAB,
            tokenTraits.tokenTraitAB,
            TickSpacing.Standard,
          );

          const rewardIndex = 0;

          const {
            params: { rewardVaultKeypair },
          } = await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            rewardIndex,
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
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
          const {
            poolInitInfo,
            configInitInfo,
            configKeypairs,
            configExtension,
          } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitAB,
            tokenTraits.tokenTraitAB,
            TickSpacing.Standard,
          );

          const rewardIndex = 0;
          const {
            params: { rewardMint },
          } = await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            rewardIndex,
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          );

          const fakeVault = await createAndMintToTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewardMint,
            10000,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
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
          const { poolInitInfo, configInitInfo, configKeypairs } =
            await initTestPoolV2(
              ctx,
              tokenTraits.tokenTraitAB,
              tokenTraits.tokenTraitAB,
              TickSpacing.Standard,
            );

          const rewardIndex = 0;

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
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
          const {
            poolInitInfo,
            configInitInfo,
            configKeypairs,
            configExtension,
          } = await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitAB,
            tokenTraits.tokenTraitAB,
            TickSpacing.Standard,
          );

          const rewardIndex = 0;

          await initializeRewardV2(
            ctx,
            tokenTraits.tokenTraitR,
            poolInitInfo.whirlpoolsConfig,
            configKeypairs.rewardEmissionsSuperAuthorityKeypair,
            poolInitInfo.whirlpoolPda.publicKey,
            rewardIndex,
            configExtension.configExtensionKeypairs.tokenBadgeAuthorityKeypair,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.setRewardEmissionsV2Ix(ctx.program, {
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
    });
  });
});
