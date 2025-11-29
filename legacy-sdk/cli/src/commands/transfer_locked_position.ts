import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { resolveOrCreateATA, TransactionBuilder } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("transfer locked position...");

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

const lockConfigPda = PDAUtil.getLockConfig(
  ctx.program.programId,
  positionPubkey,
);
const lockConfig = await ctx.fetcher.getLockConfig(lockConfigPda.publicKey);
if (!lockConfig) {
  throw new Error("position is not locked");
}

// it is possible to hold positions using non-ATA account, but it is rare case
const positionTokenAccountPubkey = getAssociatedTokenAddressSync(
  position.positionMint,
  ctx.wallet.publicKey,
  true,
  positionMint.tokenProgram,
);
const positionTokenAccount = await ctx.fetcher.getTokenInfo(
  positionTokenAccountPubkey,
);
if (!positionTokenAccount || positionTokenAccount.amount !== 1n) {
  throw new Error("position NFT not found on wallet ATA");
}

const newOwnerPubkeyStr = await promptText("newOwnerPubkey");
const newOwnerPubkey = new PublicKey(newOwnerPubkeyStr);
const newOwnerPositionTokenAccountPubkey = getAssociatedTokenAddressSync(
  position.positionMint,
  newOwnerPubkey,
  true,
  positionMint.tokenProgram,
);
const newOwnerPositionTokenAccount = await ctx.fetcher.getTokenInfo(
  newOwnerPositionTokenAccountPubkey,
);
const initializeDestinationTokenAccount = newOwnerPositionTokenAccount === null;

console.info("pool", position.whirlpool.toBase58());
console.info("position", positionPubkey.toBase58());
console.info("position liquidity", position.liquidity.toString());
console.info("new owner", newOwnerPubkey.toBase58());
console.info(
  "new owner ATA address",
  newOwnerPositionTokenAccountPubkey.toBase58(),
  initializeDestinationTokenAccount ? "(will be created)" : "(already exists)",
);

console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}
const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

if (initializeDestinationTokenAccount) {
  const ixs = await resolveOrCreateATA(
    ctx.connection,
    newOwnerPubkey,
    position.positionMint,
    ctx.fetcher.getAccountRentExempt,
    undefined,
    ctx.wallet.publicKey,
    false,
    true,
  );
  builder.addInstruction(ixs);
}

builder.addInstruction(
  WhirlpoolIx.transferLockedPositionIx(ctx.program, {
    position: positionPubkey,
    positionAuthority: ctx.wallet.publicKey,
    positionTokenAccount: positionTokenAccountPubkey,
    destinationTokenAccount: newOwnerPositionTokenAccountPubkey,
    positionMint: position.positionMint,
    lockConfig: lockConfigPda.publicKey,
    receiver: ctx.wallet.publicKey,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint https://api.devnet.solana.com
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
transfer locked position...
✔ positionPubkey … 9MtyLDRJK5fBvLozLqzfFdiSgXiH2QBLVDPcDEYJUrRC
✔ newOwnerPubkey … r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
pool 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
position 9MtyLDRJK5fBvLozLqzfFdiSgXiH2QBLVDPcDEYJUrRC
position liquidity 167853006
new owner r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
new owner ATA address Fhjos7zsvuDnXHBAuWkS1Z8p8enmg6pLPup5Tqq7mutV (will be created)

if the above is OK, enter YES
✔ yesno › Yes
estimatedComputeUnits: 149952
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 28yaH8eqknb7iv3ty9xaEZH1UG3CMSPMwT3R6ACtBXkXc7qrupAynhm2pUsK4u7BuCXwnmryKmmwmiikp1uUwRxP

*/
