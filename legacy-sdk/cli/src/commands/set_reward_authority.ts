import { PublicKey } from "@solana/web3.js";
import { PoolUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set RewardAuthority...");

// prompt
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");

const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}

const rewardAuthority = PoolUtil.getRewardAuthority(whirlpool);

if (!rewardAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error("This wallet is NOT reward authority");
}

const newRewardAuthorityStr = await promptText(`newRewardAuthority`);
const newRewardAuthority = new PublicKey(newRewardAuthorityStr);
if (newRewardAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error("newAuthority is same to the current authority");
}

console.info("setting...");
console.info(
  `\treward authority ${rewardAuthority.toBase58()} -> ${newRewardAuthority.toBase58()}`,
);

console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
    whirlpool: whirlpoolPubkey,
    rewardIndex: 0, // will be ignored
    rewardAuthority: ctx.wallet.publicKey,
    newRewardAuthority,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
set RewardAuthority...
✔ whirlpoolPubkey … 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
reward[0] authority: 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo  (Updatable)
reward[1] authority: 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5  (wallet is not authority)
reward[2] authority: 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo  (Updatable)

Enter new reward authority
* If you don't want to update it, just type SKIP

✔ newRewardAuthority for reward[0] … SKIP
✔ newRewardAuthority for reward[2] … 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
setting...
        reward[0] 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo (unchanged)
        reward[2] 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo -> 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5

if the above is OK, enter YES
✔ yesno › Yes
estimatedComputeUnits: 103936
✔ priorityFeeInSOL … 0.000001
Priority fee: 0.000001 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 5iLophVC1xsk2MsCZQ5pW81Pa18ta7pe1FsNHQPUptdRh2kLDTHw54MQNwKd5HbVY9kzqNvEELrN4xB29gUhwAPx

*/
