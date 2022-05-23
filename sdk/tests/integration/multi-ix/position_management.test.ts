import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../../../src/context";
import { initTestPool, openPosition } from "../../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../../utils/test-builders";
import { TickSpacing } from "../../utils";
import { AccountFetcher, toTx, WhirlpoolIx } from "../../../src";

describe("position management tests", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = new AccountFetcher(ctx.connection);

  it("successfully closes and opens a position in one transaction", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const { params } = await openPosition(ctx, poolInitInfo.whirlpoolPda.publicKey, 0, 128);
    const receiverKeypair = anchor.web3.Keypair.generate();

    const { params: newParams, mint } = await generateDefaultOpenPositionParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      ctx.wallet.publicKey,
      ctx.wallet.publicKey
    );

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: provider.wallet.publicKey,
        receiver: receiverKeypair.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccount,
      })
    )
      .addInstruction(WhirlpoolIx.openPositionIx(ctx.program, newParams))
      .addSigner(mint)
      .buildAndExecute();

    const closedResponse = await provider.connection.getTokenSupply(params.positionMintAddress);
    assert.equal(closedResponse.value.uiAmount, 0);
    const openResponse = await provider.connection.getTokenSupply(newParams.positionMintAddress);
    assert.equal(openResponse.value.uiAmount, 1);
  });
});
