import * as anchor from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import type { InitPoolV2Params, WhirlpoolData } from "../../../../src";
import {
  IGNORE_CACHE,
  MAX_SQRT_PRICE,
  METADATA_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE,
  PDAUtil,
  PoolUtil,
  PriceMath,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx,
} from "../../../../src";
import {
  ONE_SOL,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  ZERO_BN,
  getLocalnetAdminKeypair0,
  getProviderWalletKeypair,
  setAuthority,
  sleep,
  systemTransferTx,
  startLiteSVM,
  createLiteSVMProvider,
} from "../../../utils";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";
import {
  buildTestPoolV2Params,
  initTestPoolV2,
} from "../../../utils/v2/init-utils-v2";
import {
  asyncAssertOwnerProgram,
  asyncAssertTokenVaultV2,
  createMintV2,
  initializeNativeMint2022Idempotent,
} from "../../../utils/v2/token-2022";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  AccountState,
  AuthorityType,
  createInitializeMintInstruction,
  NATIVE_MINT,
  NATIVE_MINT_2022,
} from "@solana/spl-token";
import { buildTestPoolParams, initFeeTier } from "../../../utils/init-utils";

describe("initialize_pool_v2 (litesvm)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: any;

  beforeAll(async () => {
    await startLiteSVM();
    provider = await createLiteSVMProvider();
    const programId = new anchor.web3.PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
    );
    const idl = require("../../../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    fetcher = ctx.fetcher;
  });

  const providerWalletKeypair = getProviderWalletKeypair(provider);

  describe("v1 parity (litesvm)", () => {
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
          const { configInitInfo, poolInitInfo, feeTierParams } =
            await initTestPoolV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Standard,
              price
            );
          const whirlpool = (await fetcher.getPool(
            poolInitInfo.whirlpoolPda.publicKey
          )) as WhirlpoolData;

          const expectedWhirlpoolPda = PDAUtil.getWhirlpool(
            program.programId,
            configInitInfo.whirlpoolsConfigKeypair.publicKey,
            poolInitInfo.tokenMintA,
            poolInitInfo.tokenMintB,
            TickSpacing.Standard
          );

          assert.ok(
            poolInitInfo.whirlpoolPda.publicKey.equals(
              expectedWhirlpoolPda.publicKey
            )
          );
          assert.equal(expectedWhirlpoolPda.bump, whirlpool.whirlpoolBump[0]);

          assert.ok(
            whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig)
          );

          assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
          assert.ok(
            whirlpool.tokenVaultA.equals(
              poolInitInfo.tokenVaultAKeypair.publicKey
            )
          );
          await asyncAssertOwnerProgram(
            provider,
            whirlpool.tokenMintA,
            tokenTraits.tokenTraitA.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );

          assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
          assert.ok(
            whirlpool.tokenVaultB.equals(
              poolInitInfo.tokenVaultBKeypair.publicKey
            )
          );
          await asyncAssertOwnerProgram(
            provider,
            whirlpool.tokenMintB,
            tokenTraits.tokenTraitB.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );

          assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);
          assert.equal(
            whirlpool.protocolFeeRate,
            configInitInfo.defaultProtocolFeeRate
          );

          assert.ok(
            whirlpool.sqrtPrice.eq(
              new anchor.BN(poolInitInfo.initSqrtPrice.toString())
            )
          );
          assert.ok(whirlpool.liquidity.eq(ZERO_BN));

          assert.equal(
            whirlpool.tickCurrentIndex,
            PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice)
          );

          assert.ok(whirlpool.protocolFeeOwedA.eq(ZERO_BN));
          assert.ok(whirlpool.protocolFeeOwedB.eq(ZERO_BN));
          assert.ok(whirlpool.feeGrowthGlobalA.eq(ZERO_BN));
          assert.ok(whirlpool.feeGrowthGlobalB.eq(ZERO_BN));

          assert.ok(whirlpool.tickSpacing === TickSpacing.Standard);

          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultAKeypair.publicKey,
            poolInitInfo.tokenMintA,
            poolInitInfo.whirlpoolPda.publicKey,
            tokenTraits.tokenTraitA.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );
          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultBKeypair.publicKey,
            poolInitInfo.tokenMintB,
            poolInitInfo.whirlpoolPda.publicKey,
            tokenTraits.tokenTraitB.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );

          whirlpool.rewardInfos.forEach((rewardInfo) => {
            assert.equal(rewardInfo.emissionsPerSecondX64, 0);
            assert.equal(rewardInfo.growthGlobalX64, 0);
            assert.ok(rewardInfo.mint.equals(anchor.web3.PublicKey.default));
            assert.ok(rewardInfo.vault.equals(anchor.web3.PublicKey.default));
          });

          assert.ok(
            PoolUtil.getRewardAuthority(whirlpool).equals(
              configInitInfo.rewardEmissionsSuperAuthority
            )
          );
          assert.ok(whirlpool.rewardInfos[1].extension.every((x) => x === 0));
          assert.ok(whirlpool.rewardInfos[2].extension.every((x) => x === 0));
        });

        it("successfully init a Stable account", async () => {
          const price = MathUtil.toX64(new Decimal(5));
          const { configInitInfo, poolInitInfo, feeTierParams } =
            await initTestPoolV2(
              ctx,
              tokenTraits.tokenTraitA,
              tokenTraits.tokenTraitB,
              TickSpacing.Stable,
              price
            );
          const whirlpool = (await fetcher.getPool(
            poolInitInfo.whirlpoolPda.publicKey
          )) as WhirlpoolData;

          assert.ok(
            whirlpool.whirlpoolsConfig.equals(poolInitInfo.whirlpoolsConfig)
          );

          assert.ok(whirlpool.tokenMintA.equals(poolInitInfo.tokenMintA));
          assert.ok(
            whirlpool.tokenVaultA.equals(
              poolInitInfo.tokenVaultAKeypair.publicKey
            )
          );
          await asyncAssertOwnerProgram(
            provider,
            whirlpool.tokenMintA,
            tokenTraits.tokenTraitA.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );

          assert.ok(whirlpool.tokenMintB.equals(poolInitInfo.tokenMintB));
          assert.ok(
            whirlpool.tokenVaultB.equals(
              poolInitInfo.tokenVaultBKeypair.publicKey
            )
          );
          await asyncAssertOwnerProgram(
            provider,
            whirlpool.tokenMintB,
            tokenTraits.tokenTraitB.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );

          assert.equal(whirlpool.feeRate, feeTierParams.defaultFeeRate);
          assert.equal(
            whirlpool.protocolFeeRate,
            configInitInfo.defaultProtocolFeeRate
          );

          assert.ok(
            whirlpool.sqrtPrice.eq(
              new anchor.BN(poolInitInfo.initSqrtPrice.toString())
            )
          );
          assert.ok(whirlpool.liquidity.eq(ZERO_BN));

          assert.equal(
            whirlpool.tickCurrentIndex,
            PriceMath.sqrtPriceX64ToTickIndex(poolInitInfo.initSqrtPrice)
          );

          assert.ok(whirlpool.protocolFeeOwedA.eq(ZERO_BN));
          assert.ok(whirlpool.protocolFeeOwedB.eq(ZERO_BN));
          assert.ok(whirlpool.feeGrowthGlobalA.eq(ZERO_BN));
          assert.ok(whirlpool.feeGrowthGlobalB.eq(ZERO_BN));

          assert.ok(whirlpool.tickSpacing === TickSpacing.Stable);

          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultAKeypair.publicKey,
            poolInitInfo.tokenMintA,
            poolInitInfo.whirlpoolPda.publicKey,
            tokenTraits.tokenTraitA.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );
          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultBKeypair.publicKey,
            poolInitInfo.tokenMintB,
            poolInitInfo.whirlpoolPda.publicKey,
            tokenTraits.tokenTraitB.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID
          );

          whirlpool.rewardInfos.forEach((rewardInfo) => {
            assert.equal(rewardInfo.emissionsPerSecondX64, 0);
            assert.equal(rewardInfo.growthGlobalX64, 0);
            assert.ok(rewardInfo.mint.equals(anchor.web3.PublicKey.default));
            assert.ok(rewardInfo.vault.equals(anchor.web3.PublicKey.default));
          });

          assert.ok(
            PoolUtil.getRewardAuthority(whirlpool).equals(
              configInitInfo.rewardEmissionsSuperAuthority
            )
          );
          assert.ok(whirlpool.rewardInfos[1].extension.every((x) => x === 0));
          assert.ok(whirlpool.rewardInfos[2].extension.every((x) => x === 0));
        });

        it("succeeds when funder is different than account paying for transaction fee", async () => {
          const funderKeypair = anchor.web3.Keypair.generate();
          await systemTransferTx(
            provider,
            funderKeypair.publicKey,
            ONE_SOL
          ).buildAndExecute();
          await initTestPoolV2(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard,
            MathUtil.toX64(new Decimal(5)),
            funderKeypair
          );
        });

        it("succeeds when vault accounts have non-zero lamports (not rent-exempt)", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const preLamports = 1_000_000;
          await systemTransferTx(
            provider,
            poolInitInfo.tokenVaultAKeypair.publicKey,
            preLamports
          ).buildAndExecute();
          await systemTransferTx(
            provider,
            poolInitInfo.tokenVaultBKeypair.publicKey,
            preLamports
          ).buildAndExecute();

          await toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, poolInitInfo)
          ).buildAndExecute();
          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultAKeypair.publicKey,
            poolInitInfo.tokenMintA,
            poolInitInfo.whirlpoolPda.publicKey,
            poolInitInfo.tokenProgramA
          );
          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultBKeypair.publicKey,
            poolInitInfo.tokenMintB,
            poolInitInfo.whirlpoolPda.publicKey,
            poolInitInfo.tokenProgramB
          );

          const vaultA = await provider.connection.getAccountInfo(
            poolInitInfo.tokenVaultAKeypair.publicKey
          );
          const vaultB = await provider.connection.getAccountInfo(
            poolInitInfo.tokenVaultBKeypair.publicKey
          );
          assert.ok(vaultA!.lamports > preLamports);
          assert.ok(vaultB!.lamports > preLamports);
        });

        it("succeeds when vault accounts have non-zero lamports (rent-exempt)", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const preLamports = 1_000_000_000;
          await systemTransferTx(
            provider,
            poolInitInfo.tokenVaultAKeypair.publicKey,
            preLamports
          ).buildAndExecute();
          await systemTransferTx(
            provider,
            poolInitInfo.tokenVaultBKeypair.publicKey,
            preLamports
          ).buildAndExecute();

          await toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, poolInitInfo)
          ).buildAndExecute();
          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultAKeypair.publicKey,
            poolInitInfo.tokenMintA,
            poolInitInfo.whirlpoolPda.publicKey,
            poolInitInfo.tokenProgramA
          );
          await asyncAssertTokenVaultV2(
            provider,
            poolInitInfo.tokenVaultBKeypair.publicKey,
            poolInitInfo.tokenMintB,
            poolInitInfo.whirlpoolPda.publicKey,
            poolInitInfo.tokenProgramB
          );

          const vaultA = await provider.connection.getAccountInfo(
            poolInitInfo.tokenVaultAKeypair.publicKey
          );
          const vaultB = await provider.connection.getAccountInfo(
            poolInitInfo.tokenVaultBKeypair.publicKey
          );
          assert.ok(vaultA!.lamports === preLamports);
          assert.ok(vaultB!.lamports === preLamports);
        });

        it("fails when tokenVaultA mint does not match tokenA mint", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );
          const otherTokenPublicKey = await createMintV2(
            provider,
            tokenTraits.tokenTraitA
          );

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            tokenMintA: otherTokenPublicKey,
          };

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
            ).buildAndExecute(),
            /custom program error: 0x7d6/ // ConstraintSeeds
          );
        });

        it("fails when tokenVaultB mint does not match tokenB mint", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );
          const otherTokenPublicKey = await createMintV2(
            provider,
            tokenTraits.tokenTraitB
          );

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            tokenMintB: otherTokenPublicKey,
          };

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
            ).buildAndExecute(),
            /custom program error: 0x7d6/ // ConstraintSeeds
          );
        });

        it("fails when token mints are in the wrong order", async () => {
          const { poolInitInfo, configInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const whirlpoolPda = PDAUtil.getWhirlpool(
            ctx.program.programId,
            configInitInfo.whirlpoolsConfigKeypair.publicKey,
            poolInitInfo.tokenMintB,
            poolInitInfo.tokenMintA,
            TickSpacing.Standard
          );

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            whirlpoolPda,
            tickSpacing: TickSpacing.Standard,
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
              WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
            ).buildAndExecute(),
            /custom program error: 0x1788/ // InvalidTokenMintOrder
          );
        });

        it("fails when the same token mint is passed in", async () => {
          const { poolInitInfo, configInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const whirlpoolPda = PDAUtil.getWhirlpool(
            ctx.program.programId,
            configInitInfo.whirlpoolsConfigKeypair.publicKey,
            poolInitInfo.tokenMintA,
            poolInitInfo.tokenMintA,
            TickSpacing.Standard
          );

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            whirlpoolPda,
            tickSpacing: TickSpacing.Standard,
            tokenMintB: poolInitInfo.tokenMintA,
            tokenBadgeB: poolInitInfo.tokenBadgeA,
            tokenProgramB: tokenTraits.tokenTraitA.isToken2022
              ? TEST_TOKEN_2022_PROGRAM_ID
              : TEST_TOKEN_PROGRAM_ID,
          };

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
            ).buildAndExecute(),
            /custom program error: 0x1788/ // InvalidTokenMintOrder
          );
        });

        it("fails when sqrt-price exceeds max", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            initSqrtPrice: new anchor.BN(MAX_SQRT_PRICE).add(new anchor.BN(1)),
          };

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
            ).buildAndExecute(),
            /custom program error: 0x177b/ // SqrtPriceOutOfBounds
          );
        });

        it("fails when sqrt-price subceeds min", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            initSqrtPrice: new anchor.BN(MIN_SQRT_PRICE).sub(new anchor.BN(1)),
          };

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
            ).buildAndExecute(),
            /custom program error: 0x177b/ // SqrtPriceOutOfBounds
          );
        });

        it("ignore passed bump", async () => {
          const { poolInitInfo } = await buildTestPoolV2Params(
            ctx,
            tokenTraits.tokenTraitA,
            tokenTraits.tokenTraitB,
            TickSpacing.Standard
          );

          const whirlpoolPda = poolInitInfo.whirlpoolPda;
          const validBump = whirlpoolPda.bump;
          const invalidBump = (validBump + 1) % 256; // +1 shift mod 256
          const modifiedWhirlpoolPda: PDA = {
            publicKey: whirlpoolPda.publicKey,
            bump: invalidBump,
          };

          const modifiedPoolInitInfo: InitPoolV2Params = {
            ...poolInitInfo,
            whirlpoolPda: modifiedWhirlpoolPda,
          };

          await toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
          ).buildAndExecute();

          // check if passed invalid bump was ignored
          const whirlpool = (await fetcher.getPool(
            poolInitInfo.whirlpoolPda.publicKey
          )) as WhirlpoolData;
          assert.equal(whirlpool.whirlpoolBump, validBump);
          assert.notEqual(whirlpool.whirlpoolBump, invalidBump);
        });

        it("emit PoolInitialized event", async () => {
          const { poolInitInfo } = await buildTestPoolParams(
            ctx,
            TickSpacing.Standard
          );

          const whirlpoolsConfig = poolInitInfo.whirlpoolsConfig;
          const tickSpacing = poolInitInfo.tickSpacing;

          // initialize mint with various decimals
          const tokenXKeypair = Keypair.generate();
          const tokenYKeypair = Keypair.generate();
          const [tokenAKeypair, tokenBKeypair] =
            PoolUtil.compareMints(
              tokenXKeypair.publicKey,
              tokenYKeypair.publicKey
            ) < 0
              ? [tokenXKeypair, tokenYKeypair]
              : [tokenYKeypair, tokenXKeypair];
          const decimalsA = 7;
          const decimalsB = 11;
          const tokenProgramA = tokenTraits.tokenTraitA.isToken2022
            ? TEST_TOKEN_2022_PROGRAM_ID
            : TEST_TOKEN_PROGRAM_ID;
          const tokenProgramB = tokenTraits.tokenTraitB.isToken2022
            ? TEST_TOKEN_2022_PROGRAM_ID
            : TEST_TOKEN_PROGRAM_ID;
          await toTx(ctx, {
            instructions: [
              SystemProgram.createAccount({
                fromPubkey: ctx.wallet.publicKey,
                newAccountPubkey: tokenAKeypair.publicKey,
                space: 82,
                lamports:
                  await ctx.provider.connection.getMinimumBalanceForRentExemption(
                    82
                  ),
                programId: tokenProgramA,
              }),
              createInitializeMintInstruction(
                tokenAKeypair.publicKey,
                decimalsA,
                ctx.wallet.publicKey,
                null,
                tokenProgramA
              ),
              SystemProgram.createAccount({
                fromPubkey: ctx.wallet.publicKey,
                newAccountPubkey: tokenBKeypair.publicKey,
                space: 82,
                lamports:
                  await ctx.provider.connection.getMinimumBalanceForRentExemption(
                    82
                  ),
                programId: tokenProgramB,
              }),
              createInitializeMintInstruction(
                tokenBKeypair.publicKey,
                decimalsB,
                ctx.wallet.publicKey,
                null,
                tokenProgramB
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
            tickSpacing
          );
          const tokenBadgeA = PDAUtil.getTokenBadge(
            ctx.program.programId,
            whirlpoolsConfig,
            tokenAKeypair.publicKey
          ).publicKey;
          const tokenBadgeB = PDAUtil.getTokenBadge(
            ctx.program.programId,
            whirlpoolsConfig,
            tokenBKeypair.publicKey
          ).publicKey;

          // event verification
          let eventVerified = false;
          let detectedSignature = null;
          const listener = ctx.program.addEventListener(
            "PoolInitialized",
            (event, _slot, signature) => {
              detectedSignature = signature;
              // verify
              assert.equal(event.decimalsA, decimalsA);
              assert.equal(event.decimalsB, decimalsB);
              assert.equal(event.tickSpacing, tickSpacing);
              assert.ok(event.initialSqrtPrice.eq(initSqrtPrice));
              assert.ok(event.tokenMintA.equals(tokenAKeypair.publicKey));
              assert.ok(event.tokenMintB.equals(tokenBKeypair.publicKey));
              assert.ok(event.tokenProgramA.equals(tokenProgramA));
              assert.ok(event.tokenProgramB.equals(tokenProgramB));
              assert.ok(event.whirlpool.equals(whirlpoolPda.publicKey));
              assert.ok(event.whirlpoolsConfig.equals(whirlpoolsConfig));
              eventVerified = true;
            }
          );

          const signature = await toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              feeTierKey: poolInitInfo.feeTierKey,
              funder: ctx.wallet.publicKey,
              initSqrtPrice,
              tickSpacing,
              whirlpoolsConfig,
              tokenMintA: tokenAKeypair.publicKey,
              tokenMintB: tokenBKeypair.publicKey,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenProgramA,
              tokenProgramB,
              tokenBadgeA,
              tokenBadgeB,
              whirlpoolPda,
            })
          )
            .addSigner(tokenVaultAKeypair)
            .addSigner(tokenVaultBKeypair)
            .buildAndExecute();

          await sleep(2000);
          assert.equal(signature, detectedSignature);
          assert.ok(eventVerified);

          ctx.program.removeEventListener(listener);
        });
      });
    });
  });

  it("fails when FeeTier and tick_spacing passed unmatch", async () => {
    const { poolInitInfo, configInitInfo, configKeypairs } =
      await buildTestPoolV2Params(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard
      );

    // now FeeTier for TickSpacing.Standard is initialized, but not for TickSpacing.Stable
    const config = poolInitInfo.whirlpoolsConfig;
    const feeTierStandardPda = PDAUtil.getFeeTier(
      ctx.program.programId,
      config,
      TickSpacing.Standard
    );
    const feeTierStablePda = PDAUtil.getFeeTier(
      ctx.program.programId,
      config,
      TickSpacing.Stable
    );

    const feeTierStandard = await fetcher.getFeeTier(
      feeTierStandardPda.publicKey,
      IGNORE_CACHE
    );
    const feeTierStable = await fetcher.getFeeTier(
      feeTierStablePda.publicKey,
      IGNORE_CACHE
    );
    assert.ok(feeTierStandard !== null); // should be initialized
    assert.ok(feeTierStable === null); // shoud be NOT initialized

    const whirlpoolWithStableTickSpacing = PDAUtil.getWhirlpool(
      ctx.program.programId,
      config,
      poolInitInfo.tokenMintA,
      poolInitInfo.tokenMintB,
      TickSpacing.Stable
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePoolV2Ix(ctx.program, {
          ...poolInitInfo,
          whirlpoolPda: whirlpoolWithStableTickSpacing,
          tickSpacing: TickSpacing.Stable,
          feeTierKey: feeTierStandardPda.publicKey, // tickSpacing is Stable, but FeeTier is standard
        })
      ).buildAndExecute(),
      /custom program error: 0x7d3/ // ConstraintRaw
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePoolV2Ix(ctx.program, {
          ...poolInitInfo,
          whirlpoolPda: whirlpoolWithStableTickSpacing,
          tickSpacing: TickSpacing.Stable,
          feeTierKey: feeTierStablePda.publicKey, // FeeTier is stable, but not initialized
        })
      ).buildAndExecute(),
      /custom program error: 0xbc4/ // AccountNotInitialized
    );

    await initFeeTier(
      ctx,
      configInitInfo,
      configKeypairs.feeAuthorityKeypair,
      TickSpacing.Stable,
      3000
    );
    const feeTierStableAfterInit = await fetcher.getFeeTier(
      feeTierStablePda.publicKey,
      IGNORE_CACHE
    );
    assert.ok(feeTierStableAfterInit !== null);

    // Now it should work because FeeTier for stable have been initialized
    await toTx(
      ctx,
      WhirlpoolIx.initializePoolV2Ix(ctx.program, {
        ...poolInitInfo,
        whirlpoolPda: whirlpoolWithStableTickSpacing,
        tickSpacing: TickSpacing.Stable,
        feeTierKey: feeTierStablePda.publicKey,
      })
    ).buildAndExecute();
  });

  describe("v2 specific accounts (litesvm)", () => {
    it("fails when passed token_program_a is not token program (token-2022 is passed)", async () => {
      const { poolInitInfo } = await buildTestPoolV2Params(
        ctx,
        { isToken2022: false },
        { isToken2022: false },
        TickSpacing.Standard
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
      const modifiedPoolInitInfo: InitPoolV2Params = {
        ...poolInitInfo,
        tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token-2022 program (token is passed)", async () => {
      const { poolInitInfo } = await buildTestPoolV2Params(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      const modifiedPoolInitInfo: InitPoolV2Params = {
        ...poolInitInfo,
        tokenProgramA: TEST_TOKEN_PROGRAM_ID,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is token_metadata", async () => {
      const { poolInitInfo } = await buildTestPoolV2Params(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard
      );

      assert.ok(poolInitInfo.tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      const modifiedPoolInitInfo: InitPoolV2Params = {
        ...poolInitInfo,
        tokenProgramA: METADATA_PROGRAM_ADDRESS,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
        ).buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("fails when passed token_program_b is not token program (token-2022 is passed)", async () => {
      const { poolInitInfo } = await buildTestPoolV2Params(
        ctx,
        { isToken2022: false },
        { isToken2022: false },
        TickSpacing.Standard
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
      const modifiedPoolInitInfo: InitPoolV2Params = {
        ...poolInitInfo,
        tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is not token-2022 program (token is passed)", async () => {
      const { poolInitInfo } = await buildTestPoolV2Params(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      const modifiedPoolInitInfo: InitPoolV2Params = {
        ...poolInitInfo,
        tokenProgramB: TEST_TOKEN_PROGRAM_ID,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is token_metadata", async () => {
      const { poolInitInfo } = await buildTestPoolV2Params(
        ctx,
        { isToken2022: true },
        { isToken2022: true },
        TickSpacing.Standard
      );

      assert.ok(poolInitInfo.tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      const modifiedPoolInitInfo: InitPoolV2Params = {
        ...poolInitInfo,
        tokenProgramB: METADATA_PROGRAM_ADDRESS,
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePoolV2Ix(ctx.program, modifiedPoolInitInfo)
        ).buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    describe("invalid badge account (litesvm)", () => {
      let baseIxParams: InitPoolV2Params;

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
          tokenAKeypair
        );
        await createMintV2(
          provider,
          { isToken2022: true, hasPermanentDelegate: true },
          undefined,
          tokenBKeypair
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
          })
        );
        initConfigTx.addInstruction(
          WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
            whirlpoolsConfig: configKeypair.publicKey,
            authority: admin.publicKey,
            featureFlag: {
              tokenBadge: [true],
            },
          })
        );
        await initConfigTx
          .addSigner(admin)
          .addSigner(configKeypair)
          .buildAndExecute();

        const tickSpacing = TickSpacing.SixtyFour;
        const feeTierPda = PDAUtil.getFeeTier(
          ctx.program.programId,
          configKeypair.publicKey,
          tickSpacing
        );
        await toTx(
          ctx,
          WhirlpoolIx.initializeFeeTierIx(ctx.program, {
            defaultFeeRate: 3000,
            feeAuthority: provider.wallet.publicKey,
            funder: provider.wallet.publicKey,
            tickSpacing,
            whirlpoolsConfig: configKeypair.publicKey,
            feeTierPda: feeTierPda,
          })
        ).buildAndExecute();

        // create config extension
        const configExtensionPda = PDAUtil.getConfigExtension(
          ctx.program.programId,
          configKeypair.publicKey
        );
        await toTx(
          ctx,
          WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
            feeAuthority: provider.wallet.publicKey,
            funder: provider.wallet.publicKey,
            whirlpoolsConfig: configKeypair.publicKey,
            whirlpoolsConfigExtensionPda: configExtensionPda,
          })
        ).buildAndExecute();

        const whirlpoolPda = PDAUtil.getWhirlpool(
          ctx.program.programId,
          configKeypair.publicKey,
          tokenAKeypair.publicKey,
          tokenBKeypair.publicKey,
          tickSpacing
        );
        baseIxParams = {
          tokenVaultAKeypair: Keypair.generate(),
          tokenVaultBKeypair: Keypair.generate(),
          funder: provider.wallet.publicKey,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
          tickSpacing,
          tokenMintA: tokenAKeypair.publicKey,
          tokenMintB: tokenBKeypair.publicKey,
          whirlpoolsConfig: configKeypair.publicKey,
          feeTierKey: feeTierPda.publicKey,
          tokenBadgeA: PDAUtil.getTokenBadge(
            ctx.program.programId,
            configKeypair.publicKey,
            tokenAKeypair.publicKey
          ).publicKey,
          tokenBadgeB: PDAUtil.getTokenBadge(
            ctx.program.programId,
            configKeypair.publicKey,
            tokenBKeypair.publicKey
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
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              ...baseIxParams,
              tokenBadgeA: fakeAddress,
            })
          ).buildAndExecute(),
          /custom program error: 0x7d6/ // ConstraintSeeds
        );

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              ...baseIxParams,
              tokenBadgeB: fakeAddress,
            })
          ).buildAndExecute(),
          /custom program error: 0x7d6/ // ConstraintSeeds
        );
      });

      it("fails when token_badge_a/b address invalid (initialized, same config / different mint)", async () => {
        const config = baseIxParams.whirlpoolsConfig;

        const anotherTokenKeypair = Keypair.generate();
        await createMintV2(
          provider,
          { isToken2022: true },
          undefined,
          anotherTokenKeypair
        );

        // initialize another badge
        const configExtension = PDAUtil.getConfigExtension(
          ctx.program.programId,
          config
        ).publicKey;
        const tokenBadgePda = PDAUtil.getTokenBadge(
          ctx.program.programId,
          config,
          anotherTokenKeypair.publicKey
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
          })
        ).buildAndExecute();
        const badge = fetcher.getTokenBadge(
          tokenBadgePda.publicKey,
          IGNORE_CACHE
        );
        assert.ok(badge !== null);

        const fakeAddress = tokenBadgePda.publicKey;

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              ...baseIxParams,
              tokenBadgeA: fakeAddress,
            })
          ).buildAndExecute(),
          /custom program error: 0x7d6/ // ConstraintSeeds
        );

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              ...baseIxParams,
              tokenBadgeB: fakeAddress,
            })
          ).buildAndExecute(),
          /custom program error: 0x7d6/ // ConstraintSeeds
        );
      });

      it("fails when token_badge_a/b address invalid (account owned by WhirlpoolProgram)", async () => {
        // use Whirlpool address
        const { poolInitInfo } = await initTestPoolV2(
          ctx,
          { isToken2022: true },
          { isToken2022: true },
          TickSpacing.Standard
        );

        const fakeAddress = poolInitInfo.whirlpoolPda.publicKey;
        const whirlpool = fetcher.getPool(fakeAddress);
        assert.ok(whirlpool !== null);

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              ...baseIxParams,
              tokenBadgeA: fakeAddress,
            })
          ).buildAndExecute(),
          /custom program error: 0x7d6/ // ConstraintSeeds
        );

        await assert.rejects(
          toTx(
            ctx,
            WhirlpoolIx.initializePoolV2Ix(ctx.program, {
              ...baseIxParams,
              tokenBadgeB: fakeAddress,
            })
          ).buildAndExecute(),
          /custom program error: 0x7d6/ // ConstraintSeeds
        );
      });
    });
  });

  describe("Supported Tokens (litesvm)", () => {
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
      tickSpacing: number
    ) {
      const tokenVaultAKeypair = Keypair.generate();
      const tokenVaultBKeypair = Keypair.generate();

      const whirlpoolPda = PDAUtil.getWhirlpool(
        ctx.program.programId,
        whirlpoolsConfig,
        tokenMintA,
        tokenMintB,
        tickSpacing
      );
      const feeTierKey = PDAUtil.getFeeTier(
        ctx.program.programId,
        whirlpoolsConfig,
        tickSpacing
      ).publicKey;
      const tokenBadgeA = PDAUtil.getTokenBadge(
        ctx.program.programId,
        whirlpoolsConfig,
        tokenMintA
      ).publicKey;
      const tokenBadgeB = PDAUtil.getTokenBadge(
        ctx.program.programId,
        whirlpoolsConfig,
        tokenMintB
      ).publicKey;

      const tokenProgramA = (await provider.connection.getAccountInfo(
        tokenMintA
      ))!.owner;
      const tokenProgramB = (await provider.connection.getAccountInfo(
        tokenMintB
      ))!.owner;

      const promise = toTx(
        ctx,
        WhirlpoolIx.initializePoolV2Ix(ctx.program, {
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          funder: provider.wallet.publicKey,
          initSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(0),
          tickSpacing,
          tokenMintA,
          tokenMintB,
          whirlpoolsConfig,
          feeTierKey,
          tokenBadgeA,
          tokenBadgeB,
          tokenProgramA,
          tokenProgramB,
          whirlpoolPda,
        })
      ).buildAndExecute();

      if (supported) {
        await promise;
        const whirlpoolData = await fetcher.getPool(
          whirlpoolPda.publicKey,
          IGNORE_CACHE
        );
        assert.ok(whirlpoolData!.tokenMintA.equals(tokenMintA));
        assert.ok(whirlpoolData!.tokenMintB.equals(tokenMintB));
      } else {
        await assert.rejects(
          promise,
          /0x179f/ // UnsupportedTokenMint
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
            : TEST_TOKEN_PROGRAM_ID
        );

        const afterSetAuthorityMint = await fetcher.getMintInfo(
          tokenTarget.publicKey,
          IGNORE_CACHE
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
        })
      );
      initConfigTx.addInstruction(
        WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
          whirlpoolsConfig: configKeypair.publicKey,
          authority: admin.publicKey,
          featureFlag: {
            tokenBadge: [true],
          },
        })
      );
      await initConfigTx
        .addSigner(admin)
        .addSigner(configKeypair)
        .buildAndExecute();

      const tickSpacing = 64;
      await toTx(
        ctx,
        WhirlpoolIx.initializeFeeTierIx(ctx.program, {
          defaultFeeRate: 3000,
          feeAuthority: provider.wallet.publicKey,
          funder: provider.wallet.publicKey,
          tickSpacing,
          whirlpoolsConfig: configKeypair.publicKey,
          feeTierPda: PDAUtil.getFeeTier(
            ctx.program.programId,
            configKeypair.publicKey,
            tickSpacing
          ),
        })
      ).buildAndExecute();

      // create token badge if wanted
      if (params.createTokenBadge) {
        const pda = PDAUtil.getConfigExtension(
          ctx.program.programId,
          configKeypair.publicKey
        );
        await toTx(
          ctx,
          WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
            feeAuthority: provider.wallet.publicKey,
            funder: provider.wallet.publicKey,
            whirlpoolsConfig: configKeypair.publicKey,
            whirlpoolsConfigExtensionPda: pda,
          })
        ).buildAndExecute();

        const configExtension = PDAUtil.getConfigExtension(
          ctx.program.programId,
          configKeypair.publicKey
        ).publicKey;
        const tokenBadgePda = PDAUtil.getTokenBadge(
          ctx.program.programId,
          configKeypair.publicKey,
          tokenTarget.publicKey
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
          })
        ).buildAndExecute();
      }

      const isSupportedToken = await PoolUtil.isSupportedToken(
        ctx,
        configKeypair.publicKey,
        tokenTarget.publicKey
      );
      assert.equal(isSupportedToken, params.supported);

      // try to initialize pool
      await checkSupported(
        params.supported,
        configKeypair.publicKey,
        tokenA.publicKey,
        tokenTarget.publicKey,
        tickSpacing
      ); // as TokenB
      await checkSupported(
        params.supported,
        configKeypair.publicKey,
        tokenTarget.publicKey,
        tokenB.publicKey,
        tickSpacing
      ); // as TokenA
    }

    async function runTestWithNativeMint(params: {
      supported: boolean;
      createTokenBadge: boolean;
      isToken2022NativeMint: boolean;
    }) {
      // We need to call this to use NATIVE_MINT_2022
      await initializeNativeMint2022Idempotent(provider);

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
          nativeMint.toString()
      );
      assert.ok(
        PoolUtil.orderMints(nativeMint, tokenB.publicKey)[0].toString() ===
          nativeMint.toString()
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
        })
      );
      initConfigTx.addInstruction(
        WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
          whirlpoolsConfig: configKeypair.publicKey,
          authority: admin.publicKey,
          featureFlag: {
            tokenBadge: [true],
          },
        })
      );
      await initConfigTx
        .addSigner(admin)
        .addSigner(configKeypair)
        .buildAndExecute();

      const tickSpacing = 64;
      await toTx(
        ctx,
        WhirlpoolIx.initializeFeeTierIx(ctx.program, {
          defaultFeeRate: 3000,
          feeAuthority: provider.wallet.publicKey,
          funder: provider.wallet.publicKey,
          tickSpacing,
          whirlpoolsConfig: configKeypair.publicKey,
          feeTierPda: PDAUtil.getFeeTier(
            ctx.program.programId,
            configKeypair.publicKey,
            tickSpacing
          ),
        })
      ).buildAndExecute();

      // create token badge if wanted
      if (params.createTokenBadge) {
        const pda = PDAUtil.getConfigExtension(
          ctx.program.programId,
          configKeypair.publicKey
        );
        await toTx(
          ctx,
          WhirlpoolIx.initializeConfigExtensionIx(ctx.program, {
            feeAuthority: provider.wallet.publicKey,
            funder: provider.wallet.publicKey,
            whirlpoolsConfig: configKeypair.publicKey,
            whirlpoolsConfigExtensionPda: pda,
          })
        ).buildAndExecute();

        const configExtension = PDAUtil.getConfigExtension(
          ctx.program.programId,
          configKeypair.publicKey
        ).publicKey;
        const tokenBadgePda = PDAUtil.getTokenBadge(
          ctx.program.programId,
          configKeypair.publicKey,
          nativeMint
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
          })
        ).buildAndExecute();
      }

      // try to initialize pool
      await checkSupported(
        params.supported,
        configKeypair.publicKey,
        tokenA.publicKey,
        nativeMint,
        tickSpacing
      ); // as TokenB
      await checkSupported(
        params.supported,
        configKeypair.publicKey,
        nativeMint,
        tokenB.publicKey,
        tickSpacing
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
      await runTest({ supported: false, createTokenBadge: false, tokenTrait });
    });
  });
});
