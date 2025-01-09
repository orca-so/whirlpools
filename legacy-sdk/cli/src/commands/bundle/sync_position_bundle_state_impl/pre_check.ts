import { PublicKey } from "@solana/web3.js";
import { IGNORE_CACHE, TickArrayUtil, TickUtil, WhirlpoolContext, WhirlpoolData, PDAUtil, PoolUtil } from "@orca-so/whirlpools-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PositionBundleStateItem } from "./csv";

export async function checkTickArrayInitialization(ctx: WhirlpoolContext, whirlpoolPubkey: PublicKey, positionBundleTargetState: PositionBundleStateItem[]) {
  const whirlpool = await ctx.fetcher.getPool(whirlpoolPubkey) as WhirlpoolData; // tickSpacing is immutable
  const tickSpacing = whirlpool.tickSpacing;

  const tickArrayStartIndexes = new Set<number>();
  for (const targetState of positionBundleTargetState) {
    if (targetState.state === "open") {
      tickArrayStartIndexes.add(TickUtil.getStartTickIndex(targetState.lowerTickIndex, tickSpacing));
      tickArrayStartIndexes.add(TickUtil.getStartTickIndex(targetState.upperTickIndex, tickSpacing));
    }
  }

  const tickArrayAddresses = Array.from(tickArrayStartIndexes).map((startIndex) =>
    PDAUtil.getTickArray(ctx.program.programId, whirlpoolPubkey, startIndex).publicKey
  );

  const uninitialized = await TickArrayUtil.getUninitializedArraysString(tickArrayAddresses, ctx.fetcher, IGNORE_CACHE);
  if (uninitialized) {
    throw new Error(`uninitialized TickArrays: ${uninitialized}`);
  }
}

export async function checkATAInitialization(ctx: WhirlpoolContext, whirlpool: WhirlpoolData) {
  const mintStrings = new Set<string>();
  mintStrings.add(whirlpool.tokenMintA.toBase58());
  mintStrings.add(whirlpool.tokenMintB.toBase58());
  whirlpool.rewardInfos.forEach((rewardInfo) => {
    if (PoolUtil.isRewardInitialized(rewardInfo)) {
      mintStrings.add(rewardInfo.mint.toBase58());
    }
  });

  const mintAddresses = Array.from(mintStrings).map((mintStr) => new PublicKey(mintStr));
  const mints = await ctx.fetcher.getMintInfos(mintAddresses, IGNORE_CACHE);

  const ataAddresses = mintAddresses.map((mint) =>
    getAssociatedTokenAddressSync(
      mint,
      ctx.wallet.publicKey,
      true, // allow PDA for safety
      mints.get(mint.toBase58())!.tokenProgram, // may be Token-2022 token
    )
  );

  const atas = await ctx.fetcher.getTokenInfos(ataAddresses, IGNORE_CACHE);
  const uninitialized = mintAddresses.filter((_, i) => !atas.get(ataAddresses[i].toBase58()));

  if (uninitialized.length > 0) {
    throw new Error(`uninitialized ATAs for mint: ${uninitialized.map((mint) => mint.toBase58()).join(", ")}`);
  }
}
