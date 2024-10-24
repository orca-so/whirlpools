---
sidebar_label: Adjust Liquidity
---

# Adjusting Liquidity in Your Positions

Once you’ve opened a position in an Orca Whirlpool, you may need to adjust the amount of liquidity you've provided to align with market conditions or your strategy. Whether you want to add more liquidity to capture additional fees or withdraw liquidity to reduce exposure or realize profits, the Whirlpools SDK provides functions for both.

This guide explains how to use the SDK functions to increase and decrease the liquidity in your position.

## 1. Overview of Adjusting Liquidity

The SDK functions for increasing or decreasing liquidity work similarly, enabling you to modify the liquidity of an existing position. You can specify the liquidity directly or provide amounts of token A or token B to increase or decrease liquidity.

With these functions, you can:
- Increase liquidity to potentially earn more fees as trading volume grows.
- Decrease liquidity to reduce exposure or withdraw profits.

## 2. Getting Started Guide

### Adjusting Liquidity in a Position

Adjusting liquidity in an existing position can be done as follows:

1. **RPC Client**: Use a Solana RPC client to interact with the blockchain.
2. **Position Mint**: Provide the mint address of the NFT representing your position. This NFT serves as proof of ownership of the position you want to adjust.
3. **Liquidity Parameters**: Choose how you want to adjust liquidity. You only need to provide one of these parameters, and the function will compute the others in the returned quote based on the current price of the pool and the price range of the position:
    - `liquidity`: Specify the liquidity value to add or remove.
    - `tokenA`: Specify the amount of token A to add or withdraw.
    - `tokenB`: Specify the amount of token B to add or withdraw.
4. **Slippage tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected token amounts added or removed when adjusting liquidity and the actual amounts that are ultimately deposited or withdrawn. A lower slippage tolerance reduces the risk of depositing or withdrawing more or fewer tokens than intended, but it may lead to failed transactions if the market moves too quickly.
5. **Funder**: This can be your wallet, which will fund the pool initialization. If a funder is not specified, the default wallet will be used. You can configure the default wallet through the SDK.
6. **Create Instructions**: Use the appropriate function to generate the necessary instructions.
    ```tsx
    const {quote, instructions, initializationCost} = await increaseLiquidityInstructions(
        rpc, 
        positionMint, 
        param, 
        slippageTolerance, 
        wallet
    )
    ```
7. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK.

## 3. Usage example

You are creating a bot to manage investors' funds and want to optimize returns. Such a bot could rebalance liquidity based on market signals to maintain a specific target price range or to optimize fee collection during periods of high volatility.

## 4. Next steps

After adjusting liquidity, you can:

- [Monitor Performance](02-Fetch%20Positions.md): Track your adjusted position to evaluate its performance and earned fees.
- [Harvest Rewards](04-Harvest.md): Collect any earned fees and rewards without closing your position.
- Make Further Adjustments: Depending on market conditions, continue to adjust liquidity as needed to maximize returns or manage risk.

By using the SDK to adjust liquidity, you gain flexibility in managing your positions and optimizing your liquidity provision strategy.