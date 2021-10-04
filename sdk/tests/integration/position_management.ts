import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { WhirlpoolContext } from "../../src/context";
import { WhirlpoolClient } from "../../src/client";
import { initTestPool, openPosition } from "../utils/init-utils";
import { buildOpenPositionIx } from "../../src/instructions/open-position-ix";
import { generateDefaultOpenPositionParams } from "../utils/test-builders";
import { TickSpacing } from "../utils";

describe("position management tests", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  it("successfully closes and opens a position in one transaction", async () => {
    const { poolInitInfo } = await initTestPool(client, TickSpacing.Standard);

    const { params } = await openPosition(client, poolInitInfo.whirlpoolPda.publicKey, 0, 128);
    const receiverKeypair = anchor.web3.Keypair.generate();

    const { params: newParams, mint } = await generateDefaultOpenPositionParams(
      context,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      context.wallet.publicKey,
      context.wallet.publicKey
    );

    await client
      .closePositionTx({
        positionAuthority: provider.wallet.publicKey,
        receiver: receiverKeypair.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccountAddress,
      })
      .addInstruction(buildOpenPositionIx(context, newParams))
      .addSigner(mint)
      .buildAndExecute();

    const closedResponse = await provider.connection.getTokenSupply(params.positionMintAddress);
    assert.equal(closedResponse.value.uiAmount, 0);
    const openResponse = await provider.connection.getTokenSupply(newParams.positionMintAddress);
    assert.equal(openResponse.value.uiAmount, 1);
  });
});
