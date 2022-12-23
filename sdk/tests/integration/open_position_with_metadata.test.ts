import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { PDA, TransactionBuilder } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { web3 } from "@project-serum/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import {
  InitPoolParams,
  MAX_TICK_INDEX,
  METADATA_PROGRAM_ADDRESS,
  MIN_TICK_INDEX,
  OpenPositionParams,
  OpenPositionWithMetadataBumpsData,
  PDAUtil,
  PositionData,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx
} from "../../src";
import { openPositionAccounts } from "../../src/utils/instructions-util";
import {
  createMint,
  createMintInstructions,
  mintToByAuthority,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  ZERO_BN
} from "../utils";
import { initTestPool, openPositionWithMetadata } from "../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../utils/test-builders";

describe("open_position_with_metadata", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  let defaultParams: Required<OpenPositionParams & { metadataPda: PDA }>;
  let defaultMint: Keypair;
  const tickLowerIndex = 0;
  const tickUpperIndex = 128;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    const { params, mint } = await generateDefaultOpenPositionParams(
      ctx,
      whirlpoolPda.publicKey,
      0,
      128,
      provider.wallet.publicKey
    );
    defaultParams = params;
    defaultMint = mint;
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
  });

  async function checkMetadata(metadataPda: PDA | undefined, positionMint: PublicKey) {
    assert.ok(metadataPda != null);
    const metadata = await Metadata.load(provider.connection, metadataPda.publicKey);
    assert.ok(metadata.data.updateAuthority === "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr");
    assert.ok(metadata.data.mint === positionMint.toString());
    assert.ok(
      metadata.data.data.uri === `https://arweave.net/KZlsubXZyzeSYi2wJhyL7SY-DAot_OXhfWSYQGLmmOc`
    );
  }

  it("successfully opens position and verify position address contents", async () => {
    const positionInitInfo = await openPositionWithMetadata(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, metadataPda, positionMintAddress } = positionInitInfo.params;
    const position = (await fetcher.getPosition(positionPda.publicKey)) as PositionData;

    assert.strictEqual(position.tickLowerIndex, tickLowerIndex);
    assert.strictEqual(position.tickUpperIndex, tickUpperIndex);
    assert.ok(position.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));

    await checkMetadata(metadataPda, position.positionMint);
    // TODO: Add tests for rewards
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const { params } = await openPositionWithMetadata(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
      funderKeypair
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
      newOwner.publicKey
    );
    const {
      metadataPda,
      positionMintAddress,
      positionTokenAccount: positionTokenAccountAddress,
    } = positionInitInfo.params;

    const token = new Token(
      ctx.connection,
      positionMintAddress,
      TOKEN_PROGRAM_ID,
      web3.Keypair.generate()
    );

    await checkMetadata(metadataPda, positionMintAddress);

    const userTokenAccount = await token.getAccountInfo(positionTokenAccountAddress);
    assert.ok(userTokenAccount.amount.eq(new anchor.BN(1)));
    assert.ok(userTokenAccount.owner.equals(newOwner.publicKey));

    await assert.rejects(
      mintToByAuthority(provider, positionMintAddress, positionTokenAccountAddress, 1),
      /0x5/ // the total supply of this token is fixed
    );
  });

  it("user must pass the valid token ATA account", async () => {
    const anotherMintKey = await createMint(provider, provider.wallet.publicKey);
    const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      anotherMintKey,
      ctx.provider.wallet.publicKey
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionWithMetadataIx(ctx.program, {
          ...defaultParams,
          positionTokenAccount: positionTokenAccountAddress,
        })
      )
        .addSigner(defaultMint)
        .buildAndExecute(),
      /An account required by the instruction is missing/
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
          funderKeypair
        ),
        /0x177a/ // InvalidTickIndex
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
    const positionPda = PDAUtil.getPosition(ctx.program.programId, positionMintKeypair.publicKey);
    const metadataPda = PDAUtil.getPositionMetadata(positionMintKeypair.publicKey);

    const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      positionMintKeypair.publicKey,
      provider.wallet.publicKey
    );

    const tx = new web3.Transaction();
    tx.add(
      ...(await createMintInstructions(
        provider,
        provider.wallet.publicKey,
        positionMintKeypair.publicKey
      ))
    );

    await provider.sendAndConfirm(tx, [positionMintKeypair], { commitment: "confirmed" });

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
        })
      )
        .addSigner(positionMintKeypair)
        .buildAndExecute(),
      /0x0/
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
      >
    ) {
      const { positionPda, metadataPda, tickLowerIndex, tickUpperIndex } = defaultParams;

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
            metadataUpdateAuth: new PublicKey("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"),
            ...overrides,
          },
        }
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
        toTx(ctx, WhirlpoolIx.openPositionWithMetadataIx(ctx.program, invalidParams))
          .addSigner(defaultMint)
          .buildAndExecute(),
        // Invalid Metadata Key
        // https://github.com/metaplex-foundation/metaplex-program-library/blob/master/token-metadata/program/src/error.rs#L36
        /0x5/
      );
    });

    it("fails with non-program metadata program", async () => {
      const notMetadataProgram = Keypair.generate();
      const tx = new TransactionBuilder(ctx.provider.connection, ctx.wallet).addInstruction(
        buildOpenWithAccountOverrides({
          metadataProgram: notMetadataProgram.publicKey,
        })
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // AddressConstraint
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L84
        /0x7dc/
      );
    });

    it("fails with non-metadata program ", async () => {
      const tx = new TransactionBuilder(ctx.provider.connection, ctx.wallet).addInstruction(
        buildOpenWithAccountOverrides({
          metadataProgram: TOKEN_PROGRAM_ID,
        })
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // AddressConstraint
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L84
        /0x7dc/
      );
    });

    it("fails with non-valid update_authority program", async () => {
      const notUpdateAuth = Keypair.generate();
      const tx = new TransactionBuilder(ctx.provider.connection, ctx.wallet).addInstruction(
        buildOpenWithAccountOverrides({
          metadataUpdateAuth: notUpdateAuth.publicKey,
        })
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // AddressConstraint
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L84
        /0x7dc/
      );
    });
  });
});
