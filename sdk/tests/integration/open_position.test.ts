import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { PDA } from "@orca-so/common-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";
import {
  InitPoolParams,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  OpenPositionParams,
  PDAUtil,
  PositionData,
  toTx,
  WhirlpoolContext,
  WhirlpoolIx
} from "../../src";
import {
  createMint,
  createMintInstructions,
  mintToByAuthority,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  ZERO_BN
} from "../utils";
import { defaultConfirmOptions } from "../utils/const";
import { initTestPool, openPosition } from "../utils/init-utils";
import { generateDefaultOpenPositionParams } from "../utils/test-builders";

describe("open_position", () => {
  const provider = anchor.AnchorProvider.local(undefined, defaultConfirmOptions);

  const program = anchor.workspace.Whirlpool;
  const ctx = WhirlpoolContext.fromWorkspace(provider, program);
  const fetcher = ctx.fetcher;

  let defaultParams: OpenPositionParams;
  let defaultMint: Keypair;
  const tickLowerIndex = 0;
  const tickUpperIndex = 128;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(ctx, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    const { params, mint } = await generateDefaultOpenPositionParams(
      ctx,
      whirlpoolPda.publicKey,
      0,
      128,
      provider.wallet.publicKey
    );
    defaultParams = params;
    defaultMint = mint;
    await systemTransferTx(provider, funderKeypair.publicKey, ONE_SOL).buildAndExecute();
  });

  it("successfully opens position and verify position address contents", async () => {
    const positionInitInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionMintAddress } = positionInitInfo.params;

    const position = (await fetcher.getPosition(positionPda.publicKey)) as PositionData;

    assert.strictEqual(position.tickLowerIndex, tickLowerIndex);
    assert.strictEqual(position.tickUpperIndex, tickUpperIndex);
    assert.ok(position.whirlpool.equals(poolInitInfo.whirlpoolPda.publicKey));
    assert.ok(position.positionMint.equals(positionMintAddress));
    assert.ok(position.liquidity.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointA.eq(ZERO_BN));
    assert.ok(position.feeGrowthCheckpointB.eq(ZERO_BN));
    assert.ok(position.feeOwedA.eq(ZERO_BN));
    assert.ok(position.feeOwedB.eq(ZERO_BN));

    // TODO: Add tests for rewards
  });

  it("succeeds when funder is different than account paying for transaction fee", async () => {
    await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      provider.wallet.publicKey,
      funderKeypair
    );
  });

  it("open position & verify position mint behavior", async () => {
    const newOwner = web3.Keypair.generate();

    const positionInitInfo = await openPosition(
      ctx,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      newOwner.publicKey
    );
    const { positionMintAddress, positionTokenAccount: positionTokenAccountAddress } =
      positionInitInfo.params;

    const token = new Token(
      ctx.connection,
      positionMintAddress,
      TOKEN_PROGRAM_ID,
      web3.Keypair.generate()
    );

    const userTokenAccount = await token.getAccountInfo(positionTokenAccountAddress);
    assert.ok(userTokenAccount.amount.eq(new anchor.BN(1)));
    assert.ok(userTokenAccount.owner.equals(newOwner.publicKey));

    await assert.rejects(
      mintToByAuthority(provider, positionMintAddress, positionTokenAccountAddress, 1),
      /0x5/ // the total supply of this token is fixed
    );
  });

  it("user must pass the valid token ATA account", async () => {
    const anotherMintKey = await createMint(provider, provider.wallet.publicKey);
    const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      anotherMintKey,
      ctx.provider.wallet.publicKey
    );

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionIx(ctx.program, {
          ...defaultParams,
          positionTokenAccount: positionTokenAccountAddress,
        })
      )
        .addSigner(defaultMint)
        .buildAndExecute(),
      /An account required by the instruction is missing/
    );
  });

  describe("invalid ticks", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      await assert.rejects(
        openPosition(
          ctx,
          whirlpoolPda.publicKey,
          lowerTick,
          upperTick,
          provider.wallet.publicKey,
          funderKeypair
        ),
        /0x177a/ // InvalidTickIndex
      );
    }

    it("fail when user pass in an out of bound tick index for upper-index", async () => {
      await assertTicksFail(0, MAX_TICK_INDEX + 1);
    });

    it("fail when user pass in a lower tick index that is higher than the upper-index", async () => {
      await assertTicksFail(-22534, -22534 - 1);
    });

    it("fail when user pass in a lower tick index that equals the upper-index", async () => {
      await assertTicksFail(22365, 22365);
    });

    it("fail when user pass in an out of bound tick index for lower-index", async () => {
      await assertTicksFail(MIN_TICK_INDEX - 1, 0);
    });

    it("fail when user pass in a non-initializable tick index for upper-index", async () => {
      await assertTicksFail(0, 1);
    });

    it("fail when user pass in a non-initializable tick index for lower-index", async () => {
      await assertTicksFail(1, 2);
    });
  });

  it("fail when position mint already exists", async () => {
    const positionMintKeypair = anchor.web3.Keypair.generate();
    const positionPda = PDAUtil.getPosition(ctx.program.programId, positionMintKeypair.publicKey);

    const positionTokenAccountAddress = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      positionMintKeypair.publicKey,
      provider.wallet.publicKey
    );

    const tx = new web3.Transaction();
    tx.add(
      ...(await createMintInstructions(
        provider,
        provider.wallet.publicKey,
        positionMintKeypair.publicKey
      ))
    );

    await provider.sendAndConfirm(tx, [positionMintKeypair], { commitment: "confirmed" });

    await assert.rejects(
      toTx(
        ctx,
        WhirlpoolIx.openPositionIx(ctx.program, {
          funder: provider.wallet.publicKey,
          owner: provider.wallet.publicKey,
          positionPda,
          positionMintAddress: positionMintKeypair.publicKey,
          positionTokenAccount: positionTokenAccountAddress,
          whirlpool: whirlpoolPda.publicKey,
          tickLowerIndex: 0,
          tickUpperIndex: 128,
        })
      )
        .addSigner(positionMintKeypair)
        .buildAndExecute(),
      /0x0/
    );
  });
});
