import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type { WhirlpoolContext } from "../../../src";
import { toTx } from "../../../src";
import { pollForCondition } from "../../utils/litesvm";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing } from "../../utils";
import {
  loadPreloadAccount,
  initializeLiteSVMEnvironment,
} from "../../utils/litesvm";
import { initTestPool } from "../../utils/init-utils";

describe("migrate_repurpose_reward_authority_space", () => {
  let ctx: WhirlpoolContext;
  let fetcher: WhirlpoolContext["fetcher"];

  beforeAll(async () => {
    const env = await initializeLiteSVMEnvironment();
    ctx = env.ctx;
    fetcher = env.fetcher;
    // Load preload accounts for migration testing
    loadPreloadAccount(
      "migrate_repurpose_reward_authority_space/whirlpool.json",
    );
  });

  // SDK doesn't provide WhirlpoolIx interface for this temporary instruction
  // so we need to use the raw instruction builder
  function migrateRepurposeRewardAuthoritySpace(
    whirlpool: anchor.web3.PublicKey,
  ) {
    const program = ctx.program;

    const ix = program.instruction.migrateRepurposeRewardAuthoritySpace({
      accounts: {
        whirlpool,
      },
    });

    return {
      instructions: [ix],
      cleanupInstructions: [],
      signers: [],
    };
  }

  it("successfully migrate_repurpose_reward_authority_space", async () => {
    // preload whirlpool
    const preloadWhirlpoolAddress = new anchor.web3.PublicKey(
      "7vWRTPPBq3aNaJZsrfterTz1BSjht4YSHBXJwnbuV6SC",
    );

    const preloadWhirlpool = await fetcher.getPool(
      preloadWhirlpoolAddress,
      IGNORE_CACHE,
    );
    const preloadWhirlpoolRawData = await ctx.connection.getAccountInfo(
      preloadWhirlpoolAddress,
      "confirmed",
    );

    assert.ok(preloadWhirlpool);
    assert.ok(preloadWhirlpoolRawData);

    assert.ok(
      new anchor.web3.PublicKey(
        preloadWhirlpool.rewardInfos[0].extension,
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW",
        ),
      ),
    );
    assert.ok(
      new anchor.web3.PublicKey(
        preloadWhirlpool.rewardInfos[1].extension,
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW",
        ),
      ),
    );
    assert.ok(
      new anchor.web3.PublicKey(
        preloadWhirlpool.rewardInfos[2].extension,
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW",
        ),
      ),
    );

    // permission-less
    const migrateTx = toTx(
      ctx,
      migrateRepurposeRewardAuthoritySpace(preloadWhirlpoolAddress),
    );
    await migrateTx.buildAndExecute();

    const migratedWhirlpool = await pollForCondition(
      async () =>
        (await fetcher.getPool(preloadWhirlpoolAddress, IGNORE_CACHE))!,
      (pool) =>
        pool.rewardInfos[1].extension.every((b: number) => b === 0) &&
        pool.rewardInfos[2].extension.every((b: number) => b === 0),
      { maxRetries: 200, delayMs: 10 },
    );
    const migratedWhirlpoolRawData = await ctx.connection.getAccountInfo(
      preloadWhirlpoolAddress,
      "confirmed",
    );

    assert.ok(migratedWhirlpool);
    assert.ok(migratedWhirlpoolRawData);

    assert.ok(
      new anchor.web3.PublicKey(
        migratedWhirlpool.rewardInfos[0].extension,
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW",
        ),
      ),
    );
    assert.ok(
      migratedWhirlpool.rewardInfos[1].extension.every((b: number) => b === 0),
    );
    assert.ok(
      migratedWhirlpool.rewardInfos[2].extension.every((b: number) => b === 0),
    );

    // fields other than rewardInfos should be the same
    assert.ok(
      preloadWhirlpoolRawData.data
        .subarray(0, 269)
        .equals(migratedWhirlpoolRawData.data.subarray(0, 269)),
    );
    for (let i = 0; i < 3; i++) {
      const offset = 269 + i * 128;
      const preload = preloadWhirlpoolRawData.data.subarray(
        offset,
        offset + 128,
      );
      const migrated = migratedWhirlpoolRawData.data.subarray(
        offset,
        offset + 128,
      );

      //   0: mint
      //  32: vault
      //  64: extension (authority)
      //  96: emissionsPerSecondX64
      // 112: growthGlobalX64
      assert.ok(preload.subarray(0, 64).equals(migrated.subarray(0, 64)));
      assert.ok(preload.subarray(96, 112).equals(migrated.subarray(96, 112)));
    }

    // try to migrate again (already migrated, should fail)
    const migrateAgainTx = toTx(
      ctx,
      migrateRepurposeRewardAuthoritySpace(preloadWhirlpoolAddress),
    );
    // NOTE: the actual anchor log reads like
    // > Program log: panicked at programs/whirlpool/src/instructions/migrate_repurpose_reward_authority_space.rs:19:9:\\nWhirlpool has been migrated already",
    await assert.rejects(migrateAgainTx.buildAndExecute(), (err: Error) => {
      return /panicked at.*Whirlpool has been migrated already/s.test(
        err.message,
      );
    });
  });

  it("fail when the instruction is called with a newly initialized whirlpool", async () => {
    // no need to execute migration for a newly initialized whirlpool
    // because new whirlpools already use the new layout

    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const migrateAgainTx = toTx(
      ctx,
      migrateRepurposeRewardAuthoritySpace(poolInitInfo.whirlpoolPda.publicKey),
    );
    // NOTE: the actual anchor log reads like
    // > Program log: panicked at programs/whirlpool/src/instructions/migrate_repurpose_reward_authority_space.rs:19:9:\\nWhirlpool has been migrated already",
    await assert.rejects(migrateAgainTx.buildAndExecute(), (err: Error) => {
      return /panicked at.*Whirlpool has been migrated already/s.test(
        err.message,
      );
    });
  });
});
