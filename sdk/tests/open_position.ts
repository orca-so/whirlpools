import * as assert from "assert";
import * as anchor from "@project-serum/anchor";
import { web3 } from "@project-serum/anchor";
import { Keypair } from "@solana/web3.js";
import { WhirlpoolClient } from "../src/client";
import { WhirlpoolContext } from "../src/context";
import { initTestPool, openPosition } from "./utils/init-utils";
import {
  getPositionPda,
  InitPoolParams,
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  OpenPositionParams,
  PDA,
} from "../src";
import {
  createMint,
  createMintInstructions,
  mintToByAuthority,
  ONE_SOL,
  systemTransferTx,
  TickSpacing,
  ZERO_BN,
} from "./utils";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { generateDefaultOpenPositionParams } from "./utils/test-builders";

describe("open_position", () => {
  const provider = anchor.Provider.local();
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Whirlpool;
  const context = WhirlpoolContext.fromWorkspace(provider, program);
  const client = new WhirlpoolClient(context);

  let defaultParams: OpenPositionParams;
  let defaultMint: Keypair;
  const tickLowerIndex = 0;
  const tickUpperIndex = 128;
  let poolInitInfo: InitPoolParams;
  let whirlpoolPda: PDA;
  const funderKeypair = anchor.web3.Keypair.generate();

  before(async () => {
    poolInitInfo = (await initTestPool(client, TickSpacing.Standard)).poolInitInfo;
    whirlpoolPda = poolInitInfo.whirlpoolPda;

    const { params, mint } = await generateDefaultOpenPositionParams(
      client.context,
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
      client,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex
    );
    const { positionPda, positionMintAddress } = positionInitInfo.params;

    const position = await client.getPosition(positionPda.publicKey);

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
      client,
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
      client,
      whirlpoolPda.publicKey,
      tickLowerIndex,
      tickUpperIndex,
      newOwner.publicKey
    );
    const { positionMintAddress, positionTokenAccountAddress } = positionInitInfo.params;

    const token = new Token(
      context.connection,
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
      context.provider.wallet.publicKey
    );

    await assert.rejects(
      client
        .openPositionTx({ ...defaultParams, positionTokenAccountAddress })
        .addSigner(defaultMint)
        .buildAndExecute(),
      /An account required by the instruction is missing/
    );
  });

  describe("invalid ticks", () => {
    async function assertTicksFail(lowerTick: number, upperTick: number) {
      await assert.rejects(
        openPosition(
          client,
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
    const positionPda = getPositionPda(context.program.programId, positionMintKeypair.publicKey);

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

    await provider.send(tx, [positionMintKeypair], { commitment: "confirmed" });

    await assert.rejects(
      client
        .openPositionTx({
          funder: provider.wallet.publicKey,
          ownerKey: provider.wallet.publicKey,
          positionPda,
          positionMintAddress: positionMintKeypair.publicKey,
          positionTokenAccountAddress: positionTokenAccountAddress,
          whirlpoolKey: whirlpoolPda.publicKey,
          tickLowerIndex: 0,
          tickUpperIndex: 128,
        })
        .addSigner(positionMintKeypair)
        .buildAndExecute(),
      /0x0/
    );
  });
});
