import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
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

const updatableRewardIndexes: number[] = [];
whirlpool.rewardInfos.forEach((ri, i) => {
  const updatable = ri.authority.equals(ctx.wallet.publicKey);
  if (updatable) updatableRewardIndexes.push(i);
  console.info(
    `reward[${i}] authority: ${ri.authority.toBase58()} ${updatable ? " (Updatable)" : " (wallet is not authority)"}`,
  );
});

if (updatableRewardIndexes.length === 0) {
  throw new Error("This wallet is NOT reward authority for all reward indexes");
}

console.info(
  "\nEnter new reward authority\n* If you don't want to update it, just type SKIP\n",
);

const newRewardAuthorities: (PublicKey | undefined)[] = [];
for (let i = 0; i < updatableRewardIndexes.length; i++) {
  const newRewardAuthority = await promptText(
    `newRewardAuthority for reward[${updatableRewardIndexes[i]}]`,
  );
  try {
    const newAuthority = new PublicKey(newRewardAuthority);
    if (newAuthority.equals(ctx.wallet.publicKey)) {
      throw new Error("newAuthority is same to the current authority");
    }
    newRewardAuthorities.push(newAuthority);
  } catch (_e) {
    newRewardAuthorities.push(undefined);
  }
}

if (newRewardAuthorities.every((a) => a === undefined)) {
  throw new Error("No new reward authority");
}

console.info("setting...");
for (let i = 0; i < updatableRewardIndexes.length; i++) {
  if (newRewardAuthorities[i]) {
    console.info(
      `\treward[${updatableRewardIndexes[i]}] ${whirlpool.rewardInfos[updatableRewardIndexes[i]].authority.toBase58()} -> ${newRewardAuthorities[i]!.toBase58()}`,
    );
  } else {
    console.info(
      `\treward[${updatableRewardIndexes[i]}] ${whirlpool.rewardInfos[updatableRewardIndexes[i]].authority.toBase58()} (unchanged)`,
    );
  }
}
console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
for (let i = 0; i < updatableRewardIndexes.length; i++) {
  const rewardIndex = updatableRewardIndexes[i];
  const newRewardAuthority = newRewardAuthorities[i];
  if (newRewardAuthority) {
    builder.addInstruction(
      WhirlpoolIx.setRewardAuthorityIx(ctx.program, {
        whirlpool: whirlpoolPubkey,
        rewardIndex,
        rewardAuthority: ctx.wallet.publicKey,
        newRewardAuthority,
      }),
    );
  }
}

await sendTransaction(builder);

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
