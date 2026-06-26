import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type {
  InitPoolParams,
  InitTickArrayParams,
  TickArrayData,
  WhirlpoolContext,
} from "../../../../src";
import { getAccountSize, AccountName, TICK_ARRAY_SIZE, WhirlpoolIx, toTx, MAX_PREPARED_SWAP_NONCE } from "../../../../src";
import { expireBlockhash, initializeLiteSVMEnvironment } from "../../../utils/litesvm";
import { PDAUtil } from "../../../../dist/utils/public/pda-utils";
import { ONE_SOL, systemTransferTx } from "../../../utils";
import { PublicKey, SystemProgram } from "@solana/web3.js";

describe("initialize_prepared_swap", () => {
  let provider: anchor.AnchorProvider;
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    provider = env.provider;
    ctx = env.ctx;
    fetcher = env.fetcher;
  });

  it("successfully init a PreparedSwap account (nonce = 0)", async () => {
    const nonce = 0;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo === null);

    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        nonce,
        preparedSwapPda,
      }),
    ).buildAndExecute();
    
    const postAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(postAccountInfo);
    assert.ok(postAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
  });

  it("successfully init a PreparedSwap account (nonce = MAX_PREPARED_SWAP_NONCE)", async () => {
    const nonce = MAX_PREPARED_SWAP_NONCE;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo === null);

    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: ctx.wallet.publicKey,
        nonce,
        preparedSwapPda,
      }),
    ).buildAndExecute();
    
    const postAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(postAccountInfo);
    assert.ok(postAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();

    const nonce = 1; // Note: We need to use new nonce because these test cases uses the same liteSVM env.
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo === null);

    await toTx(
      ctx,
      WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
        funder: funderKeypair.publicKey,
        nonce,
        preparedSwapPda,
      }),
    )
    .addSigner(funderKeypair)
    .buildAndExecute();
    
    const postAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(postAccountInfo);
    assert.ok(postAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
  });

  it("fails when the accout has been already initialized", async () => {
    const nonce = 0;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    // Initialize the account if needed.
    // Note: these tests share the same LiteSVM environment, so the account may have
    // already been initialized. We intentionally ignore the error here, and only
    // care that the account is initialized after this step.
    try {
      await toTx(
        ctx,
        WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: ctx.wallet.publicKey,
          nonce,
          preparedSwapPda,
        }),
      ).buildAndExecute();
    } catch (e) {}

    // The above transaction and the following transaction may generate the same signature.
    // This step is needed to ensure that the following transaction generate a different one.
    // Note: Without this step, I saw the following error, but "6 (NotEnoughAccountKeys" was wrong.
    //       "6" means "AlreadyProcessed" here.
    // 
    // Error: Failed to process transaction: Transaction failed:
    // Error: 6 (NotEnoughAccountKeys)
    expireBlockhash();

    const preAccountInfo = await provider.connection.getAccountInfo(preparedSwapPda.publicKey);
    assert.ok(preAccountInfo);
    assert.ok(preAccountInfo.data.length == getAccountSize(AccountName.PreparedSwap));
    
    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: ctx.wallet.publicKey,
          nonce,
          preparedSwapPda,
        }),
      ).buildAndExecute(),
      (err: Error) => {
        return err.message.includes("already in use");
      },
    );
  });

  it("fails when PDA is invalid", async () => {
    const nonce = 0;
    const invalidPreparedSwapPda = PDAUtil.getPosition(ctx.program.programId, PublicKey.unique());

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: ctx.wallet.publicKey,
          nonce,
          preparedSwapPda: invalidPreparedSwapPda,
        }),
      ).buildAndExecute(),
      /0x7d6/, // ConstraintSeeds
    );
  });

  it("fails when nonce is invalid", async () => {
    const invalidNonceArray = [MAX_PREPARED_SWAP_NONCE + 1, 0x00FF, 0xFFFF];

    for (const nonce of invalidNonceArray) {
      const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

      await assert.rejects(
        toTx(
          ctx,
          WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
            funder: ctx.wallet.publicKey,
            nonce,
            preparedSwapPda,
          }),
        ).buildAndExecute(),
        /0x17b6/, // PreparedSwapNonceMaxExceeded
      );
    }
  });

  it("fails when funder is not signer", async () => {
    const funderKeypair = anchor.web3.Keypair.generate();
    await systemTransferTx(
      provider,
      funderKeypair.publicKey,
      ONE_SOL,
    ).buildAndExecute();

    const nonce = 2;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const ix = WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: funderKeypair.publicKey,
          nonce,
          preparedSwapPda,
        }).instructions[0];
    
    assert.equal(ix.keys.length, 3);
    assert.ok(ix.keys[0].pubkey.equals(funderKeypair.publicKey));

    // unset signer flag
    ix.keys[0].isSigner = false;

    const tx = toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      // not add funderKeypair as additional signer
      signers: [],
    });

    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc2/, // AccountNotSigner
    );
  });

  it("fails when system program is invalid", async () => {
    const nonce = 2;
    const preparedSwapPda = PDAUtil.getPreparedSwap(ctx.program.programId, nonce);

    const ix = WhirlpoolIx.initializePreparedSwapIx(ctx.program, {
          funder: ctx.wallet.publicKey,
          nonce,
          preparedSwapPda,
        }).instructions[0];
    
    assert.equal(ix.keys.length, 3);
    assert.ok(ix.keys[2].pubkey.equals(SystemProgram.programId));

    ix.keys[2].pubkey = PublicKey.unique();

    const tx = toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [],
    });

    await assert.rejects(
      tx.buildAndExecute(),
      /0xbc0/, // InvalidProgramId
    );
  });
});
