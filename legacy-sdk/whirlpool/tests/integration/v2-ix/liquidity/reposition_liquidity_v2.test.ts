import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import * as assert from "assert";
import BN from "bn.js";
import Decimal from "decimal.js";
import type { WhirlpoolContext } from "../../../../src";
import {
  IGNORE_CACHE,
  MAX_SQRT_PRICE_BN,
  MEMO_PROGRAM_ADDRESS,
  MIN_SQRT_PRICE_BN,
  PDAUtil,
  PriceMath,
  TickUtil,
  toTx,
  WhirlpoolIx,
} from "../../../../src";
import {
  getLiteSVM,
  initializeLiteSVMEnvironment,
  sleep,
  TickSpacing,
  warpClock,
  ZERO_BN,
} from "../../../utils";
import { initTickArray } from "../../../utils/init-utils";
import { WhirlpoolTestFixtureV2 } from "../../../utils/v2/fixture-v2";
import type { TokenTrait } from "../../../utils/v2/init-utils-v2";

describe("reposition_v2", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];
  let program: anchor.Program;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
    program = env.program;
  });

  describe("direct transfer", () => {
    const tokenTraitVariations: {
      tokenTraitA: TokenTrait;
      tokenTraitB: TokenTrait;
    }[] = [
      // Native mint for token 2022 is not supported
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: false },
        tokenTraitB: { isToken2022: true },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: true },
        tokenTraitB: { isToken2022: true },
      },
      {
        tokenTraitA: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 500,
        },
        tokenTraitB: {
          isToken2022: true,
          hasTransferFeeExtension: true,
          transferFeeInitialBps: 250,
        },
      },
      {
        tokenTraitA: { isToken2022: false, isNativeMint: true },
        tokenTraitB: { isToken2022: false },
      },
      {
        tokenTraitA: { isToken2022: false, isNativeMint: true },
        tokenTraitB: { isToken2022: true },
      },
    ];

    tokenTraitVariations.forEach((tokenTraits) => {
      describe(`tokenTraitA: ${tokenTraits.tokenTraitA.isNativeMint ? "Native " : "SPL "}${
        tokenTraits.tokenTraitA.isToken2022 ? "Token2022" : "Token"
      }, tokenTraitB: ${tokenTraits.tokenTraitB.isNativeMint ? "Native " : "SPL "}${
        tokenTraits.tokenTraitB.isToken2022 ? "Token2022" : "Token"
      }`, () => {
        it("reposition: 1-sided position above price to 50:50 ratio", async () => {
          // Initial position: 1-sided position above price
          const currTick = 0;
          const initialTickLower = 128;
          const initialTickUpper = 1280;
          const initialLiquidity = new BN(1_000_000);
          // New position: 50:50 straddling current price
          const repositionTickLower = -640;
          const repositionTickUpper = 640;

          const poolFixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = poolFixture.getInfos();

          const positionBefore = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );

          assert.equal(positionBefore?.tickLowerIndex, initialTickLower);
          assert.equal(positionBefore?.tickUpperIndex, initialTickUpper);
          assert.ok(positionBefore?.liquidity.eq(initialLiquidity));

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(repositionTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(repositionTickUpper, tickSpacing),
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(repositionTickLower, tickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(repositionTickUpper, tickSpacing),
          );

          // Get the position account and drain most of its lamports
          // to make it underfunded (less than rent-exempt for Position::LEN)
          const litesvm = getLiteSVM();
          const positionAccount = litesvm.getAccount(positions[0].publicKey);
          assert.ok(positionAccount, "Position account should exist");

          // Set lamports to an amount required for Position rent
          // This creates the scenario where the funder must add additional lamports
          // to make the position account rent-exempt.
          const underfundedLamports = 2_394_240;
          litesvm.setAccount(positions[0].publicKey, {
            lamports: underfundedLamports,
            data: positionAccount.data,
            owner: positionAccount.owner,
            executable: positionAccount.executable,
            rentEpoch: Number(positionAccount.rentEpoch),
          });

          await toTx(ctx, {
            instructions: [
              await program.methods
                .repositionLiquidityV2(
                  repositionTickLower,
                  repositionTickUpper,
                  initialLiquidity,
                  ZERO_BN,
                  ZERO_BN,
                  new BN(500_000),
                  new BN(500_000),
                  null, // remainingAccountsInfo
                )
                .accounts({
                  whirlpool: whirlpoolPda.publicKey,
                  tokenProgramA: tokenProgramA,
                  tokenProgramB: tokenProgramB,
                  memoProgram: MEMO_PROGRAM_ADDRESS,
                  positionAuthority: provider.wallet.publicKey,
                  funder: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA: tokenMintA,
                  tokenMintB: tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  existingTickArrayLower: positions[0].tickArrayLower,
                  existingTickArrayUpper: positions[0].tickArrayUpper,
                  newTickArrayLower: newTickArrayLower.publicKey,
                  newTickArrayUpper: newTickArrayUpper.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction(),
            ],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute();

          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.equal(positionAfter?.tickLowerIndex, repositionTickLower);
          assert.equal(positionAfter?.tickUpperIndex, repositionTickUpper);
          assert.ok(positionAfter?.liquidity.eq(initialLiquidity));
        });

        it("reposition: 1-sided position below price to 50:50 ratio", async () => {
          // Initial position: 1-sided position below price (only token B)
          const currTick = 0;
          const initialTickLower = -1280;
          const initialTickUpper = -128;
          const initialLiquidity = new BN(1_000_000);
          // New position: 50:50 straddling current price
          const newTickLower = -640;
          const newTickUpper = 640;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await toTx(ctx, {
            instructions: [
              await program.methods
                .repositionLiquidityV2(
                  newTickLower,
                  newTickUpper,
                  initialLiquidity,
                  ZERO_BN,
                  ZERO_BN,
                  new BN(500_000),
                  new BN(500_000),
                  null, // remainingAccountsInfo
                )
                .accounts({
                  whirlpool: whirlpoolPda.publicKey,
                  tokenProgramA: tokenProgramA,
                  tokenProgramB: tokenProgramB,
                  memoProgram: MEMO_PROGRAM_ADDRESS,
                  positionAuthority: provider.wallet.publicKey,
                  funder: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA: tokenMintA,
                  tokenMintB: tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  existingTickArrayLower: positions[0].tickArrayLower,
                  existingTickArrayUpper: positions[0].tickArrayUpper,
                  newTickArrayLower: newTickArrayLower.publicKey,
                  newTickArrayUpper: newTickArrayUpper.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction(),
            ],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute();

          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.equal(positionAfter?.tickLowerIndex, newTickLower);
          assert.equal(positionAfter?.tickUpperIndex, newTickUpper);
          assert.ok(positionAfter?.liquidity.eq(initialLiquidity));
        });

        it("reposition: tighten position width", async () => {
          // Initial position: Wide position with 50:50 ratio
          const currTick = 0;
          const initialTickLower = -1280;
          const initialTickUpper = 1280;
          const initialLiquidity = new BN(5_000_000);
          // New position: Tighter range, still 50:50
          const newTickLower = -640;
          const newTickUpper = 640;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          // A lower liquidity amount on a tigher position should trigger a transfer from vault -> owner
          const repositionLiquidityAmount = new BN(1_000_000);
          const repositionSignature = await toTx(ctx, {
            instructions: [
              await program.methods
                .repositionLiquidityV2(
                  newTickLower,
                  newTickUpper,
                  repositionLiquidityAmount,
                  ZERO_BN,
                  ZERO_BN,
                  new BN(500_000),
                  new BN(500_000),
                  null, // remainingAccountsInfo
                )
                .accounts({
                  whirlpool: whirlpoolPda.publicKey,
                  tokenProgramA: tokenProgramA,
                  tokenProgramB: tokenProgramB,
                  memoProgram: MEMO_PROGRAM_ADDRESS,
                  positionAuthority: provider.wallet.publicKey,
                  funder: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA: tokenMintA,
                  tokenMintB: tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  existingTickArrayLower: positions[0].tickArrayLower,
                  existingTickArrayUpper: positions[0].tickArrayUpper,
                  newTickArrayLower: newTickArrayLower.publicKey,
                  newTickArrayUpper: newTickArrayUpper.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction(),
            ],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute();

          const getTransferFeeLogCount = (tokenTrait: TokenTrait) =>
            tokenTrait.hasTransferFeeExtension ? 1 : 0;
          const getTransferFeeLogs = async () => {
            const repositionTx = await ctx.connection.getTransaction(
              repositionSignature,
              {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              },
            );

            return (repositionTx?.meta?.logMessages ?? []).filter((msg) => {
              return /Program log: Memo \(len \d+\): "TFe:/.test(msg);
            });
          };

          // Verify that the transfer fee memo is present if the transfer fee extension is enabled
          await getTransferFeeLogs().then((logs) => {
            const transferFeeLogCount =
              getTransferFeeLogCount(tokenTraits.tokenTraitA) +
              getTransferFeeLogCount(tokenTraits.tokenTraitB);
            assert.ok(logs.length === transferFeeLogCount);
          });

          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.equal(positionAfter?.tickLowerIndex, newTickLower);
          assert.equal(positionAfter?.tickUpperIndex, newTickUpper);
          assert.ok(positionAfter?.liquidity.eq(repositionLiquidityAmount));
        });

        it("reposition: widen position width", async () => {
          // Initial position: Narrow position with 50:50 ratio
          const currTick = 0;
          const initialTickLower = -640;
          const initialTickUpper = 640;
          const initialLiquidity = new BN(5_000_000);

          // New position: Wider range, still 50:50
          const newTickLower = -1280;
          const newTickUpper = 1280;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await toTx(ctx, {
            instructions: [
              await program.methods
                .repositionLiquidityV2(
                  newTickLower,
                  newTickUpper,
                  initialLiquidity,
                  ZERO_BN,
                  ZERO_BN,
                  new BN(500_000),
                  new BN(500_000),
                  null, // remainingAccountsInfo
                )
                .accounts({
                  whirlpool: whirlpoolPda.publicKey,
                  tokenProgramA: tokenProgramA,
                  tokenProgramB: tokenProgramB,
                  memoProgram: MEMO_PROGRAM_ADDRESS,
                  positionAuthority: provider.wallet.publicKey,
                  funder: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA: tokenMintA,
                  tokenMintB: tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  existingTickArrayLower: positions[0].tickArrayLower,
                  existingTickArrayUpper: positions[0].tickArrayUpper,
                  newTickArrayLower: newTickArrayLower.publicKey,
                  newTickArrayUpper: newTickArrayUpper.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction(),
            ],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute();

          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.equal(positionAfter?.tickLowerIndex, newTickLower);
          assert.equal(positionAfter?.tickUpperIndex, newTickUpper);
          assert.ok(positionAfter?.liquidity.eq(initialLiquidity));
        });

        it("reposition: dual-sided to 1-sided above price", async () => {
          // Initial position: 50:50 position straddling current price
          const currTick = 0;
          const initialTickLower = -640;
          const initialTickUpper = 640;
          const initialLiquidity = new BN(5_000_000);
          // New position: 1-sided position above price
          const newTickLower = 1280;
          const newTickUpper = 2560;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await toTx(ctx, {
            instructions: [
              await program.methods
                .repositionLiquidityV2(
                  newTickLower,
                  newTickUpper,
                  initialLiquidity,
                  ZERO_BN,
                  ZERO_BN,
                  new BN(500_000),
                  new BN(500_000),
                  null, // remainingAccountsInfo
                )
                .accounts({
                  whirlpool: whirlpoolPda.publicKey,
                  tokenProgramA: tokenProgramA,
                  tokenProgramB: tokenProgramB,
                  memoProgram: MEMO_PROGRAM_ADDRESS,
                  positionAuthority: provider.wallet.publicKey,
                  funder: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA: tokenMintA,
                  tokenMintB: tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  existingTickArrayLower: positions[0].tickArrayLower,
                  existingTickArrayUpper: positions[0].tickArrayUpper,
                  newTickArrayLower: newTickArrayLower.publicKey,
                  newTickArrayUpper: newTickArrayUpper.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction(),
            ],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute();

          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.equal(positionAfter?.tickLowerIndex, newTickLower);
          assert.equal(positionAfter?.tickUpperIndex, newTickUpper);
          assert.ok(positionAfter?.liquidity.eq(initialLiquidity));
        });

        it("fails to reposition liquidity with same range", async () => {
          // Initial position: 50:50 position straddling current price
          const currTick = 0;
          const initialTickLower = -640;
          const initialTickUpper = 640;
          const initialLiquidity = new BN(5_000_000);

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          await assert.rejects(
            toTx(ctx, {
              instructions: [
                await program.methods
                  .repositionLiquidityV2(
                    initialTickLower,
                    initialTickUpper,
                    initialLiquidity,
                    ZERO_BN,
                    ZERO_BN,
                    new BN(500_000),
                    new BN(500_000),
                    null, // remainingAccountsInfo
                  )
                  .accounts({
                    whirlpool: whirlpoolPda.publicKey,
                    tokenProgramA: tokenProgramA,
                    tokenProgramB: tokenProgramB,
                    memoProgram: MEMO_PROGRAM_ADDRESS,
                    positionAuthority: provider.wallet.publicKey,
                    funder: provider.wallet.publicKey,
                    position: positions[0].publicKey,
                    positionTokenAccount: positions[0].tokenAccount,
                    tokenMintA: tokenMintA,
                    tokenMintB: tokenMintB,
                    tokenOwnerAccountA: tokenAccountA,
                    tokenOwnerAccountB: tokenAccountB,
                    tokenVaultA: tokenVaultAKeypair.publicKey,
                    tokenVaultB: tokenVaultBKeypair.publicKey,
                    existingTickArrayLower: positions[0].tickArrayLower,
                    existingTickArrayUpper: positions[0].tickArrayUpper,
                    newTickArrayLower: positions[0].tickArrayLower,
                    newTickArrayUpper: positions[0].tickArrayUpper,
                    systemProgram: anchor.web3.SystemProgram.programId,
                  })
                  .instruction(),
              ],
              cleanupInstructions: [],
              signers: [],
            }).buildAndExecute(),
            (err) => /.*SameTickRangeNotAllowed|0x17ac.*/i.test(String(err)),
          );
        });

        it("fails to reposition liquidity with invalid tick range", async () => {
          // Initial position: 50:50 position straddling current price
          const currTick = 0;
          const initialTickLower = -640;
          const initialTickUpper = 640;
          const initialLiquidity = new BN(5_000_000);
          // New position: invalid ticks
          const newTickLower = -100;
          const newTickUpper = 100;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await assert.rejects(
            toTx(ctx, {
              instructions: [
                await program.methods
                  .repositionLiquidityV2(
                    newTickLower,
                    newTickUpper,
                    initialLiquidity,
                    ZERO_BN,
                    ZERO_BN,
                    new BN(500_000),
                    new BN(500_000),
                    null, // remainingAccountsInfo
                  )
                  .accounts({
                    whirlpool: whirlpoolPda.publicKey,
                    tokenProgramA: tokenProgramA,
                    tokenProgramB: tokenProgramB,
                    memoProgram: MEMO_PROGRAM_ADDRESS,
                    positionAuthority: provider.wallet.publicKey,
                    funder: provider.wallet.publicKey,
                    position: positions[0].publicKey,
                    positionTokenAccount: positions[0].tokenAccount,
                    tokenMintA: tokenMintA,
                    tokenMintB: tokenMintB,
                    tokenOwnerAccountA: tokenAccountA,
                    tokenOwnerAccountB: tokenAccountB,
                    tokenVaultA: tokenVaultAKeypair.publicKey,
                    tokenVaultB: tokenVaultBKeypair.publicKey,
                    existingTickArrayLower: positions[0].tickArrayLower,
                    existingTickArrayUpper: positions[0].tickArrayUpper,
                    newTickArrayLower: newTickArrayLower.publicKey,
                    newTickArrayUpper: newTickArrayUpper.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                  })
                  .instruction(),
              ],
              cleanupInstructions: [],
              signers: [],
            }).buildAndExecute(),
            (err) => /.*InvalidTickIndex|0x177a.*/i.test(String(err)),
          );
        });

        it("fails to widen position width with same liquidity token max exceeded", async () => {
          // Initial position: Narrow position with 50:50 ratio
          const currTick = 0;
          const initialTickLower = -640;
          const initialTickUpper = 640;
          const initialLiquidity = new BN(5_000_000);

          // New position: Wider range, still 50:50
          const newTickLower = -1280;
          const newTickUpper = 1280;

          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidity,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
          });

          const {
            poolInitInfo: {
              whirlpoolPda,
              tokenProgramA,
              tokenProgramB,
              tokenMintA,
              tokenMintB,
              tokenVaultAKeypair,
              tokenVaultBKeypair,
              tickSpacing,
            },
            positions,
            tokenAccountA,
            tokenAccountB,
          } = fixture.getInfos();

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, tickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, tickSpacing),
          );

          await assert.rejects(
            toTx(ctx, {
              instructions: [
                await program.methods
                  .repositionLiquidityV2(
                    newTickLower,
                    newTickUpper,
                    initialLiquidity,
                    ZERO_BN,
                    ZERO_BN,
                    new BN(100_000),
                    new BN(100_000),
                    null, // remainingAccountsInfo
                  )
                  .accounts({
                    whirlpool: whirlpoolPda.publicKey,
                    tokenProgramA: tokenProgramA,
                    tokenProgramB: tokenProgramB,
                    memoProgram: MEMO_PROGRAM_ADDRESS,
                    positionAuthority: provider.wallet.publicKey,
                    funder: provider.wallet.publicKey,
                    position: positions[0].publicKey,
                    positionTokenAccount: positions[0].tokenAccount,
                    tokenMintA: tokenMintA,
                    tokenMintB: tokenMintB,
                    tokenOwnerAccountA: tokenAccountA,
                    tokenOwnerAccountB: tokenAccountB,
                    tokenVaultA: tokenVaultAKeypair.publicKey,
                    tokenVaultB: tokenVaultBKeypair.publicKey,
                    existingTickArrayLower: positions[0].tickArrayLower,
                    existingTickArrayUpper: positions[0].tickArrayUpper,
                    newTickArrayLower: newTickArrayLower.publicKey,
                    newTickArrayUpper: newTickArrayUpper.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                  })
                  .instruction(),
              ],
              cleanupInstructions: [],
              signers: [],
            }).buildAndExecute(),
            (err) => /.*TokenMaxExceeded|0x1781.*/i.test(String(err)),
          );
        });

        it("reposition: dual-sided 40:60 position to 60:40 ratio, verify fees/rewards are preserved", async () => {
          // Initial position: 40:60 ratio
          const currTick = 0;
          const initialTickLower = -768;
          const initialTickUpper = 512;
          const initialLiquidityAmount = new BN(10_000_000);
          // New position: 60:40 ratio, opposite of initial position
          const newTickLower = -512;
          const newTickUpper = 768;

          const vaultStartBalance = 100_000_000; // Need at least 86.4M for 1,000 tokens/sec for a day
          const fixture = await new WhirlpoolTestFixtureV2(ctx).init({
            ...tokenTraits,
            tickSpacing: TickSpacing.Standard,
            positions: [
              {
                tickLowerIndex: initialTickLower,
                tickUpperIndex: initialTickUpper,
                liquidityAmount: initialLiquidityAmount,
              },
            ],
            initialSqrtPrice: PriceMath.tickIndexToSqrtPriceX64(currTick),
            rewards: [
              {
                rewardTokenTrait: {
                  isToken2022: true,
                  hasTransferFeeExtension: true,
                  transferFeeInitialBps: 500,
                }, // 5%
                emissionsPerSecondX64: MathUtil.toX64(new Decimal(1_000)),
                vaultAmount: new BN(vaultStartBalance),
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
              tickSpacing: poolInitTickSpacing,
            },
            tokenAccountA,
            tokenAccountB,
            positions,
          } = fixture.getInfos();

          const oraclePda = PDAUtil.getOracle(
            ctx.program.programId,
            whirlpoolPda.publicKey,
          );

          const newTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, poolInitTickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickLower, poolInitTickSpacing),
          );

          const newTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, poolInitTickSpacing),
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(newTickUpper, poolInitTickSpacing),
          );

          const currentTickArrayStart = TickUtil.getStartTickIndex(
            currTick,
            poolInitTickSpacing,
            0,
          );
          const leftTickArrayStart = TickUtil.getStartTickIndex(
            currTick,
            poolInitTickSpacing,
            -1,
          );
          const rightTickArrayStart = TickUtil.getStartTickIndex(
            currTick,
            poolInitTickSpacing,
            1,
          );

          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            currentTickArrayStart,
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            leftTickArrayStart,
          );
          await initTickArrayIfNeeded(
            ctx,
            whirlpoolPda.publicKey,
            rightTickArrayStart,
          );

          const tickArrayLeft = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            leftTickArrayStart,
          );

          const tickArrayCurrent = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            currentTickArrayStart,
          );

          const tickArrayRight = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            rightTickArrayStart,
          );

          // Accrue fees in token A
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(50_000),
              otherAmountThreshold: ZERO_BN,
              sqrtPriceLimit: MIN_SQRT_PRICE_BN,
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
              tickArray0: tickArrayCurrent.publicKey,
              tickArray1: tickArrayLeft.publicKey,
              tickArray2: tickArrayLeft.publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          // Accrue fees in token B
          await toTx(
            ctx,
            WhirlpoolIx.swapV2Ix(ctx.program, {
              amount: new BN(50_000),
              otherAmountThreshold: ZERO_BN,
              sqrtPriceLimit: MAX_SQRT_PRICE_BN,
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
              tickArray0: tickArrayCurrent.publicKey,
              tickArray1: tickArrayRight.publicKey,
              tickArray2: tickArrayRight.publicKey,
              oracle: oraclePda.publicKey,
            }),
          ).buildAndExecute();

          warpClock(5);

          const positionTickArrayLower = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(initialTickLower, poolInitTickSpacing),
          ).publicKey;
          const positionTickArrayUpper = PDAUtil.getTickArray(
            ctx.program.programId,
            whirlpoolPda.publicKey,
            TickUtil.getStartTickIndex(initialTickUpper, poolInitTickSpacing),
          ).publicKey;

          await toTx(
            ctx,
            WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
              whirlpool: whirlpoolPda.publicKey,
              position: positions[0].publicKey,
              tickArrayLower: positionTickArrayLower,
              tickArrayUpper: positionTickArrayUpper,
            }),
          ).buildAndExecute();

          const whirlpoolData = (await fetcher.getPool(
            whirlpoolPda.publicKey,
            IGNORE_CACHE,
          ))!;
          assert.ok(!whirlpoolData.protocolFeeOwedA.isZero());
          assert.ok(!whirlpoolData.protocolFeeOwedB.isZero());

          const positionAfterSwaps = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.ok(!positionAfterSwaps?.feeOwedA.isZero());
          assert.ok(!positionAfterSwaps?.feeOwedB.isZero());
          assert.ok(!positionAfterSwaps?.rewardInfos[0].amountOwed.isZero());

          const repositionSignature = await toTx(ctx, {
            instructions: [
              await program.methods
                .repositionLiquidityV2(
                  newTickLower,
                  newTickUpper,
                  initialLiquidityAmount,
                  ZERO_BN,
                  ZERO_BN,
                  new BN(500_000),
                  new BN(500_000),
                  null, // remainingAccountsInfo
                )
                .accounts({
                  whirlpool: whirlpoolPda.publicKey,
                  tokenProgramA: tokenProgramA,
                  tokenProgramB: tokenProgramB,
                  memoProgram: MEMO_PROGRAM_ADDRESS,
                  positionAuthority: provider.wallet.publicKey,
                  funder: provider.wallet.publicKey,
                  position: positions[0].publicKey,
                  positionTokenAccount: positions[0].tokenAccount,
                  tokenMintA: tokenMintA,
                  tokenMintB: tokenMintB,
                  tokenOwnerAccountA: tokenAccountA,
                  tokenOwnerAccountB: tokenAccountB,
                  tokenVaultA: tokenVaultAKeypair.publicKey,
                  tokenVaultB: tokenVaultBKeypair.publicKey,
                  existingTickArrayLower: positions[0].tickArrayLower,
                  existingTickArrayUpper: positions[0].tickArrayUpper,
                  newTickArrayLower: newTickArrayLower.publicKey,
                  newTickArrayUpper: newTickArrayUpper.publicKey,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .instruction(),
            ],
            cleanupInstructions: [],
            signers: [],
          }).buildAndExecute();

          const repositionTx = await ctx.connection.getTransaction(
            repositionSignature,
            {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            },
          );
          assert.ok(repositionTx, "Transaction should exist");

          const eventParser = new anchor.EventParser(
            ctx.program.programId,
            new anchor.BorshCoder(ctx.program.idl),
          );
          const events = Array.from(
            eventParser.parseLogs(repositionTx!.meta!.logMessages!),
          );

          const liquidityRepositionedEvents = events.filter(
            (e) => e.name === "liquidityRepositioned",
          );

          assert.equal(
            liquidityRepositionedEvents.length,
            1,
            "Expected 1 Liquidity Repositioned event",
          );

          const event = liquidityRepositionedEvents[0].data;
          assert.equal(
            event.whirlpool.toBase58(),
            whirlpoolPda.publicKey.toBase58(),
          );
          assert.equal(
            event.position.toBase58(),
            positions[0].publicKey.toBase58(),
          );
          assert.equal(event.oldTickLowerIndex, initialTickLower);
          assert.equal(event.oldTickUpperIndex, initialTickUpper);
          assert.equal(event.newTickLowerIndex, newTickLower);
          assert.equal(event.newTickUpperIndex, newTickUpper);
          assert.ok(
            !event.newTokenAAmount.eq(event.oldTokenAAmount),
            "Token A amount should change",
          );
          assert.ok(
            !event.newTokenBAmount.eq(event.oldTokenBAmount),
            "Token B amount should change",
          );

          await sleep(100);

          const positionAfter = await fetcher.getPosition(
            positions[0].publicKey,
            IGNORE_CACHE,
          );
          assert.equal(positionAfter?.tickLowerIndex, newTickLower);
          assert.equal(positionAfter?.tickUpperIndex, newTickUpper);
          assert.ok(positionAfter?.liquidity.eq(initialLiquidityAmount));
          assert.ok(positionAfter?.feeOwedA.eq(positionAfterSwaps!.feeOwedA));
          assert.notEqual(
            positionAfter?.feeGrowthCheckpointA,
            positionAfterSwaps?.feeGrowthCheckpointA,
          );
          assert.notEqual(
            positionAfter?.feeGrowthCheckpointB,
            positionAfterSwaps?.feeGrowthCheckpointB,
          );
          assert.ok(positionAfter?.feeOwedB.eq(positionAfterSwaps!.feeOwedB));
          positionAfter?.rewardInfos.forEach((rewardInfo, index) => {
            assert.ok(
              rewardInfo?.amountOwed?.eq(
                positionAfterSwaps!.rewardInfos[index].amountOwed,
              ),
            );
          });
        });
      });
    });
  });
});

async function initTickArrayIfNeeded(
  ctx: WhirlpoolContext,
  whirlpool: anchor.web3.PublicKey,
  startTick: number,
) {
  const tickArrayPda = PDAUtil.getTickArray(
    ctx.program.programId,
    whirlpool,
    startTick,
  ).publicKey;

  const tickArrayAccount = await ctx.connection.getAccountInfo(tickArrayPda);
  if (tickArrayAccount !== null) {
    return;
  }
  await initTickArray(ctx, whirlpool, startTick);
}
