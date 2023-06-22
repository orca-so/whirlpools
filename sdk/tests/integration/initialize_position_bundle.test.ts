import * as anchor from "@coral-xyz/anchor";
import { Account, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, Mint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import {
  PDAUtil,
  POSITION_BUNDLE_SIZE,
  PositionBundleData,
  toTx,
  WhirlpoolContext
} from "../../src";
import { PREFER_REFRESH } from "../../src/network/public/account-cache";
import {
  createMintInstructions,
  mintToDestination
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initializePositionBundle } from "../utils/init-utils";

describe("initialize_position_bundle", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);


  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  async function createInitializePositionBundleTx(ctx: WhirlpoolContext, overwrite: any, mintKeypair?: Keypair) {
    const positionBundleMintKeypair = mintKeypair ?? Keypair.generate();
    const positionBundlePda = PDAUtil.getPositionBundle(ctx.program.programId, positionBundleMintKeypair.publicKey);
    const positionBundleTokenAccount = getAssociatedTokenAddressSync(positionBundleMintKeypair.publicKey, ctx.wallet.publicKey);

    const defaultAccounts = {
      positionBundle: positionBundlePda.publicKey,
      positionBundleMint: positionBundleMintKeypair.publicKey,
      positionBundleTokenAccount,
      positionBundleOwner: ctx.wallet.publicKey,
      funder: ctx.wallet.publicKey,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    };

    const ix = program.instruction.initializePositionBundle({
      accounts: {
        ...defaultAccounts,
        ...overwrite,
      }
    });

    return toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [positionBundleMintKeypair],
    });
  }

  async function checkPositionBundleMint(positionBundleMintPubkey: PublicKey) {
    // verify position bundle Mint account
    const positionBundleMint = (await ctx.fetcher.getMintInfo(positionBundleMintPubkey, PREFER_REFRESH)) as Mint;
    // should have NFT characteristics
    assert.strictEqual(positionBundleMint.decimals, 0);
    assert.ok(positionBundleMint.supply === 1n);
    // mint auth & freeze auth should be set to None
    assert.ok(positionBundleMint.mintAuthority === null);
    assert.ok(positionBundleMint.freezeAuthority === null);
  }

  async function checkPositionBundleTokenAccount(positionBundleTokenAccountPubkey: PublicKey, owner: PublicKey, positionBundleMintPubkey: PublicKey) {
    // verify position bundle Token account
    const positionBundleTokenAccount = (await ctx.fetcher.getTokenInfo(positionBundleTokenAccountPubkey, PREFER_REFRESH)) as Account;
    assert.ok(positionBundleTokenAccount.amount === 1n);
    assert.ok(positionBundleTokenAccount.mint.equals(positionBundleMintPubkey));
    assert.ok(positionBundleTokenAccount.owner.equals(owner));
  }

  async function checkPositionBundle(positionBundlePubkey: PublicKey, positionBundleMintPubkey: PublicKey) {
    // verify PositionBundle account
    const positionBundle = (await ctx.fetcher.getPositionBundle(positionBundlePubkey, PREFER_REFRESH)) as PositionBundleData;
    assert.ok(positionBundle.positionBundleMint.equals(positionBundleMintPubkey));
    assert.strictEqual(positionBundle.positionBitmap.length * 8, POSITION_BUNDLE_SIZE);
    for (const bitmap of positionBundle.positionBitmap) {
      assert.strictEqual(bitmap, 0);
    }
  }

  async function createOtherWallet(): Promise<Keypair> {
    const keypair = Keypair.generate();
    const signature = await provider.connection.requestAirdrop(keypair.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(signature, "confirmed");
    return keypair;
  }

  it("successfully initialize position bundle and verify initialized account contents", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
      // funder = ctx.wallet.publicKey
    );

    const {
      positionBundleMintKeypair,
      positionBundlePda,
      positionBundleTokenAccount,
    } = positionBundleInfo;

    await checkPositionBundleMint(positionBundleMintKeypair.publicKey);
    await checkPositionBundleTokenAccount(positionBundleTokenAccount, ctx.wallet.publicKey, positionBundleMintKeypair.publicKey);
    await checkPositionBundle(positionBundlePda.publicKey, positionBundleMintKeypair.publicKey);
  });

  it("successfully initialize when funder is different than account paying for transaction fee", async () => {
    const preBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);

    const otherWallet = await createOtherWallet();
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
      otherWallet,
    );

    const postBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const diffBalance = preBalance - postBalance;
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(0);
    assert.ok(diffBalance < minRent); // ctx.wallet didn't pay any rent

    const {
      positionBundleMintKeypair,
      positionBundlePda,
      positionBundleTokenAccount,
    } = positionBundleInfo;

    await checkPositionBundleMint(positionBundleMintKeypair.publicKey);
    await checkPositionBundleTokenAccount(positionBundleTokenAccount, ctx.wallet.publicKey, positionBundleMintKeypair.publicKey);
    await checkPositionBundle(positionBundlePda.publicKey, positionBundleMintKeypair.publicKey);
  });

  it("PositionBundle account has reserved space", async () => {
    const positionBundleAccountSizeIncludingReserve = 8 + 32 + 32 + 64;

    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    const account = await ctx.connection.getAccountInfo(positionBundleInfo.positionBundlePda.publicKey, "confirmed");
    assert.equal(account!.data.length, positionBundleAccountSizeIncludingReserve);
  });

  it("should be failed: cannot mint additional NFT by owner", async () => {
    const positionBundleInfo = await initializePositionBundle(
      ctx,
      ctx.wallet.publicKey,
    );

    await assert.rejects(
      mintToDestination(
        provider,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        positionBundleInfo.positionBundleTokenAccount,
        1
      ),
      /0x5/ // the total supply of this token is fixed
    );
  });

  it("should be failed: already used mint is passed as position bundle mint", async () => {
    const positionBundleMintKeypair = Keypair.generate();

    // create mint
    const createMintIx = await createMintInstructions(
      provider,
      ctx.wallet.publicKey,
      positionBundleMintKeypair.publicKey
    );
    const createMintTx = toTx(ctx, {
      instructions: createMintIx,
      cleanupInstructions: [],
      signers: [positionBundleMintKeypair]
    });
    await createMintTx.buildAndExecute();

    const tx = await createInitializePositionBundleTx(ctx, {}, positionBundleMintKeypair);
    await assert.rejects(
      tx.buildAndExecute(),
      (err) => { return JSON.stringify(err).includes("already in use") }
    );
  });

  describe("invalid input account", () => {
    it("should be failed: invalid position bundle address", async () => {
      const tx = await createInitializePositionBundleTx(ctx, {
        // invalid parameter
        positionBundle: PDAUtil.getPositionBundle(ctx.program.programId, Keypair.generate().publicKey).publicKey,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("should be failed: invalid ATA address", async () => {
      const tx = await createInitializePositionBundleTx(ctx, {
        // invalid parameter
        positionBundleTokenAccount: getAssociatedTokenAddressSync(Keypair.generate().publicKey, ctx.wallet.publicKey),
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /An account required by the instruction is missing/ // Anchor cannot create derived ATA
      );
    });

    it("should be failed: invalid token program", async () => {
      const tx = await createInitializePositionBundleTx(ctx, {
        // invalid parameter
        tokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("should be failed: invalid system program", async () => {
      const tx = await createInitializePositionBundleTx(ctx, {
        // invalid parameter
        systemProgram: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("should be failed: invalid rent sysvar", async () => {
      const tx = await createInitializePositionBundleTx(ctx, {
        // invalid parameter
        rent: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc7/ // AccountSysvarMismatch
      );
    });

    it("should be failed: invalid associated token program", async () => {
      const tx = await createInitializePositionBundleTx(ctx, {
        // invalid parameter
        associatedTokenProgram: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });
  });
});
