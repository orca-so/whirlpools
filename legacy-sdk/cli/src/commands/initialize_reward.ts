import { PublicKey, Keypair } from "@solana/web3.js";
import { PDAUtil, WhirlpoolIx, PoolUtil } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptConfirm, promptText } from "../utils/prompt";

console.info("initialize Reward...");

// prompt
const whirlpoolPubkeyStr = await promptText("whirlpoolPubkey");
const rewardTokenMintStr = await promptText("rewardTokenMint");

const whirlpoolPubkey = new PublicKey(whirlpoolPubkeyStr);
const rewardTokenMintPubkey = new PublicKey(rewardTokenMintStr);

const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}
const rewardToken = await ctx.fetcher.getMintInfo(rewardTokenMintPubkey);
if (!rewardToken) {
  throw new Error("reward token not found");
}
const rewardTokenProgram = rewardToken.tokenProgram.equals(
  TOKEN_2022_PROGRAM_ID,
)
  ? "Token-2022"
  : "Token";

const alreadyInitialized = whirlpool.rewardInfos.some((r) =>
  r.mint.equals(rewardTokenMintPubkey),
);
if (alreadyInitialized) {
  throw new Error("reward for the token already initialized");
}
const allInitialized = whirlpool.rewardInfos.every((r) =>
  PoolUtil.isRewardInitialized(r),
);
if (allInitialized) {
  throw new Error(
    "all rewards already initialized, no more reward can be initialized",
  );
}

const rewardIndex = whirlpool.rewardInfos.findIndex(
  (r) => !PoolUtil.isRewardInitialized(r),
);
const rewardAuthority = PoolUtil.getRewardAuthority(whirlpool);
if (!rewardAuthority.equals(ctx.wallet.publicKey)) {
  throw new Error(
    `the current wallet must be the reward authority(${rewardAuthority.toBase58()})`,
  );
}

const rewardTokenBadgePubkey = PDAUtil.getTokenBadge(
  ctx.program.programId,
  whirlpool.whirlpoolsConfig,
  rewardTokenMintPubkey,
).publicKey;
const rewardTokenBadge = await ctx.fetcher.getTokenBadge(
  rewardTokenBadgePubkey,
);
const rewardTokenBadgeInialized = !!rewardTokenBadge;
const rewardVaultKeypair = Keypair.generate();

console.info(
  "setting...",
  "\n\twhirlpool",
  whirlpoolPubkey.toBase58(),
  "\n\trewardIndex",
  rewardIndex,
  "\n\trewardToken",
  rewardTokenMintPubkey.toBase58(),
  `(${rewardTokenProgram})`,
  rewardTokenBadgeInialized ? "with badge" : "without badge",
  "\n\trewardVault(gen)",
  rewardVaultKeypair.publicKey.toBase58(),
);
const yesno = await promptConfirm("if the above is OK, enter YES");
if (!yesno) {
  throw new Error("stopped");
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);
builder.addInstruction(
  WhirlpoolIx.initializeRewardV2Ix(ctx.program, {
    funder: ctx.wallet.publicKey,
    rewardAuthority: ctx.wallet.publicKey,
    rewardIndex,
    rewardMint: rewardTokenMintPubkey,
    rewardTokenBadge: rewardTokenBadgePubkey,
    rewardTokenProgram: rewardToken.tokenProgram,
    rewardVaultKeypair,
    whirlpool: whirlpoolPubkey,
  }),
);

const landed = await sendTransaction(builder);
if (landed) {
  console.info(
    "initialized reward vault address:",
    rewardVaultKeypair.publicKey.toBase58(),
  );
}

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
initialize Reward...
prompt: whirlpoolPubkey:  9dXKLjL2137ojWsQZALxV9mzQAb3ovwzHn6DbiV1NHZf
prompt: rewardTokenMint:  FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu
setting...
        whirlpool 9dXKLjL2137ojWsQZALxV9mzQAb3ovwzHn6DbiV1NHZf
        rewardIndex 1
        rewardToken FfprBPB2ULqp4tyBfzrzwxNvpGYoh8hidzSmiA5oDtmu (Token) with badge
        rewardVault(gen) DKaGdKFMLpY3Pj4crPW2tJNVuoQLA1tarLaTDCn2ZWox

if the above is OK, enter YES
prompt: yesno:  YES
tx: 47bP5aPKGBMift8xJYK3oCnDog45UNYAcr4yJsjYKsatkb7RhNFyBshaAECM3CVpvXZNC2JkLD7rcoYSaKviz2ZD
initialized reward vault address: DKaGdKFMLpY3Pj4crPW2tJNVuoQLA1tarLaTDCn2ZWox

*/
