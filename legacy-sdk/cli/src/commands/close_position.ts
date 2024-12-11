import { PublicKey } from "@solana/web3.js";
import { WhirlpoolIx } from "@orca-so/whirlpools-sdk";
import { TransactionBuilder } from "@orca-so/common-sdk";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { sendTransaction } from "../utils/transaction_sender";
import { ctx } from "../utils/provider";
import { promptText } from "../utils/prompt";

console.info("close Position...");

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

if (!position.liquidity.isZero()) {
  throw new Error("position is not empty (liquidity is not zero)");
}

// Collect fees and rewards before closing
const builder = new TransactionBuilder(ctx.connection, ctx.wallet);

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
  throw new Error("token mint not found");
}

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

// Collect Fees
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
    tokenTransferHookAccountsA: [],
    tokenTransferHookAccountsB: [],
  }),
);

// Collect Rewards
for (let i = 0; i < whirlpool.rewardInfos.length; i++) {
  if (!whirlpool.rewardInfos[i].mint.equals(PublicKey.default)) {
    const rewardMintPubkey = whirlpool.rewardInfos[i].mint;
    const rewardMint = await ctx.fetcher.getMintInfo(rewardMintPubkey);
    if (!rewardMint) {
      continue;
    }

    const rewardOwnerAccount = getAssociatedTokenAddressSync(
      rewardMintPubkey,
      ctx.wallet.publicKey,
      undefined,
      rewardMint.tokenProgram,
    );

    // Ensure the reward owner account exists
    const rewardAccountInfo = await ctx.connection.getAccountInfo(
      rewardOwnerAccount,
    );
    if (!rewardAccountInfo) {
      // Create the ATA for the reward token (e.g., WSOL)
      builder.addInstruction({
        instructions: [
          createAssociatedTokenAccountInstruction(
            ctx.wallet.publicKey,
            rewardOwnerAccount,
            ctx.wallet.publicKey,
            rewardMintPubkey,
            rewardMint.tokenProgram,
          ),
        ],
        cleanupInstructions: [],
        signers: [],
      });
    }

    builder.addInstruction(
      WhirlpoolIx.collectRewardV2Ix(ctx.program, {
        position: positionPubkey,
        positionAuthority: ctx.wallet.publicKey,
        rewardIndex: i,
        rewardMint: rewardMintPubkey,
        rewardVault: whirlpool.rewardInfos[i].vault,
        rewardTokenProgram: rewardMint.tokenProgram,
        rewardOwnerAccount,
        positionTokenAccount: getAssociatedTokenAddressSync(
          position.positionMint,
          ctx.wallet.publicKey,
          undefined,
          positionMint.tokenProgram,
        ),
        whirlpool: whirlpoolPubkey,
        rewardTransferHookAccounts: [],
      }),
    );
  }
}

// Proceed to close the position
const positionTokenAccount = getAssociatedTokenAddressSync(
  position.positionMint,
  ctx.wallet.publicKey,
  undefined,
  positionMint.tokenProgram,
);

if (positionMint.tokenProgram.equals(TOKEN_PROGRAM_ID)) {
  builder.addInstruction(
    WhirlpoolIx.closePositionIx(ctx.program, {
      position: positionPubkey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount,
      positionMint: position.positionMint,
      receiver: ctx.wallet.publicKey,
    }),
  );
} else {
  builder.addInstruction(
    WhirlpoolIx.closePositionWithTokenExtensionsIx(ctx.program, {
      position: positionPubkey,
      positionAuthority: ctx.wallet.publicKey,
      positionTokenAccount,
      positionMint: position.positionMint,
      receiver: ctx.wallet.publicKey,
    }),
  );
}

await sendTransaction(builder);

/*

SAMPLE EXECUTION LOG

connection endpoint http://localhost:8899
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
close Position...
prompt: positionPubkey:  H4WEb57EYh5AhorHArjgRXVgSBJRMZi3DvsLb3J1XNj6
estimatedComputeUnits: 120649
prompt: priorityFeeInSOL:  0
Priority fee: 0 SOL
process transaction...
transaction is still valid, 150 blocks left (at most)
sending...
confirming...
✅successfully landed
signature dQwedycTbM9UTYwQiiUE5Q7ydZRzL3zywaQ3xEo3RhHxDvfsY8wkAakSXQRdXswxdQCLLMwwDJVSNHYcTCDDcf3

*/