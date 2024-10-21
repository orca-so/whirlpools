---
sidebar_label: Adjust Liquidity
---

# Adjusting Liquidity in Your Positions

Once you’ve opened a position in an Orca Whirlpool, you may need to adjust the amount of liquidity you've provided to align with market conditions or your strategy. Whether you want to add more liquidity to capture additional fees or withdraw liquidity to reduce exposure or realize profits, the Whirlpools SDK provides functions for both actions.

This guide explains how to use the `increaseLiquidityInstructions()` and `decreaseLiquidityInstructions()` functions to adjust the liquidity in your position.

## 1. Overview of Adjusting Liquidity

Both the `increaseLiquidityInstructions()` and `decreaseLiquidityInstructions()` functions operate in a similar way, allowing you to adjust the liquidity of an existing position. You can specify the liquidity directly or provide amounts of token A or token B to increase or decrease liquidity.

With these functions, you can:
- Increase liquidity to potentially earn more fees as trading volume grows.
- Decrease liquidity to reduce exposure or withdraw profits.

## 2. Getting Started Guide

### Adjusting Liquidity in a Position

Adjusting liquidity in an existing position can be done using the `increaseLiquidityInstructions()` or `decreaseLiquidityInstructions()` functions:

1. **RPC Client**: Use a Solana RPC client to interact with the blockchain.
2. **Position Mint**: Provide the mint address of the NFT representing your position. This NFT serves as proof of ownership of the position you want to adjust.
3. **Liquidity Parameters**: Choose how you want to adjust liquidity. You only need to provide one of these parameters, and the function will compute the others in the returned quote based on the current price of the pool and the price range of the position:
    - `liquidity`: Specify the liquidity value to add or remove.
    - `tokenA`: Specify the amount of token A to add or withdraw.
    - `tokenB`: Specify the amount of token B to add or withdraw.
4. **Slippage tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected price and the actual price at which the transaction is executed. A lower slippage tolerance reduces the risk of price changes during the transaction but may lead to failed transactions if the market moves too quickly.
5. **Funder**: This will be your wallet, which will fund the transaction will be used for the liquidity adjustment.
6. **Create Instructions**: Use the appropriate function (`increaseLiquidityInstructions()` or `decreaseLiquidityInstructions()`) to generate the necessary instructions.
    ```tsx
    const {quote, instructions, initializationCost} = await increaseLiquidityInstructions(
        devnetRpc, 
        positionMint, 
        param, 
        slippageTolerance, 
        wallet
    )
    ```
7. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK.

## 3. Usage example

You are creating a bot with which you manage investors funds and want to optimize returns. Such a bot could rebalance liquidity based on market signals to maintain a specific target price range or to optimize fee collection during periods of high volatility.

## 4. Next steps

After adjusting liquidity, you can:

- [Monitor Performance](./02-Fetch%20Positions.md): Track your adjusted position to evaluate its performance and earned fees.
- [Harvest Rewards](./05-Harvest.md): Collect any earned fees and rewards without closing your position.
- Make Further Adjustments: Depending on market conditions, continue to adjust liquidity as needed to maximize returns or manage risk.

By using `increaseLiquidityInstructions()`and `decreaseLiquidityInstructions()`, you gain flexibility in managing your positions and optimizing your liquidity provision strategy.