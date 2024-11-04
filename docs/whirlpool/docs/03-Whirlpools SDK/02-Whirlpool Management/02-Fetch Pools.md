---
sidebar_label: Fetch Liquidity Pools
---

# Fetching Liquidity Pools on Orca

Monitoring and fetching details about liquidity pools on Orca is crucial for understanding their current state, whether you want to gather insights in a Splash Pool, a Concentrated Liquidity Pool, or all pools between specific token pairs. This guide will explain how to interact with the available functions to retrieve these details.

## 1. Overview of Pool Fetching

Fetching liquidity pool details helps developers gain insight into the current state of the pool, whether it is initialized or uninitialized, and retrieve relevant metrics like liquidity, price, and fee rates.

The SDKs offer three main functions to help developers monitor the pools:
- **Fetch Splash Pool**: Fetches the details of a specific Splash Pool.
- **Fetch Concentrated Liquidity Pool**: Fetches the details of a specific Concentrated Liquidity Pool.
- **Fetch Pools**: Fetches all possible liquidity pools between two token mints, with various tick spacings.

### Initialized vs. Uninitialized Pools
> Skip this section if you're using Splash Pools.

Each token pair can have multiple pools based on different tick spacings, corresponding to various fee tiers. When using the Fetch Concentrated Liquidity Pool function, it’s possible to request a pool with a tick spacing that hasn't been used to create a pool for the given token pair. In this case, you’ll receive a pool object with default parameters and an additional field `initialized = false`, indicating that the pool has not been set up.

Similarly, when using Fetch Pools, which iterates through all possible tick spacings for a given token pair, uninitialized pools can also be returned in this manner. The function will return both initialized and uninitialized pools, allowing you to identify pools that have not yet been created.

## 2. Getting Started Guide

### Fetching a Splash Pool

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that make up the liquidity pool.
2. **Fetch Pool Details**: Use the appropriate function to fetch the details of the specified Splash Pool.

```tsx
const poolInfo = await fetchSplashPool(
  rpc,
  tokenMintOne,
  tokenMintTwo
);
```

### Fetching a Concentrated Liquidity Pool

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that make up the liquidity pool.
2. **Tick Spacing**: Specify the tick spacing, which defines the intervals for price ticks.
3. **Fetch Pool Details**: Use the appropriate function to fetch the details of the specified Concentrated Liquidity Pool.

```tsx
const poolInfo = await fetchConcentratedLiquidityPool(
  rpc,
  tokenMintOne,
  tokenMintTwo,
  tickSpacing
);
```

### Fetching Pools by Token Pairs

1. **Token Mint Addresses**: Provide the mint addresses of the two tokens that make up the liquidity pool.
2. **Fetch Pool Details**: Use the appropriate function to fetch the details of the specified pools.

```tsx
const pools = await fetchWhirlPoolsByTokenPair(
  rpc,
  tokenMintOne,
  tokenMintTwo
);
```
