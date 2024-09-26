import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getExtensionData,
  getExtensionTypes,
  getMetadataPointerState,
  getMintCloseAuthority,
  getTokenMetadata,
} from "@solana/spl-token";
import { TokenMetadata, unpack as unpackTokenMetadata } from '@solana/spl-token-metadata';
import { Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import type {
  InitPoolParams,
  OpenPositionParams,
  OpenPositionWithMetadataBumpsData,
  PositionData,
} from "../../src";
import {
  IGNORE_CACHE,
  MAX_TICK_INDEX,
  METADATA_PROGRAM_ADDRESS,
  MIN_TICK_INDEX,
  PDAUtil,
  TickUtil,
  WHIRLPOOL_NFT_UPDATE_AUTH,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx,
} from "../../src";
import { openPositionAccounts } from "../../src/utils/instructions-util";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  createMint,
  createMintInstructions,
  mintToDestination,
  systemTransferTx,
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool, openPositionWithMetadata } from "../utils/init-utils";
import { generateDefaultOpenPositionWithTokenExtensionsParams, generateDefaultOpenPositionParams } from "../utils/test-builders";
import { OpenPositionWithTokenExtensionsParams } from "../../src/instructions";

describe("open_position_with_token_extensions", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const tickLowerIndex = 0;
  const tickUpperIndex = 11392;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();
  });

  function checkMetadata(
    tokenMetadata: TokenMetadata,
    positionMint: PublicKey,
  ) {
    const WP_2022_METADATA_NAME_PREFIX = "OWP";
    const WP_2022_METADATA_SYMBOL = "OWP";
    const WP_2022_METADATA_URI = "https://arweave.net/E19ZNY2sqMqddm1Wx7mrXPUZ0ZZ5ISizhebb0UsVEws";

    const mintAddress = positionMint.toBase58();
    const name =
      WP_2022_METADATA_NAME_PREFIX +
      " " +
      mintAddress.slice(0, 4) +
      "..." +
      mintAddress.slice(-4);

    assert.ok(tokenMetadata.mint.equals(positionMint));
    assert.ok(tokenMetadata.name === name);
    assert.ok(tokenMetadata.symbol === WP_2022_METADATA_SYMBOL);
    assert.ok(tokenMetadata.uri === WP_2022_METADATA_URI);
    assert.ok(!!tokenMetadata.updateAuthority);
    assert.ok(tokenMetadata.updateAuthority.equals(WHIRLPOOL_NFT_UPDATE_AUTH));
    assert.ok(tokenMetadata.additionalMetadata.length === 0); // no additional metadata
  }

  async function checkMintState(
    positionMint: PublicKey,
    withTokenMetadataExtension: boolean,
  ) {
    const positionPda = PDAUtil.getPosition(ctx.program.programId, positionMint);

    const mint = await fetcher.getMintInfo(positionMint, IGNORE_CACHE);

    assert.ok(mint !== null);
    assert.ok(mint.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));
    assert.ok(mint.freezeAuthority === null);
    assert.ok(mint.mintAuthority === null); // should be removed
    assert.ok(mint.decimals === 0); // NFT
    assert.ok(mint.supply === 1n); // NFT

    // check initialized extensions
    const initializedExtensions = getExtensionTypes(mint.tlvData);
    assert.ok(initializedExtensions.length >= 1);

    // check MintCloseAuthority extension
    // - closeAuthority = position (PDA)
    assert.ok(initializedExtensions.includes(ExtensionType.MintCloseAuthority));
    const mintCloseAuthority = getMintCloseAuthority(mint);
    assert.ok(mintCloseAuthority !== null);
    assert.ok(mintCloseAuthority.closeAuthority.equals(positionPda.publicKey));

    if (!withTokenMetadataExtension) {
      // no more extension
      assert.ok(initializedExtensions.length === 1);
    } else {
      // additional 2 extensions
      assert.ok(initializedExtensions.includes(ExtensionType.MetadataPointer));
      assert.ok(initializedExtensions.includes(ExtensionType.TokenMetadata));
      assert.ok(initializedExtensions.length === 3);

      // check MetadataPointer extension
      // - metadataAddress = mint itself
      // - authority = null
      const metadataPointer = getMetadataPointerState(mint);
      assert.ok(metadataPointer !== null);
      assert.ok(!!metadataPointer.metadataAddress);
      assert.ok(metadataPointer.metadataAddress.equals(positionMint));
      assert.ok(!metadataPointer.authority);

      // check TokenMetadata extension
      const tokenMetadata = (() => {
        const data = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
        if (data === null) return null;
        return unpackTokenMetadata(data);
      })();
      assert.ok(tokenMetadata !== null);
      checkMetadata(tokenMetadata, positionMint);
    }
  }

  async function checkTokenAccountState(
    positionTokenAccount: PublicKey,
    positionMint: PublicKey,
    owner: PublicKey,
  ) {
    const tokenAccount = await fetcher.getTokenInfo(positionTokenAccount, IGNORE_CACHE);

    assert.ok(tokenAccount !== null);
    assert.ok(tokenAccount.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));
    assert.ok(tokenAccount.isInitialized);
    assert.ok(!tokenAccount.isFrozen);
    assert.ok(tokenAccount.mint.equals(positionMint));
    assert.ok(tokenAccount.owner.equals(owner));
    assert.ok(tokenAccount.amount === 1n);
    assert.ok(tokenAccount.delegate === null);

    // ATA requires ImmutableOwner extension
    const initializedExtensions = getExtensionTypes(tokenAccount.tlvData);
    assert.ok(initializedExtensions.length === 1);
    assert.ok(initializedExtensions.includes(ExtensionType.ImmutableOwner));
  }

  async function checkInitialPositionState(
    positionAddress: PublicKey,
    tickLowerIndex: number,
    tickUpperIndex: number,
    whirlpoolAddress: PublicKey,
    positionMintAddress: PublicKey,
  ) {
    const position = (await fetcher.getPosition(
      positionAddress,
    )) as PositionData;
    assert.strictEqual(position.tickLowerIndex, tickLowerIndex);
    assert.strictEqual(position.tickUpperIndex, tickUpperIndex);
    assert.ok(position.whirlpool.equals(whirlpoolAddress));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));
  }

  it("successfully opens position with metadata and verify position address contents", async () => {
    const withTokenMetadataExtension = true;

    // open position
    const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
      ctx,
      whirlpoolPda.publicKey,
      withTokenMetadataExtension,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    ).addSigner(mint).buildAndExecute();

    // check Mint state (with metadata)
    await checkMintState(params.positionMint, withTokenMetadataExtension);

    // check TokenAccount state
    await checkTokenAccountState(
      params.positionTokenAccount,
      params.positionMint,
      params.owner,
    );

    // check Position state
    await checkInitialPositionState(
      params.positionPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      whirlpoolPda.publicKey,
      mint.publicKey,
    );
  });

  it("successfully opens position without metadata and verify position address contents", async () => {
    const withTokenMetadataExtension = false;

    // open position
    const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
      ctx,
      whirlpoolPda.publicKey,
      withTokenMetadataExtension,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    ).addSigner(mint).buildAndExecute();

    // check Mint state (with metadata)
    await checkMintState(params.positionMint, withTokenMetadataExtension);

    // check TokenAccount state
    await checkTokenAccountState(
      params.positionTokenAccount,
      params.positionMint,
      params.owner,
    );

    // check Position state
    await checkInitialPositionState(
      params.positionPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      whirlpoolPda.publicKey,
      mint.publicKey,
    );
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const { params } = await openPositionWithMetadata(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
      funderKeypair,
    );

    await checkMetadata(params.metadataPda, params.positionMintAddress);
  });

  it("open position & verify position mint behavior", async () => {
    const newOwner = web3.Keypair.generate();

    const positionInitInfo = await openPositionWithMetadata(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      newOwner.publicKey,
    );
    const {
      metadataPda,
      positionMintAddress,
      positionTokenAccount: positionTokenAccountAddress,
    } = positionInitInfo.params;

    await checkMetadata(metadataPda, positionMintAddress);

    const userTokenAccount = await getAccount(
      ctx.connection,
      positionTokenAccountAddress,
    );
    assert.ok(userTokenAccount.amount === 1n);
    assert.ok(userTokenAccount.owner.equals(newOwner.publicKey));

    await assert.rejects(
      mintToDestination(
        provider,
        positionMintAddress,
        positionTokenAccountAddress,
        1,
      ),
      /0x5/, // the total supply of this token is fixed
    );
  });

  it("user must pass the valid token ATA account", async () => {
    const anotherMintKey = await createMint(
      provider,
      provider.wallet.publicKey,
    );
    const positionTokenAccountAddress = getAssociatedTokenAddressSync(
      anotherMintKey,
      provider.wallet.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionWithMetadataIx(ctx.program, {
          ...defaultParams,
          positionTokenAccount: positionTokenAccountAddress,
        }),
      )
        .addSigner(defaultMint)
        .buildAndExecute(),
      /An account required by the instruction is missing/,
    );
  });

  describe("invalid ticks", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      await assert.rejects(
        openPositionWithMetadata(
          ctx,
          whirlpoolPda.publicKey,
          lowerTick,
          upperTick,
          provider.wallet.publicKey,
          funderKeypair,
        ),
        /0x177a/, // InvalidTickIndex
      );
    }

    it("fail when user pass in an out of bound tick index for upper-index", async () => {
      await assertTicksFail(0, MAX_TICK_INDEX + 1);
    });

    it("fail when user pass in a lower tick index that is higher than the upper-index", async () => {
      await assertTicksFail(-22534, -22534 - 1);
    });

    it("fail when user pass in a lower tick index that equals the upper-index", async () => {
      await assertTicksFail(22365, 22365);
    });

    it("fail when user pass in an out of bound tick index for lower-index", async () => {
      await assertTicksFail(MIN_TICK_INDEX - 1, 0);
    });

    it("fail when user pass in a non-initializable tick index for upper-index", async () => {
      await assertTicksFail(0, 1);
    });

    it("fail when user pass in a non-initializable tick index for lower-index", async () => {
      await assertTicksFail(1, 2);
    });
  });

  it("fail when position mint already exists", async () => {
    const positionMintKeypair = anchor.web3.Keypair.generate();
    const positionPda = PDAUtil.getPosition(
      ctx.program.programId,
      positionMintKeypair.publicKey,
    );
    const metadataPda = PDAUtil.getPositionMetadata(
      positionMintKeypair.publicKey,
    );

    const positionTokenAccountAddress = getAssociatedTokenAddressSync(
      positionMintKeypair.publicKey,
      provider.wallet.publicKey,
    );

    const tx = new web3.Transaction();
    tx.add(
      ...(await createMintInstructions(
        provider,
        provider.wallet.publicKey,
        positionMintKeypair.publicKey,
      )),
    );

    await provider.sendAndConfirm(tx, [positionMintKeypair], {
      commitment: "confirmed",
    });

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionWithMetadataIx(ctx.program, {
          ...defaultParams,
          positionPda,
          metadataPda,
          positionMintAddress: positionMintKeypair.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
          whirlpool: whirlpoolPda.publicKey,
          tickLowerIndex,
          tickUpperIndex,
        }),
      )
        .addSigner(positionMintKeypair)
        .buildAndExecute(),
      /0x0/,
    );
  });

  describe("invalid account constraints", () => {
    function buildOpenWithAccountOverrides(
      overrides: Partial<
        ReturnType<typeof openPositionAccounts> & {
          positionMetadataAccount: PublicKey;
          metadataProgram: PublicKey;
          metadataUpdateAuth: PublicKey;
        }
      >,
    ) {
      const { positionPda, metadataPda, tickLowerIndex, tickUpperIndex } =
        defaultParams;

      const bumps: OpenPositionWithMetadataBumpsData = {
        positionBump: positionPda.bump,
        metadataBump: metadataPda.bump,
      };

      const ix = ctx.program.instruction.openPositionWithMetadata(
        bumps,
        tickLowerIndex,
        tickUpperIndex,
        {
          accounts: {
            ...openPositionAccounts(defaultParams),
            positionMetadataAccount: metadataPda.publicKey,
            metadataProgram: METADATA_PROGRAM_ADDRESS,
            metadataUpdateAuth: new PublicKey(
              "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr",
            ),
            ...overrides,
          },
        },
      );

      return {
        instructions: [ix],
        cleanupInstructions: [],
        signers: [],
      };
    }

    it("fails with non-mint metadataPda", async () => {
      const notMintKeypair = Keypair.generate();
      const invalidParams = {
        ...defaultParams,
        metadataPda: PDAUtil.getPositionMetadata(notMintKeypair.publicKey),
      };

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithMetadataIx(ctx.program, invalidParams),
        )
          .addSigner(defaultMint)
          .buildAndExecute(),
        // Invalid Metadata Key
        // https://github.com/metaplex-foundation/metaplex-program-library/blob/master/token-metadata/program/src/error.rs#L36
        /0x5/,
      );
    });

    it("fails with non-program metadata program", async () => {
      const notMetadataProgram = Keypair.generate();
      const tx = new TransactionBuilder(
        ctx.provider.connection,
        ctx.wallet,
        ctx.txBuilderOpts,
      ).addInstruction(
        buildOpenWithAccountOverrides({
          metadataProgram: notMetadataProgram.publicKey,
        }),
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // InvalidProgramId
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L180
        /0xbc0/,
      );
    });

    it("fails with non-metadata program ", async () => {
      const tx = new TransactionBuilder(
        ctx.provider.connection,
        ctx.wallet,
        ctx.txBuilderOpts,
      ).addInstruction(
        buildOpenWithAccountOverrides({
          metadataProgram: TOKEN_PROGRAM_ID,
        }),
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // InvalidProgramId
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L180
        /0xbc0/,
      );
    });

    it("fails with non-valid update_authority program", async () => {
      const notUpdateAuth = Keypair.generate();
      const tx = new TransactionBuilder(
        ctx.provider.connection,
        ctx.wallet,
        ctx.txBuilderOpts,
      ).addInstruction(
        buildOpenWithAccountOverrides({
          metadataUpdateAuth: notUpdateAuth.publicKey,
        }),
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // AddressConstraint
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L84
        /0x7dc/,
      );
    });
  });

  it("fail when opening a non-full range position in an full-range only pool", async () => {
    await assert.rejects(
      openPositionWithMetadata(
        ctx,
        fullRangeOnlyWhirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
        funderKeypair,
      ),
      /0x17a6/, // FullRangeOnlyPool
    );
  });
});
