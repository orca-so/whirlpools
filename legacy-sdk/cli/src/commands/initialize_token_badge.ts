import { PublicKey } from "@solana/web3.js";
import type { TokenBadgeAttributeData } from "@orca-so/whirlpools-sdk";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("initialize TokenBadge...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const tokenMintStr = await promptText("tokenMint");
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

// some TokenBadge attributes should be set atomically at the initialization
const attributeDataArray: TokenBadgeAttributeData[] = [];

// RequireNonTransferablePosition
console.info(
  `if you want to initialize TokenBadge WITH RequireNonTransferablePosition attribute, enter YES`,
);
if (await promptConfirm("YES")) {
  console.info(
    "\n>>>>> NOTICE: Whirlpools initialized with this TokenBadge will force NON-TRANSFERABLE position <<<<<\n",
  );

  attributeDataArray.push({
    requireNonTransferablePosition: [true],
  });
} else {
  attributeDataArray.push({
    requireNonTransferablePosition: [false],
  });
}

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\ttokenMint",
  tokenMint.toBase58(),
  "\n\tattributes to be set atomically:",
);
attributeDataArray.map((attr) => {
  console.info("\t\t", JSON.stringify(attr));
});

const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializeTokenBadgeIx(ctx.program, {
    whirlpoolsConfigExtension: configExtensionPda.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    tokenMint,
    tokenBadgePda: pda,
    tokenBadgeAuthority: configExtension.tokenBadgeAuthority,
    funder: ctx.wallet.publicKey,
  }),
);
for (const attribute of attributeDataArray) {
  builder.addInstruction(
    WhirlpoolIx.setTokenBadgeAttributeIx(ctx.program, {
      whirlpoolsConfigExtension: configExtensionPda.publicKey,
      whirlpoolsConfig: whirlpoolsConfigPubkey,
      tokenMint,
      tokenBadge: pda.publicKey,
      tokenBadgeAuthority: configExtension.tokenBadgeAuthority,
      attribute,
    }),
  );
}

const landed = await processTransaction(builder);
if (landed) {
  console.info("tokenBadge address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

wallet 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
initialize TokenBadge...
✔ whirlpoolsConfigPubkey … FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
✔ tokenMint … 7mg4AksSu95yHiB5MzKt2M8MERH676gHWLJexAGUJQD1
if you want to initialize TokenBadge WITH RequireNonTransferablePosition attribute, enter YES
✔ YES › Yes

>>>>> NOTICE: Whirlpools initialized with this TokenBadge will force NON-TRANSFERABLE position <<<<<

setting...
        whirlpoolsConfig FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
        tokenMint 7mg4AksSu95yHiB5MzKt2M8MERH676gHWLJexAGUJQD1
        attributes to be set atomically:
                 {"requireNonTransferablePosition":[true]}
✔ if the above is OK, enter YES › Yes
estimatedComputeUnits: 118090
✔ priorityFeeInSOL … 0.000005
Priority fee: 0.000005 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 5PRYu7FthRW6B9D1PrqJEZvmY76jNbTecroPmX6KQRkEtHK3FJyXFLgPK8zuxivfatwAgXGMAM3SwYNgWgXE8ADi
tokenBadge address: 6JPBd9utJEUmAyjxL41txnG8AqF4wfDUw98AdSg5CKYc

*/
