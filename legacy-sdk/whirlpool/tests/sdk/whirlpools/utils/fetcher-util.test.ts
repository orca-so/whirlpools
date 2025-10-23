import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import * as assert from "assert";
import {
  getAllPositionAccountsByOwner,
  IGNORE_CACHE,
  toTx,
  WhirlpoolContext,
} from "../../../../src";
import { systemTransferTx, TickSpacing } from "../../../utils";
import { defaultConfirmOptions } from "../../../utils/const";
import { WhirlpoolTestFixture } from "../../../utils/fixture";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import { PDAUtil } from "../../../../dist/utils/public/pda-utils";
import { WhirlpoolIx } from "../../../../dist/ix";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PositionBundleUtil } from "../../../../dist/utils/public/position-bundle-util";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

describe("fetcher util tests", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const globalCtx = WhirlpoolContext.fromWorkspace(provider, program);

  // create isolated wallet because the wallet for globalCtx has many positions created by other test cases.
  const isolatedOwnerKeypair = Keypair.generate();
  const isolatedWallet = new NodeWallet(isolatedOwnerKeypair);
  const ctx = WhirlpoolContext.from(globalCtx.connection, isolatedWallet);
  const fetcher = ctx.fetcher;
  beforeAll(async () => {
    await systemTransferTx(
      provider,
      isolatedOwnerKeypair.publicKey,
      10 * LAMPORTS_PER_SOL,
    ).buildAndExecute();
  });

  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const tickSpacing = TickSpacing.Standard;
  const liquidityAmount = new BN(10_000_000);

  async function initializePositionBundleWithPositions(
    whirlpool: PublicKey,
    bundleIndexes: number[],
  ): Promise<PublicKey> {
    const positionBundleMintKeypair = Keypair.generate();
    const positionBundlePda = PDAUtil.getPositionBundle(
      ctx.program.programId,
      positionBundleMintKeypair.publicKey,
    );
    const positionBundleTokenAccount = getAssociatedTokenAddressSync(
      positionBundleMintKeypair.publicKey,
      ctx.wallet.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
    );

    await toTx(
      ctx,
      WhirlpoolIx.initializePositionBundleIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        owner: ctx.wallet.publicKey,
        positionBundleMintKeypair,
        positionBundlePda,
        positionBundleTokenAccount,
      }),
    ).buildAndExecute();

    for (const bundleIndex of bundleIndexes) {
      const bundledPositionPda = PDAUtil.getBundledPosition(
        ctx.program.programId,
        positionBundleMintKeypair.publicKey,
        bundleIndex,
      );
      await toTx(
        ctx,
        WhirlpoolIx.openBundledPositionIx(ctx.program, {
          bundledPositionPda,
          bundleIndex,
          tickLowerIndex,
          tickUpperIndex,
          positionBundle: positionBundlePda.publicKey,
          positionBundleAuthority: ctx.wallet.publicKey,
          positionBundleTokenAccount,
          funder: ctx.wallet.publicKey,
          whirlpool,
        }),
      ).buildAndExecute();
    }

    const positionBundleData = await fetcher.getPositionBundle(
      positionBundlePda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(!!positionBundleData);
    const occupied =
      PositionBundleUtil.getOccupiedBundleIndexes(positionBundleData);
    assert.deepEqual(occupied, bundleIndexes);

    return positionBundlePda.publicKey;
  }

  it("getAllPositionAccountsByOwner", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing,
      positions: [
        // 5 TokenProgram based positions
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: false,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: false,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: false,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: false,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: false,
        },
        // 5 TokenExtensions based positions
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: true,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: true,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: true,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: true,
        },
        {
          tickLowerIndex,
          tickUpperIndex,
          liquidityAmount,
          isTokenExtensionsBasedPosition: true,
        },
      ],
    });

    const positionAddresses = new Set(
      fixture
        .getInfos()
        .positions.slice(0, 5)
        .map((p) => p.publicKey.toBase58()),
    );
    assert.ok(positionAddresses.size === 5);
    const positionWithTokenExtensionsAddresses = new Set(
      fixture
        .getInfos()
        .positions.slice(5)
        .map((p) => p.publicKey.toBase58()),
    );
    assert.ok(positionWithTokenExtensionsAddresses.size === 5);

    // initialize 2 position bundles
    const whirlpool = fixture.getInfos().poolInitInfo.whirlpoolPda.publicKey;
    const positionBundle1BundleIndexes = [0, 128, 250];
    const positionBundle1Pubkey = await initializePositionBundleWithPositions(
      whirlpool,
      positionBundle1BundleIndexes,
    );
    const positionBundle2BundleIndexes = [5, 30, 64, 135, 192, 255];
    const positionBundle2Pubkey = await initializePositionBundleWithPositions(
      whirlpool,
      positionBundle2BundleIndexes,
    );

    const result = await getAllPositionAccountsByOwner({
      ctx,
      owner: ctx.wallet.publicKey,
      includesPositions: true,
      includesBundledPositions: true,
      includesPositionsWithTokenExtensions: true,
    });

    assert.ok(result.positions.size === 5);
    assert.ok(
      Array.from(result.positions.keys()).every((p) =>
        positionAddresses.has(p),
      ),
    );
    assert.ok(
      Array.from(result.positions.values()).every(
        (p) =>
          p.tickLowerIndex === tickLowerIndex &&
          p.tickUpperIndex === tickUpperIndex,
      ),
    );
    assert.ok(result.positionsWithTokenExtensions.size === 5);
    assert.ok(
      Array.from(result.positionsWithTokenExtensions.keys()).every((p) =>
        positionWithTokenExtensionsAddresses.has(p),
      ),
    );
    assert.ok(
      Array.from(result.positionsWithTokenExtensions.values()).every(
        (p) =>
          p.tickLowerIndex === tickLowerIndex &&
          p.tickUpperIndex === tickUpperIndex,
      ),
    );

    assert.ok(result.positionBundles.length === 2);
    const pb0 = result.positionBundles[0];
    const pb1 = result.positionBundles[1];
    const occupied0 = PositionBundleUtil.getOccupiedBundleIndexes(
      pb0.positionBundleData,
    );
    const occupied1 = PositionBundleUtil.getOccupiedBundleIndexes(
      pb1.positionBundleData,
    );

    if (
      pb0.positionBundleAddress.toString() === positionBundle1Pubkey.toString()
    ) {
      assert.ok(
        pb0.positionBundleAddress.toString() ===
          positionBundle1Pubkey.toString(),
      );
      assert.deepEqual(occupied0, positionBundle1BundleIndexes);
      assert.ok(
        pb0.bundledPositions.size === positionBundle1BundleIndexes.length,
      );
      assert.deepEqual(
        Array.from(pb0.bundledPositions.keys()),
        positionBundle1BundleIndexes,
      );
      assert.ok(
        Array.from(pb0.bundledPositions.values()).every(
          (p) =>
            p.tickLowerIndex === tickLowerIndex &&
            p.tickUpperIndex === tickUpperIndex,
        ),
      );

      assert.ok(
        pb1.positionBundleAddress.toString() ===
          positionBundle2Pubkey.toString(),
      );
      assert.deepEqual(occupied1, positionBundle2BundleIndexes);
      assert.ok(
        pb1.bundledPositions.size === positionBundle2BundleIndexes.length,
      );
      assert.deepEqual(
        Array.from(pb1.bundledPositions.keys()),
        positionBundle2BundleIndexes,
      );
      assert.ok(
        Array.from(pb1.bundledPositions.values()).every(
          (p) =>
            p.tickLowerIndex === tickLowerIndex &&
            p.tickUpperIndex === tickUpperIndex,
        ),
      );
    } else {
      assert.ok(
        pb0.positionBundleAddress.toString() ===
          positionBundle2Pubkey.toString(),
      );
      assert.deepEqual(occupied0, positionBundle2BundleIndexes);
      assert.ok(
        pb0.bundledPositions.size === positionBundle2BundleIndexes.length,
      );
      assert.deepEqual(
        Array.from(pb0.bundledPositions.keys()),
        positionBundle2BundleIndexes,
      );
      assert.ok(
        Array.from(pb0.bundledPositions.values()).every(
          (p) =>
            p.tickLowerIndex === tickLowerIndex &&
            p.tickUpperIndex === tickUpperIndex,
        ),
      );

      assert.ok(
        pb1.positionBundleAddress.toString() ===
          positionBundle1Pubkey.toString(),
      );
      assert.deepEqual(occupied1, positionBundle1BundleIndexes);
      assert.ok(
        pb1.bundledPositions.size === positionBundle1BundleIndexes.length,
      );
      assert.deepEqual(
        Array.from(pb1.bundledPositions.keys()),
        positionBundle1BundleIndexes,
      );
      assert.ok(
        Array.from(pb1.bundledPositions.values()).every(
          (p) =>
            p.tickLowerIndex === tickLowerIndex &&
            p.tickUpperIndex === tickUpperIndex,
        ),
      );
    }

    const resultDefault = await getAllPositionAccountsByOwner({
      ctx,
      owner: ctx.wallet.publicKey,
    });

    assert.ok(resultDefault.positions.size === 5);
    assert.ok(resultDefault.positionsWithTokenExtensions.size === 5);
    // no bundled positions
    assert.ok(resultDefault.positionBundles.length === 0);

    const resultAllFalse = await getAllPositionAccountsByOwner({
      ctx,
      owner: ctx.wallet.publicKey,
      includesPositions: false,
      includesBundledPositions: false,
      includesPositionsWithTokenExtensions: false,
    });

    assert.ok(resultAllFalse.positions.size === 0);
    assert.ok(resultAllFalse.positionsWithTokenExtensions.size === 0);
    assert.ok(resultAllFalse.positionBundles.length === 0);
  });
});
