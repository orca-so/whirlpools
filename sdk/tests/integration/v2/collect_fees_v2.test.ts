import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import {
  collectFeesQuote,
  METADATA_PROGRAM_ADDRESS,
  PDAUtil,
  PositionData,
  TickArrayData,
  TickArrayUtil,
  toTx,
  WhirlpoolContext,
  WhirlpoolData,
  WhirlpoolIx,
} from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import {
  approveToken,
  getTokenBalance,
  TEST_TOKEN_2022_PROGRAM_ID,
  TEST_TOKEN_PROGRAM_ID,
  TickSpacing,
  transferToken,
  ZERO_BN,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";
import { TokenTrait } from "../../utils/v2/init-utils-v2";
import { createMintV2, createTokenAccountV2 } from "../../utils/v2/token-2022";
import { createTokenAccount as createTokenAccountForPosition } from "../../utils/token";
import { NATIVE_MINT } from "@solana/spl-token";
import { RemainingAccountsSliceData } from "../../../src/utils/remaining-accounts-util";
import { TokenExtensionUtil } from "../../../src/utils/token-extension-util";

describe("collect_fees_v2", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  describe("v1 parity", () => {
    const tokenTraitVariations: { tokenTraitA: TokenTrait; tokenTraitB: TokenTrait }[] = [
      { tokenTraitA: { isToken2022: false }, tokenTraitB: { isToken2022: false } },
      { tokenTraitA: { isToken2022: true }, tokenTraitB: { isToken2022: false } },
      { tokenTraitA: { isToken2022: false }, tokenTraitB: { isToken2022: true } },
      { tokenTraitA: { isToken2022: true }, tokenTraitB: { isToken2022: true } },
    ];
    tokenTraitVariations.forEach((tokenTraits) => {
      describe(`tokenTraitA: ${
        tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitB: ${tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"}`, () => {
        it("successfully collect fees", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;

          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }, // In range position
              { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: new anchor.BN(1_000_000) }, // Out of range position
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const tickArrayPda = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            22528
          );
          const positionBeforeSwap = (await fetcher.getPosition(
            positions[0].publicKey
          )) as PositionData;
          assert.ok(positionBeforeSwap.feeOwedA.eq(ZERO_BN));
          assert.ok(positionBeforeSwap.feeOwedB.eq(ZERO_BN));

          const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

          // Accrue fees in token A
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(200_000),
              otherAmountThreshold: ZERO_BN,
              sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
              amountSpecifiedIsInput: true,
              aToB: true,
              whirlpool: whirlpoolPda.publicKey,
              tokenAuthority: ctx.wallet.publicKey,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArray0: tickArrayPda.publicKey,
              tickArray1: tickArrayPda.publicKey,
              tickArray2: tickArrayPda.publicKey,
              oracle: oraclePda.publicKey,
            })
          ).buildAndExecute();

          // Accrue fees in token B
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(200_000),
              otherAmountThreshold: ZERO_BN,
              sqrtPriceLimit: MathUtil.toX64(new Decimal(5)),
              amountSpecifiedIsInput: true,
              aToB: false,
              whirlpool: whirlpoolPda.publicKey,
              tokenAuthority: ctx.wallet.publicKey,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tickArray0: tickArrayPda.publicKey,
              tickArray1: tickArrayPda.publicKey,
              tickArray2: tickArrayPda.publicKey,
              oracle: oraclePda.publicKey,
            })
          ).buildAndExecute();

          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[0].publicKey,
              tickArrayLower: tickArrayPda.publicKey,
              tickArrayUpper: tickArrayPda.publicKey,
            })
          ).buildAndExecute();

          const positionBeforeCollect = (await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE
          )) as PositionData;
          assert.ok(positionBeforeCollect.feeOwedA.eq(new BN(581)));
          assert.ok(positionBeforeCollect.feeOwedB.eq(new BN(581)));

          const feeAccountA = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenMintA,
            provider.wallet.publicKey
          );
          const feeAccountB = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenMintB,
            provider.wallet.publicKey
          );

          // Generate collect fees expectation
          const whirlpoolData = (await fetcher.getPool(whirlpoolPda.publicKey)) as WhirlpoolData;
          const tickArrayData = (await fetcher.getTickArray(
            tickArrayPda.publicKey
          )) as TickArrayData;
          const lowerTick = TickArrayUtil.getTickFromArray(
            tickArrayData,
            tickLowerIndex,
            tickSpacing
          );
          const upperTick = TickArrayUtil.getTickFromArray(
            tickArrayData,
            tickUpperIndex,
            tickSpacing
          );
          const expectation = collectFeesQuote({
            whirlpool: whirlpoolData,
            position: positionBeforeCollect,
            tickLower: lowerTick,
            tickUpper: upperTick,
            tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(fetcher, whirlpoolData, IGNORE_CACHE),
          });

          // Perform collect fees tx
          await toTx(
            ctx,
            WhirlpoolIx.collectFeesV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: positions[0].publicKey,
              positionTokenAccount: positions[0].tokenAccount,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenOwnerAccountA: feeAccountA,
              tokenOwnerAccountB: feeAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
            })
          ).buildAndExecute();
          const positionAfter = (await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE
          )) as PositionData;
          const feeBalanceA = await getTokenBalance(provider, feeAccountA);
          const feeBalanceB = await getTokenBalance(provider, feeAccountB);

          assert.equal(feeBalanceA, expectation.feeOwedA);
          assert.equal(feeBalanceB, expectation.feeOwedB);
          assert.ok(positionAfter.feeOwedA.eq(ZERO_BN));
          assert.ok(positionAfter.feeOwedB.eq(ZERO_BN));

          // Assert out of range position values
          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[1].publicKey,
              tickArrayLower: positions[1].tickArrayLower,
              tickArrayUpper: positions[1].tickArrayUpper,
            })
          ).buildAndExecute();
          const outOfRangePosition = await fetcher.getPosition(
            positions[1].publicKey,
            IGNORE_CACHE
          );
          assert.ok(outOfRangePosition?.feeOwedA.eq(ZERO_BN));
          assert.ok(outOfRangePosition?.feeOwedB.eq(ZERO_BN));
        });

        it("successfully collect fees with approved delegate", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 0,
                tickUpperIndex: 128,
                liquidityAmount: new anchor.BN(10_000_000),
              }, // In range position
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();
          const position = positions[0];

          const delegate = anchor.web3.Keypair.generate();
          await approveToken(provider, position.tokenAccount, delegate.publicKey, 1);

          await toTx(
            ctx,
            WhirlpoolIx.collectFeesV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: delegate.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
            })
          )
            .addSigner(delegate)
            .buildAndExecute();
        });

        it("successfully collect fees with owner even if there is approved delegate", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 0,
                tickUpperIndex: 128,
                liquidityAmount: new anchor.BN(10_000_000),
              }, // In range position
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();
          const position = positions[0];

          const delegate = anchor.web3.Keypair.generate();
          await approveToken(provider, position.tokenAccount, delegate.publicKey, 1);

          await toTx(
            ctx,
            WhirlpoolIx.collectFeesV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: provider.wallet.publicKey,
              position: position.publicKey,
              positionTokenAccount: position.tokenAccount,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
            })
          ).buildAndExecute();
        });

        it("successfully collect fees with transferred position token", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 0,
                tickUpperIndex: 128,
                liquidityAmount: new anchor.BN(10_000_000),
              }, // In range position
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();
          const position = positions[0];

          const newOwner = anchor.web3.Keypair.generate();
          const newOwnerPositionTokenAccount = await createTokenAccountForPosition(
            provider,
            position.mintKeypair.publicKey,
            newOwner.publicKey
          );

          await transferToken(provider, position.tokenAccount, newOwnerPositionTokenAccount, 1);

          await toTx(
            ctx,
            WhirlpoolIx.collectFeesV2Ix(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              positionAuthority: newOwner.publicKey,
              position: position.publicKey,
              positionTokenAccount: newOwnerPositionTokenAccount,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenOwnerAccountA: tokenAccountA,
              tokenOwnerAccountB: tokenAccountB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
            })
          )
            .addSigner(newOwner)
            .buildAndExecute();
        });

        it("fails when position does not match whirlpool", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
          });

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: anotherFixture.getInfos().poolInitInfo.whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7d1/ // ConstraintHasOne
          );
        });

        it("fails when position token account does not contain exactly one token", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const positionTokenAccount2 = await createTokenAccountForPosition(
            provider,
            positions[0].mintKeypair.publicKey,
            provider.wallet.publicKey
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positionTokenAccount2,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );

          await transferToken(provider, positions[0].tokenAccount, positionTokenAccount2, 1);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );
        });

        it("fails when position authority is not approved delegate for position token account", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const delegate = anchor.web3.Keypair.generate();

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            )
              .addSigner(delegate)
              .buildAndExecute(),
            /0x1783/ // MissingOrInvalidDelegate
          );
        });

        it("fails when position authority is not authorized to transfer exactly one token", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const delegate = anchor.web3.Keypair.generate();
          await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 2);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            )
              .addSigner(delegate)
              .buildAndExecute(),
            /0x1784/ // InvalidPositionTokenAmount
          );
        });

        it("fails when position authority is not a signer", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const delegate = anchor.web3.Keypair.generate();
          await approveToken(provider, positions[0].tokenAccount, delegate.publicKey, 1);

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: delegate.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /.*signature verification fail.*/i
          );
        });

        it("fails when position token account mint does not equal position mint", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const fakePositionTokenAccount = await createTokenAccountForPosition(
            provider,
            NATIVE_MINT,
            provider.wallet.publicKey
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: fakePositionTokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );
        });

        it("fails when token vault does not match whirlpool token vault", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const fakeVaultA = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenMintA,
            provider.wallet.publicKey
          );
          const fakeVaultB = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenMintB,
            provider.wallet.publicKey
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: fakeVaultA,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7dc/ // ConstraintAddress
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: fakeVaultB,
              })
            ).buildAndExecute(),
            /0x7dc/ // ConstraintAddress
          );
        });

        it("fails when owner token account mint does not match whirlpool token mint", async () => {
          // In same tick array - start index 22528
          const tickLowerIndex = 29440;
          const tickUpperIndex = 33536;
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              { tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) },
            ],
          });
          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const invalidOwnerAccountA = await createTokenAccountV2(
            provider,
            // invalid token trait & mint
            tokenTraits.tokenTraitB,
            tokenMintB,
            provider.wallet.publicKey
          );
          const invalidOwnerAccountB = await createTokenAccountV2(
            provider,
            // invalid token trait & mint
            tokenTraits.tokenTraitA,
            tokenMintA,
            provider.wallet.publicKey
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: invalidOwnerAccountA,
                tokenOwnerAccountB: tokenAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectFeesV2Ix(ctx.program, {
                whirlpool: whirlpoolPda.publicKey,
                positionAuthority: provider.wallet.publicKey,
                position: positions[0].publicKey,
                positionTokenAccount: positions[0].tokenAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: invalidOwnerAccountB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
              })
            ).buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );
        });
      });
    });
  });

  describe("v2 specific accounts", () => {
    it("fails when passed token_mint_a does not match whirlpool's token_mint_a", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          //tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      const otherTokenPublicKey = await createMintV2(provider, { isToken2022: true });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA: otherTokenPublicKey, // invalid
            tokenMintB,
            tokenProgramA,
            tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_mint_b does not match whirlpool's token_mint_b", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          //tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      const otherTokenPublicKey = await createMintV2(provider, { isToken2022: true });

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB: otherTokenPublicKey, // invalid
            tokenProgramA,
            tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token program (token-2022 is passed)", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      assert.ok(tokenProgramA.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB,
            tokenProgramA: TEST_TOKEN_2022_PROGRAM_ID, // invalid
            tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is not token-2022 program (token is passed)", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      assert.ok(tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB,
            tokenProgramA: TEST_TOKEN_PROGRAM_ID, // invalid
            tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_a is token_metadata", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      assert.ok(tokenProgramA.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB,
            tokenProgramA: METADATA_PROGRAM_ADDRESS, // invalid
            tokenProgramB,
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("fails when passed token_program_b is not token program (token-2022 is passed)", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      assert.ok(tokenProgramB.equals(TEST_TOKEN_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB,
            tokenProgramA,
            tokenProgramB: TEST_TOKEN_2022_PROGRAM_ID, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is not token-2022 program (token is passed)", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      assert.ok(tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB,
            tokenProgramA,
            tokenProgramB: TEST_TOKEN_PROGRAM_ID, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("fails when passed token_program_b is token_metadata", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      assert.ok(tokenProgramB.equals(TEST_TOKEN_2022_PROGRAM_ID));
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.collectFeesV2Ix(ctx.program, {
            whirlpool: whirlpoolPda.publicKey,
            positionAuthority: provider.wallet.publicKey,
            position: positions[0].publicKey,
            positionTokenAccount: positions[0].tokenAccount,
            tokenMintA,
            tokenMintB,
            tokenProgramA,
            tokenProgramB: METADATA_PROGRAM_ADDRESS, // invalid
            tokenOwnerAccountA: tokenAccountA,
            tokenOwnerAccountB: tokenAccountB,
            tokenVaultA: tokenVaultAKeypair.publicKey,
            tokenVaultB: tokenVaultBKeypair.publicKey,
          })
        ).buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("fails when passed memo_program is token_metadata", async () => {
      const tickLowerIndex = 29440;
      const tickUpperIndex = 33536;
      const tickSpacing = TickSpacing.Standard;
      const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
        tickSpacing,
        positions: [{ tickLowerIndex, tickUpperIndex, liquidityAmount: new anchor.BN(10_000_000) }],
      });
      const {
        poolInitInfo: {
          whirlpoolPda,
          tokenVaultAKeypair,
          tokenVaultBKeypair,
          tokenMintA,
          tokenMintB,
          tokenProgramA,
          tokenProgramB,
        },
        tokenAccountA,
        tokenAccountB,
        positions,
      } = fixture.getInfos();

      const invalidMemoProgram = METADATA_PROGRAM_ADDRESS;

      await assert.rejects(
        toTx(ctx, {
          cleanupInstructions: [],
          signers: [],
          instructions: [
            ctx.program.instruction.collectFeesV2(
              { slices: [] },
              {
                accounts: {
                  whirlpool: whirlpoolPda.publicKey,
                  positionAuthority: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA,
                  tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  tokenProgramA,
                  tokenProgramB,
                  memoProgram: invalidMemoProgram,
                },
              }
            ),
          ],
        }).buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });
  });
});
