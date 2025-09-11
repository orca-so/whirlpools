import * as anchor from "@coral-xyz/anchor";
import { AuthorityType } from "@solana/spl-token";
import * as assert from "assert";
import { toTx, WhirlpoolIx } from "../../../src";
import { WhirlpoolContext } from "../../../src/context";
import {
  approveToken,
  createAndMintToTokenAccount,
  createTokenAccount,
  setAuthority,
  TickSpacing,
  transferToken,
  ZERO_BN,
} from "../../utils";
import { defaultConfirmOptions } from "../../utils/const";
import { WhirlpoolTestFixture } from "../../utils/fixture";
import {
  initializePositionBundle,
  initTestPool,
  initTestPoolWithLiquidity,
  openBundledPosition,
  openPosition,
} from "../../utils/init-utils";
import { generateDefaultOpenPositionWithTokenExtensionsParams } from "../../utils/test-builders";

describe("close_position", () => {
  const provider = anchor.AnchorProvider.local(
    undefined,
    defaultConfirmOptions,
  );
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);

  it("successfully closes an open position", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
    );
    const receiverKeypair = anchor.web3.Keypair.generate();

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: provider.wallet.publicKey,
        receiver: receiverKeypair.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccount,
      }),
    ).buildAndExecute();

    const supplyResponse = await provider.connection.getTokenSupply(
      params.positionMintAddress,
    );
    assert.equal(supplyResponse.value.uiAmount, 0);

    assert.equal(
      await provider.connection.getAccountInfo(params.positionPda.publicKey),
      undefined,
    );
    assert.equal(
      await provider.connection.getAccountInfo(params.positionTokenAccount),
      undefined,
    );

    const receiverAccount = await provider.connection.getAccountInfo(
      receiverKeypair.publicKey,
    );
    const lamports = receiverAccount?.lamports;
    assert.ok(lamports != undefined && lamports > 0);
  });

  it("succeeds if the position is delegated", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
    );

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: delegate.publicKey,
        receiver: owner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccount,
      }),
    )
      .addSigner(delegate)
      .buildAndExecute();
  });

  it("succeeds with the owner's signature even if the token is delegated", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
    );

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: owner.publicKey,
        receiver: owner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccount,
      }),
    )
      .addSigner(owner)
      .buildAndExecute();
  });

  it("succeeds with position token that was transferred to new owner", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN },
      ],
    });
    const position = fixture.getInfos().positions[0];

    const newOwner = anchor.web3.Keypair.generate();
    const newOwnerPositionTokenAccount = await createTokenAccount(
      provider,
      position.mintKeypair.publicKey,
      newOwner.publicKey,
    );

    await transferToken(
      provider,
      position.tokenAccount,
      newOwnerPositionTokenAccount,
      1,
    );

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: newOwner.publicKey,
        receiver: newOwner.publicKey,
        position: position.publicKey,
        positionMint: position.mintKeypair.publicKey,
        positionTokenAccount: newOwnerPositionTokenAccount,
      }),
    )
      .addSigner(newOwner)
      .buildAndExecute();
  });

  it("fails to close a position with liquidity", async () => {
    const { positionInfo } = await initTestPoolWithLiquidity(ctx);

    const receiverKeypair = anchor.web3.Keypair.generate();

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: receiverKeypair.publicKey,
          position: positionInfo.positionPda.publicKey,
          positionMint: positionInfo.positionMintAddress,
          positionTokenAccount: positionInfo.positionTokenAccount,
        }),
      ).buildAndExecute(),
      /0x1775/, // ClosePositionNotEmpty
    );
  });

  it("fails if owner is not signer", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: owner.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccount,
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });

  it("fails if delegate is not signer", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: delegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccount,
        }),
      ).buildAndExecute(),
      /.*signature verification fail.*/i,
    );
  });

  it("fails if the authority does not match", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const fakeOwner = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: fakeOwner.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccount,
        }),
      )
        .addSigner(fakeOwner)
        .buildAndExecute(),
      /0x1783/, // MissingOrInvalidDelegate
    );
  });

  it("fails if position token account does not contain exactly one token", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN },
      ],
    });
    const position = fixture.getInfos().positions[0];

    const fakePositionTokenAccount = await createTokenAccount(
      provider,
      position.mintKeypair.publicKey,
      provider.wallet.publicKey,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: position.publicKey,
          positionMint: position.mintKeypair.publicKey,
          positionTokenAccount: fakePositionTokenAccount,
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails if delegated amount is 0", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      0,
      owner,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: delegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccount,
        }),
      )
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/, // InvalidPositionTokenAmount
    );
  });

  it("fails if positionAuthority does not match delegate", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();
    const fakeDelegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey,
    );

    await approveToken(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      1,
      owner,
    );
    await setAuthority(
      ctx.provider,
      params.positionTokenAccount,
      delegate.publicKey,
      AuthorityType.CloseAccount,
      owner,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: fakeDelegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccount,
        }),
      )
        .addSigner(fakeDelegate)
        .buildAndExecute(),
      /0x1783/, // MissingOrInvalidDelegate
    );
  });

  it("fails if position token account mint does not match position mint", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN },
      ],
    });
    const {
      poolInitInfo: { tokenMintA },
      positions,
    } = fixture.getInfos();
    const position = positions[0];

    const fakePositionTokenAccount = await createAndMintToTokenAccount(
      provider,
      tokenMintA,
      1,
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: position.publicKey,
          positionMint: position.mintKeypair.publicKey,
          positionTokenAccount: fakePositionTokenAccount,
        }),
      ).buildAndExecute(),
      /0x7d3/, // ConstraintRaw
    );
  });

  it("fails if position_mint does not match position's position_mint field", async () => {
    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [
        { tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN },
      ],
    });
    const {
      poolInitInfo: { tokenMintA },
      positions,
    } = fixture.getInfos();
    const position = positions[0];

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.closePositionIx(ctx.program, {
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: position.publicKey,
          positionMint: tokenMintA,
          positionTokenAccount: position.tokenAccount,
        }),
      ).buildAndExecute(),
      // Seeds constraint added by adding PositionBundle, so ConstraintSeeds will be violated first
      /0x7d6/, // ConstraintSeeds (seed constraint was violated)
    );
  });

  describe("bundled position and TokenExtensions based position", () => {
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
          WhirlpoolIx.closePositionIx(ctx.program, {
            positionAuthority: provider.wallet.publicKey,
            receiver: provider.wallet.publicKey,
            position: positionInitInfo.params.bundledPositionPda.publicKey,
            positionMint:
              positionBundleInfo.positionBundleMintKeypair.publicKey,
            positionTokenAccount: positionBundleInfo.positionBundleTokenAccount,
          }),
        ).buildAndExecute(),
        /0x7d6/, // ConstraintSeeds (seed constraint was violated)
      );
    });

    it("fails if position is TokenExtensions based position", async () => {
      const fixture = await new WhirlpoolTestFixture(ctx).init({
        tickSpacing: TickSpacing.Standard,
        positions: [],
      });
      const { poolInitInfo } = fixture.getInfos();

      // open position with TokenExtensions
      const { params, mint } =
        await generateDefaultOpenPositionWithTokenExtensionsParams(
          ctx,
          poolInitInfo.whirlpoolPda.publicKey,
          true,
          0,
          poolInitInfo.tickSpacing,
          provider.wallet.publicKey,
        );
      await toTx(
        ctx,
        WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, params),
      )
        .addSigner(mint)
        .buildAndExecute();

      // try to close bundled position
      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.closePositionIx(ctx.program, {
            positionAuthority: provider.wallet.publicKey,
            receiver: provider.wallet.publicKey,
            position: params.positionPda.publicKey,
            positionMint: params.positionMint,
            positionTokenAccount: params.positionTokenAccount,
          }),
        ).buildAndExecute(),
        /0xbbf/, // AccountOwnedByWrongProgram (Mint and TokenAccount must be owned by TokenProgram (but owned by Token-2022 program))
      );
    });
  });
});
