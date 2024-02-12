import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";
import {
  AccountName,
  getAccountSize,
  NUM_ORACLE_OBSERVATIONS,
  PDAUtil,
  toTx,
  WhirlpoolContext
} from "../../src";
import { IGNORE_CACHE } from "../../src/network/public/fetcher";
import {
  TickSpacing
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initializeOracle, initTestPool } from "../utils/init-utils";

describe("initialize_oracle", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);


  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  async function createInitializeOracleTx(ctx: WhirlpoolContext, whirlpool: PublicKey, overwrite: any) {
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpool);

    const defaultAccounts = {
      whirlpool,
      funder: ctx.wallet.publicKey,
      oracle: oraclePda.publicKey,
      systemProgram: SystemProgram.programId,
    };

    const ix = program.instruction.initializeOracle({
      accounts: {
        ...defaultAccounts,
        ...overwrite,
      }
    });

    return toTx(ctx, {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [],
    });
  }

  async function checkInitializedOracle(whirlpool: PublicKey, oraclePubkey: PublicKey) {
    const accountInfo = await ctx.connection.getAccountInfo(oraclePubkey);
    assert.ok(accountInfo!.data.length === getAccountSize(AccountName.Oracle));

    const oracle = await ctx.fetcher.getOracle(oraclePubkey, IGNORE_CACHE);
    assert.ok(oracle!.whirlpool.equals(whirlpool));
    assert.strictEqual(oracle!.observationIndex, 0);
    assert.strictEqual(oracle!.observations.length, NUM_ORACLE_OBSERVATIONS);

    assert.ok(oracle!.observations[0].tickCumulative.isZero());
    assert.ok(oracle!.observations[0].timestamp > 0);
    const timestampDelta = oracle!.observations[0].timestamp - Math.floor(Date.now() / 1000);
    assert.ok(timestampDelta < 10);
    for (let i = 1; i < NUM_ORACLE_OBSERVATIONS; i++) {
      assert.ok(oracle!.observations[i].tickCumulative.isZero());
      assert.ok(oracle!.observations[i].timestamp === 0);
    }
  }

  async function createOtherWallet(): Promise<Keypair> {
    const keypair = Keypair.generate();
    const signature = await provider.connection.requestAirdrop(keypair.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(signature, "confirmed");
    return keypair;
  }

  it("successfully initialize oracle and verify initialized account contents", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);
    const oracleInfo = await initializeOracle(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      // funder = ctx.wallet.publicKey
    )

    const { oraclePda } = oracleInfo;
    await checkInitializedOracle(poolInitInfo.whirlpoolPda.publicKey, oraclePda.publicKey);
  });

  it("successfully initialize when funder is different than account paying for transaction fee", async () => {
    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const preBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);

    const otherWallet = await createOtherWallet();
    const oracleInfo = await initializeOracle(
      ctx,
      poolInitInfo.whirlpoolPda.publicKey,
      otherWallet,
    );

    const postBalance = await ctx.connection.getBalance(ctx.wallet.publicKey);
    const diffBalance = preBalance - postBalance;
    const minRent = await ctx.connection.getMinimumBalanceForRentExemption(0);
    assert.ok(diffBalance < minRent); // ctx.wallet didn't pay any rent

    const { oraclePda } = oracleInfo;
    await checkInitializedOracle(poolInitInfo.whirlpoolPda.publicKey, oraclePda.publicKey);
  });

  describe("invalid input account", () => {
    it("should be failed: invalid oracle address", async () => {
      const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

      const tx = await createInitializeOracleTx(ctx, poolInitInfo.whirlpoolPda.publicKey, {
        // invalid parameter
        oracle: PDAUtil.getOracle(ctx.program.programId, Keypair.generate().publicKey).publicKey,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0x7d6/ // ConstraintSeeds
      );
    });

    it("should be failed: invalid whirlpool address", async () => {
      const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

      const tx = await createInitializeOracleTx(ctx, poolInitInfo.whirlpoolPda.publicKey, {
        // invalid parameter
        whirlpool: Keypair.generate().publicKey,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc4/ // AccountNotInitialized (no whirlpool found)
      );
    });

    it("should be failed: invalid system program", async () => {
      const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

      const tx = await createInitializeOracleTx(ctx, poolInitInfo.whirlpoolPda.publicKey, {
        // invalid parameter
        systemProgram: TOKEN_PROGRAM_ID,
      });

      await assert.rejects(
        tx.buildAndExecute(),
        /0xbc0/ // InvalidProgramId
      );
    });
  });

});
