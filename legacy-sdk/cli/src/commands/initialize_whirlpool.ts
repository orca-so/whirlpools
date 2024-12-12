import { Keypair, PublicKey } from "@solana/web3.js";
import {
  PDAUtil,
  WhirlpoolIx,
  PoolUtil,
  PriceMath,
} from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText, promptConfirm } from "../utils/prompt";

console.info("initialize Whirlpool...");

// prompt
const whirlpoolsConfigPubkeyStr = await promptText("whirlpoolsConfigPubkey");
const tokenMint0PubkeyStr = await promptText("tokenMint0Pubkey");
const tokenMint1PubkeyStr = await promptText("tokenMint1Pubkey");
const tickSpacingStr = await promptText("tickSpacing");

const whirlpoolsConfigPubkey = new PublicKey(whirlpoolsConfigPubkeyStr);
const tokenMint0Pubkey = new PublicKey(tokenMint0PubkeyStr);
const tokenMint1Pubkey = new PublicKey(tokenMint1PubkeyStr);
const tickSpacing = Number.parseInt(tickSpacingStr);

const [tokenMintAAddress, tokenMintBAddress] = PoolUtil.orderMints(
  tokenMint0Pubkey,
  tokenMint1Pubkey,
);
if (tokenMintAAddress.toString() !== tokenMint0Pubkey.toBase58()) {
  console.info("token order is inverted due to order restriction");
}

const tokenMintAPubkey = new PublicKey(tokenMintAAddress);
const tokenMintBPubkey = new PublicKey(tokenMintBAddress);

const feeTierPubkey = PDAUtil.getFeeTier(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tickSpacing,
).publicKey;

const pda = PDAUtil.getWhirlpool(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tokenMintAPubkey,
  tokenMintBPubkey,
  tickSpacing,
);
const tokenVaultAKeypair = Keypair.generate();
const tokenVaultBKeypair = Keypair.generate();

const mintA = await ctx.fetcher.getMintInfo(tokenMintAPubkey);
const mintB = await ctx.fetcher.getMintInfo(tokenMintBPubkey);

if (!mintA || !mintB) {
  throw new Error("mint not found");
}

const tokenProgramA = mintA.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
  ? "Token-2022"
  : "Token";
const tokenProgramB = mintB.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
  ? "Token-2022"
  : "Token";
const tokenBadgeAPubkey = PDAUtil.getTokenBadge(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tokenMintAPubkey,
).publicKey;
const tokenBadgeBPubkey = PDAUtil.getTokenBadge(
  ctx.program.programId,
  whirlpoolsConfigPubkey,
  tokenMintBPubkey,
).publicKey;
const tokenBadge = await ctx.fetcher.getTokenBadges([
  tokenBadgeAPubkey,
  tokenBadgeBPubkey,
]);
const tokenBadgeAInitialized = !!tokenBadge.get(tokenBadgeAPubkey.toBase58());
const tokenBadgeBInitialized = !!tokenBadge.get(tokenBadgeBPubkey.toBase58());

let initTickIndex, initPrice;
while (true) {
  initTickIndex = Number.parseInt(await promptText("initTickIndex"));
  initPrice = PriceMath.tickIndexToPrice(
    initTickIndex,
    mintA.decimals,
    mintB.decimals,
  );

  const ok = await promptConfirm(
    `is InitPrice ${initPrice.toFixed(6)} OK ? (if it is OK, enter OK)`,
  );
  if (ok) break;
}

const initSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(initTickIndex);

console.info(
  "setting...",
  "\n\twhirlpoolsConfig",
  whirlpoolsConfigPubkey.toBase58(),
  "\n\ttokenMintA",
  tokenMintAPubkey.toBase58(),
  `(${tokenProgramA})`,
  tokenBadgeAInitialized ? "with badge" : "without badge",
  "\n\ttokenMintB",
  tokenMintBPubkey.toBase58(),
  `(${tokenProgramB})`,
  tokenBadgeBInitialized ? "with badge" : "without badge",
  "\n\ttickSpacing",
  tickSpacing,
  "\n\tinitPrice",
  initPrice.toFixed(mintB.decimals),
  "B/A",
  "\n\ttokenVaultA(gen)",
  tokenVaultAKeypair.publicKey.toBase58(),
  "\n\ttokenVaultB(gen)",
  tokenVaultBKeypair.publicKey.toBase58(),
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializePoolV2Ix(ctx.program, {
    whirlpoolPda: pda,
    funder: ctx.wallet.publicKey,
    whirlpoolsConfig: whirlpoolsConfigPubkey,
    tokenMintA: tokenMintAPubkey,
    tokenMintB: tokenMintBPubkey,
    tokenProgramA: mintA.tokenProgram,
    tokenProgramB: mintB.tokenProgram,
    tokenBadgeA: tokenBadgeAPubkey,
    tokenBadgeB: tokenBadgeBPubkey,
    tickSpacing,
    feeTierKey: feeTierPubkey,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    initSqrtPrice,
  }),
);

const landed = await sendTransaction(builder);
if (landed) {
  console.info("whirlpool address:", pda.publicKey.toBase58());
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
create Whirlpool...
prompt: whirlpoolsConfigPubkey:  8raEdn1tNEft7MnbMQJ1ktBqTKmHLZu7NJ7teoBkEPKm
prompt: tokenMintAPubkey:  So11111111111111111111111111111111111111112
prompt: tokenMintBPubkey:  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
prompt: feeTierPubkey:  BYUiw9LdPsn5n8qHQhL7SNphubKtLXKwQ4tsSioP6nTj
prompt: initTickIndex:  0
is InitPrice 999.999999 OK ? (if it is OK, enter OK)
prompt: OK:
prompt: initTickIndex:  -1000
is InitPrice 904.841941 OK ? (if it is OK, enter OK)
prompt: OK:
prompt: initTickIndex:  -10000
is InitPrice 367.897834 OK ? (if it is OK, enter OK)
prompt: OK:
prompt: initTickIndex:  -50000
is InitPrice 6.739631 OK ? (if it is OK, enter OK)
prompt: OK:
prompt: initTickIndex:  -40000
is InitPrice 18.319302 OK ? (if it is OK, enter OK)
prompt: OK:
prompt: initTickIndex:  -38000
is InitPrice 22.375022 OK ? (if it is OK, enter OK)
prompt: OK:  OK
setting...
        whirlpoolsConfig 8raEdn1tNEft7MnbMQJ1ktBqTKmHLZu7NJ7teoBkEPKm
        tokenMintA So11111111111111111111111111111111111111112
        tokenMintB EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
        tickSpacing 64
        initPrice 22.375022 B/A
        tokenVaultA(gen) G5JMrgXxUdjjGXPVMezddTZAr5x7L9N4Nix6ZBS1FAwB
        tokenVaultB(gen) 3wwdjzY7mAsoG5yYN3Ebo58p1HdihCCSeo8Qbwx8Yg5r

if the above is OK, enter YES
prompt: yesno:  YES
tx: X7pyW22o6fi5x1YmjDEacabvbtPYrqLyXaJpv88JJ6xLBi9eXra9QhuqeYuRmLGh72NsmQ11Kf8YCe3rPzqcc9r
whirlpool address: CJBunHdcRxtYSWGxkw8KarDpoz78KtNeMni2yU51TbPq

*/
