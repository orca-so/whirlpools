import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import type {
  InitializeAdaptiveFeeTierParams,
  InitPoolWithAdaptiveFeeParams,
  WhirlpoolData,
  WhirlpoolContext,
} from "../../../src";
import {
  IGNORE_CACHE,
  MAX_SQRT_PRICE,
  METADATA_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE,
  PDAUtil,
  PoolUtil,
  PriceMath,
  WhirlpoolIx,
  toTx,
} from "../../../src";
import {
  ONE_SOL,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  dropIsSignerFlag,
  getLocalnetAdminKeypair0,
  getProviderWalletKeypair,
  setAuthority,
  sleep,
  systemTransferTx,
} from "../../utils";
import { initializeLiteSVMEnvironment } from "../../utils/litesvm";
import type { TokenTrait } from "../../utils/v2/init-utils-v2";
import {
  buildTestPoolWithAdaptiveFeeParams,
  initTestPoolV2,
  initTestPoolWithAdaptiveFee,
} from "../../utils/v2/init-utils-v2";
import {
  asyncAssertOwnerProgram,
  asyncAssertTokenVaultV2,
  createMintV2,
  initializeNativeMint2022Idempotent,
} from "../../utils/v2/token-2022";
import { initializeNativeMintIdempotent } from "../../utils/litesvm";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import {
  AccountState,
  AuthorityType,
  createInitializeMintInstruction,
  NATIVE_MINT,
  NATIVE_MINT_2022,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  initAdaptiveFeeTier,
  initFeeTier,
  initializeConfigWithDefaultConfigParams,
} from "../../utils/init-utils";
import { getDefaultPresetAdaptiveFeeConstants } from "../../utils/test-builders";

describe("initialize_pool_with_adaptive_fee", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];
  let providerWalletKeypair: Keypair;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    program = env.program;
    ctx = env.ctx;
    fetcher = env.fetcher;
    providerWalletKeypair = getProviderWalletKeypair(provider);
  });

  describe("v2 parity", () => {
    describe("v1 parity", () => {
      const tokenTraitVariations: {
        tokenTraitA: TokenTrait;
        tokenTraitB: TokenTrait;
      }[] = [
        {
          tokenTraitA: { isToken2022: false },
          tokenTraitB: { isToken2022: false },
        },
        {
          tokenTraitA: { isToken2022: true },
          tokenTraitB: { isToken2022: false },
        },
        {
          tokenTraitA: { isToken2022: false },
          tokenTraitB: { isToken2022: true },
        },
        {
          tokenTraitA: { isToken2022: true },
          tokenTraitB: { isToken2022: true },
        },
      ];
      tokenTraitVariations.forEach((tokenTraits) => {
        describe(`tokenTraitA: ${
          tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
        }, tokenTraitB: ${tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"}`, () => {
          it("successfully init a Standard account", async () => {
            const price = MathUtil.toX64(new Decimal(5));
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { configInitInfo, poolInitInfo, feeTierParams } =
              await initTestPoolWithAdaptiveFee(
                ctx,
                tokenTraits.tokenTraitA,
                tokenTraits.tokenTraitB,
                feeTierIndex,
                tickSpacing,
                undefined,
                getDefaultPresetAdaptiveFeeConstants(tickSpacing),
                undefined,
                undefined,
                price,
              );
            const whirlpool = (await fetcher.getPool(
              poolInitInfo.whirlpoolPda.publicKey,
            )) as WhirlpoolData;

            const expectedWhirlpoolPda = PDAUtil.getWhirlpool(
              program.programId,
              configInitInfo.whirlpoolsConfigKeypair.publicKey,
              poolInitInfo.tokenMintA,
              poolInitInfo.tokenMintB,
              feeTierIndex,
            );

            assert.ok(
              poolInitInfo.whirlpoolPda.publicKey.equals(
                expectedWhirlpoolPda.publicKey,
              ),
            );
            assert.equal(expectedWhirlpoolPda.bump, whirlpool.whirlpoolBump[0]);

            assert.ok(
              whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig),
            );

            assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
            assert.ok(
              whirlpool.tokenVaultA.equals(
                poolInitInfo.tokenVaultAKeypair.publicKey,
              ),
            );
            await asyncAssertOwnerProgram(
              provider,
              whirlpool.tokenMintA,
              tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
            assert.ok(
              whirlpool.tokenVaultB.equals(
                poolInitInfo.tokenVaultBKeypair.publicKey,
              ),
            );
            await asyncAssertOwnerProgram(
              provider,
              whirlpool.tokenMintB,
              tokenTraits.tokenTraitB.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            assert.equal(whirlpool.feeRate, feeTierParams.defaultBaseFeeRate);
            assert.equal(
              whirlpool.protocolFeeRate,
              configInitInfo.defaultProtocolFeeRate,
            );

            assert.ok(
              whirlpool.sqrtPrice.eq(
                new anchor.BN(poolInitInfo.initSqrtPrice.toString()),
              ),
            );
            assert.ok(whirlpool.liquidity.eq(ZERO_BN));

            assert.equal(
              whirlpool.tickCurrentIndex,
              PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
            );

            assert.ok(whirlpool.protocolFeeOwedA.eq(ZERO_BN));
            assert.ok(whirlpool.protocolFeeOwedB.eq(ZERO_BN));
            assert.ok(whirlpool.feeGrowthGlobalA.eq(ZERO_BN));
            assert.ok(whirlpool.feeGrowthGlobalB.eq(ZERO_BN));

            assert.ok(whirlpool.tickSpacing === tickSpacing);
            assert.ok(
              whirlpool.feeTierIndexSeed[0] +
                whirlpool.feeTierIndexSeed[1] * 256 ===
                feeTierIndex,
            );

            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
              poolInitInfo.tokenMintA,
              poolInitInfo.whirlpoolPda.publicKey,
              tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );
            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
              poolInitInfo.tokenMintB,
              poolInitInfo.whirlpoolPda.publicKey,
              tokenTraits.tokenTraitB.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            whirlpool.rewardInfos.forEach((rewardInfo) => {
              assert.equal(rewardInfo.emissionsPerSecondX64, 0);
              assert.equal(rewardInfo.growthGlobalX64, 0);
              assert.ok(rewardInfo.mint.equals(anchor.web3.PublicKey.default));
              assert.ok(rewardInfo.vault.equals(anchor.web3.PublicKey.default));
            });

            assert.ok(
              PoolUtil.getRewardAuthority(whirlpool).equals(
                configInitInfo.rewardEmissionsSuperAuthority,
              ),
            );
            assert.ok(whirlpool.rewardInfos[1].extension.every((x) => x === 0));
            assert.ok(whirlpool.rewardInfos[2].extension.every((x) => x === 0));

            // Oracle should be initialized
            await asyncAssertOracle(
              poolInitInfo.oraclePda.publicKey,
              poolInitInfo.whirlpoolPda.publicKey,
              feeTierParams,
            );
          });

          it("successfully init a Stable account", async () => {
            const price = MathUtil.toX64(new Decimal(5));
            const tickSpacing = TickSpacing.Stable;
            const feeTierIndex = 1024 + tickSpacing;
            const { configInitInfo, poolInitInfo, feeTierParams } =
              await initTestPoolWithAdaptiveFee(
                ctx,
                tokenTraits.tokenTraitA,
                tokenTraits.tokenTraitB,
                feeTierIndex,
                tickSpacing,
                undefined,
                getDefaultPresetAdaptiveFeeConstants(tickSpacing),
                undefined,
                undefined,
                price,
              );
            const whirlpool = (await fetcher.getPool(
              poolInitInfo.whirlpoolPda.publicKey,
            )) as WhirlpoolData;

            assert.ok(
              whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig),
            );

            assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
            assert.ok(
              whirlpool.tokenVaultA.equals(
                poolInitInfo.tokenVaultAKeypair.publicKey,
              ),
            );
            await asyncAssertOwnerProgram(
              provider,
              whirlpool.tokenMintA,
              tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
            assert.ok(
              whirlpool.tokenVaultB.equals(
                poolInitInfo.tokenVaultBKeypair.publicKey,
              ),
            );
            await asyncAssertOwnerProgram(
              provider,
              whirlpool.tokenMintB,
              tokenTraits.tokenTraitB.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            assert.equal(whirlpool.feeRate, feeTierParams.defaultBaseFeeRate);
            assert.equal(
              whirlpool.protocolFeeRate,
              configInitInfo.defaultProtocolFeeRate,
            );

            assert.ok(
              whirlpool.sqrtPrice.eq(
                new anchor.BN(poolInitInfo.initSqrtPrice.toString()),
              ),
            );
            assert.ok(whirlpool.liquidity.eq(ZERO_BN));

            assert.equal(
              whirlpool.tickCurrentIndex,
              PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice),
            );

            assert.ok(whirlpool.protocolFeeOwedA.eq(ZERO_BN));
            assert.ok(whirlpool.protocolFeeOwedB.eq(ZERO_BN));
            assert.ok(whirlpool.feeGrowthGlobalA.eq(ZERO_BN));
            assert.ok(whirlpool.feeGrowthGlobalB.eq(ZERO_BN));

            assert.ok(whirlpool.tickSpacing === tickSpacing);
            assert.ok(
              whirlpool.feeTierIndexSeed[0] +
                whirlpool.feeTierIndexSeed[1] * 256 ===
                feeTierIndex,
            );

            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
              poolInitInfo.tokenMintA,
              poolInitInfo.whirlpoolPda.publicKey,
              tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );
            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
              poolInitInfo.tokenMintB,
              poolInitInfo.whirlpoolPda.publicKey,
              tokenTraits.tokenTraitB.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            );

            whirlpool.rewardInfos.forEach((rewardInfo) => {
              assert.equal(rewardInfo.emissionsPerSecondX64, 0);
              assert.equal(rewardInfo.growthGlobalX64, 0);
              assert.ok(rewardInfo.mint.equals(anchor.web3.PublicKey.default));
              assert.ok(rewardInfo.vault.equals(anchor.web3.PublicKey.default));
            });

            assert.ok(
              PoolUtil.getRewardAuthority(whirlpool).equals(
                configInitInfo.rewardEmissionsSuperAuthority,
              ),
            );
            assert.ok(whirlpool.rewardInfos[1].extension.every((x) => x === 0));
            assert.ok(whirlpool.rewardInfos[2].extension.every((x) => x === 0));

            // Oracle should be initialized
            await asyncAssertOracle(
              poolInitInfo.oraclePda.publicKey,
              poolInitInfo.whirlpoolPda.publicKey,
              feeTierParams,
            );
          });

          it("succeeds when funder is different than account paying for transaction fee", async () => {
            const funderKeypair = anchor.web3.Keypair.generate();
            await systemTransferTx(
              provider,
              funderKeypair.publicKey,
              ONE_SOL,
            ).buildAndExecute();

            const price = MathUtil.toX64(new Decimal(5));
            const tickSpacing = TickSpacing.Stable;
            const feeTierIndex = 1024 + tickSpacing;
            await initTestPoolWithAdaptiveFee(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              undefined,
              undefined,
              price,
              undefined,
              funderKeypair,
            );
          });

          it("succeeds when vault accounts have non-zero lamports (not rent-exempt)", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              PublicKey.default,
              PublicKey.default,
            );

            const preLamports = 1_000_000;
            await systemTransferTx(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
              preLamports,
            ).buildAndExecute();
            await systemTransferTx(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
              preLamports,
            ).buildAndExecute();

            await toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                ctx.program,
                poolInitInfo,
              ),
            ).buildAndExecute();
            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
              poolInitInfo.tokenMintA,
              poolInitInfo.whirlpoolPda.publicKey,
              poolInitInfo.tokenProgramA,
            );
            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
              poolInitInfo.tokenMintB,
              poolInitInfo.whirlpoolPda.publicKey,
              poolInitInfo.tokenProgramB,
            );

            const vaultA = await provider.connection.getAccountInfo(
              poolInitInfo.tokenVaultAKeypair.publicKey,
            );
            const vaultB = await provider.connection.getAccountInfo(
              poolInitInfo.tokenVaultBKeypair.publicKey,
            );
            assert.ok(vaultA!.lamports > preLamports);
            assert.ok(vaultB!.lamports > preLamports);
          });

          it("succeeds when vault accounts have non-zero lamports (rent-exempt)", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              PublicKey.default,
              PublicKey.default,
            );

            const preLamports = 1_000_000_000;
            await systemTransferTx(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
              preLamports,
            ).buildAndExecute();
            await systemTransferTx(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
              preLamports,
            ).buildAndExecute();

            await toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                ctx.program,
                poolInitInfo,
              ),
            ).buildAndExecute();
            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultAKeypair.publicKey,
              poolInitInfo.tokenMintA,
              poolInitInfo.whirlpoolPda.publicKey,
              poolInitInfo.tokenProgramA,
            );
            await asyncAssertTokenVaultV2(
              provider,
              poolInitInfo.tokenVaultBKeypair.publicKey,
              poolInitInfo.tokenMintB,
              poolInitInfo.whirlpoolPda.publicKey,
              poolInitInfo.tokenProgramB,
            );

            const vaultA = await provider.connection.getAccountInfo(
              poolInitInfo.tokenVaultAKeypair.publicKey,
            );
            const vaultB = await provider.connection.getAccountInfo(
              poolInitInfo.tokenVaultBKeypair.publicKey,
            );
            assert.ok(vaultA!.lamports === preLamports);
            assert.ok(vaultB!.lamports === preLamports);
          });

          it("fails when tokenVaultA mint does not match tokenA mint", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              PublicKey.default,
              PublicKey.default,
            );
            const otherTokenPublicKey = await createMintV2(
              provider,
              tokenTraits.tokenTraitA,
            );

            const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
              ...poolInitInfo,
              tokenMintA: otherTokenPublicKey,
            };

            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                  ctx.program,
                  modifiedPoolInitInfo,
                ),
              ).buildAndExecute(),
              /custom program error: 0x7d6/, // ConstraintSeeds
            );
          });

          it("fails when tokenVaultB mint does not match tokenB mint", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              PublicKey.default,
              PublicKey.default,
            );
            const otherTokenPublicKey = await createMintV2(
              provider,
              tokenTraits.tokenTraitB,
            );

            const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
              ...poolInitInfo,
              tokenMintB: otherTokenPublicKey,
            };

            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                  ctx.program,
                  modifiedPoolInitInfo,
                ),
              ).buildAndExecute(),
              /custom program error: 0x7d6/, // ConstraintSeeds
            );
          });

          it("fails when token mints are in the wrong order", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { configInitInfo, poolInitInfo } =
              await buildTestPoolWithAdaptiveFeeParams(
                ctx,
                tokenTraits.tokenTraitA,
                tokenTraits.tokenTraitB,
                feeTierIndex,
                tickSpacing,
                undefined,
                undefined,
                getDefaultPresetAdaptiveFeeConstants(tickSpacing),
                PublicKey.default,
                PublicKey.default,
              );

            const whirlpoolPda = PDAUtil.getWhirlpool(
              ctx.program.programId,
              configInitInfo.whirlpoolsConfigKeypair.publicKey,
              poolInitInfo.tokenMintB,
              poolInitInfo.tokenMintA,
              feeTierIndex,
            );

            const oraclePda = PDAUtil.getOracle(
              ctx.program.programId,
              whirlpoolPda.publicKey,
            );

            const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
              ...poolInitInfo,
              whirlpoolPda,
              oraclePda,
              tokenMintA: poolInitInfo.tokenMintB,
              tokenBadgeA: poolInitInfo.tokenBadgeB,
              tokenProgramA: tokenTraits.tokenTraitB.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
              tokenMintB: poolInitInfo.tokenMintA,
              tokenBadgeB: poolInitInfo.tokenBadgeA,
              tokenProgramB: tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            };

            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                  ctx.program,
                  modifiedPoolInitInfo,
                ),
              ).buildAndExecute(),
              /custom program error: 0x1788/, // InvalidTokenMintOrder
            );
          });

          it("fails when the same token mint is passed in", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { configInitInfo, poolInitInfo } =
              await buildTestPoolWithAdaptiveFeeParams(
                ctx,
                tokenTraits.tokenTraitA,
                tokenTraits.tokenTraitB,
                feeTierIndex,
                tickSpacing,
                undefined,
                undefined,
                getDefaultPresetAdaptiveFeeConstants(tickSpacing),
                PublicKey.default,
                PublicKey.default,
              );

            const whirlpoolPda = PDAUtil.getWhirlpool(
              ctx.program.programId,
              configInitInfo.whirlpoolsConfigKeypair.publicKey,
              poolInitInfo.tokenMintA,
              poolInitInfo.tokenMintA,
              feeTierIndex,
            );

            const oraclePda = PDAUtil.getOracle(
              ctx.program.programId,
              whirlpoolPda.publicKey,
            );

            const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
              ...poolInitInfo,
              whirlpoolPda,
              oraclePda,
              tokenMintB: poolInitInfo.tokenMintA,
              tokenBadgeB: poolInitInfo.tokenBadgeA,
              tokenProgramB: tokenTraits.tokenTraitA.isToken2022
                ? TEST_TOKEN_2022_PROGRAM_ID
                : TEST_TOKEN_PROGRAM_ID,
            };

            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                  ctx.program,
                  modifiedPoolInitInfo,
                ),
              ).buildAndExecute(),
              /custom program error: 0x1788/, // InvalidTokenMintOrder
            );
          });

          it("fails when sqrt-price exceeds max", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              PublicKey.default,
              PublicKey.default,
            );

            const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
              ...poolInitInfo,
              initSqrtPrice: new anchor.BN(MAX_SQRT_PRICE).add(
                new anchor.BN(1),
              ),
            };

            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                  ctx.program,
                  modifiedPoolInitInfo,
                ),
              ).buildAndExecute(),
              /custom program error: 0x177b/, // SqrtPriceOutOfBounds
            );
          });

          it("fails when sqrt-price subceeds min", async () => {
            const tickSpacing = TickSpacing.Standard;
            const feeTierIndex = 1024 + tickSpacing;
            const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              feeTierIndex,
              tickSpacing,
              undefined,
              undefined,
              getDefaultPresetAdaptiveFeeConstants(tickSpacing),
              PublicKey.default,
              PublicKey.default,
            );

            const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
              ...poolInitInfo,
              initSqrtPrice: new anchor.BN(MIN_SQRT_PRICE).sub(
                new anchor.BN(1),
              ),
            };

            await assert.rejects(
              toTx(
                ctx,
                WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
                  ctx.program,
                  modifiedPoolInitInfo,
                ),
              ).buildAndExecute(),
              /custom program error: 0x177b/, // SqrtPriceOutOfBounds
            );
          });

          // no explicit bump value passed (it should be derived by Anchor)
        });
      });
    });

    // no tick_spacing parameter (it should be copied from AdaptiveFeeTier)

    describe("v2 specific accounts", () => {
      it("fails when passed token_program_a is not token program (token-2022 is passed)", async () => {
        const tickSpacing = TickSpacing.Standard;
        const feeTierIndex = 1024 + tickSpacing;
        const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: false },
          { isToken2022: false },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

        assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
        const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
          ...poolInitInfo,
          tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
        };

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
              ctx.program,
              modifiedPoolInitInfo,
            ),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      });

      it("fails when passed token_program_a is not token-2022 program (token is passed)", async () => {
        const tickSpacing = TickSpacing.Standard;
        const feeTierIndex = 1024 + tickSpacing;
        const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: true },
          { isToken2022: false },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

        assert.ok(
          poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID),
        );
        const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
          ...poolInitInfo,
          tokenProgramA: TEST_TOKEN_PROGRAM_ID,
        };

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
              ctx.program,
              modifiedPoolInitInfo,
            ),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      });

      it("fails when passed token_program_a is token_metadata", async () => {
        const tickSpacing = TickSpacing.Standard;
        const feeTierIndex = 1024 + tickSpacing;
        const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: true },
          { isToken2022: false },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

        assert.ok(
          poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID),
        );
        const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
          ...poolInitInfo,
          tokenProgramA: METADATA_PROGRAM_ADDRESS,
        };

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
              ctx.program,
              modifiedPoolInitInfo,
            ),
          ).buildAndExecute(),
          /0xbc0/, // InvalidProgramId
        );
      });

      it("fails when passed token_program_b is not token program (token-2022 is passed)", async () => {
        const tickSpacing = TickSpacing.Standard;
        const feeTierIndex = 1024 + tickSpacing;
        const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: false },
          { isToken2022: false },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

        assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
        const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
          ...poolInitInfo,
          tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,
        };

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
              ctx.program,
              modifiedPoolInitInfo,
            ),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      });

      it("fails when passed token_program_b is not token-2022 program (token is passed)", async () => {
        const tickSpacing = TickSpacing.Standard;
        const feeTierIndex = 1024 + tickSpacing;
        const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: false },
          { isToken2022: true },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

        assert.ok(
          poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID),
        );
        const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
          ...poolInitInfo,
          tokenProgramB: TEST_TOKEN_PROGRAM_ID,
        };

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
              ctx.program,
              modifiedPoolInitInfo,
            ),
          ).buildAndExecute(),
          /0x7dc/, // ConstraintAddress
        );
      });

      it("fails when passed token_program_b is token_metadata", async () => {
        const tickSpacing = TickSpacing.Standard;
        const feeTierIndex = 1024 + tickSpacing;
        const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: false },
          { isToken2022: true },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

        assert.ok(
          poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID),
        );
        const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
          ...poolInitInfo,
          tokenProgramB: METADATA_PROGRAM_ADDRESS,
        };

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
              ctx.program,
              modifiedPoolInitInfo,
            ),
          ).buildAndExecute(),
          /0xbc0/, // InvalidProgramId
        );
      });

      describe("invalid badge account", () => {
        let baseIxParams: InitPoolWithAdaptiveFeeParams;

        beforeEach(async () => {
          // create tokens
          const [tokenAKeypair, tokenBKeypair] = [
            Keypair.generate(),
            Keypair.generate(),
          ].sort((a, b) => PoolUtil.compareMints(a.publicKey, b.publicKey));
          await createMintV2(
            provider,
            { isToken2022: true, hasPermanentDelegate: true },
            undefined,
            tokenAKeypair,
          );
          await createMintV2(
            provider,
            { isToken2022: true, hasPermanentDelegate: true },
            undefined,
            tokenBKeypair,
          );

          // create config and feetier
          const admin = await getLocalnetAdminKeypair0(ctx);
          const configKeypair = Keypair.generate();
          const initConfigTx = toTx(
            ctx,
            WhirlpoolIx.initializeConfigIx(ctx.program, {
              collectProtocolFeesAuthority: provider.wallet.publicKey,
              feeAuthority: provider.wallet.publicKey,
              rewardEmissionsSuperAuthority: provider.wallet.publicKey,
              defaultProtocolFeeRate: 300,
              funder: admin.publicKey,
              whirlpoolsConfigKeypair: configKeypair,
            }),
          );
          initConfigTx.addInstruction(
            WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
              whirlpoolsConfig: configKeypair.publicKey,
              authority: admin.publicKey,
              featureFlag: {
                tokenBadge: [true],
              },
            }),
          );
          await initConfigTx
            .addSigner(admin)
            .addSigner(configKeypair)
            .buildAndExecute();

          const tickSpacing = TickSpacing.SixtyFour;
          const feeTierIndex = 1024 + tickSpacing;
          const feeTierPda = PDAUtil.getFeeTier(
            ctx.program.programId,
            configKeypair.publicKey,
            feeTierIndex,
          );
          const presetAdaptiveFeeConstants =
            getDefaultPresetAdaptiveFeeConstants(tickSpacing);
          await toTx(
            ctx,
            WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
              defaultBaseFeeRate: 3000,
              feeAuthority: provider.wallet.publicKey,
              funder: provider.wallet.publicKey,
              feeTierIndex,
              tickSpacing,
              whirlpoolsConfig: configKeypair.publicKey,
              feeTierPda: feeTierPda,
              presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
              presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
              presetAdaptiveFeeControlFactor:
                presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
              presetMaxVolatilityAccumulator:
                presetAdaptiveFeeConstants.maxVolatilityAccumulator,
              presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
              presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
              presetMajorSwapThresholdTicks:
                presetAdaptiveFeeConstants.majorSwapThresholdTicks,
            }),
          ).buildAndExecute();

          // create config extension
          const configExtensionPda = PDAUtil.getConfigExtension(
            ctx.program.programId,
            configKeypair.publicKey,
          );
          await toTx(
            ctx,
            WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
              feeAuthority: provider.wallet.publicKey,
              funder: provider.wallet.publicKey,
              whirlpoolsConfig: configKeypair.publicKey,
              whirlpoolsConfigExtensionPda: configExtensionPda,
            }),
          ).buildAndExecute();

          const whirlpoolPda = PDAUtil.getWhirlpool(
            ctx.program.programId,
            configKeypair.publicKey,
            tokenAKeypair.publicKey,
            tokenBKeypair.publicKey,
            feeTierIndex,
          );
          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );
          baseIxParams = {
            oraclePda,
            initializePoolAuthority: provider.wallet.publicKey,
            tokenVaultAKeypair: Keypair.generate(),
            tokenVaultBKeypair: Keypair.generate(),
            funder: provider.wallet.publicKey,
            initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
            tokenMintA: tokenAKeypair.publicKey,
            tokenMintB: tokenBKeypair.publicKey,
            whirlpoolsConfig: configKeypair.publicKey,
            adaptiveFeeTierKey: feeTierPda.publicKey,
            tokenBadgeA: PDAUtil.getTokenBadge(
              ctx.program.programId,
              configKeypair.publicKey,
              tokenAKeypair.publicKey,
            ).publicKey,
            tokenBadgeB: PDAUtil.getTokenBadge(
              ctx.program.programId,
              configKeypair.publicKey,
              tokenBKeypair.publicKey,
            ).publicKey,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,
            whirlpoolPda,
          };
        });

        it("fails when token_badge_a/b address invalid (uninitialized)", async () => {
          const fakeAddress = Keypair.generate().publicKey;
          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
                ...baseIxParams,
                tokenBadgeA: fakeAddress,
              }),
            ).buildAndExecute(),
            /custom program error: 0x7d6/, // ConstraintSeeds
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
                ...baseIxParams,
                tokenBadgeB: fakeAddress,
              }),
            ).buildAndExecute(),
            /custom program error: 0x7d6/, // ConstraintSeeds
          );
        });

        it("fails when token_badge_a/b address invalid (initialized, same config / different mint)", async () => {
          const config = baseIxParams.whirlpoolsConfig;

          const anotherTokenKeypair = Keypair.generate();
          await createMintV2(
            provider,
            { isToken2022: true },
            undefined,
            anotherTokenKeypair,
          );

          // initialize another badge
          const configExtension = PDAUtil.getConfigExtension(
            ctx.program.programId,
            config,
          ).publicKey;
          const tokenBadgePda = PDAUtil.getTokenBadge(
            ctx.program.programId,
            config,
            anotherTokenKeypair.publicKey,
          );
          await toTx(
            ctx,
            WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
              whirlpoolsConfig: config,
              whirlpoolsConfigExtension: configExtension,
              funder: provider.wallet.publicKey,
              tokenBadgeAuthority: provider.wallet.publicKey,
              tokenBadgePda,
              tokenMint: anotherTokenKeypair.publicKey,
            }),
          ).buildAndExecute();
          const badge = fetcher.getTokenBadge(
            tokenBadgePda.publicKey,
            IGNORE_CACHE,
          );
          assert.ok(badge !== null);

          const fakeAddress = tokenBadgePda.publicKey;

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
                ...baseIxParams,
                tokenBadgeA: fakeAddress,
              }),
            ).buildAndExecute(),
            /custom program error: 0x7d6/, // ConstraintSeeds
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
                ...baseIxParams,
                tokenBadgeB: fakeAddress,
              }),
            ).buildAndExecute(),
            /custom program error: 0x7d6/, // ConstraintSeeds
          );
        });

        it("fails when token_badge_a/b address invalid (account owned by WhirlpoolProgram)", async () => {
          // use Whirlpool address (it is okay to use initTestPoolV2 because we want an initialized Whirlpool)
          const { poolInitInfo } = await initTestPoolV2(
            ctx,
            { isToken2022: true },
            { isToken2022: true },
            TickSpacing.Standard,
          );

          const fakeAddress = poolInitInfo.whirlpoolPda.publicKey;
          const whirlpool = fetcher.getPool(fakeAddress);
          assert.ok(whirlpool !== null);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
                ...baseIxParams,
                tokenBadgeA: fakeAddress,
              }),
            ).buildAndExecute(),
            /custom program error: 0x7d6/, // ConstraintSeeds
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
                ...baseIxParams,
                tokenBadgeB: fakeAddress,
              }),
            ).buildAndExecute(),
            /custom program error: 0x7d6/, // ConstraintSeeds
          );
        });
      });
    });

    describe("Supported Tokens", () => {
      function generate3MintAddress(): [Keypair, Keypair, Keypair] {
        const keypairs = [
          Keypair.generate(),
          Keypair.generate(),
          Keypair.generate(),
        ].sort((a, b) => PoolUtil.compareMints(a.publicKey, b.publicKey));
        return [keypairs[0], keypairs[1], keypairs[2]];
      }

      async function checkSupported(
        supported: boolean,
        whirlpoolsConfig: PublicKey,
        tokenMintA: PublicKey,
        tokenMintB: PublicKey,
        feeTierIndex: number,
      ) {
        const tokenVaultAKeypair = Keypair.generate();
        const tokenVaultBKeypair = Keypair.generate();

        const whirlpoolPda = PDAUtil.getWhirlpool(
          ctx.program.programId,
          whirlpoolsConfig,
          tokenMintA,
          tokenMintB,
          feeTierIndex,
        );
        const oraclePda = PDAUtil.getOracle(
          ctx.program.programId,
          whirlpoolPda.publicKey,
        );
        const feeTierKey = PDAUtil.getFeeTier(
          ctx.program.programId,
          whirlpoolsConfig,
          feeTierIndex,
        ).publicKey;
        const tokenBadgeA = PDAUtil.getTokenBadge(
          ctx.program.programId,
          whirlpoolsConfig,
          tokenMintA,
        ).publicKey;
        const tokenBadgeB = PDAUtil.getTokenBadge(
          ctx.program.programId,
          whirlpoolsConfig,
          tokenMintB,
        ).publicKey;

        const tokenProgramA = (await provider.connection.getAccountInfo(
          tokenMintA,
        ))!.owner;
        const tokenProgramB = (await provider.connection.getAccountInfo(
          tokenMintB,
        ))!.owner;

        const promise = toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
            tokenVaultAKeypair,
            tokenVaultBKeypair,
            funder: provider.wallet.publicKey,
            initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
            tokenMintA,
            tokenMintB,
            whirlpoolsConfig,
            adaptiveFeeTierKey: feeTierKey,
            tokenBadgeA,
            tokenBadgeB,
            tokenProgramA,
            tokenProgramB,
            whirlpoolPda,
            initializePoolAuthority: provider.wallet.publicKey,
            oraclePda,
          }),
        ).buildAndExecute();

        if (supported) {
          await promise;
          const whirlpoolData = await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          );
          assert.ok(whirlpoolData!.tokenMintA.equals(tokenMintA));
          assert.ok(whirlpoolData!.tokenMintB.equals(tokenMintB));
        } else {
          await assert.rejects(
            promise,
            /0x179f/, // UnsupportedTokenMint
          );
        }
      }

      async function runTest(params: {
        supported: boolean;
        createTokenBadge: boolean;
        tokenTrait: TokenTrait;
        dropFreezeAuthorityAfterMintInitialization?: boolean;
      }) {
        // create tokens
        const [tokenA, tokenTarget, tokenB] = generate3MintAddress();
        await createMintV2(provider, { isToken2022: false }, undefined, tokenA);
        await createMintV2(provider, { isToken2022: false }, undefined, tokenB);
        await createMintV2(provider, params.tokenTrait, undefined, tokenTarget);

        if (params.dropFreezeAuthorityAfterMintInitialization) {
          await setAuthority(
            provider,
            tokenTarget.publicKey,
            null,
            AuthorityType.FreezeAccount,
            providerWalletKeypair,
            params.tokenTrait.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID,
          );

          const afterSetAuthorityMint = await fetcher.getMintInfo(
            tokenTarget.publicKey,
            IGNORE_CACHE,
          );
          assert.ok(afterSetAuthorityMint?.freezeAuthority === null);
        }

        // create config and feetier
        const admin = await getLocalnetAdminKeypair0(ctx);
        const configKeypair = Keypair.generate();
        const initConfigTx = toTx(
          ctx,
          WhirlpoolIx.initializeConfigIx(ctx.program, {
            collectProtocolFeesAuthority: provider.wallet.publicKey,
            feeAuthority: provider.wallet.publicKey,
            rewardEmissionsSuperAuthority: provider.wallet.publicKey,
            defaultProtocolFeeRate: 300,
            funder: admin.publicKey,
            whirlpoolsConfigKeypair: configKeypair,
          }),
        );
        initConfigTx.addInstruction(
          WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
            whirlpoolsConfig: configKeypair.publicKey,
            authority: admin.publicKey,
            featureFlag: {
              tokenBadge: [true],
            },
          }),
        );
        await initConfigTx
          .addSigner(admin)
          .addSigner(configKeypair)
          .buildAndExecute();

        const tickSpacing = 64;
        const feeTierIndex = 1024 + tickSpacing;
        const presetAdaptiveFeeConstants =
          getDefaultPresetAdaptiveFeeConstants(tickSpacing);
        await toTx(
          ctx,
          WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
            defaultBaseFeeRate: 3000,
            feeAuthority: provider.wallet.publicKey,
            funder: provider.wallet.publicKey,
            feeTierIndex,
            tickSpacing,
            whirlpoolsConfig: configKeypair.publicKey,
            feeTierPda: PDAUtil.getFeeTier(
              ctx.program.programId,
              configKeypair.publicKey,
              feeTierIndex,
            ),
            presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
            presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
            presetAdaptiveFeeControlFactor:
              presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
            presetMaxVolatilityAccumulator:
              presetAdaptiveFeeConstants.maxVolatilityAccumulator,
            presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
            presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
            presetMajorSwapThresholdTicks:
              presetAdaptiveFeeConstants.majorSwapThresholdTicks,
          }),
        ).buildAndExecute();

        // create token badge if wanted
        if (params.createTokenBadge) {
          const pda = PDAUtil.getConfigExtension(
            ctx.program.programId,
            configKeypair.publicKey,
          );
          await toTx(
            ctx,
            WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
              feeAuthority: provider.wallet.publicKey,
              funder: provider.wallet.publicKey,
              whirlpoolsConfig: configKeypair.publicKey,
              whirlpoolsConfigExtensionPda: pda,
            }),
          ).buildAndExecute();

          const configExtension = PDAUtil.getConfigExtension(
            ctx.program.programId,
            configKeypair.publicKey,
          ).publicKey;
          const tokenBadgePda = PDAUtil.getTokenBadge(
            ctx.program.programId,
            configKeypair.publicKey,
            tokenTarget.publicKey,
          );
          await toTx(
            ctx,
            WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
              whirlpoolsConfig: configKeypair.publicKey,
              whirlpoolsConfigExtension: configExtension,
              funder: provider.wallet.publicKey,
              tokenBadgeAuthority: provider.wallet.publicKey,
              tokenBadgePda,
              tokenMint: tokenTarget.publicKey,
            }),
          ).buildAndExecute();
        }

        const isSupportedToken = await PoolUtil.isSupportedToken(
          ctx,
          configKeypair.publicKey,
          tokenTarget.publicKey,
        );
        assert.equal(isSupportedToken, params.supported);

        // try to initialize pool
        await checkSupported(
          params.supported,
          configKeypair.publicKey,
          tokenA.publicKey,
          tokenTarget.publicKey,
          feeTierIndex,
        ); // as TokenB
        await checkSupported(
          params.supported,
          configKeypair.publicKey,
          tokenTarget.publicKey,
          tokenB.publicKey,
          feeTierIndex,
        ); // as TokenA
      }

      async function runTestWithNativeMint(params: {
        supported: boolean;
        createTokenBadge: boolean;
        isToken2022NativeMint: boolean;
      }) {
        // Initialize the appropriate native mint for LiteSVM
        if (params.isToken2022NativeMint) {
          await initializeNativeMint2022Idempotent(provider);
        } else {
          await initializeNativeMintIdempotent(provider);
        }

        // create tokens
        const nativeMint = params.isToken2022NativeMint
          ? NATIVE_MINT_2022
          : NATIVE_MINT;

        let tokenA = Keypair.generate();
        while (PoolUtil.compareMints(tokenA.publicKey, nativeMint) >= 0)
          tokenA = Keypair.generate();
        let tokenB = Keypair.generate();
        while (PoolUtil.compareMints(nativeMint, tokenB.publicKey) >= 0)
          tokenB = Keypair.generate();

        assert.ok(
          PoolUtil.orderMints(tokenA.publicKey, nativeMint)[1].toString() ===
            nativeMint.toString(),
        );
        assert.ok(
          PoolUtil.orderMints(nativeMint, tokenB.publicKey)[0].toString() ===
            nativeMint.toString(),
        );

        await createMintV2(provider, { isToken2022: false }, undefined, tokenA);
        await createMintV2(provider, { isToken2022: false }, undefined, tokenB);

        // create config and feetier
        const admin = await getLocalnetAdminKeypair0(ctx);
        const configKeypair = Keypair.generate();
        const initConfigTx = toTx(
          ctx,
          WhirlpoolIx.initializeConfigIx(ctx.program, {
            collectProtocolFeesAuthority: provider.wallet.publicKey,
            feeAuthority: provider.wallet.publicKey,
            rewardEmissionsSuperAuthority: provider.wallet.publicKey,
            defaultProtocolFeeRate: 300,
            funder: admin.publicKey,
            whirlpoolsConfigKeypair: configKeypair,
          }),
        );
        initConfigTx.addInstruction(
          WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
            whirlpoolsConfig: configKeypair.publicKey,
            authority: admin.publicKey,
            featureFlag: {
              tokenBadge: [true],
            },
          }),
        );
        await initConfigTx
          .addSigner(admin)
          .addSigner(configKeypair)
          .buildAndExecute();

        const tickSpacing = 64;
        const feeTierIndex = 1024 + tickSpacing;
        const presetAdaptiveFeeConstants =
          getDefaultPresetAdaptiveFeeConstants(tickSpacing);
        await toTx(
          ctx,
          WhirlpoolIx.initializeAdaptiveFeeTierIx(ctx.program, {
            defaultBaseFeeRate: 3000,
            feeAuthority: provider.wallet.publicKey,
            funder: provider.wallet.publicKey,
            feeTierIndex,
            tickSpacing,
            whirlpoolsConfig: configKeypair.publicKey,
            feeTierPda: PDAUtil.getFeeTier(
              ctx.program.programId,
              configKeypair.publicKey,
              feeTierIndex,
            ),
            presetFilterPeriod: presetAdaptiveFeeConstants.filterPeriod,
            presetDecayPeriod: presetAdaptiveFeeConstants.decayPeriod,
            presetAdaptiveFeeControlFactor:
              presetAdaptiveFeeConstants.adaptiveFeeControlFactor,
            presetMaxVolatilityAccumulator:
              presetAdaptiveFeeConstants.maxVolatilityAccumulator,
            presetReductionFactor: presetAdaptiveFeeConstants.reductionFactor,
            presetTickGroupSize: presetAdaptiveFeeConstants.tickGroupSize,
            presetMajorSwapThresholdTicks:
              presetAdaptiveFeeConstants.majorSwapThresholdTicks,
          }),
        ).buildAndExecute();

        // create token badge if wanted
        if (params.createTokenBadge) {
          const pda = PDAUtil.getConfigExtension(
            ctx.program.programId,
            configKeypair.publicKey,
          );
          await toTx(
            ctx,
            WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
              feeAuthority: provider.wallet.publicKey,
              funder: provider.wallet.publicKey,
              whirlpoolsConfig: configKeypair.publicKey,
              whirlpoolsConfigExtensionPda: pda,
            }),
          ).buildAndExecute();

          const configExtension = PDAUtil.getConfigExtension(
            ctx.program.programId,
            configKeypair.publicKey,
          ).publicKey;
          const tokenBadgePda = PDAUtil.getTokenBadge(
            ctx.program.programId,
            configKeypair.publicKey,
            nativeMint,
          );
          await toTx(
            ctx,
            WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
              whirlpoolsConfig: configKeypair.publicKey,
              whirlpoolsConfigExtension: configExtension,
              funder: provider.wallet.publicKey,
              tokenBadgeAuthority: provider.wallet.publicKey,
              tokenBadgePda,
              tokenMint: nativeMint,
            }),
          ).buildAndExecute();
        }

        // try to initialize pool
        await checkSupported(
          params.supported,
          configKeypair.publicKey,
          tokenA.publicKey,
          nativeMint,
          feeTierIndex,
        ); // as TokenB
        await checkSupported(
          params.supported,
          configKeypair.publicKey,
          nativeMint,
          tokenB.publicKey,
          feeTierIndex,
        ); // as TokenA
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
        await runTestWithNativeMint({
          supported: true,
          createTokenBadge: false,
          isToken2022NativeMint: false,
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

      it("Token-2022: with ConfidentialTransferMint & TransferFeeConfig (& ConfidentialTransferFeeConfig)", async () => {
        await runTest({
          supported: true,
          createTokenBadge: false,
          tokenTrait: {
            isToken2022: true,
            hasTransferFeeExtension: true,
            hasConfidentialTransferExtension: true,
            // test util will automatically initialize ConfidentialTransferFeeConfig
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

      it("Token-2022: [FAIL] with TokenBadge with DefaultAccountState(Frozen), but no freeze authority", async () => {
        await runTest({
          supported: false, // thawing is impossible
          createTokenBadge: true,
          tokenTrait: {
            isToken2022: true,
            hasFreezeAuthority: true, // needed to set initial state to Frozen
            hasDefaultAccountStateExtension: true,
            defaultAccountInitialState: AccountState.Frozen,
          },
          dropFreezeAuthorityAfterMintInitialization: true,
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
        await runTestWithNativeMint({
          supported: false,
          createTokenBadge: false,
          isToken2022NativeMint: true,
        });

        await runTestWithNativeMint({
          supported: false,
          createTokenBadge: true,
          isToken2022NativeMint: true,
        });
      });

      //[11 Mar, 2024] NOT IMPLEMENTED / I believe this extension is not stable yet
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
        await runTest({
          supported: false,
          createTokenBadge: false,
          tokenTrait,
        });
      });
    });
  });

  describe("with_adaptive_fee specific accounts", () => {
    it("[FAIL] when adaptive_fee_tier belongs to different config", async () => {
      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        PublicKey.default,
        PublicKey.default,
      );

      const { poolInitInfo: anotherPoolInitInfo } =
        await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        whirlpoolsConfig: anotherPoolInitInfo.whirlpoolsConfig,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
            ctx.program,
            modifiedPoolInitInfo,
          ),
        ).buildAndExecute(),
        /0x7d6/, // ConstraintSeeds
      );
    });

    it("[FAIL] when adaptive_fee_tier is FeeTier (not AdaptiveFeeTier)", async () => {
      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const { poolInitInfo, configInitInfo, configKeypairs } =
        await buildTestPoolWithAdaptiveFeeParams(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
          feeTierIndex,
          tickSpacing,
          undefined,
          undefined,
          getDefaultPresetAdaptiveFeeConstants(tickSpacing),
          PublicKey.default,
          PublicKey.default,
        );

      const { params: nonAdaptiveFeeTierParams } = await initFeeTier(
        ctx,
        configInitInfo,
        configKeypairs.feeAuthorityKeypair,
        tickSpacing,
        3000,
      );

      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        adaptiveFeeTierKey: nonAdaptiveFeeTierParams.feeTierPda.publicKey,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
            ctx.program,
            modifiedPoolInitInfo,
          ),
        ).buildAndExecute(),
        /0xbba/, // AccountDiscriminatorMismatch.
      );
    });

    it("[FAIL] when oracle address is invalid", async () => {
      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        PublicKey.default,
        PublicKey.default,
      );

      const wrongOraclePda = PDAUtil.getOracle(
        ctx.program.programId,
        Keypair.generate().publicKey,
      );

      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        oraclePda: wrongOraclePda,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
            ctx.program,
            modifiedPoolInitInfo,
          ),
        ).buildAndExecute(),
        /0x7d6/, // ConstraintSeeds
      );
    });

    it("when initialize_pool_authority is not set (permission less)", async () => {
      const initializePoolAuthorityKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        initializePoolAuthorityKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();

      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier = PublicKey.default; // permission-less
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        initializePoolAuthority: initializePoolAuthorityKeypair.publicKey,
      };

      await toTx(
        ctx,
        WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
          ctx.program,
          modifiedPoolInitInfo,
        ),
      )
        .addSigner(initializePoolAuthorityKeypair)
        .buildAndExecute();

      const whirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(whirlpoolData !== null);
    });

    it("when initialize_pool_authority is set (permissioned)", async () => {
      const initializePoolAuthorityKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        initializePoolAuthorityKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();

      const fakeAuthorityKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        fakeAuthorityKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();

      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier =
        initializePoolAuthorityKeypair.publicKey;
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const modifiedPoolInitInfoWithFakeAuthority: InitPoolWithAdaptiveFeeParams =
        {
          ...poolInitInfo,
          initializePoolAuthority: fakeAuthorityKeypair.publicKey,
        };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
            ctx.program,
            modifiedPoolInitInfoWithFakeAuthority,
          ),
        )
          .addSigner(fakeAuthorityKeypair)
          .buildAndExecute(),
        /0x7d3/, // ConstraintRaw
      );

      const emptyWhirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(emptyWhirlpoolData === null);

      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        initializePoolAuthority: initializePoolAuthorityKeypair.publicKey,
      };

      await toTx(
        ctx,
        WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
          ctx.program,
          modifiedPoolInitInfo,
        ),
      )
        .addSigner(initializePoolAuthorityKeypair)
        .buildAndExecute();

      const whirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(whirlpoolData !== null);
    });

    it("[FAIL] when initialize_pool_authority is set (permissioned) and wrong initialize_pool_authority is used", async () => {
      const initializePoolAuthorityKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        initializePoolAuthorityKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();

      const fakeAuthorityKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        fakeAuthorityKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();

      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier =
        initializePoolAuthorityKeypair.publicKey;
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const modifiedPoolInitInfoWithFakeAuthority: InitPoolWithAdaptiveFeeParams =
        {
          ...poolInitInfo,
          initializePoolAuthority: fakeAuthorityKeypair.publicKey,
        };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
            ctx.program,
            modifiedPoolInitInfoWithFakeAuthority,
          ),
        )
          .addSigner(fakeAuthorityKeypair)
          .buildAndExecute(),
        /0x7d3/, // ConstraintRaw
      );

      const emptyWhirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(emptyWhirlpoolData === null);
    });

    it("[FAIL] when initialize_pool_authority is set (permissioned) and initialize_pool_authority is not a signer", async () => {
      const initializePoolAuthorityKeypair = anchor.web3.Keypair.generate();
      await systemTransferTx(
        provider,
        initializePoolAuthorityKeypair.publicKey,
        ONE_SOL,
      ).buildAndExecute();

      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier =
        initializePoolAuthorityKeypair.publicKey;
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        initializePoolAuthority: initializePoolAuthorityKeypair.publicKey,
      };

      const ix = WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
        ctx.program,
        modifiedPoolInitInfo,
      );
      const ixWithoutSigner = dropIsSignerFlag(
        ix.instructions[0],
        initializePoolAuthorityKeypair.publicKey,
      );

      await assert.rejects(
        toTx(ctx, {
          instructions: [ixWithoutSigner],
          cleanupInstructions: [],
          signers: ix.signers, // vault keypairs
        }).buildAndExecute(),
        /0xbc2/, // AccountNotSigner
      );

      const emptyWhirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(emptyWhirlpoolData === null);
    });
  });

  describe("with_adaptive_fee specific parameter", () => {
    it("[FAIL] when trade_enable_timestamp is set with permission less Adaptive Fee tier", async () => {
      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier = PublicKey.default; // permission-less
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const currentTimeInSec = new anchor.BN(Math.floor(Date.now() / 1000));
      const tradeEnableTimestamp = currentTimeInSec.addn(60);
      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        tradeEnableTimestamp,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
            ctx.program,
            modifiedPoolInitInfo,
          ),
        ).buildAndExecute(),
        /0x17af/, // InvalidTradeEnableTimestamp
      );

      await toTx(
        ctx,
        WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, poolInitInfo),
      ).buildAndExecute();

      const whirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(whirlpoolData !== null);

      const oracleData = await fetcher.getOracle(
        poolInitInfo.oraclePda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(oracleData !== null);
      assert.ok(oracleData!.tradeEnableTimestamp.isZero());
    });

    it("when trade_enable_timestamp is set with permissioned Adaptive Fee tier", async () => {
      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier = ctx.wallet.publicKey; // permissioned
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const currentTimeInSec = new anchor.BN(Math.floor(Date.now() / 1000));
      const tradeEnableTimestamp = currentTimeInSec.addn(60 * 60 * 24 * 1); // 1 day later
      const modifiedPoolInitInfo: InitPoolWithAdaptiveFeeParams = {
        ...poolInitInfo,
        tradeEnableTimestamp,
      };

      await toTx(
        ctx,
        WhirlpoolIx.initializePoolWithAdaptiveFeeIx(
          ctx.program,
          modifiedPoolInitInfo,
        ),
      ).buildAndExecute();

      const whirlpoolData = await fetcher.getPool(
        poolInitInfo.whirlpoolPda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(whirlpoolData !== null);

      const oracleData = await fetcher.getOracle(
        poolInitInfo.oraclePda.publicKey,
        IGNORE_CACHE,
      );
      assert.ok(oracleData !== null);
      assert.ok(oracleData!.tradeEnableTimestamp.eq(tradeEnableTimestamp));
    });

    it("[FAIL] when invalid trade_enable_timestamp is set with permissioned Adaptive Fee tier", async () => {
      const tickSpacing = TickSpacing.Standard;
      const feeTierIndex = 1024 + tickSpacing;
      const initializeFeeAuthorityOnAdaptiveFeeTier = ctx.wallet.publicKey; // permissioned
      const { poolInitInfo } = await buildTestPoolWithAdaptiveFeeParams(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        feeTierIndex,
        tickSpacing,
        undefined,
        undefined,
        getDefaultPresetAdaptiveFeeConstants(tickSpacing),
        initializeFeeAuthorityOnAdaptiveFeeTier,
        PublicKey.default,
      );

      const currentTimeInSec = new anchor.BN(Math.floor(Date.now() / 1000));
      const tradeEnableTimestamps = [
        // too old
        new anchor.BN(0),
        currentTimeInSec.subn(60),
        // far future
        currentTimeInSec.addn(60 * 60 * 24 * 3 + 100),
        currentTimeInSec.addn(60 * 60 * 24 * 365),
      ];

      for (const tradeEnableTimestamp of tradeEnableTimestamps) {
        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
              ...poolInitInfo,
              tradeEnableTimestamp,
            }),
          ).buildAndExecute(),
          /0x17af/, // InvalidTradeEnableTimestamp
        );
      }
    });
  });

  it("emit PoolInitialized event", async () => {
    const tickSpacing = TickSpacing.Standard;
    const feeTierIndex = 1024 + TickSpacing.Standard;
    const defaultBaseFeeRate = 3000;
    const presetAdaptiveFeeConstants =
      getDefaultPresetAdaptiveFeeConstants(tickSpacing);

    const { configInitInfo, configKeypairs } =
      await initializeConfigWithDefaultConfigParams(ctx);

    const whirlpoolsConfig = configInitInfo.whirlpoolsConfigKeypair.publicKey;

    const { params: feeTierParams } = await initAdaptiveFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      feeTierIndex,
      tickSpacing,
      defaultBaseFeeRate,
      presetAdaptiveFeeConstants,
    );

    // initialize mint with various decimals
    const tokenXKeypair = Keypair.generate();
    const tokenYKeypair = Keypair.generate();
    const [tokenAKeypair, tokenBKeypair] =
      PoolUtil.compareMints(tokenXKeypair.publicKey, tokenYKeypair.publicKey) <
      0
        ? [tokenXKeypair, tokenYKeypair]
        : [tokenYKeypair, tokenXKeypair];
    const decimalsA = 7;
    const decimalsB = 11;
    await toTx(ctx, {
      instructions: [
        SystemProgram.createAccount({
          fromPubkey: ctx.wallet.publicKey,
          newAccountPubkey: tokenAKeypair.publicKey,
          space: 82,
          lamports:
            await ctx.provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          tokenAKeypair.publicKey,
          decimalsA,
          ctx.wallet.publicKey,
          null,
          TOKEN_PROGRAM_ID,
        ),
        SystemProgram.createAccount({
          fromPubkey: ctx.wallet.publicKey,
          newAccountPubkey: tokenBKeypair.publicKey,
          space: 82,
          lamports:
            await ctx.provider.connection.getMinimumBalanceForRentExemption(82),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          tokenBKeypair.publicKey,
          decimalsB,
          ctx.wallet.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      ],
      cleanupInstructions: [],
      signers: [tokenAKeypair, tokenBKeypair],
    }).buildAndExecute();

    const initSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(123456);
    const tokenVaultAKeypair = Keypair.generate();
    const tokenVaultBKeypair = Keypair.generate();
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      whirlpoolsConfig,
      tokenAKeypair.publicKey,
      tokenBKeypair.publicKey,
      feeTierIndex,
    );
    const tokenBadgeA = PDAUtil.getTokenBadge(
      ctx.program.programId,
      whirlpoolsConfig,
      tokenAKeypair.publicKey,
    ).publicKey;
    const tokenBadgeB = PDAUtil.getTokenBadge(
      ctx.program.programId,
      whirlpoolsConfig,
      tokenBKeypair.publicKey,
    ).publicKey;
    const oraclePda = PDAUtil.getOracle(
      ctx.program.programId,
      whirlpoolPda.publicKey,
    );

    // event verification
    let eventVerified = false;
    let detectedSignature = null;
    const listener = ctx.program.addEventListener(
      "poolInitialized",
      (event, _slot, signature) => {
        detectedSignature = signature;
        // verify
        assert.equal(event.decimalsA, decimalsA);
        assert.equal(event.decimalsB, decimalsB);
        assert.equal(event.tickSpacing, tickSpacing);
        assert.ok(event.initialSqrtPrice.eq(initSqrtPrice));
        assert.ok(event.tokenMintA.equals(tokenAKeypair.publicKey));
        assert.ok(event.tokenMintB.equals(tokenBKeypair.publicKey));
        assert.ok(event.tokenProgramA.equals(TOKEN_PROGRAM_ID));
        assert.ok(event.tokenProgramB.equals(TOKEN_2022_PROGRAM_ID));
        assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
        assert.ok(event.whirlpoolsConfig.equals(whirlpoolsConfig));
        eventVerified = true;
      },
    );

    const signature = await toTx(
      ctx,
      WhirlpoolIx.initializePoolWithAdaptiveFeeIx(ctx.program, {
        whirlpoolPda,
        whirlpoolsConfig,
        tokenMintA: tokenAKeypair.publicKey,
        tokenMintB: tokenBKeypair.publicKey,
        adaptiveFeeTierKey: feeTierParams.feeTierPda.publicKey,
        initSqrtPrice,
        funder: ctx.wallet.publicKey,
        initializePoolAuthority: ctx.wallet.publicKey,
        oraclePda,
        tokenBadgeA,
        tokenBadgeB,
        tokenProgramA: TOKEN_PROGRAM_ID,
        tokenProgramB: TOKEN_2022_PROGRAM_ID,
        tokenVaultAKeypair,
        tokenVaultBKeypair,
      }),
    )
      .addSigner(tokenVaultAKeypair)
      .addSigner(tokenVaultBKeypair)
      .buildAndExecute();

    await sleep(2000);
    assert.equal(signature, detectedSignature);
    assert.ok(eventVerified);

    ctx.program.removeEventListener(listener);
  });

  async function asyncAssertOracle(
    oracle: PublicKey,
    whirlpool: PublicKey,
    feeTierParams: InitializeAdaptiveFeeTierParams,
    tradeEnableTimestamp?: anchor.BN,
  ) {
    const oracleData = await fetcher.getOracle(oracle, IGNORE_CACHE);
    assert.ok(oracleData);

    assert.ok(oracleData.whirlpool.equals(whirlpool));
    assert.ok(
      oracleData.tradeEnableTimestamp.eq(
        tradeEnableTimestamp ?? new anchor.BN(0),
      ),
    );

    const consts = oracleData.adaptiveFeeConstants;
    assert.ok(consts.filterPeriod === feeTierParams.presetFilterPeriod);
    assert.ok(consts.decayPeriod === feeTierParams.presetDecayPeriod);
    assert.ok(consts.reductionFactor === feeTierParams.presetReductionFactor);
    assert.ok(
      consts.adaptiveFeeControlFactor ===
        feeTierParams.presetAdaptiveFeeControlFactor,
    );
    assert.ok(
      consts.maxVolatilityAccumulator ===
        feeTierParams.presetMaxVolatilityAccumulator,
    );
    assert.ok(consts.tickGroupSize === feeTierParams.presetTickGroupSize);

    const vars = oracleData.adaptiveFeeVariables;
    assert.ok(vars.lastReferenceUpdateTimestamp.isZero());
    assert.ok(vars.lastMajorSwapTimestamp.isZero());
    assert.ok(vars.tickGroupIndexReference === 0);
    assert.ok(vars.volatilityReference === 0);
    assert.ok(vars.volatilityAccumulator === 0);
  }
});
