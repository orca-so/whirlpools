import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import Decimal from "decimal.js";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolData, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { getTokenBalance, TickSpacing, ZERO_BN } from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixtureV2 } from "../../utils/v2/fixture-v2";
import { TokenTrait } from "../../utils/v2/init-utils-v2";
import { createTokenAccountV2 } from "../../utils/v2/token-2022";

describe("collect_protocol_fees_v2", () => {
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
        it("successfully collects fees", async () => {
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
            configKeypairs: { feeAuthorityKeypair, collectProtocolFeesAuthorityKeypair },
            configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKeypair },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          await toTx(
            ctx,
            WhirlpoolIx.setProtocolFeeRateIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
              feeAuthority: feeAuthorityKeypair.publicKey,
              protocolFeeRate: 2500,
            })
          )
            .addSigner(feeAuthorityKeypair)
            .buildAndExecute();

          const poolBefore = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE
          )) as WhirlpoolData;
          assert.ok(poolBefore?.protocolFeeOwedA.eq(ZERO_BN));
          assert.ok(poolBefore?.protocolFeeOwedB.eq(ZERO_BN));

          const tickArrayPda = positions[0].tickArrayLower;

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
              tickArray0: tickArrayPda,
              tickArray1: tickArrayPda,
              tickArray2: tickArrayPda,
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
              tickArray0: tickArrayPda,
              tickArray1: tickArrayPda,
              tickArray2: tickArrayPda,
              oracle: oraclePda.publicKey,
            })
          ).buildAndExecute();

          const poolAfter = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE
          )) as WhirlpoolData;
          assert.ok(poolAfter?.protocolFeeOwedA.eq(new BN(150)));
          assert.ok(poolAfter?.protocolFeeOwedB.eq(new BN(150)));

          const destA = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenMintA,
            provider.wallet.publicKey
          );
          const destB = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenMintB,
            provider.wallet.publicKey
          );

          await toTx(
            ctx,
            WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
              whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
              whirlpool: whirlpoolPda.publicKey,
              collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
              tokenMintA,
              tokenMintB,
              tokenProgramA,
              tokenProgramB,
              tokenVaultA: tokenVaultAKeypair.publicKey,
              tokenVaultB: tokenVaultBKeypair.publicKey,
              tokenOwnerAccountA: destA,
              tokenOwnerAccountB: destB,
            })
          )
            .addSigner(collectProtocolFeesAuthorityKeypair)
            .buildAndExecute();

          const balanceDestA = await getTokenBalance(provider, destA);
          const balanceDestB = await getTokenBalance(provider, destB);
          assert.equal(balanceDestA, "150");
          assert.equal(balanceDestB, "150");
          assert.ok(poolBefore?.protocolFeeOwedA.eq(ZERO_BN));
          assert.ok(poolBefore?.protocolFeeOwedB.eq(ZERO_BN));
        });

        it("fails to collect fees without the authority's signature", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 29440,
                tickUpperIndex: 33536,
                liquidityAmount: new anchor.BN(10_000_000),
              },
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
            configKeypairs: { collectProtocolFeesAuthorityKeypair },
            configInitInfo: { whirlpoolsConfigKeypair },
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
                whirlpool: whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
              })
            ).buildAndExecute(),
            /.*signature verification fail.*/i
          );
        });

        it("fails when collect_protocol_fees_authority is invalid", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 29440,
                tickUpperIndex: 33536,
                liquidityAmount: new anchor.BN(10_000_000),
              },
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
            configKeypairs: { rewardEmissionsSuperAuthorityKeypair },
            configInitInfo: { whirlpoolsConfigKeypair },
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
                whirlpool: whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: rewardEmissionsSuperAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
              })
            )
              .addSigner(rewardEmissionsSuperAuthorityKeypair)
              .buildAndExecute(),
            /0x7dc/ // ConstraintAddress
          );
        });

        it("fails when whirlpool does not match config", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 29440,
                tickUpperIndex: 33536,
                liquidityAmount: new anchor.BN(10_000_000),
              },
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
            configKeypairs: { collectProtocolFeesAuthorityKeypair },
            configInitInfo: { whirlpoolsConfigKeypair },
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const anotherFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
          });

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
                whirlpool: anotherFixture.getInfos().poolInitInfo.whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
              })
            )
              .addSigner(collectProtocolFeesAuthorityKeypair)
              .buildAndExecute(),
            /0x7d1/ // ConstraintHasOne
          );
        });

        it("fails when vaults do not match whirlpool vaults", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 29440,
                tickUpperIndex: 33536,
                liquidityAmount: new anchor.BN(10_000_000),
              },
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
            configKeypairs: { collectProtocolFeesAuthorityKeypair },
            configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKeypair },
            tokenAccountA,
            tokenAccountB,
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
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
                whirlpool: whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: fakeVaultA,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
              })
            )
              .addSigner(collectProtocolFeesAuthorityKeypair)
              .buildAndExecute(),
            /0x7dc/ // ConstraintAddress
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKeypair.publicKey,
                whirlpool: whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: fakeVaultB,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: tokenAccountB,
              })
            )
              .addSigner(collectProtocolFeesAuthorityKeypair)
              .buildAndExecute(),
            /0x7dc/ // ConstraintAddress
          );
        });

        it("fails when destination mints do not match whirlpool mints", async () => {
          const tickSpacing = TickSpacing.Standard;
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing,
            positions: [
              {
                tickLowerIndex: 29440,
                tickUpperIndex: 33536,
                liquidityAmount: new anchor.BN(10_000_000),
              },
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
            configKeypairs: { collectProtocolFeesAuthorityKeypair },
            configInitInfo: { whirlpoolsConfigKeypair: whirlpoolsConfigKepair },
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const invalidDestA = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitB,
            tokenMintB,
            provider.wallet.publicKey
          );
          const invalidDestB = await createTokenAccountV2(
            provider,
            tokenTraits.tokenTraitA,
            tokenMintA,
            provider.wallet.publicKey
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKepair.publicKey,
                whirlpool: whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tokenOwnerAccountA: invalidDestA,
                tokenOwnerAccountB: tokenAccountB,
              })
            )
              .addSigner(collectProtocolFeesAuthorityKeypair)
              .buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );

          await assert.rejects(
            toTx(
              ctx,
              WhirlpoolIx.collectProtocolFeesV2Ix(ctx.program, {
                whirlpoolsConfig: whirlpoolsConfigKepair.publicKey,
                whirlpool: whirlpoolPda.publicKey,
                collectProtocolFeesAuthority: collectProtocolFeesAuthorityKeypair.publicKey,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                tokenVaultA: tokenVaultAKeypair.publicKey,
                tokenVaultB: tokenVaultBKeypair.publicKey,
                tokenOwnerAccountA: tokenAccountA,
                tokenOwnerAccountB: invalidDestB,
              })
            )
              .addSigner(collectProtocolFeesAuthorityKeypair)
              .buildAndExecute(),
            /0x7d3/ // ConstraintRaw
          );
        });
      });
    });
  });
});
