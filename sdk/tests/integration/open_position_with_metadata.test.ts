import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { PDA, TransactionBuilder } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
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
  TickUtil,
  WhirlpoolContext,
  WhirlpoolIx,
  toTx
} from "../../src";
import { openPositionAccounts } from "../../src/utils/instructions-util";
import {
  ONE_SOL,
  TickSpacing,
  ZERO_BN,
  createMint,
  createMintInstructions,
  mintToDestination,
  systemTransferTx
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool, openPositionWithMetadata } from "../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../utils/test-builders";
import { MetaplexHttpClient } from "../utils/metaplex";

describe("open_position_with_metadata", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  const metaplex = new MetaplexHttpClient();

  let defaultParams: Required<OpenPositionParams & { metadataPda: PDA }>;
  let defaultMint: Keypair;
  const tickLowerIndex = 0;
  const tickUpperIndex = 32768;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  let fullRangeOnlyPoolInitInfo: InitPoolParams;
  let fullRangeOnlyWhirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    fullRangeOnlyPoolInitInfo = (await initTestPool(ctx, TickSpacing.FullRangeOnly)).poolInitInfo;
    fullRangeOnlyWhirlpoolPda = fullRangeOnlyPoolInitInfo.whirlpoolPda;

    const { params, mint } = await generateDefaultOpenPositionParams(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey
    );
    defaultParams = params;
    defaultMint = mint;
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
  });

  async function checkMetadata(metadataPda: PDA | undefined, positionMint: PublicKey) {
    assert.ok(metadataPda != null);

    const metadataAccountInfo = await provider.connection.getAccountInfo(metadataPda.publicKey);
    assert.ok(metadataAccountInfo !== null);
    const metadata = metaplex.parseOnChainMetadata(metadataPda.publicKey, metadataAccountInfo!.data);
    assert.ok(metadata !== null);

    assert.ok(metadata.updateAuthority.toBase58() === "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr");
    assert.ok(metadata.mint.toBase58() === positionMint.toString());
    assert.ok(
      metadata.uri.replace(/\0/g, '') === `https://arweave.net/E19ZNY2sqMqddm1Wx7mrXPUZ0ZZ5ISizhebb0UsVEws`
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

  it("successfully opens position and verify position address contents for full-range only pool", async () => {
    const [lowerTickIndex, upperTickIndex] = TickUtil.getFullRangeTickIndex(TickSpacing.FullRangeOnly);

    const positionInitInfo = await openPositionWithMetadata(
      ctx,
      fullRangeOnlyWhirlpoolPda.publicKey,
      lowerTickIndex,
      upperTickIndex
    );
    const { positionPda, metadataPda, positionMintAddress } = positionInitInfo.params;
    const position = (await fetcher.getPosition(positionPda.publicKey)) as PositionData;

    assert.strictEqual(position.tickLowerIndex, lowerTickIndex);
    assert.strictEqual(position.tickUpperIndex, upperTickIndex);
    assert.ok(position.whirlpool.equals(fullRangeOnlyPoolInitInfo.whirlpoolPda.publicKey));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));

    await checkMetadata(metadataPda, position.positionMint);
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

    await checkMetadata(metadataPda, positionMintAddress);

    const userTokenAccount = await getAccount(ctx.connection, positionTokenAccountAddress);
    assert.ok(userTokenAccount.amount === 1n);
    assert.ok(userTokenAccount.owner.equals(newOwner.publicKey));

    await assert.rejects(
      mintToDestination(provider, positionMintAddress, positionTokenAccountAddress, 1),
      /0x5/ // the total supply of this token is fixed
    );
  });

  it("user must pass the valid token ATA account", async () => {
    const anotherMintKey = await createMint(provider, provider.wallet.publicKey);
    const positionTokenAccountAddress = getAssociatedTokenAddressSync(anotherMintKey, provider.wallet.publicKey)

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

    const positionTokenAccountAddress = getAssociatedTokenAddressSync(positionMintKeypair.publicKey, provider.wallet.publicKey);

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
      const tx = new TransactionBuilder(ctx.provider.connection, ctx.wallet, ctx.txBuilderOpts).addInstruction(
        buildOpenWithAccountOverrides({
          metadataProgram: notMetadataProgram.publicKey,
        })
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // InvalidProgramId
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L180
        /0xbc0/
      );
    });

    it("fails with non-metadata program ", async () => {
      const tx = new TransactionBuilder(ctx.provider.connection, ctx.wallet, ctx.txBuilderOpts).addInstruction(
        buildOpenWithAccountOverrides({
          metadataProgram: TOKEN_PROGRAM_ID,
        })
      );

      await assert.rejects(
        tx.addSigner(defaultMint).buildAndExecute(),
        // InvalidProgramId
        // https://github.com/project-serum/anchor/blob/master/lang/src/error.rs#L180
        /0xbc0/
      );
    });

    it("fails with non-valid update_authority program", async () => {
      const notUpdateAuth = Keypair.generate();
      const tx = new TransactionBuilder(ctx.provider.connection, ctx.wallet, ctx.txBuilderOpts).addInstruction(
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

  it("fail when opening a non-full range position in an full-range only pool", async () => {
    await assert.rejects(
      openPositionWithMetadata(
        ctx,
        fullRangeOnlyWhirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
        provider.wallet.publicKey,
        funderKeypair
      ),
      /0x17a6/ // FullRangeOnlyPool
    );
  });
});
