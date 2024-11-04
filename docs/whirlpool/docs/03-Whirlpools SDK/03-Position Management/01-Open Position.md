---
sidebar_label: Open a position
---

# Opening a Position

Opening a position in liquidity pools on Orca is a fundamental step for providing liquidity and earning fees. In this guide, we'll explore how to open a position in both **Splash Pools** and **Concentrated Liquidity Pools**, their differences, and which approach is suitable for different use cases.

## 1. Introduction to Positions in Pools

A position in a liquidity pool represents your contribution of liquidity, which allows traders to swap between tokens while you earn a share of the trading fees. When you open a position, you decide how much liquidity to add, and this liquidity can later be adjusted or removed.

- **Splash Pools**: Provide liquidity without specifying a price range. Ideal for those seeking a simple way to start providing liquidity.

- **Concentrated Liquidity Pools**: Allow you to provide liquidity within a specified price range, enabling higher capital efficiency but requiring more advanced management.

Upon creation of the position, an NFT will be minted to represent ownership of the position. This NFT is used by the program to verify your ownership when adjusting liquidity, harvesting rewards, or closing the position. For more information, refer to [Tokenized Positions](../../02-Architecture%20Overview/04-Tokenized%20Positions.md).

> ⚠️ **Risk of Divergence loss**: The ratio of Token A to Token B that you deposit as liquidity is determined by several factors, including the current price. As trades occur against the pool, the amounts of Token A and Token B in the pool — and in your position — will change, which affects the price of the tokens relative to each other. This can work to your advantage, but it may also result in the combined value of your tokens (including any earned fees and rewards) being lower than when you initially provided liquidity.
 
> ⚠️ Do not burn the position NFT, as burning it will result in the indefinite loss of your position and liquidity.

## 2. Getting Started Guide

Before opening a position, ensure you have completed the environment setup:
- **RPC Setup**: Use a Solana RPC client to communicate with the blockchain.
- **Wallet Creation**: Create a wallet to interact with the Solana network.
- **Devnet Airdrop**: Fund your wallet with a Solana Devnet airdrop to cover transaction fees.

For more details, refer to our [Environment Setup Guide](../01-Environment%20Setup.md)

### Opening a Position in Splash Pools

1. **Pool Address**: Provide the address of the Splash Pool where you want to open a position.
2. **Liquidity Parameters**: Choose how you want to provide liquidity. You only need to provide one of these parameters, and the function will compute the others in the returned quote based on the current price of the pool:
    - `liquidity`: Specify the liquidity value to provide.
    - `tokenA`: Specify the amount of token A (first token in the pool).
    - `tokenB`: Specify the amount of token B (second token in the pool).
3. **Slippage Tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected price and the actual price at which the transaction is executed. A lower slippage tolerance reduces the risk of price changes during the transaction but may lead to failed transactions if the market moves too quickly.
4. **Funder**: This will be your wallet, which will fund the transaction.
5. **Create Instructions**: Use the appropriate function to generate the necessary instructions.
    ```tsx
    const { quote, instructions, initializationCost } = await openFullRangePositionInstructions(
        devnetRpc,
        poolAddress,
        param, 
        slippageTolerance,
        wallet
    );
    ```
6. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK. Ensure that you have enough of both Token A and Token B as calculated in the quote, or the transaction will fail.

### Opening a Position in Concentrated Liquidity Pools

1. **Pool Address**: Provide the address of the Concentrated Liquidity Pool where you want to open a position.
2. **Liquidity Parameters**: Choose how you want to provide liquidity. You only need to provide one of these parameters, and the function will compute the others in the returned quote based on the price range and the current price of the pool:
    - `liquidity`: Specify the liquidity value to provide.
    - `tokenA`: Specify the amount of token A (first token in the pool).
    - `tokenB`: Specify the amount of token B (second token in the pool).
3. **Price Range**: Set the lower and upper bounds of the price range within which your liquidity will be active. The current price and the specified price range will influence the quote amounts. If the current price is in the middle of your price range, the ratio of token A to token B will reflect that price. However, if the current price is outside your range, you will only deposit one token, resulting in one-sided liquidity. Note that your position will only earn fees when the price falls within your selected price range, so it’s important to choose a range where you expect the price to remain active.
3. **Slippage Tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected token amounts and the actual amounts deposited into the liquidity pool. A lower slippage tolerance reduces the risk of depositing more tokens than expected but may lead to failed transactions if the market moves too quickly. For example, if you expect to deposit 100 units of Token A and 1,000 units of Token B, with a 1% slippage tolerance, the maximum amounts would be 101 Token A and 1,010 Token B.
4. **Funder**: This can be your wallet, which will fund the pool initialization. If the funder is not specified, the default wallet will be used. You can configure the default wallet through the SDK.
5. **Create Instructions**: Use the appropriate function to generate the necessary instructions.
    ```tsx
    const { quote, instructions, initializationCost, positionMint } = await openPositionInstructions(
        rpc,
        poolAddress,
        param, 
        slippageTolerance,
        wallet
    );
    ```
6. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK. Ensure that you have enough of both Token A and Token B as calculated in the quote, or the transaction will fail.

> ⚠️ You cannot use this function on Splash Pools, as this function is specifically for Concentrated Liquidity Pools.

## 3. Usage examples

### Opening a Position in a Splash Pool

Suppose you want to provide 1,000,000 tokens of Token A at a price of 0.0001 SOL. You will also need to provide 100 SOL as Token B to match the price. By using the SDK to open full range positions, you ensure that your liquidity is spread evenly across all price levels. This approach is ideal if you are launching a new token and want to facilitate easy swaps for traders.

### Opening a Position in a Concentrated Liquidity Pool

If you want to maximize capital efficiency, you can open a position in a Concentrated Liquidity Pool. For example, if the current price is at 0.01 and you want to maximize profitability, you could use the SDK to deposit liquidity between the price range of 0.009 and 0.011. This approach allows you to focus your liquidity in a narrow range, making it more effective and potentially more profitable.

## Next Steps

After opening a position, you can:
- [Add or Remove Liquidity](03-Adjust%20Liquidity.md): Adjust the amount of liquidity in your position based on market conditions.
- [Harvest Rewards](04-Harvest.md): Collect rewards and fees without closing the position.
- [Monitor Performance](02-Fetch%20Positions.md): Track your position's performance and earned fees.
- [Close Position](05-Close%20Position.md): When you decide to exit, close the position and withdraw the provided tokens along with any earned fees.