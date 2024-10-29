---
sidebar_label: Trade
---

# Executing a Token Swap

You can use the SDK to execute a token swap on Orca. Whether you're swapping a specific amount of input tokens or looking to receive a precise amount of output tokens, this function handles the preparation of token accounts, liquidity data, and instruction assembly. It also manages slippage tolerance to ensure that swaps are executed within acceptable price changes.

This guide explains how to use the SDK to perform a token swap in an Orca Whirlpool.

## 1. Overview of Executing a Token Swap

The SDK allows you to swap tokens between different pools on Orca. It handles the calculation of token amounts, manages slippage, and assembles the necessary instructions for executing the swap.

With this function, you can:
- Swap an exact amount of input tokens for the maximum possible output.
- Specify the desired amount of output tokens and determine the necessary input.
- Control slippage to manage your risk during volatile market conditions.

## 2. Getting Started Guide

Before creating a Splash Pool or a Concentrated Liquidity Pool, ensure you have completed the environment setup:
- **RPC Setup**: Use a Solana RPC client to communicate with the blockchain.
- **Wallet Creation**: Create a wallet to interact with the Solana network.
- **Devnet Airdrop**: Fund your wallet with a Solana devnet airdrop to cover transaction fees.

For more details, refer to our [Environment Setup Guide](./01-Environment%20Setup.md)

### Executing a Token Swap
To execute a token swap in an Orca Whirlpool, follow these steps:

1. **RPC Client**: Use a Solana RPC client to interact with the blockchain.
2. **Pool Address**: Provide the address of the Orca Whirlpool pool where the swap will take place.
3. **Swap Parameters**: Define the swap parameters. You only need to provide one of these parameters, and the function will compute the others in the returned quote based on the current price of the pool:
  - `inputAmount`: Specify the amount of tokens to swap (if exact input).
  - `outputAmount`: Specify the desired amount of tokens to receive (if exact output).
  - `mint`: Provide the mint address of the token you want to swap out.
4. **Slippage tolerance**: Set the maximum slippage tolerance (optional, defaults to 1%). Slippage refers to the difference between the expected amounts of tokens received or sent during the swap and the actual amounts executed. A lower slippage tolerance reduces the risk of receiving fewer tokens than expected, but may lead to failed transactions if the market moves too quickly. For example, if you expect to receive 1,000 units of Token B for 100 units of Token A, with a 1% slippage tolerance, the maximum Token A spent will be 101, and the minimum Token B received will be 990.
5. **Signer**: This can be your wallet, which will fund the pool initialization. If a signer is not specified, the default wallet will be used. You can configure the default wallet through the SDK.
6. **Create Instructions**: Use the appropriate function to generate the necessary instructions for the swap.
  ```tsx
  const { instructions, quote } = await swapInstructions(
    rpc, 
    { 
      inputAmount: amount, 
      mint: mintAddress
    }, 
    poolAddress, 
    slippageTolerance,
    wallet
  );
  ```
7. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK.

### 3. Example Usage

Suppose you are developing an arbitrage bot that looks for price discrepancies between different liquidity pools on Orca. By using the SDK, the bot can retrieve the quote object for a potential swap, which includes details about the token amounts and expected output. The bot can quickly compare quotes from multiple pools to identify arbitrage opportunities and execute profitable swaps.
