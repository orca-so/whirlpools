import * as anchor from "@coral-xyz/anchor";
import type { PDA } from "@orca-so/common-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getExtensionData,
  getExtensionTypes,
  getMetadataPointerState,
  getMintCloseAuthority,
  createMint,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { unpack as unpackTokenMetadata } from '@solana/spl-token-metadata';
import type { TokenMetadata } from '@solana/spl-token-metadata';
import { Keypair, SystemProgram } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import type {
  InitPoolParams,
  PositionData,
} from "../../src";
import {
  IGNORE_CACHE,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  PDAUtil,
  WHIRLPOOL_NFT_UPDATE_AUTH,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx,
} from "../../src";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  systemTransferTx,
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool } from "../utils/init-utils";
import { generateDefaultOpenPositionWithTokenExtensionsParams } from "../utils/test-builders";
import type { OpenPositionWithTokenExtensionsParams } from "../../src/instructions";
import { useMaxCU } from "../utils/v2/init-utils-v2";

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

  beforeAll(async () => {
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
    poolAddress: PublicKey,
    positionAddress: PublicKey,
  ) {
    const WP_2022_METADATA_NAME_PREFIX = "OWP";
    const WP_2022_METADATA_SYMBOL = "OWP";
    const WP_2022_METADATA_URI_BASE = "https://position-nft.orca.so/meta";

    const mintAddress = positionMint.toBase58();
    const name =
      WP_2022_METADATA_NAME_PREFIX +
      " " +
      mintAddress.slice(0, 4) +
      "..." +
      mintAddress.slice(-4);

    const uri =
      WP_2022_METADATA_URI_BASE +
      "/" +
      poolAddress.toBase58() +
      "/" +
      positionAddress.toBase58();

    assert.ok(tokenMetadata.mint.equals(positionMint));
    assert.ok(tokenMetadata.name === name);
    assert.ok(tokenMetadata.symbol === WP_2022_METADATA_SYMBOL);
    assert.ok(tokenMetadata.uri === uri);
    assert.ok(!!tokenMetadata.updateAuthority);
    assert.ok(tokenMetadata.updateAuthority.equals(WHIRLPOOL_NFT_UPDATE_AUTH));
    assert.ok(tokenMetadata.additionalMetadata.length === 0); // no additional metadata
  }

  async function checkMintState(
    positionMint: PublicKey,
    withTokenMetadataExtension: boolean,
    poolAddress: PublicKey,
  ) {
    const positionPda = PDAUtil.getPosition(ctx.program.programId, positionMint);

    const mint = await fetcher.getMintInfo(positionMint, IGNORE_CACHE);

    assert.ok(mint !== null);
    assert.ok(mint.tokenProgram.equals(TOKEN_2022_PROGRAM_ID));

    // freeze authority: reserved for future improvements
    assert.ok(mint.freezeAuthority !== null);
    assert.ok(mint.freezeAuthority.equals(positionPda.publicKey));
    // mint authority: should be removed
    assert.ok(mint.mintAuthority === null);

    assert.ok(mint.decimals === 0); // NFT
    assert.ok(mint.supply === 1n); // NFT

    // rent should be necessary and sufficient
    const mintAccount = await ctx.connection.getAccountInfo(positionMint);
    assert.ok(mintAccount !== null);
    const dataLength = mintAccount.data.length;
    const rentRequired = await ctx.connection.getMinimumBalanceForRentExemption(dataLength);
    assert.ok(mintAccount.lamports === rentRequired);

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
      checkMetadata(tokenMetadata, positionMint, poolAddress, positionPda.publicKey);
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
    params: OpenPositionWithTokenExtensionsParams,
  ) {
    const position = (await fetcher.getPosition(
      params.positionPda.publicKey,
    )) as PositionData;
    assert.strictEqual(position.tickLowerIndex, params.tickLowerIndex);
    assert.strictEqual(position.tickUpperIndex, params.tickUpperIndex);
    assert.ok(position.whirlpool.equals(params.whirlpool));
    assert.ok(position.positionMint.equals(params.positionMint));
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
    ).addSigner(mint).prependInstruction(useMaxCU()).buildAndExecute();

    // check Mint state (with metadata)
    await checkMintState(params.positionMint, withTokenMetadataExtension, whirlpoolPda.publicKey);

    // check TokenAccount state
    await checkTokenAccountState(
      params.positionTokenAccount,
      params.positionMint,
      params.owner,
    );

    // check Position state
    await checkInitialPositionState(params);
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
    await checkMintState(params.positionMint, withTokenMetadataExtension, whirlpoolPda.publicKey);

    // check TokenAccount state
    await checkTokenAccountState(
      params.positionTokenAccount,
      params.positionMint,
      params.owner,
    );

    // check Position state
    await checkInitialPositionState(params);
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
      ctx,
      whirlpoolPda.publicKey,
      true,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey, // owner
      funderKeypair.publicKey, // funder
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
    .addSigner(mint)
    .addSigner(funderKeypair)
    .buildAndExecute();

    await checkInitialPositionState(params);
  });

  it("succeeds when owner is different than account paying for transaction fee", async () => {
    const ownerKeypair = anchor.web3.Keypair.generate();

    const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
      ctx,
      whirlpoolPda.publicKey,
      true,
      tickLowerIndex,
      tickUpperIndex,
      ownerKeypair.publicKey, // owner
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
    .addSigner(mint)
    .buildAndExecute();

    await checkInitialPositionState(params);

    const tokenAccount = await fetcher.getTokenInfo(params.positionTokenAccount, IGNORE_CACHE);
    assert.ok(tokenAccount !== null);
    assert.ok(tokenAccount.owner.equals(ownerKeypair.publicKey));
  });

  it("should be failed: mint one more position token", async () => {
    const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
      ctx,
      whirlpoolPda.publicKey,
      true,
      tickLowerIndex,
      tickUpperIndex,
      ctx.wallet.publicKey,
    );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
    .addSigner(mint)
    .buildAndExecute();

    await checkInitialPositionState(params);

    const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
    builder.addInstruction({
      instructions: [
        createMintToInstruction(
          params.positionMint,
          params.positionTokenAccount,
          provider.wallet.publicKey,
          1n,
          undefined,
          TOKEN_2022_PROGRAM_ID,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    });

    await assert.rejects(
      builder.buildAndExecute(),
      /0x5/, // the total supply of this token is fixed
    );
  });

  describe("should be failed: invalid ticks", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        lowerTick,
        upperTick,
        provider.wallet.publicKey,
      );
  
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
        )
        .addSigner(mint)
        .buildAndExecute(),
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

  describe("should be failed: invalid account constraints", () => {
    let defaultParams: OpenPositionWithTokenExtensionsParams;
    let defaultMint: Keypair;

    beforeAll(async () => {
      const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey, // owner
      );

      defaultParams = params;
      defaultMint = mint;
    });

    it("no signature of funder", async () => {
      const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey, // owner
        funderKeypair.publicKey, // funder
      );

      const ix = WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params).instructions[0];

      // drop isSigner flag
      const keysWithoutSign = ix.keys.map((key) => {
        if (key.pubkey.equals(funderKeypair.publicKey)) {
          return { pubkey: key.pubkey, isSigner: false, isWritable: key.isWritable };
        }
        return key;
      });
      const ixWithoutSign = {
        ...ix,
        keys: keysWithoutSign,
      };

      await assert.rejects(
        toTx(
          ctx,
          {
            instructions: [ixWithoutSign],
            cleanupInstructions: [],
            signers: [],
          }
        )
        .addSigner(mint)
        // no signature of funder
        .buildAndExecute(),
        /0xbc2/ // AccountNotSigner
      );
    });

    it("invalid position address (invalid PDA)", async () => {
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
            ...defaultParams,
            positionPda: PDAUtil.getPosition(ctx.program.programId, Keypair.generate().publicKey),
          })
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("no signature of position mint", async () => {
      const ix = WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, defaultParams).instructions[0];

      // drop isSigner flag
      const keysWithoutSign = ix.keys.map((key) => {
        if (key.pubkey.equals(defaultParams.positionMint)) {
          return { pubkey: key.pubkey, isSigner: false, isWritable: key.isWritable };
        }
        return key;
      });
      const ixWithoutSign = {
        ...ix,
        keys: keysWithoutSign,
      };

      await assert.rejects(
        toTx(
          ctx,
          {
            instructions: [ixWithoutSign],
            cleanupInstructions: [],
            signers: [],
          }
        )
        // no signature of position mint
        .buildAndExecute(),
        /0xbc2/ // AccountNotSigner
      );
    });

    it("position mint already initialized", async () => {
      const { params, mint } = await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
      );

      await createMint(
        ctx.connection,
        funderKeypair,
        ctx.wallet.publicKey,
        null,
        6,
        mint,
        {commitment: "confirmed"},
        TOKEN_2022_PROGRAM_ID,
      );

      const created = await fetcher.getMintInfo(params.positionMint, IGNORE_CACHE);
      assert.ok(created !== null);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
        )
        .addSigner(mint)
        .buildAndExecute(),
        /already in use/
      );
    });

    it("invalid position token account (ATA for different mint)", async () => {
      const anotherMint = Keypair.generate();
      const ataForAnotherMint = getAssociatedTokenAddressSync(
        anotherMint.publicKey,
        defaultParams.owner,
        true,
        TOKEN_2022_PROGRAM_ID,
      );

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
            ...defaultParams,
            positionTokenAccount: ataForAnotherMint,
          })
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /An account required by the instruction is missing/ // missing valid ATA address
      );
    });

    it("invalid position token account (ATA with TokenProgram (not Token-2022 program))", async () => {
      const ataWithTokenProgram = getAssociatedTokenAddressSync(
        defaultParams.positionMint,
        defaultParams.owner,
        true,
        TOKEN_PROGRAM_ID,
      );

      assert.ok(!defaultParams.positionTokenAccount.equals(ataWithTokenProgram));

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
            ...defaultParams,
            positionTokenAccount: ataWithTokenProgram,
          })
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /An account required by the instruction is missing/ // missing valid ATA address
      );
    });

    it("invalid whirlpool address", async () => {
      // uninitialized address
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
            ...defaultParams,
            whirlpool: Keypair.generate().publicKey,
          })
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0xbc4/ // AccountNotInitialized
      );

      // not Whirlpool account
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
            ...defaultParams,
            whirlpool: poolInitInfo.whirlpoolsConfig,
          })
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0xbba/ // AccountDiscriminatorMismatch
      );
    });

    it("invalid token 2022 program", async () => {
      const ix = WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, defaultParams).instructions[0];
      const ixWithWrongAccount = {
        ...ix,
        keys: ix.keys.map((key) => {
          if (key.pubkey.equals(TOKEN_2022_PROGRAM_ID)) {
            return { ...key, pubkey: TOKEN_PROGRAM_ID };
          }
          return key;
        }),
      };

      await assert.rejects(
        toTx(
          ctx,
          {
            instructions: [ixWithWrongAccount],
            cleanupInstructions: [],
            signers: [],
          }
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("invalid system program", async () => {
      const ix = WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, defaultParams).instructions[0];
      const ixWithWrongAccount = {
        ...ix,
        keys: ix.keys.map((key) => {
          if (key.pubkey.equals(SystemProgram.programId)) {
            return { ...key, pubkey: TOKEN_PROGRAM_ID };
          }
          return key;
        }),
      };

      await assert.rejects(
        toTx(
          ctx,
          {
            instructions: [ixWithWrongAccount],
            cleanupInstructions: [],
            signers: [],
          }
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("invalid associated token program", async () => {
      const ix = WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, defaultParams).instructions[0];
      const ixWithWrongAccount = {
        ...ix,
        keys: ix.keys.map((key) => {
          if (key.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
            return { ...key, pubkey: TOKEN_PROGRAM_ID };
          }
          return key;
        }),
      };

      await assert.rejects(
        toTx(
          ctx,
          {
            instructions: [ixWithWrongAccount],
            cleanupInstructions: [],
            signers: [],
          }
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });

    it("invalid metadata update auth", async () => {
      const ix = WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, defaultParams).instructions[0];
      const ixWithWrongAccount = {
        ...ix,
        keys: ix.keys.map((key) => {
          if (key.pubkey.equals(WHIRLPOOL_NFT_UPDATE_AUTH)) {
            return { ...key, pubkey: Keypair.generate().publicKey };
          }
          return key;
        }),
      };

      await assert.rejects(
        toTx(
          ctx,
          {
            instructions: [ixWithWrongAccount],
            cleanupInstructions: [],
            signers: [],
          }
        )
        .addSigner(defaultMint)
        .buildAndExecute(),
        /0x7dc/ // ConstraintAddress
      );
    });
  });
});
