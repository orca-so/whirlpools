import * as anchor from "@coral-xyz/anchor";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { PDA } from "@orca-so/common-sdk";
import {
  Account,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  Mint,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import {
  METADATA_PROGRAM_ADDRESS,
  PDAUtil,
  POSITION_BUNDLE_SIZE,
  PositionBundleData,
  toTx,
  WHIRLPOOL_NFT_UPDATE_AUTH,
  WhirlpoolContext,
} from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/account-fetcher";
import {
  createMintInstructions,
  mintToDestination
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initializePositionBundleWithMetadata } from "../utils/init-utils";

describe("initialize_position_bundle_with_metadata", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);

  async function createInitializePositionBundleWithMetadataTx(
    ctx: WhirlpoolContext,
    overwrite: any,
    mintKeypair?: Keypair
  ) {
    const positionBundleMintKeypair = mintKeypair ?? Keypair.generate();
    const positionBundlePda = PDAUtil.getPositionBundle(
      ctx.program.programId,
      positionBundleMintKeypair.publicKey
    );
    const positionBundleMetadataPda = PDAUtil.getPositionBundleMetadata(
      positionBundleMintKeypair.publicKey
    );
    const positionBundleTokenAccount = getAssociatedTokenAddressSync(
      positionBundleMintKeypair.publicKey,
      ctx.wallet.publicKey
    );

    const defaultAccounts = {
      positionBundle: positionBundlePda.publicKey,
      positionBundleMint: positionBundleMintKeypair.publicKey,
      positionBundleMetadata: positionBundleMetadataPda.publicKey,
      positionBundleTokenAccount,
      positionBundleOwner: ctx.wallet.publicKey,
      funder: ctx.wallet.publicKey,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      metadataProgram: METADATA_PROGRAM_ADDRESS,
      metadataUpdateAuth: WHIRLPOOL_NFT_UPDATE_AUTH,
    };

    const ix = program.instruction.initializePositionBundleWithMetadata({
      accounts: {
        ...defaultAccounts,
        ...overwrite,
      },
    });

    return toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [positionBundleMintKeypair],
    });
  }

  async function checkPositionBundleMint(positionBundleMintPubkey: PublicKey) {
    // verify position bundle Mint account
    const positionBundleMint = (await ctx.fetcher.getMintInfo(
      positionBundleMintPubkey,
      IGNORE_CACHE
    )) as Mint;
    // should have NFT characteristics
    assert.strictEqual(positionBundleMint.decimals, 0);
    assert.ok(positionBundleMint.supply === 1n);
    // mint auth & freeze auth should be set to None
    assert.ok(positionBundleMint.mintAuthority === null);
    assert.ok(positionBundleMint.freezeAuthority === null);
  }

  async function checkPositionBundleTokenAccount(
    positionBundleTokenAccountPubkey: PublicKey,
    owner: PublicKey,
    positionBundleMintPubkey: PublicKey
  ) {
    // verify position bundle Token account
    const positionBundleTokenAccount = (await ctx.fetcher.getTokenInfo(
      positionBundleTokenAccountPubkey,
      IGNORE_CACHE
    )) as Account;
    assert.ok(positionBundleTokenAccount.amount === 1n);
    assert.ok(positionBundleTokenAccount.mint.equals(positionBundleMintPubkey));
    assert.ok(positionBundleTokenAccount.owner.equals(owner));
  }

  async function checkPositionBundle(
    positionBundlePubkey: PublicKey,
    positionBundleMintPubkey: PublicKey
  ) {
    // verify PositionBundle account
    const positionBundle = (await ctx.fetcher.getPositionBundle(
      positionBundlePubkey,
      IGNORE_CACHE
    )) as PositionBundleData;
    assert.ok(positionBundle.positionBundleMint.equals(positionBundleMintPubkey));
    assert.strictEqual(positionBundle.positionBitmap.length * 8, POSITION_BUNDLE_SIZE);
    for (const bitmap of positionBundle.positionBitmap) {
      assert.strictEqual(bitmap, 0);
    }
  }

  async function checkPositionBundleMetadata(metadataPda: PDA, positionMint: PublicKey) {
    const WPB_METADATA_NAME_PREFIX = "Orca Position Bundle";
    const WPB_METADATA_SYMBOL = "OPB";
    const WPB_METADATA_URI = "https://arweave.net/A_Wo8dx2_3lSUwMIi7bdT_sqxi8soghRNAWXXiqXpgE";

    const mintAddress = positionMint.toBase58();
    const nftName =
      WPB_METADATA_NAME_PREFIX + " " + mintAddress.slice(0, 4) + "..." + mintAddress.slice(-4);

    assert.ok(metadataPda != null);
    const metadata = await Metadata.fromAccountAddress(provider.connection, metadataPda.publicKey);
    assert.ok(metadata.mint.toBase58() === positionMint.toString());
    assert.ok(metadata.updateAuthority.toBase58() === WHIRLPOOL_NFT_UPDATE_AUTH.toBase58());
    assert.ok(metadata.isMutable);
    assert.strictEqual(metadata.data.name.replace(/\0/g, ''), nftName);
    assert.strictEqual(metadata.data.symbol.replace(/\0/g, ''), WPB_METADATA_SYMBOL);
    assert.strictEqual(metadata.data.uri.replace(/\0/g, ''), WPB_METADATA_URI);
  }

  async function createOtherWallet(): Promise<Keypair> {
    const keypair = Keypair.generate();
    const signature = await provider.connection.requestAirdrop(
      keypair.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
    return keypair;
  }

  it("successfully initialize position bundle and verify initialized account contents", async () => {
    const positionBundleInfo = await initializePositionBundleWithMetadata(
      ctx,
      ctx.wallet.publicKey
      // funder = ctx.wallet.publicKey
    );

    const {
      positionBundleMintKeypair,
      positionBundlePda,
      positionBundleMetadataPda,
      positionBundleTokenAccount,
    } = positionBundleInfo;

    await checkPositionBundleMint(positionBundleMintKeypair.publicKey);
    await checkPositionBundleTokenAccount(
      positionBundleTokenAccount,
      ctx.wallet.publicKey,
      positionBundleMintKeypair.publicKey
    );
    await checkPositionBundle(positionBundlePda.publicKey, positionBundleMintKeypair.publicKey);
    await checkPositionBundleMetadata(
      positionBundleMetadataPda,
      positionBundleMintKeypair.publicKey
    );
  });

  it("successfully initialize when funder is different than account paying for transaction fee", async () => {
    const preBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);

    const otherWallet = await createOtherWallet();
    const positionBundleInfo = await initializePositionBundleWithMetadata(
      ctx,
      ctx.wallet.publicKey,
      otherWallet
    );

    const postBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const diffBalance = preBalance - postBalance;
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(0);
    assert.ok(diffBalance < minRent); // ctx.wallet didn't pay any rent

    const {
      positionBundleMintKeypair,
      positionBundlePda,
      positionBundleMetadataPda,
      positionBundleTokenAccount,
    } = positionBundleInfo;

    await checkPositionBundleMint(positionBundleMintKeypair.publicKey);
    await checkPositionBundleTokenAccount(
      positionBundleTokenAccount,
      ctx.wallet.publicKey,
      positionBundleMintKeypair.publicKey
    );
    await checkPositionBundle(positionBundlePda.publicKey, positionBundleMintKeypair.publicKey);
    await checkPositionBundleMetadata(
      positionBundleMetadataPda,
      positionBundleMintKeypair.publicKey
    );
  });

  it("PositionBundle account has reserved space", async () => {
    const positionBundleAccountSizeIncludingReserve = 8 + 32 + 32 + 64;

    const positionBundleInfo = await initializePositionBundleWithMetadata(
      ctx,
      ctx.wallet.publicKey
    );

    const account = await ctx.connection.getAccountInfo(
      positionBundleInfo.positionBundlePda.publicKey,
      "confirmed"
    );
    assert.equal(account!.data.length, positionBundleAccountSizeIncludingReserve);
  });

  it("should be failed: cannot mint additional NFT by owner", async () => {
    const positionBundleInfo = await initializePositionBundleWithMetadata(
      ctx,
      ctx.wallet.publicKey
    );

    await assert.rejects(
      mintToDestination(provider, positionBundleInfo.positionBundleMintKeypair.publicKey, positionBundleInfo.positionBundleTokenAccount, 1),
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
      signers: [positionBundleMintKeypair],
    });
    await createMintTx.buildAndExecute();

    const tx = await createInitializePositionBundleWithMetadataTx(
      ctx,
      {},
      positionBundleMintKeypair
    );
    await assert.rejects(tx.buildAndExecute(), (err) => {
      return JSON.stringify(err).includes("already in use");
    });
  });

  describe("invalid input account", () => {
    it("should be failed: invalid position bundle address", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        positionBundle: PDAUtil.getPositionBundle(
          ctx.program.programId,
          Keypair.generate().publicKey
        ).publicKey,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("should be failed: invalid metadata address", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        positionBundleMetadata: PDAUtil.getPositionBundleMetadata(Keypair.generate().publicKey)
          .publicKey,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0x5/ // InvalidMetadataKey: cannot create Metadata
      );
    });

    it("should be failed: invalid ATA address", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        positionBundleTokenAccount: getAssociatedTokenAddressSync(
          Keypair.generate().publicKey,
          ctx.wallet.publicKey
        ),
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /An account required by the instruction is missing/ // Anchor cannot create derived ATA
      );
    });

    it("should be failed: invalid update auth", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        metadataUpdateAuth: Keypair.generate().publicKey,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });

    it("should be failed: invalid token program", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        tokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("should be failed: invalid system program", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        systemProgram: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("should be failed: invalid rent sysvar", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        rent: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc7/ // AccountSysvarMismatch
      );
    });

    it("should be failed: invalid associated token program", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        associatedTokenProgram: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("should be failed: invalid metadata program", async () => {
      const tx = await createInitializePositionBundleWithMetadataTx(ctx, {
        // invalid parameter
        metadataProgram: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });
  });
});
