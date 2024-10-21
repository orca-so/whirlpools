---
sidebar_label: Fetch Liquidity Pools
---

# Fetching Liquidity Pools on Orca

Monitoring and fetching details about liquidity pools on Orca is crucial for understanding their current state, whether you want to gather insights for a Splash Pool, a Concentrated Liquidity Pool, or all pools between specific token pairs. This guide will explain how to interact with the available functions to retrieve these details.

## 1. Overview of Pool Fetching

Fetching liquidity pool details helps developers gain insights into the current state of the pool, whether it is initialized or uninitialized, and retrieve relevant metrics like liquidity, price, and fee rates.

Whirlpools SDK offers three main functions to help developers monitor the pools:
- `fetchSplashPool()`: Fetches the details of a specific Splash Pool.
- `fetchPool()`: Fetches the details of a specific Concentrated Liquidity Pool.
- `fetchPools()`: Fetches all possible liquidity pools between two token mints, with various tick spacings.

## 2. Getting Started Guide

### Fetching a Splash Pool

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that make up the liquidity pool.
2. **Fetch Pool Details**: Use the fetchSplashPool() function to fetch the details of the specified Splash Pool.

```tsx
const poolInfo = await fetchSplashPool(
  Rpc,
  tokenMintOne,
  tokenMintTwo
);
```

### Fetching a Concentrated Liquidity Pool

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that make up the liquidity pool.
2. **Tick Spacing**: Specify the tick spacing, which defines the intervals for price ticks.
3. **Fetch Pool Details**: Use the fetchConcentratedLiquidityPool() function to fetch the details of the specified Concentrated Liquidity Pool.

```tsx
const poolInfo = await fetchConcentratedLiquidityPool(
  Rpc,
  tokenMintOne,
  tokenMintTwo,
  tickSpacing
);
```

### Fetching Pools by Token Pairs

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that make up the liquidity pool.
2. **Fetch Pool Details**: Use the fetchPools() function to fetch the details of the specified pools.

```tsx
const pools = await fetchPools(
  Rpc,
  tokenMintOne,
  tokenMintTwo
);
```