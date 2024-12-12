import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("close Position...");

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

if (!position.liquidity.isZero()) {
  throw new Error("position is not empty (liquidity is not zero)");
}

if (!position.feeOwedA.isZero() || !position.feeOwedB.isZero()) {
  throw new Error("position has collectable fees");
}

if (!position.rewardInfos.every((r) => r.amountOwed.isZero())) {
  throw new Error("position has collectable rewards");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

if (positionMint.tokenProgram.equals(TOKEN_PROGRAM_ID)) {
  builder.addInstruction(
    WhirlpoolIx.closePositionIx(ctx.program, {
      position: positionPubkey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount: getAssociatedTokenAddressSync(
        position.positionMint,
        ctx.wallet.publicKey,
      ),
      positionMint: position.positionMint,
      receiver: ctx.wallet.publicKey,
    }),
  );
} else {
  builder.addInstruction(
    WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
      position: positionPubkey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount: getAssociatedTokenAddressSync(
        position.positionMint,
        ctx.wallet.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      ),
      positionMint: position.positionMint,
      receiver: ctx.wallet.publicKey,
    }),
  );
}

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
close Position...
prompt: positionPubkey:  H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
estimatedComputeUnits: 120649
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature dQwedycTbM9UTYwQiiUE5Q7ydZRzL3zywaQ3xEo3RhHxDvfsY8wkAakSXQRdXswxdQCLLMwwDJVSNHYcTCDDcf3

*/
