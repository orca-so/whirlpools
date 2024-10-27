# Closing a Position
To close a position, you must first withdraw all liquidity and collect all fees and rewards from the position. You can then call the [`closePosition`](https://orca-so.github.io/whirlpools/legacy/interfaces/Whirlpool.html#closePosition) instruction to close and burn the position NFT. 

The parameters of `closePosition` are identical to the ones in `openPosition`.

## Whirlpool Client - Sample Code
The [`WhirlpoolClient`](https://orca-so.github.io/whirlpools/legacy/interfaces/WhirlpoolClient.html) version of [`closePosition`](https://orca-so.github.io/whirlpools/legacy/interfaces/Whirlpool.html#closePosition) will automatically call `decrease_liquidity` and `close_position` for you. Note that you still have to manually call `collect_fees` and `collect_reward` to make sure the position is empty.

```tsx
const client = new WhirlpoolClient(context, fetcher);
const poolAddress = PDAUtil.getPool(...)
const positionAddress = PDAUtil.getPosition(...);

const pool = client.getPool(poolAddress);
// Must manually call update_fee_and_rewards -> collect_fees -> collect_rewards
// Convienience function coming soon.
const tx = await pool.closePosition(positionAddress, Percentage.fromFraction(1, 100))
await tx.buildAndExecute();
```

## Instruction - Sample Code

```tsx
const poolAddress = PDAUtil.getPool(...)
const positionAddress = PDAUtil.getPosition(...);
const position = await fetcher.getPosition(positionAddress);
// Must manually call decrease_liquidity here
const tx = await toTx(ctx, WhirlpoolIx.closePositionTx(ctx, {
    positionAuthority: ctx.wallet.publicKey,
    receiver: ctx.wallet.publicKey,
    positionTokenAccount,
    position: positionAddress,
    positionMint: position.positionMint,
}))
await tx.buildAndExecute();
```

## Common Errors
- `ClosePositionNotEmpty` (0x1775) - Position still has liquidity in it. Withdraw all before calling this instruction.