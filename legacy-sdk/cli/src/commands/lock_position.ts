import { PublicKey } from "@solana/web3.js";
import {
  PDAUtil,
  WhirlpoolIx,
  LockConfigUtil,
  TickUtil,
} from "@orca-so/whirlpools-sdk";
import {
  TransactionBuilder,
} from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("lock position...");

// prompt
const positionPubkeyStr = await promptText("positionPubkey");

const positionPubkey = new PublicKey(positionPubkeyStr);
const position = await ctx.fetcher.getPosition(positionPubkey);
if (!position) {
  throw new Error("position not found");
}
const positionMint = await ctx.fetcher.getMintInfo(position.positionMint);
if (!positionMint) {
  throw new Error("positionMint not found");
}

if (!positionMint.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
  throw new Error("positionMint is not a 2022 token (only Token-2022 based position is supported)");
}
if (position.liquidity.isZero()) {
  throw new Error("position liquidity is zero (empty position is not lockable)");
}

const whirlpoolPubkey = position.whirlpool;
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}

const isFullRange = TickUtil.isFullRange(
  whirlpool.tickSpacing,
  position.tickLowerIndex,
  position.tickUpperIndex,
);

console.info("pool", whirlpoolPubkey.toBase58());
console.info("position", positionPubkey.toBase58());
console.info("position is FullRange", isFullRange);
console.info("position liquidity", position.liquidity.toString());
console.info("lock duration", "PERMANENT");

console.info("\nif the above is OK, enter YES");
console.info(
  "\n>>>>> WARNING: liquidity in the position will be permanently locked and you cannot withdraw any tokens from the position <<<<<\n",
);
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}
const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

const lockConfigPda = PDAUtil.getLockConfig(ctx.program.programId, positionPubkey);
builder.addInstruction(
  WhirlpoolIx.lockPositionIx(ctx.program, {
    position: positionPubkey,
    positionAuthority: ctx.wallet.publicKey,
    positionTokenAccount: getAssociatedTokenAddressSync(
      position.positionMint,
      ctx.wallet.publicKey,
      undefined,
      positionMint.tokenProgram,
    ),
    whirlpool: whirlpoolPubkey,
    funder: ctx.wallet.publicKey,
    positionMint: position.positionMint,
    lockType: LockConfigUtil.getPermanentLockType(),
    lockConfigPda,
  }),
);

const landed = await sendTransaction(builder);
if (landed) {
  console.info("lockConfig address:", lockConfigPda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint https://api.devnet.solana.com
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
lock position...
✔ positionPubkey … 9MtyLDRJK5fBvLozLqzfFdiSgXiH2QBLVDPcDEYJUrRC
pool 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
position 9MtyLDRJK5fBvLozLqzfFdiSgXiH2QBLVDPcDEYJUrRC
position is FullRange false
position liquidity 167853006
lock duration PERMANENT

if the above is OK, enter YES

>>>>> WARNING: liquidity in the position will be permanently locked and you cannot withdraw any tokens from the position <<<<<

✔ yesno › Yes
estimatedComputeUnits: 122039
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 2KYPHS8fumy5ejAzMWVbf7zwwXsWPo8YAAUoMs834GwnzsYvhzYHnGe3nnqus9qN4A1nVdCBjNYYnACNL2UXJBc
lockConfig address: D87H6UzDkUjU2Mz3xGnbx8o3Mwat3t5fiJCgEwJVHCoR

*/
