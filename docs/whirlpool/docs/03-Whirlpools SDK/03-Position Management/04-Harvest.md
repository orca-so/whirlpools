---
sidebar_label: Harvest
---

# Harvesting a Position

Harvesting a position in Orca Whirlpools allows you to collect any accumulated fees and rewards without closing the position. This process is useful when you want to claim your earnings while keeping your liquidity active in the pool, ensuring you continue to benefit from potential future fees.

The `harvestPositionInstructions()` function generates the instructions needed to collect fees and rewards from an open position.

## 1. Overview of Harvesting a Position

The `harvestPositionInstructions()` function generates the necessary instructions to collect earned fees and rewards from a position without closing it. This allows you to realize your earnings while maintaining liquidity in the pool.

With this function, you can:
- Collect accumulated trading fees from your position.
- Harvest rewards earned by providing liquidity, all while keeping the position active.

## 2. Getting Started Guide

### Step-by-Step Guide to Harvesting a Position

To harvest fees and rewards from a position, follow these steps:
1. **RPC Client**: Use a Solana RPC client to interact with the blockchain.
2. **Position Mint**: Provide the mint address of the NFT representing your position. This NFT serves as proof of ownership and represents the liquidity in the position.
3. **Authority**: The wallet that authorizes the transaction for harvesting.
4. **Create Instructions**: Use the harvestPositionInstructions() function to generate the necessary instructions to harvest fees and rewards.
```tsx
  const { feesQuote, rewardsQuote, instructions } = await harvestPositionInstructions(
    devnetRpc,
    positionMint,
    wallet
  );
```
5. **Submit Transaction**: Include the generated instructions in a Solana transaction and send it to the network using the Solana SDK.

## 3. Usage Example

Suppose you are a developer creating a bot to manage investments for a group of investors. The bot periodically collects accumulated fees and rewards from liquidity positions to distribute profits among investors. By using the harvestPositionInstructions() function, you can generate the instructions to collect earnings from each active position without closing it, allowing the liquidity to continue generating returns.

## 4. Next Steps

After harvesting fees and rewards, you can:

- [Monitor Performance](./02-Fetch%20Positions.md): Keep track of your position to evaluate future earnings and the overall performance.
- Reinvest Earnings: Use the harvested fees and rewards to add more liquidity or diversify your positions.
- Harvest Regularly: Regularly collect your earnings to maintain optimal capital efficiency while keeping your liquidity active.

By using harvestPositionInstructions(), you can maximize the benefits of providing liquidity while keeping your position open and continuously earning fees.