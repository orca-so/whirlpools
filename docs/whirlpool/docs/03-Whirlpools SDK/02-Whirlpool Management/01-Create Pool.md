---
sidebar_label: Create Liquidity Pools
---

# Creating Liquidity Pools on Orca

Creating liquidity pools on Orca is an essential step for launching your token and enabling trading. In this guide, we'll explore two types of liquidity pools available in the Orca ecosystem, **Splash Pools** and **Concentrated Liquidity Pools**, and help you understand how to create them, their differences, and which one best suits your needs.

## 1. Introduction to Pool Types

### Overview

Liquidity pools are a foundational concept in DeFi, enabling users to trade tokens without relying on traditional order books. On Orca, liquidity pools provide the means for traders to swap between two tokens, while liquidity providers earn fees by supplying the tokens to the pool.

### Splash Pools vs. Concentrated Liquidity Pools

- **Splash Pools**: Splash Pools are the simplest type of liquidity pool. They are ideal for those looking to launch a new token with minimal parameters. You only need to provide the mint addresses of the two tokens and set the initial price. Splash Pools offer an easy entry point into liquidity provision, making them especially appealing for community-driven projects like memecoins. These projects often prioritize community engagement over technical complexity, and Splash Pools provide a straightforward way to get started.

- **Concentrated Liquidity Pools:** Concentrated Liquidity Pools are more advanced and allow liquidity providers to concentrate their liquidity within specific price ranges. This results in higher capital efficiency but requires a deeper understanding of how to manage liquidity. Concentrated Liquidity Pools are better suited for experienced users who want greater control over their liquidity. However, they also come with the risk of divergence loss, where the value of your position may decrease compared to simply holding the tokens individually.

## 2. Getting Started Guide

Before creating a Splash Pool or a Concentrated Liquidity Pool, ensure you have completed the environment setup:
- **RPC Setup**: Use a Solana RPC client to communicate with the blockchain.
- **Wallet Creation**: Create a wallet to interact with the Solana network.
- **Devnet Airdrop**: Fund your wallet with a Solana devnet airdrop to cover transaction fees.

For more details, refer to our [Environment Setup Guide](../01-Environment%20Setup.md)

### Creating Splash Pools

Splash Pools are the easiest way to get started:

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that will make up the liquidity pool. The order of the tokens is important: the first token will be priced in terms of the second token. This means that the price you set will reflect how many units of the second token are needed to equal one unit of the first token. For example, if you set the price to 0.0001 SOL, this means that one unit of the first token is worth 0.0001 units of the second token (SOL). Make sure to verify the order of your tokens.
2. **Initial Price**: Set the initial price of token 1 in terms of token 2.
3. **Funder**: This will be your wallet, which will fund the initialization process.
4. **Create Instructions**: Use the appropriate function to generate the required pool creation instructions.
    ```tsx
    import { createSplashPoolInstructions } from '@orca-so/whirlpools'

    const { poolAddress, instructions, initializationCost } = await createSplashPoolInstructions(
        rpc,
        tokenMintOne,
        tokenMintTwo,
        initialPrice,
        wallet
    );
    ```
5. Submit Transaction: Include the generated pool creation instructions in a Solana transaction and send it to the network using the Solana SDK.

### Creating Concentrated Liquidity Pools

Concentrated Liquidity Pools offer more flexibility:

1. **Token Mint Addresses**: Provide the two token mints.
2. **Tick Spacing**: Set the tick spacing, which defines the intervals for price ticks. Visit [this link](https://orca-so.gitbook.io/orca-developer-portal/whirlpools/interacting-with-the-protocol/orca-whirlpools-parameters#initialized-feetier-and-tickspacing) to learn more about the available values of tick spacing and their corresponding fee rates.
3. **Initial Price**: Specify the initial price of token 1 in terms of token 2.
4. **Funder**: This can be your wallet, which will fund the pool initialization. If the funder is not specified, the default wallet will be used. You can configure the default wallet through the SDK.
5. **Create instructions**: Use the appropriate function to create the pool.
    ```tsx
    import { createConcentratedLiquidityPool } from '@orca-so/whirlpools'

    const { poolAddress, instructions, initializationCost } = await createConcentratedLiquidityPool(
        rpc,
        tokenMintOne,
        tokenMintTwo,
        tickSpacing,
        initialPrice,
        wallet
    );
    ```
6. **Submit Transaction**: Include the generated pool creation instructions in a Solana transaction and send it to the network using the Solana SDK.

### Comparison
| Feature            | Splash Pools       | Concentrated Liquidity Pools     |
| ------------------ | ------------------ | -------------------------------- |
| Complexity         | Low                | High                             |
| Initial Parameters | Token mints, price | Token mints, tick spacing, price |
| Capital Efficiency | Moderate           | High                             |
| Ideal For          | Beginners          | Advanced Users                   |

## 3. Usage Examples

### Launching a Token Pair with a Splash Pool

Suppose you want to launch a new memecoin and pair it with USDC. You can leverage the simplicity of Splash Pools to quickly set up the pool with an initial price. This is ideal if you want to keep things simple and start earning trading fees with minimal configuration. For example, if a development team is building a launchpad for memecoins, Splash Pools are an ideal solution.

### Creating a Concentrated Liquidity Pool for Efficiency

If you want to maximize capital efficiency, you can use the flexibility of Concentrated Liquidity Pools to define specific price ranges for your liquidity. This approach is beneficial when you expect price movements within certain bounds and want to concentrate liquidity accordingly. For example, a DeFi protocol might use a Concentrated Liquidity Pool to facilitate a stablecoin-stablecoin pair, where the price is expected to remain within a tight range. By concentrating liquidity in this range, the protocol can maximize returns for liquidity providers and reduce slippage for traders.

## 4. Next Steps

After creating a liquidity pool, the pool is still empty and requires liquidity for people to trade against. To make the pool functional, open a position and add liquidity. This enables traders to swap between tokens and helps you start earning fees.