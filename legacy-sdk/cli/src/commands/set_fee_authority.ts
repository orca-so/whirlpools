import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set FeeAuthority...");

const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const newFeeAuthorityPubkeyStr = await promptText("newFeeAuthorityPubkey");
const newFeeAuthorityPubkeyAgainStr = await promptText(
  "newFeeAuthorityPubkeyAgain",
);

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const newFeeAuthorityPubkey = new PublicKey(newFeeAuthorityPubkeyStr);
const newFeeAuthorityPubkeyAgain = new PublicKey(newFeeAuthorityPubkeyAgainStr);

if (!newFeeAuthorityPubkey.equals(newFeeAuthorityPubkeyAgain)) {
  throw new Error(
    "newFeeAuthorityPubkey and newFeeAuthorityPubkeyAgain must be the same",
  );
}

const whirlpoolsConfig = await ctx.fetcher.getConfig(whirlpoolsConfigPubkey);
if (!whirlpoolsConfig) {
  throw new Error("whirlpoolsConfig not found");
}

if (!whirlpoolsConfig.feeAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the fee authority(${whirlpoolsConfig.feeAuthority.toBase58()})`,
  );
}

console.info(
  "setting...",
  "\n\tfeeAuthority",
  whirlpoolsConfig.feeAuthority.toBase58(),
  "\n\tnewFeeAuthority",
  newFeeAuthorityPubkey.toBase58(),
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
  WhirlpoolIx.setFeeAuthorityIx(ctx.program, {
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    feeAuthority: whirlpoolsConfig.feeAuthority,
    newFeeAuthority: newFeeAuthorityPubkey,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
set FeeAuthority...
prompt: whirlpoolsConfigPubkey:  FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR
prompt: newFeeAuthorityPubkey:  3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
prompt: newFeeAuthorityPubkeyAgain:  3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo
setting...
        feeAuthority 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
        newFeeAuthority 3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo

if the above is OK, enter YES

>>>>> WARNING: authority transfer is highly sensitive operation, please double check new authority address <<<<<

prompt: yesno:  YES
estimatedComputeUnits: 102611
prompt: priorityFeeInSOL:  0.000005
Priority fee: 0.000005 SOL
process transaction...
transaction is still valid, 151 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 5Z75rUDcMkXS5sUz45rKNLVMbniBtEzLdU3LC1mHmQymSUBYEzZTHAmmeE6gxzRTHtmmp9AWVWvM9MPYYNsGWTyq

*/
