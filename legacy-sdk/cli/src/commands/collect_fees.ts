import { PublicKey } from "@solana/web3.js";
import {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  WhirlpoolIx,
  collectFeesQuote,
  TickArrayUtil,
} from "@orca-so/whirlpools-sdk";
import { DecimalUtil, TransactionBuilder } from "@orca-so/common-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { TokenExtensionUtil } from "@orca-so/whirlpools-sdk/dist/utils/public/token-extension-util";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("collect Fees...");

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

const tokenMintAPubkey = whirlpool.tokenMintA;
const tokenMintBPubkey = whirlpool.tokenMintB;
const mintA = await ctx.fetcher.getMintInfo(tokenMintAPubkey);
const mintB = await ctx.fetcher.getMintInfo(tokenMintBPubkey);
if (!mintA || !mintB) {
  // extremely rare case (CloseMint extension on Token-2022 is used)
  throw new Error("token mint not found");
}
const decimalsA = mintA.decimals;
const decimalsB = mintB.decimals;

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

const quote = collectFeesQuote({
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

console.info(
  "collectable feeA: ",
  DecimalUtil.fromBN(quote.feeOwedA, decimalsA),
);
console.info(
  "collectable feeB: ",
  DecimalUtil.fromBN(quote.feeOwedB, decimalsB),
);

const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

const tokenOwnerAccountA = getAssociatedTokenAddressSync(
  tokenMintAPubkey,
  ctx.wallet.publicKey,
  undefined,
  mintA.tokenProgram,
);
const tokenOwnerAccountB = getAssociatedTokenAddressSync(
  tokenMintBPubkey,
  ctx.wallet.publicKey,
  undefined,
  mintB.tokenProgram,
);

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

builder.addInstruction(
  WhirlpoolIx.collectFeesV2Ix(ctx.program, {
    position: positionPubkey,
    positionAuthority: ctx.wallet.publicKey,
    tokenMintA: tokenMintAPubkey,
    tokenMintB: tokenMintBPubkey,
    positionTokenAccount: getAssociatedTokenAddressSync(
      position.positionMint,
      ctx.wallet.publicKey,
      undefined,
      positionMint.tokenProgram,
    ),
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenProgramA: mintA.tokenProgram,
    tokenProgramB: mintB.tokenProgram,
    tokenVaultA: whirlpool.tokenVaultA,
    tokenVaultB: whirlpool.tokenVaultB,
    whirlpool: whirlpoolPubkey,
    tokenTransferHookAccountsA:
      await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
        ctx.provider.connection,
        mintA,
        tokenOwnerAccountA,
        whirlpool.tokenVaultA,
        ctx.wallet.publicKey,
      ),
    tokenTransferHookAccountsB:
      await TokenExtensionUtil.getExtraAccountMetasForTransferHook(
        ctx.provider.connection,
        mintB,
        tokenOwnerAccountB,
        whirlpool.tokenVaultB,
        ctx.wallet.publicKey,
      ),
  }),
);

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
collect Fees...
prompt: positionPubkey:  H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
collectable feeA:  0
collectable feeB:  0
estimatedComputeUnits: 149469
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature 3VfNAQJ8nxTStU9fjkhg5sNRPpBrAMYx5Vyp92aDS5FsWpEqgLw5Ckzzw5hJ1rsNEh6VGLaf9TZWWcLCRWzvhNjX

*/
