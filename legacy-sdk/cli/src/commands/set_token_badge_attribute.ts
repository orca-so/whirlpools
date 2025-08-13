import { PublicKey } from "@solana/web3.js";
import type { TokenBadgeAttributeData } from "@orca-so/whirlpools-sdk";
import { IGNORE_CACHE, PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptChoice, promptConfirm, promptText } from "../utils/prompt";

console.info("set TokenBadgeAttribute...");

const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const tokenMintStr = await promptText("tokenMint");

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const tokenMint = new PublicKey(tokenMintStr);

const pda = PDAUtil.getTokenBadge(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tokenMint,
);
const configExtensionPda = PDAUtil.getConfigExtension(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
);
const configExtension = await ctx.fetcher.getConfigExtension(
  configExtensionPda.publicKey,
);

if (!configExtension) {
  throw new Error("configExtension not found");
}

if (!configExtension.tokenBadgeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the token badge authority(${configExtension.tokenBadgeAuthority.toBase58()})`,
  );
}

const tokenBadge = await ctx.fetcher.getTokenBadge(pda.publicKey, IGNORE_CACHE);
if (!tokenBadge) {
  throw new Error("tokenBadge not found");
}

const attributes = Object.keys(tokenBadge).filter((key) =>
  key.startsWith("attribute"),
);

console.info("current attributes:");
for (const attribute of attributes) {
  console.info(
    "\t",
    attribute,
    ":",
    tokenBadge[attribute as keyof typeof tokenBadge],
  );
}

const attributeChoices = attributes.map((name) => ({
  title: name,
  value: name,
}));
const choice = await promptChoice("attribute", attributeChoices);
const currentAttributeValue = tokenBadge[choice as keyof typeof tokenBadge];

let attributeData: TokenBadgeAttributeData;
let newAttributeValue: boolean;
switch (choice) {
  case "attributeRequireNonTransferablePosition":
    newAttributeValue = await promptChoice(
      `new value for ${choice} (current: ${currentAttributeValue})`,
      [
        { title: "true", value: true },
        { title: "false", value: false },
      ],
    );

    if (currentAttributeValue === newAttributeValue) {
      throw new Error(
        `the attribute ${choice} is already set to ${newAttributeValue}`,
      );
    }

    attributeData = { requireNonTransferablePosition: [newAttributeValue] };
    break;
  default:
    throw new Error(`unsupported attribute: ${choice}`);
}

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\ttokenMint",
  tokenMint.toBase58(),
  "\n\ttokenBadge",
  pda.publicKey.toBase58(),
  "\n\tattribute",
  choice,
  "\n\tcurrent value",
  currentAttributeValue,
  "\n\tnew value",
  newAttributeValue,
);
const ok = await promptConfirm("If the above is OK, enter YES");
if (!ok) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setTokenBadgeAttributeIx(ctx.program, {
    whirlpoolsConfigExtension: configExtensionPda.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    tokenMint,
    tokenBadge: pda.publicKey,
    tokenBadgeAuthority: configExtension.tokenBadgeAuthority,
    attribute: attributeData,
  }),
);

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
set TokenBadgeAttribute...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ tokenMint … Hy5ZLF26P3bjfVtrt4qDQCn6HGhS5izb5SNv7P9qmgcG
current attributes:
         attributeRequireNonTransferablePosition : true
✔ attribute › attributeRequireNonTransferablePosition
✔ new value for attributeRequireNonTransferablePosition (current: true) › false
setting... 
        whirlpoolsConfig FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR 
        tokenMint Hy5ZLF26P3bjfVtrt4qDQCn6HGhS5izb5SNv7P9qmgcG 
        tokenBadge 7a4fzdEMe2p22Wo72ZiisaiZ7UZLd4NSUSYphvJpbDGs 
        attribute attributeRequireNonTransferablePosition 
        current value true 
        new value false
✔ If the above is OK, enter YES › Yes
estimatedComputeUnits: 106249
✔ priorityFeeInSOL … 0.000005
Priority fee: 0.000005 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 2gbi6xrqmuzT9zgVyuKvHU3Gb9ATfJWPC8zg9JLAxnCTcw33xKeQcX87y6jvWbJu5zA8cW4HU4ykhxeWVBjjn69T

*/
