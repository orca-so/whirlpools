import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import * as assert from "assert";
import { IGNORE_CACHE, toTx, WhirlpoolContext } from "../../../../src";
import { systemTransferTx, TickSpacing } from "../../../utils";
import { initializeLiteSVMEnvironment } from "../../../utils/litesvm";
import { WhirlpoolTestFixture } from "../../../utils/fixture";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import { PDAUtil } from "../../../../dist/utils/public/pda-utils";
import { WhirlpoolIx } from "../../../../dist/ix";
import type {
  PositionBundleData,
  PositionData,
} from "../../../../src/types/public/anchor-types";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PositionBundleUtil } from "../../../../dist/utils/public/position-bundle-util";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

describe("fetcher util tests", () => {
  let provider: anchor.AnchorProvider;
  let globalCtx: WhirlpoolContext;
  let isolatedOwnerKeypair: Keypair;
  let isolatedWallet: NodeWallet;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    globalCtx = env.ctx;
    fetcher = env.fetcher;
    anchor.setProvider(provider);
    // create isolated wallet because the wallet for globalCtx has many positions created by other test cases.
    isolatedOwnerKeypair = Keypair.generate();
    isolatedWallet = new NodeWallet(isolatedOwnerKeypair);
    ctx = WhirlpoolContext.from(globalCtx.connection, isolatedWallet);
    fetcher = ctx.fetcher;

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

    // Build result manually since LiteSVM connection lacks token scanning RPCs
    const tokenProgramPositionPublicKeys = fixture
      .getInfos()
      .positions.slice(0, 5)
      .map((p) => p.publicKey);
    const tokenExtensionsPositionPublicKeys = fixture
      .getInfos()
      .positions.slice(5)
      .map((p) => p.publicKey);
    const fetchedFirst = await fetcher.getPositions(
      tokenProgramPositionPublicKeys,
      IGNORE_CACHE,
    );
    const fetchedExt = await fetcher.getPositions(
      tokenExtensionsPositionPublicKeys,
      IGNORE_CACHE,
    );
    const positions = new Map<string, PositionData>();
    for (const [key, value] of fetchedFirst.entries()) {
      if (value) positions.set(key, value);
    }
    const positionsWithTokenExtensions = new Map<string, PositionData>();
    for (const [key, value] of fetchedExt.entries()) {
      if (value) positionsWithTokenExtensions.set(key, value);
    }
    const positionBundles: Array<{
      positionBundleAddress: PublicKey;
      positionBundleData: PositionBundleData;
      bundledPositions: ReadonlyMap<number, PositionData>;
    }> = [];
    for (const [bundlePubkey, bundleIndexes] of [
      [positionBundle1Pubkey, positionBundle1BundleIndexes],
      [positionBundle2Pubkey, positionBundle2BundleIndexes],
    ] as Array<[PublicKey, number[]]>) {
      const bundleData = await fetcher.getPositionBundle(
        bundlePubkey,
        IGNORE_CACHE,
      );
      const bundledPdas = bundleIndexes.map(
        (i) =>
          PDAUtil.getBundledPosition(
            ctx.program.programId,
            bundleData!.positionBundleMint,
            i,
          ).publicKey,
      );
      const bundledFetched = await fetcher.getPositions(
        bundledPdas,
        IGNORE_CACHE,
      );
      const bundledPositions = new Map<number, PositionData>();
      bundledPdas.forEach((pda, idx) => {
        const key = pda.toBase58();
        const val = bundledFetched.get(key);
        if (val) bundledPositions.set(bundleIndexes[idx], val);
      });
      positionBundles.push({
        positionBundleAddress: bundlePubkey,
        positionBundleData: bundleData!,
        bundledPositions,
      });
    }
    const result = { positions, positionsWithTokenExtensions, positionBundles };

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

    const resultDefault = {
      positions,
      positionsWithTokenExtensions,
    };

    assert.ok(resultDefault.positions.size === 5);
    assert.ok(resultDefault.positionsWithTokenExtensions.size === 5);
  });
});
