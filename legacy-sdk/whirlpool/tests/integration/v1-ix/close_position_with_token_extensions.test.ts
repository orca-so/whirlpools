import * as anchor from "@coral-xyz/anchor";
import {
  AuthorityType,
  createCloseAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as assert from "assert";
import {
  IGNORE_CACHE,
  increaseLiquidityQuoteByLiquidityWithParams,
  NO_TOKEN_EXTENSION_CONTEXT,
  PDAUtil,
  TickUtil,
  toTx,
  WhirlpoolIx,
} from "../../../src";
import type { InitPoolParams } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import {
  approveToken,
  createTokenAccount,
  mintToDestination,
  ONE_SOL,
  setAuthority,
  systemTransferTx,
  TickSpacing,
  transferToken,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import {
  initializePositionBundle,
  initTestPool,
  initTickArray,
  openBundledPosition,
  openPosition,
} from "../../utils/init-utils";
import { Percentage } from "@orca-so/common-sdk";
import type { PDA } from "@orca-so/common-sdk";
import { generateDefaultOpenPositionWithTokenExtensionsParams } from "../../utils/test-builders";
import type { PublicKey } from "@solana/web3.js";
import { createTokenAccountV2 } from "../../utils/v2/token-2022";

describe("close_position_with_token_extensions", () => {
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

  async function getRent(address: PublicKey): Promise<number> {
    const rent = (await ctx.connection.getAccountInfo(address))?.lamports;
    assert.ok(rent !== undefined);
    return rent;
  }

  async function checkClosed(address: PublicKey): Promise<void> {
    assert.equal(await provider.connection.getAccountInfo(address), undefined);
  }

  describe("successfully closes an open position", () => {
    [true, false].map((withMetadata) => {
      it(`successfully closes an open position ${withMetadata ? "with" : "without"} metadata`, async () => {
        const { params, mint } =
          await generateDefaultOpenPositionWithTokenExtensionsParams(
            ctx,
            whirlpoolPda.publicKey,
            withMetadata,
            tickLowerIndex,
            tickUpperIndex,
            provider.wallet.publicKey,
          );
        await toTx(
          ctx,
          WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
        )
          .addSigner(mint)
          .buildAndExecute();

        const rentPosition = await getRent(params.positionPda.publicKey);
        const rentMint = await getRent(params.positionMint);
        const rentTokenAccount = await getRent(params.positionTokenAccount);
        const rent = rentPosition + rentMint + rentTokenAccount;
        assert.ok(rent > 0);

        const receiverKeypair = anchor.web3.Keypair.generate();
        await toTx(
          ctx,
          WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
            positionAuthority: provider.wallet.publicKey,
            receiver: receiverKeypair.publicKey,
            position: params.positionPda.publicKey,
            positionMint: params.positionMint,
            positionTokenAccount: params.positionTokenAccount,
          }),
        ).buildAndExecute();

        // Position account should be closed
        await checkClosed(params.positionPda.publicKey);

        // Mint and TokenAccount should be closed
        await checkClosed(params.positionMint);
        await checkClosed(params.positionTokenAccount);

        const receiverAccount = await provider.connection.getAccountInfo(
          receiverKeypair.publicKey,
        );
        const lamports = receiverAccount?.lamports;
        assert.ok(lamports === rent);
      });
    });
  });

  it("succeeds if the position is delegated", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );

    // check delegation
    const tokenAccount = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!tokenAccount);
    assert.ok(tokenAccount.delegate?.equals(delegate.publicKey));
    assert.ok(tokenAccount.delegatedAmount === 1n);
    assert.ok(tokenAccount.closeAuthority?.equals(delegate.publicKey)); // needed to close token account by delegate

    await toTx(
      ctx,
      WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
        positionAuthority: delegate.publicKey,
        receiver: owner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMint,
        positionTokenAccount: params.positionTokenAccount,
      }),
    )
      // sign with delegate
      .addSigner(delegate)
      .buildAndExecute();

    await Promise.all([
      checkClosed(params.positionPda.publicKey),
      checkClosed(params.positionMint),
      checkClosed(params.positionTokenAccount),
    ]);
  });

  it("succeeds with the owner's signature even if the token is delegated", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );

    // check delegation
    const tokenAccount = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!tokenAccount);
    assert.ok(tokenAccount.delegate?.equals(delegate.publicKey));
    assert.ok(tokenAccount.delegatedAmount === 1n);
    assert.ok(!tokenAccount.closeAuthority); // no close authority

    await toTx(
      ctx,
      WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
        positionAuthority: owner.publicKey,
        receiver: owner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMint,
        positionTokenAccount: params.positionTokenAccount,
      }),
    )
      // sign with owner
      .addSigner(owner)
      .buildAndExecute();

    await Promise.all([
      checkClosed(params.positionPda.publicKey),
      checkClosed(params.positionMint),
      checkClosed(params.positionTokenAccount),
    ]);
  });

  it("succeeds with position token that was transferred to new owner", async () => {
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
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

    const newOwner = anchor.web3.Keypair.generate();
    const newOwnerPositionTokenAccount = await createTokenAccountV2(
      provider,
      { isToken2022: true },
      mint.publicKey,
      newOwner.publicKey,
    );
    await transferToken(
      provider,
      params.positionTokenAccount,
      newOwnerPositionTokenAccount,
      1,
      TOKEN_2022_PROGRAM_ID,
    );

    // check transfer
    const oldOwnerTokenAccount = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!oldOwnerTokenAccount);
    assert.ok(oldOwnerTokenAccount.amount === 0n);
    const newOwnerTokenAccount = await fetcher.getTokenInfo(
      newOwnerPositionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!newOwnerTokenAccount);
    assert.ok(newOwnerTokenAccount.amount === 1n);

    await toTx(
      ctx,
      WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
        positionAuthority: newOwner.publicKey,
        receiver: newOwner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMint,
        positionTokenAccount: newOwnerPositionTokenAccount,
      }),
    )
      // sign with new owner
      .addSigner(newOwner)
      .buildAndExecute();

    await Promise.all([
      checkClosed(params.positionPda.publicKey),
      checkClosed(params.positionMint),
      checkClosed(newOwnerPositionTokenAccount),
    ]);

    // check original token account
    const oldOwnerTokenAccountAfter = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!oldOwnerTokenAccountAfter);
    assert.ok(oldOwnerTokenAccountAfter.amount === 0n);

    // closing token account should be possible even if Mint have been closed.
    await toTx(ctx, {
      instructions: [
        createCloseAccountInstruction(
          params.positionTokenAccount,
          ctx.wallet.publicKey,
          ctx.wallet.publicKey,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ],
      cleanupInstructions: [],
      signers: [],
    }).buildAndExecute();
    await checkClosed(params.positionTokenAccount);
  });

  it("fails to close a position with liquidity", async () => {
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
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

    // add liquidity
    const pool = await fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE);
    const quote = increaseLiquidityQuoteByLiquidityWithParams({
      liquidity: new anchor.BN(100000),
      slippageTolerance: Percentage.fromFraction(0, 1000),
      sqrtPrice: pool!.sqrtPrice,
      tickCurrentIndex: pool!.tickCurrentIndex,
      tickLowerIndex,
      tickUpperIndex,
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
    });

    const tokenOwnerAccountA = await createTokenAccount(
      provider,
      pool!.tokenMintA,
      provider.wallet.publicKey,
    );
    await mintToDestination(
      provider,
      pool!.tokenMintA,
      tokenOwnerAccountA,
      quote.tokenMaxA,
    );
    const tokenOwnerAccountB = await createTokenAccount(
      provider,
      pool!.tokenMintB,
      provider.wallet.publicKey,
    );
    await mintToDestination(
      provider,
      pool!.tokenMintB,
      tokenOwnerAccountB,
      quote.tokenMaxB,
    );

    const lowerStartTickIndex = TickUtil.getStartTickIndex(
      tickLowerIndex,
      pool!.tickSpacing,
    );
    const upperStartTickIndex = TickUtil.getStartTickIndex(
      tickUpperIndex,
      pool!.tickSpacing,
    );
    await initTickArray(ctx, whirlpoolPda.publicKey, lowerStartTickIndex);
    await initTickArray(ctx, whirlpoolPda.publicKey, upperStartTickIndex);
    await toTx(
      ctx,
      WhirlpoolIx.increaseLiquidityIx(ctx.program, {
        ...quote,
        position: params.positionPda.publicKey,
        positionAuthority: ctx.wallet.publicKey,
        positionTokenAccount: params.positionTokenAccount,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        whirlpool: whirlpoolPda.publicKey,
        tokenVaultA: pool!.tokenVaultA,
        tokenVaultB: pool!.tokenVaultB,
        tickArrayLower: PDAUtil.getTickArray(
          ctx.program.programId,
          whirlpoolPda.publicKey,
          lowerStartTickIndex,
        ).publicKey,
        tickArrayUpper: PDAUtil.getTickArray(
          ctx.program.programId,
          whirlpoolPda.publicKey,
          upperStartTickIndex,
        ).publicKey,
      }),
    ).buildAndExecute();

    // check liquidity (not zero)
    const position = await fetcher.getPosition(
      params.positionPda.publicKey,
      IGNORE_CACHE,
    );
    assert.ok(position!.liquidity.gtn(0));

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      ).buildAndExecute(),
      /0x1775/, // ClosePositionNotEmpty
    );
  });

  it("fails if owner is not signer", async () => {
    const owner = anchor.web3.Keypair.generate();
    const receiver = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    const ix = WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
      positionAuthority: owner.publicKey,
      receiver: receiver.publicKey,
      position: params.positionPda.publicKey,
      positionMint: params.positionMint,
      positionTokenAccount: params.positionTokenAccount,
    }).instructions[0];

    // drop isSigner flag
    const keysWithoutSign = ix.keys.map((key) => {
      if (key.pubkey.equals(owner.publicKey)) {
        return {
          pubkey: key.pubkey,
          isSigner: false,
          isWritable: key.isWritable,
        };
      }
      return key;
    });
    const ixWithoutSign = {
      ...ix,
      keys: keysWithoutSign,
    };

    await assert.rejects(
      toTx(ctx, {
        instructions: [ixWithoutSign],
        cleanupInstructions: [],
        signers: [],
      })
        // no signature of owner
        .buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails if delegate is not signer", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();
    const receiver = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );

    // check delegation
    const tokenAccount = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!tokenAccount);
    assert.ok(tokenAccount.delegate?.equals(delegate.publicKey));
    assert.ok(tokenAccount.delegatedAmount === 1n);
    assert.ok(tokenAccount.closeAuthority?.equals(delegate.publicKey)); // needed to close token account by delegate

    const ix = WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
      positionAuthority: delegate.publicKey,
      receiver: receiver.publicKey,
      position: params.positionPda.publicKey,
      positionMint: params.positionMint,
      positionTokenAccount: params.positionTokenAccount,
    }).instructions[0];

    // drop isSigner flag
    const keysWithoutSign = ix.keys.map((key) => {
      if (key.pubkey.equals(delegate.publicKey)) {
        return {
          pubkey: key.pubkey,
          isSigner: false,
          isWritable: key.isWritable,
        };
      }
      return key;
    });
    const ixWithoutSign = {
      ...ix,
      keys: keysWithoutSign,
    };

    await assert.rejects(
      toTx(ctx, {
        instructions: [ixWithoutSign],
        cleanupInstructions: [],
        signers: [],
      })
        // no signature of delegate
        .buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails if the authority does not match", async () => {
    const owner = anchor.web3.Keypair.generate();
    const fakeOwner = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: fakeOwner.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      )
        .addSigner(fakeOwner)
        .buildAndExecute(),
      /0x1783/, // MissingOrInvalidDelegate
    );
  });

  it("fails if position token account does not contain exactly one token", async () => {
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
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

    // not ATA
    const fakePositionTokenAccount = await createTokenAccountV2(
      provider,
      { isToken2022: true },
      mint.publicKey,
      provider.wallet.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: fakePositionTokenAccount,
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails if delegated amount is 0", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      0, // 0 amount
      owner,
      TOKEN_2022_PROGRAM_ID,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );

    // check delegation (delegated, but 0 amount)
    const tokenAccount = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!tokenAccount);
    assert.ok(tokenAccount.delegate?.equals(delegate.publicKey));
    assert.ok(tokenAccount.delegatedAmount === 0n);
    assert.ok(tokenAccount.closeAuthority?.equals(delegate.publicKey)); // needed to close token account by delegate

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: delegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/, // InvalidPositionTokenAmount
    );
  });

  it("fails if positionAuthority does not match delegate", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();
    const fakeDelegate = anchor.web3.Keypair.generate();

    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        owner.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
    )
      .addSigner(mint)
      .buildAndExecute();

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
      TOKEN_2022_PROGRAM_ID,
    );

    // check delegation
    const tokenAccount = await fetcher.getTokenInfo(
      params.positionTokenAccount,
      IGNORE_CACHE,
    );
    assert.ok(!!tokenAccount);
    assert.ok(tokenAccount.delegate?.equals(delegate.publicKey));
    assert.ok(tokenAccount.delegatedAmount === 1n);
    assert.ok(tokenAccount.closeAuthority?.equals(delegate.publicKey)); // needed to close token account by delegate

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: fakeDelegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMint,
          positionTokenAccount: params.positionTokenAccount,
        }),
      )
        .addSigner(fakeDelegate)
        .buildAndExecute(),
      /0x1783/, // MissingOrInvalidDelegate
    );
  });

  it("fails if position token account mint does not match position mint", async () => {
    const { params: params1, mint: mint1 } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        ctx.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params1),
    )
      .addSigner(mint1)
      .buildAndExecute();

    const { params: params2, mint: mint2 } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        ctx.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params2),
    )
      .addSigner(mint2)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: params1.positionPda.publicKey,
          positionMint: params1.positionMint,
          positionTokenAccount: params2.positionTokenAccount, // params2 (fake)
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails if position_mint does not match position's position_mint field", async () => {
    const { params: params1, mint: mint1 } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        ctx.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params1),
    )
      .addSigner(mint1)
      .buildAndExecute();

    const { params: params2, mint: mint2 } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
        ctx,
        whirlpoolPda.publicKey,
        true,
        tickLowerIndex,
        tickUpperIndex,
        ctx.wallet.publicKey,
      );
    await toTx(
      ctx,
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params2),
    )
      .addSigner(mint2)
      .buildAndExecute();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: params1.positionPda.publicKey,
          positionMint: params2.positionMint, // params2 (fake)
          positionTokenAccount: params1.positionTokenAccount,
        }),
      ).buildAndExecute(),
      // Seeds constraint added by adding PositionBundle, so ConstraintSeeds will be violated first
      /0x7d6/, // ConstraintSeeds (seed constraint was violated)
    );
  });

  it("fails if token program is invalid", async () => {
    const { params, mint } =
      await generateDefaultOpenPositionWithTokenExtensionsParams(
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

    const ix = WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
      positionAuthority: provider.wallet.publicKey,
      receiver: provider.wallet.publicKey,
      position: params.positionPda.publicKey,
      positionMint: params.positionMint,
      positionTokenAccount: params.positionTokenAccount,
    }).instructions[0];
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
      toTx(ctx, {
        instructions: [ixWithWrongAccount],
        cleanupInstructions: [],
        signers: [],
      }).buildAndExecute(),
      /0xbc0/, // InvalidProgramId
    );
  });

  describe("TokenProgram based position and bundled position", () => {
    it("fails if position is TokenProgram based position", async () => {
      // TokenProgram based poition
      const { params } = await openPosition(
        ctx,
        whirlpoolPda.publicKey,
        tickLowerIndex,
        tickUpperIndex,
        ctx.wallet.publicKey,
      );

      // try to close TokenProgram based position
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
            positionAuthority: provider.wallet.publicKey,
            receiver: provider.wallet.publicKey,
            position: params.positionPda.publicKey,
            positionMint: params.positionMintAddress,
            positionTokenAccount: params.positionTokenAccount,
          }),
        ).buildAndExecute(),
        /0x7d4/, // ConstraintOwner (The owner of Mint account must be Token-2022)
      );
    });

    it("fails if position is BUNDLED position", async () => {
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing: TickSpacing.Standard,
        positions: [],
      });
      const { poolInitInfo } = fixture.getInfos();

      // open bundled position
      const positionBundleInfo = await initializePositionBundle(ctx);
      const bundleIndex = 0;
      const positionInitInfo = await openBundledPosition(
        ctx,
        poolInitInfo.whirlpoolPda.publicKey,
        positionBundleInfo.positionBundleMintKeypair.publicKey,
        bundleIndex,
        0,
        128,
      );

      // try to close bundled position
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
            positionAuthority: provider.wallet.publicKey,
            receiver: provider.wallet.publicKey,
            position: positionInitInfo.params.bundledPositionPda.publicKey,
            positionMint:
              positionBundleInfo.positionBundleMintKeypair.publicKey,
            positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          }),
        ).buildAndExecute(),
        /0x7d6/, // ConstraintSeeds (seed constraint was violated because BundledPosition uses different seeds)
      );
    });
  });
});
