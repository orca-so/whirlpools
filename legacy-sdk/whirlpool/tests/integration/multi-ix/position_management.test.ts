import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolIx } from "../../../src";
import type { WhirlpoolContext } from "../../../src/context";
import { initializeLiteSVMEnvironment, TickSpacing } from "../../utils";
import { initTestPool, openPosition } from "../../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../../utils/test-builders";

describe("position management tests", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
  });

  it("successfully closes and opens a position in one transaction", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
    );
    const receiverKeypair = anchor.web3.Keypair.generate();

    const { params: newParams, mint } = await generateDefaultOpenPositionParams(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128,
      ctx.wallet.publicKey,
      ctx.wallet.publicKey,
    );

    await toTx(
      ctx,
      WhirlpoolIx.closePositionIx(ctx.program, {
        positionAuthority: provider.wallet.publicKey,
        receiver: receiverKeypair.publicKey,
        position: params.positionPda.publicKey,
        positionMint: params.positionMintAddress,
        positionTokenAccount: params.positionTokenAccount,
      }),
    )
      .addInstruction(WhirlpoolIx.openPositionIx(ctx.program, newParams))
      .addSigner(mint)
      .buildAndExecute();

    const closedResponse = await provider.connection.getTokenSupply(
      params.positionMintAddress,
    );
    assert.equal(closedResponse.value.uiAmount, 0);
    const openResponse = await provider.connection.getTokenSupply(
      newParams.positionMintAddress,
    );
    assert.equal(openResponse.value.uiAmount, 1);
  });
});
