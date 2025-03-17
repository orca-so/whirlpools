# Creating a Pool

Whirlpools is set up such that anyone is able to set up a liquidity pool within a WhirlpoolsConfig space. Follow these steps to initialize a Whirlpool using the `initialize_pool` instruction.

## Determine Whirlpool Parameters
**Whirlpool Pda** - The derived address of the Whirlpool account that will be initialized. Can be derived with [`PDAUtil.getWhirlpool()`](https://dev.orca.so/legacy/classes/PDAUtil.html#getWhirlpool)

**Token Mints** - The mints of the tokens for this trading pair. Token A and Token B Mint has to be cardinally ordered. Use the [`orderMints`](https://dev.orca.so/legacy/classes/PoolUtil.html#orderMints
) function to help you order them.

**Tick Spacing** - Consider the effects of fees and tick-spacing when determining your tick spacing value. Note that for optimal compute-budget performance, tick-spacing should be a power of 2.

**Token Vault Keypairs** - Empty Keypair accounts that will host deposited tokens for this pool. Once the initialize ix is ran, these accounts will be initialized as a spl-token accounts with the tokenAuthority set to the Whirlpool program.

## Determining initial sqrt-price
This determines where the tick will be after initialization. It is recommended that this be set close to the market price, otherwise it will take a series of swap iterations to move the price back to the desired location.

The price must be within `MIN_SQRT_PRICE` and `MAX_SQRT_PRICE`, and must be shifted by 64 bits.

```tsx
// Current SOL/USDC price
const desiredMarketPrice = new Decimal(98);
// Invert due to token mint ordering
const actualPrice = new Decimal(1).div(desiredMarketPrice);
// Shift by 64 bits
const initSqrtPrice = MathUtil.toX64(actualPrice);
```
> ℹ️ Reminder to take into account the ordering of the token A / B when determining the price. You may have to invert the value if your traded token is older than base token.

## Determine the appropriate FeeTier
The fee tier account determines the initial default fee amount for this pool. There's no hard requirement to use the fee-tier with the same tick-spacing as the pool you are initializing, but it is recommended. If the desired fee rate account for a particular tick-spacing does not exist yet, contact the WhirlpoolConfig's feeAuthority to either:
1. Create the appropriate fee tier for you with the `initialize_fee_tier` ix.
2. Set your desired fee tier for you with the `set_fee_rate` ix.

## Sample Code
Create the instruction and invoke it when you are ready.

```tsx
const whirlpoolPda = getWhirlpoolPda(
  programId,
  whirlpoolConfigKey,
  toPubKey(tokenMintA),
  toPubKey(tokenMintB),
  tickSpacing
);

const feeTierKey = getFeeTierPda(programId, whirlpoolConfigKey, tickSpacing).publicKey;
const tokenVaultAKeypair = Keypair.generate();
const tokenVaultBKeypair = Keypair.generate();

await WhirlpoolIx.initializePoolIx(ctx, {
  initSqrtPrice,
  tickSpacing: 128,
  tokenMintA,
  tokenMintB,
  tokenVaultAKeypair,
  tokenVaultBKeypair,
  whirlpoolPda,
  whirlpoolsConfig,
  feeTierKey: feeTierPda.publicKey,
  funder: ctx.wallet.publicKey,
}).toTx().buildAndExecute();
```
