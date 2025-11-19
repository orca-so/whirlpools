import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("set TokenBadgeAuthority...");

const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const newTokenBadgeAuthorityPubkeyStr = await promptText(
  "newTokenBadgeAuthorityPubkey",
);

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const newTokenBadgeAuthorityPubkey = new PublicKey(
  newTokenBadgeAuthorityPubkeyStr,
);

const pda = PDAUtil.getConfigExtension(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
);
const whirlpoolsConfigExtension = await ctx.fetcher.getConfigExtension(
  pda.publicKey,
);

if (!whirlpoolsConfigExtension) {
  throw new Error("whirlpoolsConfigExtension not found");
}

if (
  !whirlpoolsConfigExtension.configExtensionAuthority.equals(
    ctx.wallet.publicKey,
  )
) {
  throw new Error(
    `the current wallet must be the config extension authority(${whirlpoolsConfigExtension.configExtensionAuthority.toBase58()})`,
  );
}

console.info(
  "setting...",
  "\n\ttokenBadgeAuthority",
  whirlpoolsConfigExtension.tokenBadgeAuthority.toBase58(),
  "\n\tnewTokenBadgeAuthority",
  newTokenBadgeAuthorityPubkey.toBase58(),
);
console.info("\nif the above is OK, enter YES");
const yesno = await promptConfirm("yesno");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.setTokenBadgeAuthorityIx(ctx.program, {
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    whirlpoolsConfigExtension: pda.publicKey,
    configExtensionAuthority:
      whirlpoolsConfigExtension.configExtensionAuthority,
    newTokenBadgeAuthority: newTokenBadgeAuthorityPubkey,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
set TokenBadgeAuthority...
prompt: whirlpoolsConfigPubkey:  JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
prompt: newTokenBadgeAuthorityPubkey:  2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5
setting...
        tokenBadgeAuthority r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
        newTokenBadgeAuthority 2v112XbwQXFrdqX438HUrfZF91qCZb7QRP4bwUiN7JF5

if the above is OK, enter YES
prompt: yesno:  YES
tx: 2g8gsZFYyNcp4oQU6s9ZM5ZcyH4sye3KbNVTdTyt9KZzPrwP2tqK3Hxrc8LEXiTHGUSiyw228QWsYBdJMdPNqib5

*/
