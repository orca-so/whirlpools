import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set RewardEmissionsSuperAuthority...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const newRewardEmissionsSuperAuthorityPubkeyStr = await promptText(
  "newRewardEmissionsSuperAuthorityPubkey",
);
const newRewardEmissionsSuperAuthorityPubkeyAgainStr = await promptText(
  "newRewardEmissionsSuperAuthorityPubkeyAgain",
);

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const newRewardEmissionsSuperAuthorityPubkey = new PublicKey(
  newRewardEmissionsSuperAuthorityPubkeyStr,
);
const newRewardEmissionsSuperAuthorityPubkeyAgain = new PublicKey(
  newRewardEmissionsSuperAuthorityPubkeyAgainStr,
);

if (
  !newRewardEmissionsSuperAuthorityPubkey.equals(
    newRewardEmissionsSuperAuthorityPubkeyAgain,
  )
) {
  throw new Error(
    "newRewardEmissionsSuperAuthorityPubkey and newRewardEmissionsSuperAuthorityPubkeyAgain must be the same",
  );
}

const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (
  !whirlpoolsConfig.rewardEmissionsSuperAuthority.equals(ctx.wallet.publicKey)
) {
  throw new Error(
    `the current wallet must be the reward emissions super authority(${whirlpoolsConfig.rewardEmissionsSuperAuthority.toBase58()})`,
  );
}

console.info(
  "setting...",
  "\n\trewardEmissionsSuperAuthority",
  whirlpoolsConfig.rewardEmissionsSuperAuthority.toBase58(),
  "\n\tnewRewardEmissionsSuperAuthority",
  newRewardEmissionsSuperAuthorityPubkey.toBase58(),
);
console.info("\nif the above is OK, enter YES");
console.info(
  "\n>>>>> WARNING: authority transfer is highly sensitive operation, please double check new authority address <<<<<\n",
);
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setRewardEmissionsSuperAuthorityIx(ctx.program, {
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    rewardEmissionsSuperAuthority: whirlpoolsConfig.rewardEmissionsSuperAuthority,
    newRewardEmissionsSuperAuthority: newRewardEmissionsSuperAuthorityPubkey,
  }),
);

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
set RewardEmissionsSuperAuthority...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ newRewardEmissionsSuperAuthorityPubkey … 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
✔ newRewardEmissionsSuperAuthorityPubkeyAgain … 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
setting... 
        rewardEmissionsSuperAuthority 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5 
        newRewardEmissionsSuperAuthority 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo

if the above is OK, enter YES

>>>>> WARNING: authority transfer is highly sensitive operation, please double check new authority address <<<<<

✔ yesno › Yes
estimatedComputeUnits: 102385
✔ priorityFeeInSOL … 0.000002
Priority fee: 0.000002 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 432eMv1tPRN6JU7b7ezFCSU1npEVudkmfXcVsUYEnyGep988oLraMP9cz7nMEcwzhh8xW3YfnHZa4eReHU5tfzfC

*/
