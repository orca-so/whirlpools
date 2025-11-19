import { PublicKey } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { processTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";
console.info("delete TokenBadge...");

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

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\ttokenMint",
  tokenMint.toBase58(),
  "\n\ttokenBadge",
  pda.publicKey.toBase58(),
);
const ok = await promptConfirm("If the above is OK, enter YES");
if (!ok) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.deleteTokenBadgeIx(ctx.program, {
    whirlpoolsConfigExtension: configExtensionPda.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    tokenMint,
    tokenBadge: pda.publicKey,
    tokenBadgeAuthority: configExtension.tokenBadgeAuthority,
    receiver: ctx.wallet.publicKey,
  }),
);

await processTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
delete TokenBadge...
prompt: whirlpoolsConfigPubkey:  JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
prompt: tokenMint:  FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu
setting...
        whirlpoolsConfig JChtLEVR9E6B5jiHTZS1Nd9WgMULMHv2UcVryYACAFYQ
        tokenMint FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu
        tokenBadge FZViZVK1ANAH9Ca3SfshZRpUdSfy1qpX3KGbDBCfCJNh

if the above is OK, enter YES
prompt: yesno:  YES
tx: 1k7UNUdrVqbSbDG4XhWuLaKpxXZpGw9akz4q7iLF6ismWhtnSnJUK8san5voNCBYMFWCUyxUgYwWb3iTHBZe8Tf

*/
