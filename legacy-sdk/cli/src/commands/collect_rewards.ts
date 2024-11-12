import { PublicKey } from "@solana/web3.js";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  WhirlpoolIx,
  TickArrayUtil,
  PoolUtil,
  collectRewardsQuote,
} from "@orca-so/whirlpools-sdk";
import { DecimalUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { TokenExtensionUtil } from "@orca-so/whirlpools-sdk/dist/utils/public/token-extension-util";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("collect Rewards...");

// prompt
const positionPubkeyStr = await promptText("positionPubkey");

const positionPubkey = new PublicKey(positionPubkeyStr);
const position = await ctx.fetcher.getPosition(positionPubkey);
if (!position) {
  throw new Error("position not found");
}
const positionMint = await ctx.fetcher.getMintInfo(position.positionMint);
if (!positionMint) {
  throw new Error("positionMint not found");
}

const whirlpoolPubkey = position.whirlpool;
const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey);
if (!whirlpool) {
  throw new Error("whirlpool not found");
}
const tickSpacing = whirlpool.tickSpacing;

const rewardMintPubkeys = whirlpool.rewardInfos
  .filter((r) => PoolUtil.isRewardInitialized(r))
  .map((r) => r.mint);
const rewardMints = await Promise.all(
  rewardMintPubkeys.map((m) => ctx.fetcher.getMintInfo(m)),
);
if (rewardMints.some((m) => !m)) {
  // extremely rare case (CloseMint extension on Token-2022 is used)
  throw new Error("token mint not found");
}

if (rewardMints.length === 0) {
  throw new Error("no rewards");
}

const lowerTickArrayPubkey = PDAUtil.getTickArrayFromTickIndex(
  position.tickLowerIndex,
  tickSpacing,
  whirlpoolPubkey,
  ORCA_WHIRLPOOL_PROGRAM_ID,
).publicKey;
const upperTickArrayPubkey = PDAUtil.getTickArrayFromTickIndex(
  position.tickUpperIndex,
  tickSpacing,
  whirlpoolPubkey,
  ORCA_WHIRLPOOL_PROGRAM_ID,
).publicKey;

const lowerTickArray = await ctx.fetcher.getTickArray(lowerTickArrayPubkey);
const upperTickArray = await ctx.fetcher.getTickArray(upperTickArrayPubkey);
if (!lowerTickArray || !upperTickArray) {
  throw new Error("tick array not found");
}

const quote = collectRewardsQuote({
  position,
  tickLower: TickArrayUtil.getTickFromArray(
    lowerTickArray,
    position.tickLowerIndex,
    tickSpacing,
  ),
  tickUpper: TickArrayUtil.getTickFromArray(
    upperTickArray,
    position.tickUpperIndex,
    tickSpacing,
  ),
  whirlpool,
  tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(
    ctx.fetcher,
    whirlpool,
  ),
});

for (let i = 0; i < rewardMints.length; i++) {
  console.info(
    `collectable reward[${i}](${rewardMintPubkeys[i].toBase58()}): `,
    DecimalUtil.fromBN(quote.rewardOwed[i]!, rewardMints[i]!.decimals),
  );
}

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

if (position.liquidity.gtn(0)) {
  builder.addInstruction(
    WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
      position: positionPubkey,
      tickArrayLower: lowerTickArrayPubkey,
      tickArrayUpper: upperTickArrayPubkey,
      whirlpool: whirlpoolPubkey,
    }),
  );
}

for (let i = 0; i < rewardMints.length; i++) {
  // TODO: create if needed...
  const rewardOwnerAccount = getAssociatedTokenAddressSync(
    rewardMintPubkeys[i],
    ctx.wallet.publicKey,
    undefined,
    rewardMints[i]?.tokenProgram,
  );

  builder.addInstruction(
    WhirlpoolIx.collectRewardV2Ix(ctx.program, {
      position: positionPubkey,
      positionAuthority: ctx.wallet.publicKey,
      rewardIndex: i,
      rewardMint: rewardMintPubkeys[i],
      rewardVault: whirlpool.rewardInfos[i].vault,
      rewardTokenProgram: rewardMints[i]!.tokenProgram,
      rewardOwnerAccount,
      positionTokenAccount: getAssociatedTokenAddressSync(
        position.positionMint,
        ctx.wallet.publicKey,
        undefined,
        positionMint.tokenProgram,
      ),
      whirlpool: whirlpoolPubkey,
      rewardTransferHookAccounts:
        await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
          ctx.provider.connection,
          rewardMints[i]!,
          rewardOwnerAccount,
          whirlpool.tokenVaultB,
          ctx.wallet.publicKey,
        ),
    }),
  );
}

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
collect Rewards...
prompt: positionPubkey:  H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
collectable reward[0](Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6):  0.004849
collectable reward[1](Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa):  0.000048513
estimatedComputeUnits: 154746
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 4uRtXJHNQNhZC17Cryatk8ASbDABNqgskPcBouoRqUjA8P3YhbP1Z9Z25JAcJLP1wdxu9TsLwHiR7G2R3Z7oZss6

*/
