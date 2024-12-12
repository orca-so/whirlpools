# Collect Fees and Rewards

As the liquidity pool is traded upon, liquidity providers will begin to accrue fees and rewards. Follow the following steps to see how much you are owe and how to collect them.

## Get a quick quote on outstanding fees and rewards
There are use-cases where users would like to check the outstanding values before deciding to perform an on-chain update and harvest. In these cases, use the provided `collectFeesQuote` and `collectRewardsQuote` in the Typescript SDK.

```tsx
// Fetching necessary on-chain account data.
const whirlpool = await fetcher.getPool(whirlpoolAddress);
const position = await fetcher.getPosition(positionAddress)
// Fetching tick array. Note that you may have to fetch two of them
// if the upper and lower ticks live on different tick arrays.
const tickArrayAddress = TickUtil.getPdaWithTickIndex(tickLowerIndex, ...);
const tickArray = await fetcher.getTickArray(tickArrayAddress);

// Get the individual TickData on each tickIndex from the fetched TickArray
const lowerTick = TickUtil.getTickFromTickArrayData(tickArrayData, tickLowerIndex, tickSpacing);
const upperTick = TickUtil.getTickFromTickArrayData(tickArrayData, tickUpperIndex, tickSpacing);

const feeQuote = collectFeesQuote({
  whirlpool,
  position,
  tickLower: lowerTick,
  tickUpper: upperTick,
});

const feesInTokenA = feeQuote.feeOwedA;
const feesInTokenB = feeQuote.feeOwedB;

const rewardQuote = collectRewardsQuote({
  whirlpool,
  position,
  tickLower: lowerTick,
  tickUpper: upperTick,
});

const rewardsInReward0 = rewardQuote[0].toNumber();
const rewardsInReward1 = rewardQuote[1].toNumber();
const rewardsInReward2 = rewardQuote[2].toNumber();
```

## Update on-chain position with the latest accrued fees
Before you fetch your owed fees, you must update the on-chain position with the latest values by calling `increase_liquidity` or `decrease_liquidity`. Alternatively, you can call `update_fee_and_rewards` to update without modifying liquidity.

If this step is skipped, the collect instructions will only fetch the last updated values of the position. In many cases, this will be 0.

Sample code on using `update_fee_and_rewards`:

```tsx
const whirlpool = await fetcher.getPool(whirlpoolAddress);
const position = await fetcher.getPosition(positionAddress);
const tickArrayLower = getTickArrayPda(ctx.program.programId, whirlpoolAddress, position.tickLowerIndex);
const tickArrayUpper = getTickArrayPda(ctx.program.programId, whirlpoolAddress, position.tickUpperIndex);
await toTx(ctx, WhirlpoolIx.updateFeesAndRewardsIx(ctx.program, {
    whirlpool: position.whirlpool,
    position: positionAddress,
    tickArrayLower,
    tickArrayUpper,
})).buildAndExecute();
```

## Collect Fees and Rewards
Once the position has been updated, you can use `collect_fees` and `collect_reward` to harvest the position.

### Collect fee
```tsx
const whirlpool = await fetcher.getPool(whirlpoolAddress);
const position = await fetcher.getPosition(positionAddress);

const positionTokenAccount = await deriveATA(provider.wallet.publicKey, position.positionMint);
const tokenOwnerAccountA = await deriveATA(provider.wallet.publicKey, whirlpool.tokenMintA);
const tokenOwnerAccountB = await deriveATA(provider.wallet.publicKey, whirlpool.tokenMintB);

await toTx(ctx, WhirlpoolIx.collectFeesIx(ctx.program, {
  whirlpool: whirlpoolAddress,
  positionAuthority: provider.wallet.publicKey,
  position: positionAddress,
  positionTokenAccount,
  tokenOwnerAccountA,
  tokenOwnerAccountB,
  tokenVaultA: whirlpool.tokenVaultA,
  tokenVaultB: whirlpool.tokenVaultB
})).buildAndExecute();
```

### Collect rewards
```tsx
// Fetching rewards at reward index 0
const whirlpool = await fetcher.getPool(whirlpoolAddress);
const position = await fetcher.getPosition(positionAddress);

const rewardTokenMint = whirlpool.rewardInfos[0].mint;
const rewardOwnerAccount = await deriveATA(provider.wallet.publicKey, rewardTokenMint);
const positionTokenAccount = await deriveATA(provider.wallet.publicKey, position.positionMint);

await toTx(ctx, WhirlpoolIx.collectRewardIx(ctx.program, {
  whirlpool: whirlpoolAddress,
  positionAuthority: provider.wallet.publicKey,
  position: positionAddress,
  positionTokenAccount,
  rewardOwnerAccount: rewardOwnerAccount,
  rewardVault: whirlpool.rewardInfo[0].vault,
  rewardIndex: 0,
})).buildAndExecute();
```