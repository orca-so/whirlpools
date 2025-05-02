import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set CollectProtocolFeesAuthority...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const newCollectProtocolFeesAuthorityPubkeyStr = await promptText(
  "newCollectProtocolFeesAuthorityPubkey",
);
const newCollectProtocolFeesAuthorityPubkeyAgainStr = await promptText(
  "newCollectProtocolFeesAuthorityPubkeyAgain",
);

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const newCollectProtocolFeesAuthorityPubkey = new PublicKey(
  newCollectProtocolFeesAuthorityPubkeyStr,
);
const newCollectProtocolFeesAuthorityPubkeyAgain = new PublicKey(
  newCollectProtocolFeesAuthorityPubkeyAgainStr,
);

if (
  !newCollectProtocolFeesAuthorityPubkey.equals(
    newCollectProtocolFeesAuthorityPubkeyAgain,
  )
) {
  throw new Error(
    "newCollectProtocolFeesAuthorityPubkey and newCollectProtocolFeesAuthorityPubkeyAgain must be the same",
  );
}

const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (
  !whirlpoolsConfig.collectProtocolFeesAuthority.equals(ctx.wallet.publicKey)
) {
  throw new Error(
    `the current wallet must be the collect protocol fees authority(${whirlpoolsConfig.collectProtocolFeesAuthority.toBase58()})`,
  );
}

console.info(
  "setting...",
  "\n\tcollectProtocolFeesAuthority",
  whirlpoolsConfig.collectProtocolFeesAuthority.toBase58(),
  "\n\tnewCollectProtocolFeesAuthority",
  newCollectProtocolFeesAuthorityPubkey.toBase58(),
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
  WhirlpoolIx.setCollectProtocolFeesAuthorityIx(ctx.program, {
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    collectProtocolFeesAuthority: whirlpoolsConfig.collectProtocolFeesAuthority,
    newCollectProtocolFeesAuthority: newCollectProtocolFeesAuthorityPubkey,
  }),
);

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
set CollectProtocolFeesAuthority...
prompt: whirlpoolsConfigPubkey:  FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
prompt: newCollectProtocolFeesAuthorityPubkey:  3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
prompt: newCollectProtocolFeesAuthorityPubkeyAgain:  3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
setting...
        collectProtocolFeesAuthority 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
        newCollectProtocolFeesAuthority 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo

if the above is OK, enter YES

>>>>> WARNING: authority transfer is highly sensitive operation, please double check new authority address <<<<<

prompt: yesno:  YES
estimatedComputeUnits: 102679
prompt: priorityFeeInSOL:  0.000005
Priority fee: 0.000005 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature WNmYAhcYSoiJgJRveeKijsA77w1i68eD7iYjZzmEtwAf7VnzLqZYcFZk1acCzY5Qt3rMXNjnS6Xvd8mFNtyWmas

*/
