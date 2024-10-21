---
sidebar_label: Close Position
---

# Close a Position

Once you've provided liquidity in a pool, there may come a time when you want to close your position entirely. The `closePositionInstructions()` function allows you to fully remove liquidity from the pool, collect any outstanding fees and rewards, and close the position. This is useful when you want to exit the pool, either to realize profits or to reallocate capital to other opportunities.

This guide explains how to use the `closePositionInstructions()` function to close a position.

## 1. Overview of Closing a Position

The `closePositionInstructions()` function generates the necessary instructions to fully close a liquidity position. It performs the following key actions:

1. Collect Fees: Retrieves any fees earned from trades involving your liquidity.
2. Collect Rewards: Retrieves any rewards you've accumulated for the pool.
3. Decrease Liquidity: Removes any remaining liquidity in the position.
4. Close Position: Closes the position and returns the tokens in your account.


## 2. Getting Started Guide

### Closing a Position

To close a position and withdraw all liquidity, follow these steps:
1. **RPC Client**: Use a Solana RPC client to interact with the blockchain.
2. **Position Mint**: Provide the mint address of the NFT representing your position. This NFT serves as proof of ownership and represents the liquidity in the position.
3. **Parameters for Liquidity**: Define the parameters for decreasing liquidity. This can be specified as a liquidity amount or as specific token amounts.
4. **Slippage Tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected price and the actual price at which the transaction is executed. A lower slippage tolerance reduces the risk of price changes during the transaction but may lead to failed transactions if the market moves too quickly.
5. **Authority**: The wallet authorizing the transaction for closing the position.
6. **Create Instructions**: Use the closePositionInstructions() function to generate the necessary instructions.
  ```tsx
  const { instructions, quote, feesQuote, rewardsQuote } = await closePositionInstructions(
    devnetRpc,
    positionMint,
    param,
    slippageTolerance, 
    wallet 
  );
  ```
7. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK.

## 3. Usage Example

Suppose your trading strategy predicts that the current price range will lead to divergence loss, and you need to close the position to avoid further losses. Using `closePositionInstructions()`, you can generate the instructions to collect all accumulated fees, rewards, and remove liquidity to prevent further losses.
