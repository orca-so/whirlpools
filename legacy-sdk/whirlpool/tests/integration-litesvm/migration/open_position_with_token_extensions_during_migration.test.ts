import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TEST_TOKEN_2022_PROGRAM_ID, TEST_TOKEN_PROGRAM_ID } from "../../utils";
import {
  startLiteSVM,
  createLiteSVMProvider,
  loadPreloadAccount,
} from "../../utils/litesvm";
import {
  getAssociatedTokenAddressSync,
  getMint,
  getNonTransferable,
} from "@solana/spl-token";

describe("open_position_with_token_extensions (during migration) (litesvm)", () => {
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
    loadPreloadAccount("open_position_with_token_extensions/whirlpool.json");
  });

  // preload whirlpool
  const tickLowerIndex = 29440;
  const tickUpperIndex = 33536;
  const preloadWhirlpoolAddress = new anchor.web3.PublicKey(
    "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
  );

  it(`non-transferable position feature is available on new or migrated pools only`, async () => {
    const whirlpool = await fetcher.getPool(
      preloadWhirlpoolAddress,
      IGNORE_CACHE
    );

    assert.ok(whirlpool);
    // not migrated
    assert.ok(!whirlpool.rewardInfos[2].extension.every((b: any) => b === 0));
    // REQUIRE_NON_TRANSFERABLE_POSITION bit is 1 (if it is treated as controll_flags)
    assert.ok((whirlpool.rewardInfos[1].extension[0] & 0x01) === 0x01);

    const positionMintKeypair = anchor.web3.Keypair.generate();
    const positionPda = PDAUtil.getPosition(
      ctx.program.programId,
      positionMintKeypair.publicKey
    );
    const positionTokenAccount = getAssociatedTokenAddressSync(
      positionMintKeypair.publicKey,
      provider.wallet.publicKey,
      false,
      TEST_TOKEN_2022_PROGRAM_ID
    );
    const openPositionWithTokenExtensionsIx =
      WhirlpoolIx.openPositionWithTokenExtensionsIx(ctx.program, {
        whirlpool: preloadWhirlpoolAddress,
        funder: provider.wallet.publicKey,
        owner: provider.wallet.publicKey,
        positionMint: positionMintKeypair.publicKey,
        positionPda,
        positionTokenAccount,
        tickLowerIndex,
        tickUpperIndex,
        withTokenMetadataExtension: true,
      });

    await toTx(ctx, openPositionWithTokenExtensionsIx)
      .addSigner(positionMintKeypair)
      .buildAndExecute();

    const position = await fetcher.getPosition(
      positionPda.publicKey,
      IGNORE_CACHE
    );
    assert.ok(position);

    // NonTransferable extension should NOT be set on the position mint
    const positionMint = await getMint(
      provider.connection,
      positionMintKeypair.publicKey,
      undefined,
      TEST_TOKEN_2022_PROGRAM_ID
    );
    const nonTransferable = getNonTransferable(positionMint);
    assert.ok(!nonTransferable);
  });

  it(`not block open_position instruction`, async () => {
    const whirlpool = await fetcher.getPool(
      preloadWhirlpoolAddress,
      IGNORE_CACHE
    );

    assert.ok(whirlpool);
    // not migrated
    assert.ok(!whirlpool.rewardInfos[2].extension.every((b: any) => b === 0));
    // REQUIRE_NON_TRANSFERABLE_POSITION bit is 1 (if it is treated as controll_flags)
    assert.ok((whirlpool.rewardInfos[1].extension[0] & 0x01) === 0x01);

    const positionMintKeypair = anchor.web3.Keypair.generate();
    const positionPda = PDAUtil.getPosition(
      ctx.program.programId,
      positionMintKeypair.publicKey
    );
    const positionTokenAccount = getAssociatedTokenAddressSync(
      positionMintKeypair.publicKey,
      provider.wallet.publicKey,
      false,
      TEST_TOKEN_PROGRAM_ID
    );
    const openPositionIx = WhirlpoolIx.openPositionIx(ctx.program, {
      whirlpool: preloadWhirlpoolAddress,
      funder: provider.wallet.publicKey,
      owner: provider.wallet.publicKey,
      positionMintAddress: positionMintKeypair.publicKey,
      positionPda,
      positionTokenAccount,
      tickLowerIndex,
      tickUpperIndex,
    });

    await toTx(ctx, openPositionIx)
      .addSigner(positionMintKeypair)
      .buildAndExecute();

    const position = await fetcher.getPosition(
      positionPda.publicKey,
      IGNORE_CACHE
    );
    assert.ok(position);
  });
});
