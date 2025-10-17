import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { toTx, WhirlpoolContext } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing } from "../../utils";
import {
  startLiteSVM,
  createLiteSVMProvider,
  loadPreloadAccount,
} from "../../utils/litesvm";
import { initTestPool } from "../../utils/init-utils";

describe("migrate_repurpose_reward_authority_space (litesvm)", () => {
  let provider: anchor.AnchorProvider;
  let program: anchor.Program;
  let ctx: WhirlpoolContext;
  let fetcher: any;

  beforeAll(async () => {
    await startLiteSVM();
    provider = await createLiteSVMProvider();
    const programId = new anchor.web3.PublicKey(
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
    );
    const idl = require("../../../src/artifacts/whirlpool.json");
    program = new anchor.Program(idl, programId, provider);
    ctx = WhirlpoolContext.fromWorkspace(provider, program);
    fetcher = ctx.fetcher;

    // Load preload accounts for migration testing
    loadPreloadAccount(
      "migrate_repurpose_reward_authority_space/whirlpool.json"
    );
  });

  // SDK doesn't provide WhirlpoolIx interface for this temporary instruction
  // so we need to use the raw instruction builder
  function migrateRepurposeRewardAuthoritySpace(
    whirlpool: anchor.web3.PublicKey
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
      "7vWRTPPBq3aNaJZsrfterTz1BSjht4YSHBXJwnbuV6SC"
    );

    const preloadWhirlpool = await fetcher.getPool(
      preloadWhirlpoolAddress,
      IGNORE_CACHE
    );
    const preloadWhirlpoolRawData = await ctx.connection.getAccountInfo(
      preloadWhirlpoolAddress,
      "confirmed"
    );

    assert.ok(preloadWhirlpool);
    assert.ok(preloadWhirlpoolRawData);

    assert.ok(
      new anchor.web3.PublicKey(
        preloadWhirlpool.rewardInfos[0].extension
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW"
        )
      )
    );
    assert.ok(
      new anchor.web3.PublicKey(
        preloadWhirlpool.rewardInfos[1].extension
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW"
        )
      )
    );
    assert.ok(
      new anchor.web3.PublicKey(
        preloadWhirlpool.rewardInfos[2].extension
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW"
        )
      )
    );

    // permission-less
    const migrateTx = toTx(
      ctx,
      migrateRepurposeRewardAuthoritySpace(preloadWhirlpoolAddress)
    );
    await migrateTx.buildAndExecute();

    const migratedWhirlpool = await fetcher.getPool(
      preloadWhirlpoolAddress,
      IGNORE_CACHE
    );
    const migratedWhirlpoolRawData = await ctx.connection.getAccountInfo(
      preloadWhirlpoolAddress,
      "confirmed"
    );

    assert.ok(migratedWhirlpool);
    assert.ok(migratedWhirlpoolRawData);

    assert.ok(
      new anchor.web3.PublicKey(
        migratedWhirlpool.rewardInfos[0].extension
      ).equals(
        new anchor.web3.PublicKey(
          "DjDsi34mSB66p2nhBL6YvhbcLtZbkGfNybFeLDjJqxJW"
        )
      )
    );
    assert.ok(
      migratedWhirlpool.rewardInfos[1].extension.every((b: any) => b === 0)
    );
    assert.ok(
      migratedWhirlpool.rewardInfos[2].extension.every((b: any) => b === 0)
    );

    // fields other than rewardInfos should be the same
    assert.ok(
      preloadWhirlpoolRawData.data
        .subarray(0, 269)
        .equals(migratedWhirlpoolRawData.data.subarray(0, 269))
    );
    for (let i = 0; i < 3; i++) {
      const offset = 269 + i * 128;
      const preload = preloadWhirlpoolRawData.data.subarray(
        offset,
        offset + 128
      );
      const migrated = migratedWhirlpoolRawData.data.subarray(
        offset,
        offset + 128
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
      migrateRepurposeRewardAuthoritySpace(preloadWhirlpoolAddress)
    );
    await assert.rejects(
      migrateAgainTx.buildAndExecute(),
      /panicked at 'Whirlpool has been migrated already'/
    );
  });

  it("fail when the instruction is called with a newly initialized whirlpool", async () => {
    // no need to execute migration for a newly initialized whirlpool
    // because new whirlpools already use the new layout

    const { poolInitInfo } = await initTestPool(ctx, TickSpacing.Standard);

    const migrateAgainTx = toTx(
      ctx,
      migrateRepurposeRewardAuthoritySpace(poolInitInfo.whirlpoolPda.publicKey)
    );
    await assert.rejects(
      migrateAgainTx.buildAndExecute(),
      /panicked at 'Whirlpool has been migrated already'/
    );
  });
});
