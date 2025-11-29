import { PublicKey } from "@solana/web3.js";
import type { ConfigFeatureFlagData } from "@orca-so/whirlpools-sdk";
import { FlagUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptChoice, promptConfirm, promptText } from "../utils/prompt";

console.info("set ConfigFeatureFlag...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);

const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

const flags = FlagUtil.u16ToConfigFeatureFlags(whirlpoolsConfig.featureFlags);
const flagChoices = Object.keys(flags).map((name) => ({
  title: name,
  value: name,
}));

const choice = await promptChoice("flag", flagChoices);
const currentFlagValue = flags[choice as keyof typeof flags];

const newFlagValue = await promptChoice(
  `new value for ${choice} (current: ${currentFlagValue})`,
  [
    { title: "true", value: true },
    { title: "false", value: false },
  ],
);

if (currentFlagValue === newFlagValue) {
  throw new Error(`the flag ${choice} is already set to ${newFlagValue}`);
}

const configFeatureFlagData = {} as ConfigFeatureFlagData;
configFeatureFlagData[choice as keyof ConfigFeatureFlagData] = [newFlagValue];

console.info("setting...");
console.info(
  `whirlpoolsConfig: ${whirlpoolsConfigPubkey.toBase58()}`,
  `\nflag: ${choice}`,
  `\ncurrent value: ${currentFlagValue}`,
  `\nnew value: ${newFlagValue}`,
);
console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setConfigFeatureFlagIx(ctx.program, {
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    authority: ctx.wallet.publicKey,
    featureFlag: configFeatureFlagData,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
set ConfigFeatureFlag...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ flag › tokenBadge
✔ new value for tokenBadge (current: false) › true
setting...
whirlpoolsConfig: FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
flag: tokenBadge
current value: false
new value: true

if the above is OK, enter YES
✔ yesno › Yes
estimatedComputeUnits: 102258
✔ priorityFeeInSOL … 0.000005
Priority fee: 0.000005 SOL
process transaction...
transaction is still valid, 149 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 2HSNnn1HYSpfEyrPRW4X5pZBekEEgUeCoDA7Coi6cJVdzjuYWkp6wVq3D7i1nDd24DiEEkMEH9pchFSzg88MWxJ3

*/
