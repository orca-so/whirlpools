import { Keypair } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

console.info("initialize PositionBundle...");

const positionBundleMintKeypair = Keypair.generate();

const pda = PDAUtil.getPositionBundle(
  ctx.program.programId,
  positionBundleMintKeypair.publicKey,
);

// PositionBundle is Token program based (not Token-2022 program based)
const positionBundleTokenAccount = getAssociatedTokenAddressSync(
  positionBundleMintKeypair.publicKey,
  ctx.wallet.publicKey,
);

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializePositionBundleIx(ctx.program, {
    owner: ctx.wallet.publicKey,
    positionBundleMintKeypair,
    positionBundlePda: pda,
    positionBundleTokenAccount,
    funder: ctx.wallet.publicKey,
  }),
);

const landed = await sendTransaction(builder);
if (landed) {
  console.info("positionBundle address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize PositionBundle...
estimatedComputeUnits: 170954
✔ priorityFeeInSOL … 0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
successfully landed
signature 55Qs1vGXeQ8EXokLLdPbD3iYEjPPM2ryvStU3cQm4Qw4sVhboRxzFZwdjPqZR4rGcRQygJut9puYWS1V8i94zsUH
positionBundle address: 3XmaBcpvHdNTv6u35M13w55SpJKVhxSahTkzMiVRVsqC

*/
