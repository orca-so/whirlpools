import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../src/context";
import { WhirlpoolClient } from "../src/client";
import { initTestPool, initTestPoolWithLiquidity, openPosition } from "./utils/init-utils";
import {
  approveToken,
  createAndMintToTokenAccount,
  createTokenAccount,
  setAuthority,
  TickSpacing,
  transfer,
  ZERO_BN,
} from "./utils";
import { WhirlpoolTestFixture } from "./utils/fixture";

describe("close_position", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully closes an open position", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const { params } = await openPosition(client, poolInitInfo.whirlpoolPda.publicKey, 0, 128);
    const receiverKeypair = anchor.web3.Keypair.generate();

    await client
      .closePositionTx({
        positionAuthority: provider.wallet.publicKey,
        receiver: receiverKeypair.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccountAddress,
      })
      .buildAndExecute();

    const supplyResponse = await provider.connection.getTokenSupply(params.positionMintAddress);
    assert.equal(supplyResponse.value.uiAmount, 0);

    assert.equal(await provider.connection.getAccountInfo(params.positionPda.publicKey), undefined);
    assert.equal(
      await provider.connection.getAccountInfo(params.positionTokenAccountAddress),
      undefined
    );

    const receiverAccount = await provider.connection.getAccountInfo(receiverKeypair.publicKey);
    const lamports = receiverAccount?.lamports;
    assert.ok(lamports != undefined && lamports > 0);
  });

  it("succeeds if the position is delegated", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await approveToken(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      1,
      owner
    );
    await setAuthority(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      "CloseAccount",
      owner
    );

    await client
      .closePositionTx({
        positionAuthority: delegate.publicKey,
        receiver: owner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccountAddress,
      })
      .addSigner(delegate)
      .buildAndExecute();
  });

  it("succeeds with the owner's signature even if the token is delegated", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await approveToken(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      1,
      owner
    );

    await client
      .closePositionTx({
        positionAuthority: owner.publicKey,
        receiver: owner.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccountAddress,
      })
      .addSigner(owner)
      .buildAndExecute();
  });

  it("succeeds with position token that was transferred to new owner", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN }],
    });
    const position = fixture.getInfos().positions[0];

    const newOwner = anchor.web3.Keypair.generate();
    const newOwnerPositionTokenAccount = await createTokenAccount(
      provider,
      position.mintKeypair.publicKey,
      newOwner.publicKey
    );

    await transfer(provider, position.tokenAccount, newOwnerPositionTokenAccount, 1);

    await client
      .closePositionTx({
        positionAuthority: newOwner.publicKey,
        receiver: newOwner.publicKey,
        position: position.publicKey,
        positionMint: position.mintKeypair.publicKey,
        positionTokenAccount: newOwnerPositionTokenAccount,
      })
      .addSigner(newOwner)
      .buildAndExecute();
  });

  it("fails to close a position with liquidity", async () => {
    const { positionInfo } = await initTestPoolWithLiquidity(client);

    const receiverKeypair = anchor.web3.Keypair.generate();

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: provider.wallet.publicKey,
          receiver: receiverKeypair.publicKey,
          position: positionInfo.positionPda.publicKey,
          positionMint: positionInfo.positionMintAddress,
          positionTokenAccount: positionInfo.positionTokenAccountAddress,
        })
        .buildAndExecute(),
      /0x1775/ // ClosePositionNotEmpty
    );
  });

  it("fails if owner is not signer", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: owner.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccountAddress,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails if delegate is not signer", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await approveToken(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      1,
      owner
    );
    await setAuthority(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      "CloseAccount",
      owner
    );

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: delegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccountAddress,
        })
        .buildAndExecute(),
      /Signature verification failed/
    );
  });

  it("fails if the authority does not match", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const fakeOwner = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: fakeOwner.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccountAddress,
        })
        .addSigner(fakeOwner)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails if position token account does not contain exactly one token", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN }],
    });
    const position = fixture.getInfos().positions[0];

    const fakePositionTokenAccount = await createTokenAccount(
      provider,
      position.mintKeypair.publicKey,
      provider.wallet.publicKey
    );

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: position.publicKey,
          positionMint: position.mintKeypair.publicKey,
          positionTokenAccount: fakePositionTokenAccount,
        })
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails if delegated amount is 0", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await approveToken(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      0,
      owner
    );
    await setAuthority(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      "CloseAccount",
      owner
    );

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: delegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccountAddress,
        })
        .addSigner(delegate)
        .buildAndExecute(),
      /0x1784/ // InvalidPositionTokenAmount
    );
  });

  it("fails if positionAuthority does not match delegate", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const owner = anchor.web3.Keypair.generate();
    const delegate = anchor.web3.Keypair.generate();
    const fakeDelegate = anchor.web3.Keypair.generate();

    const { params } = await openPosition(
      client,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      owner.publicKey
    );

    await approveToken(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      1,
      owner
    );
    await setAuthority(
      client.context.provider,
      params.positionTokenAccountAddress,
      delegate.publicKey,
      "CloseAccount",
      owner
    );

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: fakeDelegate.publicKey,
          receiver: owner.publicKey,
          position: params.positionPda.publicKey,
          positionMint: params.positionMintAddress,
          positionTokenAccount: params.positionTokenAccountAddress,
        })
        .addSigner(fakeDelegate)
        .buildAndExecute(),
      /0x1783/ // MissingOrInvalidDelegate
    );
  });

  it("fails if position token account mint does not match position mint", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN }],
    });
    const {
      poolInitInfo: { tokenMintA },
      positions,
    } = fixture.getInfos();
    const position = positions[0];

    const fakePositionTokenAccount = await createAndMintToTokenAccount(provider, tokenMintA, 1);

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: position.publicKey,
          positionMint: position.mintKeypair.publicKey,
          positionTokenAccount: fakePositionTokenAccount,
        })
        .buildAndExecute(),
      /0x7d3/ // ConstraintRaw
    );
  });

  it("fails if position_mint does not match position's position_mint field", async () => {
    const fixture = await new WhirlpoolTestFixture(client).init({
      tickSpacing: TickSpacing.Standard,
      positions: [{ tickLowerIndex: 0, tickUpperIndex: 128, liquidityAmount: ZERO_BN }],
    });
    const {
      poolInitInfo: { tokenMintA },
      positions,
    } = fixture.getInfos();
    const position = positions[0];

    await assert.rejects(
      client
        .closePositionTx({
          positionAuthority: provider.wallet.publicKey,
          receiver: provider.wallet.publicKey,
          position: position.publicKey,
          positionMint: tokenMintA,
          positionTokenAccount: position.tokenAccount,
        })
        .buildAndExecute(),
      /0x7dc/ // ConstraintAddress
    );
  });
});
