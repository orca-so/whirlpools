import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import type { WhirlpoolData, WhirlpoolContext } from "../../../../src";
import {
  buildWhirlpoolClient,
  collectRewardsQuote,
  METADATA_PROGRAM_ADDRESS,
  NUM_REWARDS,
  toTx,
  WhirlpoolIx,
} from "../../../../src";
import { IGNORE_CACHE } from "../../../../src/network/public/fetcher";
import {
  approveToken,
  getTokenBalance,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  transferToken,
  ZERO_BN,
  warpClock,
  initializeLiteSVMEnvironment,
} from "../../../utils";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";
import {
  createTokenAccountV2,
  createMintV2,
} from "../../../utils/v2/token-2022";
import { createTokenAccount as createTokenAccountForPosition } from "../../../utils/token";
import { NATIVE_MINT } from "@solana/spl-token";
import { TokenExtensionUtil } from "../../../../src/utils/public/token-extension-util";

describe("collect_reward_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];
  let client: ReturnType<typeof buildWhirlpoolClient>;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
    client = buildWhirlpoolClient(ctx);
  });

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
        it("successfully collect rewards", async () => {
          const vaultStartBalance = 1_000_000;
          const lowerTickIndex = -1280,
            upperTickIndex = 1280,
            tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
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
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
                vaultAmount: new BN(vaultStartBalance),
              },
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
                vaultAmount: new BN(vaultStartBalance),
              },
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
                vaultAmount: new BN(vaultStartBalance),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[0].publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          ).buildAndExecute();

          // Generate collect reward expectation
          const whirlpoolData = (await fetcher.getPool(
            whirlpoolPda.publicKey,
          )) as WhirlpoolData;
          const positionPreCollect = await client.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );

          // Lock the collectRewards quote to the last time we called updateFeesAndRewards
          const expectation = collectRewardsQuote({
            whirlpool: whirlpoolData,
            position: positionPreCollect.getData(),
            tickLower: positionPreCollect.getLowerTickData(),
            tickUpper: positionPreCollect.getUpperTickData(),
            timeStampInSeconds: whirlpoolData.rewardLastUpdatedTimestamp,
            tokenExtensionCtx:
              await TokenExtensionUtil.buildTokenExtensionContext(
                fetcher,
                whirlpoolData,
                IGNORE_CACHE,
              ),
          });

          // Check that the expectation is not zero
          for (let i = 0; i < NUM_REWARDS; i++) {
            assert.ok(!expectation.rewardOwed[i]!.isZero());
          }

          // Perform collect rewards tx
          for (let i = 0; i < NUM_REWARDS; i++) {
            const rewardOwnerAccount = await createTokenAccountV2(
              provider,
              tokenTraits.tokenTraitR,
              rewards[i].rewardMint,
              provider.wallet.publicKey,
            );

            await toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[i].rewardMint,
                rewardTokenProgram: rewards[i].tokenProgram,
                rewardOwnerAccount: rewardOwnerAccount,
                rewardVault: rewards[i].rewardVaultKeypair.publicKey,
                rewardIndex: i,
              }),
            ).buildAndExecute();

            const collectedBalance = parseInt(
              await getTokenBalance(provider, rewardOwnerAccount),
            );
            assert.equal(
              collectedBalance,
              expectation.rewardOwed[i]?.toNumber(),
            );
            const vaultBalance = parseInt(
              await getTokenBalance(
                provider,
                rewards[i].rewardVaultKeypair.publicKey,
              ),
            );
            assert.equal(vaultStartBalance - collectedBalance, vaultBalance);
            const position = await fetcher.getPosition(
              positions[0].publicKey,
              IGNORE_CACHE,
            );
            assert.equal(position?.rewardInfos[i].amountOwed, 0);
            assert.ok(
              position?.rewardInfos[i].growthInsideCheckpoint.gte(ZERO_BN),
            );
          }
        });

        it("successfully collect reward with a position authority delegate", async () => {
          const vaultStartBalance = 1_000_000;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(vaultStartBalance),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );

          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[0].publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          ).buildAndExecute();

          const delegate = anchor.web3.Keypair.generate();
          await approveToken(
            provider,
            positions[0].tokenAccount,
            delegate.publicKey,
            1,
          );

          await toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: delegate.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              rewardMint: rewards[0].rewardMint,
              rewardTokenProgram: rewards[0].tokenProgram,
              rewardOwnerAccount,
              rewardVault: rewards[0].rewardVaultKeypair.publicKey,
              rewardIndex: 0,
            }),
          )
            .addSigner(delegate)
            .buildAndExecute();
        });

        it("successfully collect reward with transferred position token", async () => {
          const vaultStartBalance = 1_000_000;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(vaultStartBalance),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );

          const delegate = anchor.web3.Keypair.generate();
          const delegatePositionAccount = await createTokenAccountForPosition(
            provider,
            positions[0].mintKeypair.publicKey,
            delegate.publicKey,
          );
          await transferToken(
            provider,
            positions[0].tokenAccount,
            delegatePositionAccount,
            1,
          );

          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[0].publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          ).buildAndExecute();

          await toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: delegate.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: delegatePositionAccount,
              rewardMint: rewards[0].rewardMint,
              rewardTokenProgram: rewards[0].tokenProgram,
              rewardOwnerAccount,
              rewardVault: rewards[0].rewardVaultKeypair.publicKey,
              rewardIndex: 0,
            }),
          )
            .addSigner(delegate)
            .buildAndExecute();
        });

        it("successfully collect reward with owner even when there is a delegate", async () => {
          const vaultStartBalance = 1_000_000;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(vaultStartBalance),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );

          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[0].publicKey,
              tickArrayLower: positions[0].tickArrayLower,
              tickArrayUpper: positions[0].tickArrayUpper,
            }),
          ).buildAndExecute();

          const delegate = anchor.web3.Keypair.generate();
          await approveToken(
            provider,
            positions[0].tokenAccount,
            delegate.publicKey,
            1,
          );

          await toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              rewardMint: rewards[0].rewardMint,
              rewardTokenProgram: rewards[0].tokenProgram,
              rewardOwnerAccount,
              rewardVault: rewards[0].rewardVaultKeypair.publicKey,
              rewardIndex: 0,
            }),
          ).buildAndExecute();
        });

        it("fails when reward index references an uninitialized reward", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
          } = fixture.getInfos();

          warpClock(1.2);

          const fakeRewardMint = await createMintV2(
            provider,
            tokenTraits.tokenTraitR,
          );
          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            fakeRewardMint,
            provider.wallet.publicKey,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: fakeRewardMint,
                rewardTokenProgram: tokenTraits.tokenTraitR.isToken2022
                  ? TEST_TOKEN_2022_PROGRAM_ID
                  : TEST_TOKEN_PROGRAM_ID,
                rewardOwnerAccount,
                rewardVault: anchor.web3.PublicKey.default,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /0xbbf/, // AccountNotInitialized
          );
        });

        it("fails when position does not match whirlpool", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const { positions, rewards } = fixture.getInfos();

          warpClock(1.2);

          const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
          });

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool:
                  anotherFixture.getInfos().poolInitInfo.whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /0x7d1/, // ConstraintHasOne
          );
        });

        it("fails when position token account does not have exactly one token", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          const otherPositionAcount = await createTokenAccountForPosition(
            provider,
            positions[0].mintKeypair.publicKey,
            provider.wallet.publicKey,
          );
          await transferToken(
            provider,
            positions[0].tokenAccount,
            otherPositionAcount,
            1,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when position token account mint does not match position mint", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );

          const fakePositionTokenAccount = await createTokenAccountForPosition(
            provider,
            NATIVE_MINT,
            provider.wallet.publicKey,
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: fakePositionTokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when position authority is not approved delegate for position token account", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          const delegate = anchor.web3.Keypair.generate();
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            )
              .addSigner(delegate)
              .buildAndExecute(),
            /0x1783/, // MissingOrInvalidDelegate
          );
        });

        it("fails when position authority is not authorized for exactly one token", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          const delegate = anchor.web3.Keypair.generate();
          await approveToken(
            provider,
            positions[0].tokenAccount,
            delegate.publicKey,
            2,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            )
              .addSigner(delegate)
              .buildAndExecute(),
            /0x1784/, // InvalidPositionTokenAmount
          );
        });

        it("fails when position authority was not a signer", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          const delegate = anchor.web3.Keypair.generate();
          await approveToken(
            provider,
            positions[0].tokenAccount,
            delegate.publicKey,
            1,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /.*signature verification fail.*/i,
          );
        });

        it("fails when reward vault does not match whirlpool reward vault", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewardOwnerAccount,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /0x7dc/, // ConstraintAddress
          );
        });

        it("fails when reward owner account mint does not match whirlpool reward mint", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const fakeMint = await createMintV2(
            provider,
            tokenTraits.tokenTraitR,
          );
          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            fakeMint,
            provider.wallet.publicKey,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 0,
              }),
            ).buildAndExecute(),
            /0x7d3/, // ConstraintRaw
          );
        });

        it("fails when reward index is out of bounds", async () => {
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            tokenTraitA: tokenTraits.tokenTraitAB,
            tokenTraitB: tokenTraits.tokenTraitAB,
            tickSpacing: TickSpacing.Standard,
            initialSqrtPrice: MathUtil.toX64(new Decimal(1)),
            positions: [
              {
                tickLowerIndex: -1280,
                tickUpperIndex: 1280,
                liquidityAmount: new anchor.BN(1_000_000),
              },
            ],
            rewards: [
              {
                rewardTokenTrait: tokenTraits.tokenTraitR,
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(2)),
                vaultAmount: new BN(1_000_000),
              },
            ],
          });
          const {
            poolInitInfo: { whirlpoolPda },
            positions,
            rewards,
          } = fixture.getInfos();

          warpClock(1.2);

          const rewardOwnerAccount = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitR,
            rewards[0].rewardMint,
            provider.wallet.publicKey,
          );
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectRewardV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                rewardMint: rewards[0].rewardMint,
                rewardTokenProgram: rewards[0].tokenProgram,
                rewardOwnerAccount,
                rewardVault: rewards[0].rewardVaultKeypair.publicKey,
                rewardIndex: 4,
              }),
            ).buildAndExecute(),
            /ProgramFailedToComplete|SBF program panicked/, // index out of bounds
          );
        });
      });
    });
  });

  describe("v2 specific accounts", () => {
    it("fails when passed reward_mint does not match whirlpool's reward_infos", async () => {
      const tokenTraits: TokenTrait[] = [
        { isToken2022: true },
        { isToken2022: false },
        { isToken2022: true },
      ];

      const vaultStartBalance = 1_000_000;
      const lowerTickIndex = -1280,
        upperTickIndex = 1280,
        tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
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
            rewardTokenTrait: tokenTraits[0],
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: tokenTraits[1],
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: tokenTraits[2],
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      const otherTokenPublicKey = await createMintV2(provider, {
        isToken2022: true,
      });

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardOwnerAccount = await createTokenAccountV2(
          provider,
          tokenTraits[i],
          rewards[i].rewardMint,
          provider.wallet.publicKey,
        );

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              rewardMint: otherTokenPublicKey, // invalid
              rewardTokenProgram: rewards[i].tokenProgram,
              rewardOwnerAccount: rewardOwnerAccount,
              rewardVault: rewards[i].rewardVaultKeypair.publicKey,
              rewardIndex: i,
            }),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      }
    });

    it("fails when passed token_program is not token program (token-2022 is passed)", async () => {
      const vaultStartBalance = 1_000_000;
      const lowerTickIndex = -1280,
        upperTickIndex = 1280,
        tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
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
            rewardTokenTrait: { isToken2022: false },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: false },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: false },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardOwnerAccount = await createTokenAccountV2(
          provider,
          { isToken2022: false },
          rewards[i].rewardMint,
          provider.wallet.publicKey,
        );

        assert.ok(rewards[i].tokenProgram.equals(TEST_TOKEN_PROGRAM_ID));
        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              rewardMint: rewards[i].rewardMint,
              rewardTokenProgram: TEST_TOKEN_2022_PROGRAM_ID, // invalid
              rewardOwnerAccount: rewardOwnerAccount,
              rewardVault: rewards[i].rewardVaultKeypair.publicKey,
              rewardIndex: i,
            }),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      }
    });

    it("fails when passed token_program is not token-2022 program (token is passed)", async () => {
      const vaultStartBalance = 1_000_000;
      const lowerTickIndex = -1280,
        upperTickIndex = 1280,
        tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
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
            rewardTokenTrait: { isToken2022: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardOwnerAccount = await createTokenAccountV2(
          provider,
          { isToken2022: true },
          rewards[i].rewardMint,
          provider.wallet.publicKey,
        );

        assert.ok(rewards[i].tokenProgram.equals(TEST_TOKEN_2022_PROGRAM_ID));
        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              rewardMint: rewards[i].rewardMint,
              rewardTokenProgram: TEST_TOKEN_PROGRAM_ID, // invalid
              rewardOwnerAccount: rewardOwnerAccount,
              rewardVault: rewards[i].rewardVaultKeypair.publicKey,
              rewardIndex: i,
            }),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      }
    });

    it("fails when passed token_program is token_metadata", async () => {
      const vaultStartBalance = 1_000_000;
      const lowerTickIndex = -1280,
        upperTickIndex = 1280,
        tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
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
            rewardTokenTrait: { isToken2022: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
          {
            rewardTokenTrait: { isToken2022: true },
            emissionsPerSecondX64: MathUtil.toX64(new Decimal(10)),
            vaultAmount: new BN(vaultStartBalance),
          },
        ],
      });
      const {
        poolInitInfo: { whirlpoolPda },
        positions,
        rewards,
      } = fixture.getInfos();

      for (let i = 0; i < NUM_REWARDS; i++) {
        const rewardOwnerAccount = await createTokenAccountV2(
          provider,
          { isToken2022: true },
          rewards[i].rewardMint,
          provider.wallet.publicKey,
        );

        assert.ok(rewards[i].tokenProgram.equals(TEST_TOKEN_2022_PROGRAM_ID));
        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.collectRewardV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              rewardMint: rewards[i].rewardMint,
              rewardTokenProgram: METADATA_PROGRAM_ADDRESS, // invalid
              rewardOwnerAccount: rewardOwnerAccount,
              rewardVault: rewards[i].rewardVaultKeypair.publicKey,
              rewardIndex: i,
            }),
          ).buildAndExecute(),
          /0xbc0/, // InvalidProgramId
        );
      }
    });

    it("fails when passed memo_program is token_metadata", async () => {});
  });
});
