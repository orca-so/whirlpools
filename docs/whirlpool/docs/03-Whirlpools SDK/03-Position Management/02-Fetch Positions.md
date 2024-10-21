---
sidebar_label: Fetch Positions
---

# Fetching Positions

Retrieving details about positions held in liquidity pools is an essential part of managing your liquidity and monitoring performance. This guide explains how to use the `fetchPositions()` function to gather information about all active positions held by a given wallet.

## 1. Overview of Fetching Positions

The `fetchPositions()` function helps developers retrieve liquidity positions associated with a specific wallet. It scans the Solana blockchain for token accounts owned by the wallet, determines which ones represent positions, and decodes the data to provide detailed information about each position.

With this function, you can:
- Identify all liquidity positions held by a wallet.
- Gather information about liquidity, price ranges, and fees earned.

## 2. Getting Started Guide

### Fetching Positions for a Wallet

Fetching positions is a straightforward process:

1. **RPC Client**: Use a Solana RPC client to interact with the blockchain.
2. **Wallet Address**: Provide the wallet address of the user whose positions you want to fetch.
3. **Fetch Positions**: Use the `fetchPositions()` function to retrieve all positions held by the specified wallet.

```tsx
const positions = await fetchPositions(Rpc, wallet.address);
```

## 3. Usage example

Suppose you want to monitor all active positions held by a wallet. Using `fetchPositions()`, you can retrieve detailed information about each position, including liquidity amounts, associated pools, and earned rewards. This information can also be used to build a bot that rebalances or repositions liquidity according to a strategy defined by an algorithmic trader. Tracking position performance helps in making informed decisions about adjusting, rebalancing, or closing positions.

## 4. Next steps

After fetching positions, you could:

- [Add or Remove Liquidity](./03-Adjust%20Liquidity.md): Adjust the amount of liquidity in your position based on market conditions.
- [Harvest Rewards](./05-Harvest.md): Collect rewards and fees without closing the position.
- [Close Position](./04-Close%20Position.md): When you decide to exit, close the position and withdraw the provided tokens along with any earned fees.

By utilizing the `fetchPositions()` function, you gain visibility into your liquidity positions and can take necessary actions to optimize returns