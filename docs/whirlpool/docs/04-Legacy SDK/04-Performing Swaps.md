# Performing Swaps

Before we begin, you should have an understanding of what ticks are and how they are stored. If not, you can reference [Price & Ticks](../02-Architecture%20Overview/02-Price%20&%20Ticks.md).

## Trade with WhirlpoolClient
You can use the swap quote and WhirlpoolClient to easily perform a trade. 

Learn more about `amountSpecifiedIsInput` , `aToB` in the section below.

### Generating a swap quote by input or output token
Generate quote with one of the quote functions:
- [`swapQuoteByInputToken`](https://orca-so.github.io/whirlpools/legacy/functions/swapQuoteByInputToken.html) if you want an estimate on the amount of outputToken received on an amount of inputToken.
- [`swapQuoteByOutputToken`](https://orca-so.github.io/whirlpools/legacy/functions/swapQuoteByInputToken.html) if you want an estimate on the amount of inputToken needed to receive a set amount of outputToken.

The resulting [`SwapQuote`](https://orca-so.github.io/whirlpools/legacy/types/SwapQuote.html) object contains the estimations on the expected amount of tokenIn, tokenOut, fees, projected ending sqrtPrice. When you are ready, plug the quote object directly into the swapIx to perform the trade.

```tsx
const whirlpoolPda = PDAUtil.getWhirlpool(...);
const whirlpoolClient = buildWhirlpoolClient(ctx);
const whirlpool = await whirlpoolClient.getPool(whirlpoolPda.publicKey, true);
// use getData or refreshData, depending on whether you think your data is stale.
const whirlpoolData = await whirlpool.getData(); 

const inputTokenQuote = await swapQuoteByInputToken(
  whirlpool,
  whirlpoolData.tokenMintB,
  new u64(190000000),
  Percentage.fromFraction(1, 1000), // 0.1%
  ctx.program.programId,
  fetcher,
  true
);

// Send out the transaction
const txId = await (await whirlpool.swap(inputTokenQuote)).buildAndExecute();
```

### Adding a developer fee to the swap
The SDK also provides [`swapQuoteByInputTokenWithDevFees`](https://orca-so.github.io/whirlpools/legacy/functions/swapQuoteByInputTokenWithDevFees.html) & [`swapWithDevFees`](https://orca-so.github.io/whirlpools/legacy/interfaces/Whirlpool.html#swapWithDevFees) function to let developers take a fee as a percentage of the input asset. This feature is a convenient way to calculate the percentage, build a transfer instruction for the fee, and use the remaining input asset in a swap instruction.

```tsx
// Wallet used to collect developer fees
const DEV_WALLET = new PublicKey(...)

const whirlpoolPda = PDAUtil.getWhirlpool(...);
const whirlpoolClient = buildWhirlpoolClient(ctx);
const whirlpool = await whirlpoolClient.getPool(whirlpoolPda.publicKey, true);
// use getData or refreshData, depending on whether you think your data is stale.
const whirlpoolData = await whirlpool.getData(); 

const inputTokenQuote = await swapQuoteByInputTokenWithDevFees(
  whirlpool,
  whirlpoolData.tokenMintB,
  new u64(190000000),
  Percentage.fromFraction(1, 1000), // 0.1%
  ctx.program.programId,
  fetcher,
  Percentage.fromFraction(2, 1000), // 0.2% of the input asset will be sent to DEV_WALLET
  true
);

// Send out the transaction
const txId = await (await whirlpool.swapWithDevFees(inputTokenQuote, DEV_WALLET)).buildAndExecute();
```

> ℹ️ The developer fee transfer is performed by the SPL Token program or System program, and not the Whirlpools program.

Best practice is to [pre-create Associated Token Accounts (ATA)](https://solanacookbook.com/references/token.html#how-to-create-a-token-account) for each token type which will be sent to the developer wallet. Also, if the fee will be payed in SOL, make sure that the developer wallet has at least 0.001 SOL to ensure that the wallet account will meet rent exemption.

## The Manual Way
Manually constructing your own parameters gives you more flexibility in defining the boundaries of your trade.

### Trade Parameters
The [`swap`](https://orca-so.github.io/whirlpools/legacy/interfaces/Whirlpool.html#swap) instruction requires the following input (and other common accounts) to execute the trade.

```tsx
export type SwapInput = {
  amount: u64;
  otherAmountThreshold: u64;
  sqrtPriceLimit: BN;
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
  tickArray0: PublicKey;
  tickArray1: PublicKey;
  tickArray2: PublicKey;
};
```

- Decide the trade direction with `aToB`
    - If true, you are trading from token A to B
    - If false, you are trading from token B to A
- Decide the token you would like to cap with `amountSpecifiedIsInput`
    - If true, `amount` is the value representing the token being traded from. This amount is subject to trade fees before the trade calculation.
    - If false, `amount` is the value representing the token being traded to. This amount is the required token out amount from a trade after fees.
- Decide whether you want to cap the other token of the trade using `otherAmountThreshold`
    - If `amountSpecifiedIsInput` is true, this amount represents the minimum amount of output token expected from this trade. If you do not want to cap, use 0.
    - If `amountSpecifiedIsInput` is false, this amount represents the maximum amount of input token that can be used to trade to an expected amount of the output token. If you do not want to cap, use the maximum amount of tokens in your wallet.
- Decide the price limit that you would like to cap this trade to with `sqrtPriceLimit`.
    - If `aToB` is true, the trade will push the price lower. This amount is minimum sqrt-price that the trade will trade to if input token amount is sufficient.
    - If `aToB` is false, the trade will push the price higher. This amount is the maximum sqrt-price that the trade will trade to if the the input token amount is sufficient.
    - If you don't have a cap and want to trade as much as you've defined with `amount` and `otherAmountThreshold`, use the minimum price of your tick-array range for `bToA` and maximum price of your tick-range for `aToB`. If you don't mind hitting tick-array errors or you know your swap won't move the price too much, you can use [`MIN_SQRT_PRICE`](https://orca-so.github.io/whirlpools/legacy/variables/MIN_SQRT_PRICE.html) or [`MAX_SQRT_PRICE`](https://orca-so.github.io/whirlpools/legacy/variables/MAX_SQRT_PRICE.html).
    - sqrt-price is a x64 number. So your number would need to multiplied by 2^64. Use [`PriceMath`](https://orca-so.github.io/whirlpools/legacy/classes/PriceMath.html) utils here to help you do the conversion.
- `amount` and `otherAmountThreshold` are u64 numbers. So make sure you shift your expected token numbers by the token's decimal.

### Tick Arrays
The tick-array parameters are a sequence of tick-arrays that your swap may traverse through. `tickArray0` will always be the PublicKey of the TickArray that houses the current tick-index.

In almost all cases, you can use the [`SwapUtils.getTickArrays`](https://orca-so.github.io/whirlpools/legacy/classes/SwapUtils.html#getTickArrays) to generate the sequence of tick-arrays that you need.

If you opt for building it yourself and you know that your swap is small enough that it's unlikely to traverse through an array, simply provide the same tickArray0 account for all 3 accounts. Once you have the sequence of tick-array public keys, you can use the AccountFetcher to check that the tick-arrays are initialized.

To learn more about tick-arrays and how its traversal works, read [Understanding Tick Arrays](../02-Architecture%20Overview/03-Understanding%20Tick%20Arrays.md).

### Common Usage Examples
Assume all tokens below have a decimal of 6
1. Trading 100 token A for some amount of token B.
    ```tsx
    aToB = true
    amount = 100 * Math.pow(10, 6)
    amountSpecifiedIsInput  = true
    otherAmountThreshold = 0
    sqrt_price_limit = MIN_SQRT_PRICE
    ```
2. Trading a max amount of 50 token B for 100 token A
    ```tsx
    aToB = false
    amount = 100 * Math.pow(10, 6)
    amountSpecifiedIsInput  = false
    otherAmountThreshold = 50
    sqrt_price_limit = MAX_SQRT_PRICE
    ```
3. Trade whatever amount needed to move the price from current sqrt-price 50_x64 to sqrt_price 250_x64
    ```tsx
    aToB = true
    amount = maxAmmountWallet
    amountSpecifiedIsInput  = true
    otherAmountThreshold = 0
    sqrt_price_limit = 250_x64
    ```
