---
sidebar_label: Close Position
---

# Close a Position

Once you've provided liquidity in a pool, there may come a time when you want to close your position entirely. The SDK allows you to fully remove liquidity from the pool, collect any outstanding fees and rewards, and close the position. This is useful when you want to exit the pool, either to realize profits or to reallocate capital to other opportunities.

This guide explains how to use the SDK to close a position.

## 1. Overview of Closing a Position

When using the SDK to fully close a liquidity position, you generate all the necessary instructions. It performs the following key actions:

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
4. **Slippage Tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected token amounts you receive when closing a position and the actual amounts returned to your wallet. A lower slippage tolerance reduces the risk of receiving fewer tokens than expected but may lead to failed transactions if the market moves too quickly. For example, if you expect to receive 100 units of Token A and 1,000 units of Token B when closing your position, with a 1% slippage tolerance, the minimum amounts returned would be 99 Token A and 990 Token B.
5. **Authority**: This can be your wallet, which will fund the pool initialization. If the authority is not specified, the default wallet will be used. You can configure the default wallet through the SDK.
6. **Create Instructions**: Use the appropriate function to generate the necessary instructions.
  ```tsx
  const { instructions, quote, feesQuote, rewardsQuote } = await closePositionInstructions(
    rpc,
    positionMint,
    param,
    slippageTolerance, 
    wallet 
  );
  ```
7. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK.

## 3. Usage Example

Suppose your trading strategy predicts that the current price range will lead to divergence loss, and you need to close the position to avoid further losses. Using the SDK, you can generate the instructions to collect all accumulated fees, rewards, and remove liquidity to prevent further losses.
