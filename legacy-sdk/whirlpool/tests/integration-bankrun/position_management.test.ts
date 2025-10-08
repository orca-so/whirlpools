/**
 * Position Management Test - Bankrun Version
 *
 * This demonstrates the minimal changes needed to migrate from solana-test-validator to bankrun:
 * - Replace provider initialization with bankrun
 * - Load program explicitly
 * - Everything else stays exactly the same!
 *
 * NOTE: This test requires the SDK to be built first (`yarn build`) and imports
 * from the compiled dist. For TypeScript source imports, use anchor test framework.
 */
import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolIx, WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import { TickSpacing } from "../utils";
import { startBankrun, createBankrunProvider } from "../utils/bankrun";
import { initTestPool, openPosition } from "../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../utils/test-builders";

describe("position management tests (bankrun)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;

  beforeAll(async () => {
    // Initialize bankrun (replaces solana-test-validator)
    await startBankrun();

    // Create provider (replaces anchor.AnchorProvider.local())
    provider = await createBankrunProvider();

    // Load program (replaces anchor.workspace.Whirlpool)
    const programId = new anchor.web3.PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
    );
    const idl = require("../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);

    // Create context (same as original)
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
  });

  it("successfully closes and opens a position in one transaction", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const { params } = await openPosition(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      0,
      128
    );
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

    const closedResponse = await provider.connection.getTokenSupply(
      params.positionMintAddress
    );
    assert.equal(closedResponse.value.uiAmount, 0);
    const openResponse = await provider.connection.getTokenSupply(
      newParams.positionMintAddress
    );
    assert.equal(openResponse.value.uiAmount, 1);
  });
});
