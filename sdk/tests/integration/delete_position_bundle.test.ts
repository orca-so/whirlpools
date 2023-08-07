import * as anchor from "@coral-xyz/anchor";
import { PDA } from "@orca-so/common-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import { InitPoolParams, POSITION_BUNDLE_SIZE, PositionBundleData, WhirlpoolIx, toTx } from "../../src";
import { WhirlpoolContext } from "../../src/context";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import {
  ONE_SOL,
  TickSpacing,
  approveToken,
  burnToken,
  createAssociatedTokenAccount,
  systemTransferTx,
  transferToken
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool, initializePositionBundle, initializePositionBundleWithMetadata, openBundledPosition } from "../utils/init-utils";

describe("delete_position_bundle", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);


  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tickLowerIndex = 0;
  const tickUpperIndex = 128;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
  });

  function checkBitmapIsOpened(account: PositionBundleData, bundleIndex: number): boolean {
    if (bundleIndex < 0 || bundleIndex >= POSITION_BUNDLE_SIZE) throw Error("bundleIndex is out of bounds");

    const bitmapIndex = Math.floor(bundleIndex / 8);
    const bitmapOffset = bundleIndex % 8;
    return (account.positionBitmap[bitmapIndex] & (1 << bitmapOffset)) > 0;
  }

  it("successfully closes an position bundle, with metadata", async () => {
    // with local-validator, ctx.wallet may have large lamports and it overflows number data type...
    const owner = funderKeypair;

    const positionBundleInfo = await initializePositionBundleWithMetadata(
      ctx,
      owner.publicKey,
      owner
    );

    // PositionBundle account exists
    const prePositionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(prePositionBundle !== null);

    // NFT supply should be 1
    const preSupplyResponse = await provider.connection.getTokenSupply(positionBundleInfo.positionBundleMintKeypair.publicKey);
    assert.equal(preSupplyResponse.value.uiAmount, 1);

    // ATA account exists
    assert.notEqual(await provider.connection.getAccountInfo(positionBundleInfo.positionBundleTokenAccount), undefined);

    // Metadata account exists
    assert.notEqual(await provider.connection.getAccountInfo(positionBundleInfo.positionBundleMetadataPda.publicKey), undefined);

    const preBalance = await provider.connection.getBalance(owner.publicKey, "confirmed");

    const rentPositionBundle = await provider.connection.getBalance(positionBundleInfo.positionBundlePda.publicKey, "confirmed");
    const rentTokenAccount = await provider.connection.getBalance(positionBundleInfo.positionBundleTokenAccount, "confirmed");

    await toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: owner.publicKey,
        receiver: owner.publicKey
      })
    ).addSigner(owner).buildAndExecute();

    const postBalance = await provider.connection.getBalance(owner.publicKey, "confirmed");

    // PositionBundle account should be closed
    const postPositionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(postPositionBundle === null);

    // NFT should be burned and its supply should be 0
    const supplyResponse = await provider.connection.getTokenSupply(positionBundleInfo.positionBundleMintKeypair.publicKey);
    assert.equal(supplyResponse.value.uiAmount, 0);

    // ATA account should be closed
    assert.equal(await provider.connection.getAccountInfo(positionBundleInfo.positionBundleTokenAccount), undefined);

    // Metadata account should NOT be closed
    assert.notEqual(await provider.connection.getAccountInfo(positionBundleInfo.positionBundleMetadataPda.publicKey), undefined);

    // check if rent are refunded
    const diffBalance = postBalance - preBalance;
    const rentTotal = rentPositionBundle + rentTokenAccount;
    assert.equal(diffBalance, rentTotal);
  });

  it("successfully closes an position bundle, without metadata", async () => {
    // with local-validator, ctx.wallet may have large lamports and it overflows number data type...
    const owner = funderKeypair;

    const positionBundleInfo = await initializePositionBundle(
      ctx,
      owner.publicKey,
      owner
    );

    // PositionBundle account exists
    const prePositionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(prePositionBundle !== null);

    // NFT supply should be 1
    const preSupplyResponse = await provider.connection.getTokenSupply(positionBundleInfo.positionBundleMintKeypair.publicKey);
    assert.equal(preSupplyResponse.value.uiAmount, 1);

    // ATA account exists
    assert.notEqual(await provider.connection.getAccountInfo(positionBundleInfo.positionBundleTokenAccount), undefined);

    const preBalance = await provider.connection.getBalance(owner.publicKey, "confirmed");

    const rentPositionBundle = await provider.connection.getBalance(positionBundleInfo.positionBundlePda.publicKey, "confirmed");
    const rentTokenAccount = await provider.connection.getBalance(positionBundleInfo.positionBundleTokenAccount, "confirmed");

    await toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: owner.publicKey,
        receiver: owner.publicKey
      })
    ).addSigner(owner).buildAndExecute();

    const postBalance = await provider.connection.getBalance(owner.publicKey, "confirmed");

    // PositionBundle account should be closed
    const postPositionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(postPositionBundle === null);

    // NFT should be burned and its supply should be 0
    const supplyResponse = await provider.connection.getTokenSupply(positionBundleInfo.positionBundleMintKeypair.publicKey);
    assert.equal(supplyResponse.value.uiAmount, 0);

    // ATA account should be closed
    assert.equal(await provider.connection.getAccountInfo(positionBundleInfo.positionBundleTokenAccount), undefined);

    // check if rent are refunded
    const diffBalance = postBalance - preBalance;
    const rentTotal = rentPositionBundle + rentTokenAccount;
    assert.equal(diffBalance, rentTotal);
  });

  it("successfully closes an position bundle, receiver != owner", async () => {
    const receiver = funderKeypair;

    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const preBalance = await provider.connection.getBalance(receiver.publicKey, "confirmed");

    const rentPositionBundle = await provider.connection.getBalance(positionBundleInfo.positionBundlePda.publicKey, "confirmed");
    const rentTokenAccount = await provider.connection.getBalance(positionBundleInfo.positionBundleTokenAccount, "confirmed");

    await toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: ctx.wallet.publicKey,
        receiver: receiver.publicKey
      })
    ).buildAndExecute();

    const postBalance = await provider.connection.getBalance(receiver.publicKey, "confirmed");

    // check if rent are refunded to receiver
    const diffBalance = postBalance - preBalance;
    const rentTotal = rentPositionBundle + rentTokenAccount;
    assert.equal(diffBalance, rentTotal);
  });

  it("should be failed: position bundle has opened bundled position (bundleIndex = 0)", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const bundleIndex = 0;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const position = await fetcher.getPosition(positionInitInfo.params.bundledPositionPda.publicKey, IGNORE_CACHE);
    assert.equal(position!.tickLowerIndex, tickLowerIndex);
    assert.equal(position!.tickUpperIndex, tickUpperIndex);

    const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    checkBitmapIsOpened(positionBundle!, bundleIndex);

    const tx = toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: ctx.wallet.publicKey,
        receiver: ctx.wallet.publicKey,
      })
    );

    // should be failed
    await assert.rejects(
      tx.buildAndExecute(),
      /0x179e/  // PositionBundleNotDeletable
    );

    // close bundled position
    await toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPda.publicKey,
        bundleIndex,
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    // should be ok
    await tx.buildAndExecute();
    const deleted = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(deleted === null);
  });

  it("should be failed: position bundle has opened bundled position (bundleIndex = POSITION_BUNDLE_SIZE - 1)", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const bundleIndex = POSITION_BUNDLE_SIZE - 1;
    const positionInitInfo = await openBundledPosition(
      ctx,
      whirlpoolPda.publicKey,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      bundleIndex,
      tickLowerIndex,
      tickUpperIndex
    );
    const { bundledPositionPda } = positionInitInfo.params;

    const position = await fetcher.getPosition(positionInitInfo.params.bundledPositionPda.publicKey, IGNORE_CACHE);
    assert.equal(position!.tickLowerIndex, tickLowerIndex);
    assert.equal(position!.tickUpperIndex, tickUpperIndex);

    const positionBundle = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    checkBitmapIsOpened(positionBundle!, bundleIndex);

    const tx = toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: ctx.wallet.publicKey,
        receiver: ctx.wallet.publicKey,
      })
    );

    // should be failed
    await assert.rejects(
      tx.buildAndExecute(),
      /0x179e/  // PositionBundleNotDeletable
    );

    // close bundled position
    await toTx(
      ctx,
      WhirlpoolIx.closeBundledPositionIx(ctx.program, {
        bundledPosition: bundledPositionPda.publicKey,
        bundleIndex,
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleAuthority: ctx.wallet.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        receiver: ctx.wallet.publicKey,
      })
    ).buildAndExecute();

    // should be ok
    await tx.buildAndExecute();
    const deleted = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(deleted === null);
  });

  it("should be failed: only owner can delete position bundle, delegated user cannot", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const delegate = Keypair.generate();
    await approveToken(
      provider,
      positionBundleInfo.positionBundleTokenAccount,
      delegate.publicKey,
      1
    );

    const tx = toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
        owner: delegate.publicKey, // not owner
        receiver: ctx.wallet.publicKey,
      })
    ).addSigner(delegate);

    // should be failed
    await assert.rejects(
      tx.buildAndExecute(),
      /0x7d3/  // ConstraintRaw
    );

    // ownership transfer to delegate
    const delegateTokenAccount = await createAssociatedTokenAccount(
      provider,
      positionBundleInfo.positionBundleMintKeypair.publicKey,
      delegate.publicKey,
      ctx.wallet.publicKey
    );
    await transferToken(
      provider,
      positionBundleInfo.positionBundleTokenAccount,
      delegateTokenAccount,
      1
    );

    const txAfterTransfer = toTx(
      ctx,
      WhirlpoolIx.deletePositionBundleIx(ctx.program, {
        positionBundle: positionBundleInfo.positionBundlePda.publicKey,
        positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleTokenAccount: delegateTokenAccount,
        owner: delegate.publicKey, // now, delegate is owner
        receiver: ctx.wallet.publicKey,
      })
    ).addSigner(delegate);

    await txAfterTransfer.buildAndExecute();
    const deleted = await fetcher.getPositionBundle(positionBundleInfo.positionBundlePda.publicKey, IGNORE_CACHE);
    assert.ok(deleted === null);
  });

  describe("invalid input account", () => {
    it("should be failed: invalid position bundle", async () => {
      const positionBundleInfo1 = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const positionBundleInfo2 = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const tx = toTx(
        ctx,
        WhirlpoolIx.deletePositionBundleIx(ctx.program, {
          positionBundle: positionBundleInfo2.positionBundlePda.publicKey, // invalid
          positionBundleMint: positionBundleInfo1.positionBundleMintKeypair.publicKey,
          positionBundleTokenAccount: positionBundleInfo1.positionBundleTokenAccount,
          owner: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7dc/  // ConstraintAddress
      );
    });

    it("should be failed: invalid position bundle mint", async () => {
      const positionBundleInfo1 = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const positionBundleInfo2 = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const tx = toTx(
        ctx,
        WhirlpoolIx.deletePositionBundleIx(ctx.program, {
          positionBundle: positionBundleInfo1.positionBundlePda.publicKey,
          positionBundleMint: positionBundleInfo2.positionBundleMintKeypair.publicKey, // invalid
          positionBundleTokenAccount: positionBundleInfo1.positionBundleTokenAccount,
          owner: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7dc/  // ConstraintAddress
      );
    });

    it("should be failed: invalid ATA (amount is zero)", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      await burnToken(ctx.provider, positionBundleInfo.positionBundleTokenAccount, positionBundleInfo.positionBundleMintKeypair.publicKey, 1);

      const tokenAccount = await fetcher.getTokenInfo(positionBundleInfo.positionBundleTokenAccount);
      assert.equal(tokenAccount!.amount.toString(), "0");

      const tx = toTx(
        ctx,
        WhirlpoolIx.deletePositionBundleIx(ctx.program, {
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount, // amount = 0
          owner: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/  // ConstraintRaw
      );
    });

    it("should be failed: invalid ATA (invalid mint)", async () => {
      const positionBundleInfo1 = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );
      const positionBundleInfo2 = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const tx = toTx(
        ctx,
        WhirlpoolIx.deletePositionBundleIx(ctx.program, {
          positionBundle: positionBundleInfo1.positionBundlePda.publicKey,
          positionBundleMint: positionBundleInfo1.positionBundleMintKeypair.publicKey,
          positionBundleTokenAccount: positionBundleInfo2.positionBundleTokenAccount, // invalid,
          owner: ctx.wallet.publicKey,
          receiver: ctx.wallet.publicKey,
        })
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/  // ConstraintRaw
      );
    });

    it("should be failed: invalid ATA (invalid owner), invalid owner", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const otherWallet = Keypair.generate();
      const tx = toTx(
        ctx,
        WhirlpoolIx.deletePositionBundleIx(ctx.program, {
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount, // ata.owner != owner
          owner: otherWallet.publicKey,
          receiver: ctx.wallet.publicKey,
        })
      ).addSigner(otherWallet);

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d3/  // ConstraintRaw
      );
    });

    it("should be failed: invalid token program", async () => {
      const positionBundleInfo = await initializePositionBundle(
        ctx,
        ctx.wallet.publicKey,
      );

      const ix = program.instruction.deletePositionBundle({
        accounts: {
          positionBundle: positionBundleInfo.positionBundlePda.publicKey,
          positionBundleMint: positionBundleInfo.positionBundleMintKeypair.publicKey,
          positionBundleTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          positionBundleOwner: ctx.wallet.publicKey,
          tokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, // invalid
          receiver: ctx.wallet.publicKey,
        }
      });

      const tx = toTx(
        ctx,
        {
          instructions: [ix],
          cleanupInstructions: [],
          signers: [],
        }
      );

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });
  });

});
