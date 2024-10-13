---
sidebar_label: Splash Pools
---

# Fetching a Splash Pool

This guide explains how to use fetchSplashPool to fetch the details of a specific Splash Pool.

## Function Overview
**`fetchSplashPool()`**
- **Inputs**
    - `rpc`: A Solana RPC client used to interact with the blockchain and fetch pool data.
    - `tokenMintOne`: The first token mint address in the pool.
    - `tokenMintTwo`: The second token mint address in the pool.
- **Outputs**
    - `PoolInfo`: The function returns a Promise that resolves to PoolInfo, which contains onchain state information about the specified Splash Pool.

## Basic Usage

```tsx title="getSplashPool.ts"
import { fetchSplashPool } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';

async function getSplashPoolInfo() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();

  const tokenMintOne = "TOKEN_MINT_ONE"; 
  const tokenMintTwo = "TOKEN_MINT_TWO";
  
  const poolInfo = await fetchSplashPool(connection, tokenMintOne, tokenMintTwo);

  console.log("Splash Pool State:", poolInfo);
}

getSplashPoolInfo()
```