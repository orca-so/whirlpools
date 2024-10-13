---
sidebar_label: CLMM pool
---

# Fetching a Concentrated Liquidity Pool

The `fetchPool()` function is used to retrieve detailed information about a liquidity pool in Orca Whirlpools, given two token mints and a specific tick spacing. This function checks whether the pool is already initialized and returns either its full details or default configuration data for uninitialized pools.

## Function Overview
**`fetchPool()`**
- **Inputs**
    - `rpc`: A Solana RPC client used to interact with the blockchain and fetch pool data.
    - `tokenMintOne`: The first token mint address in the pool.
    - `tokenMintTwo`: The second token mint address in the pool.
    - `tickSpacing`: The tick spacing of the pool.
- **Outputs**
    - `PoolInfo`: The function returns a Promise that resolves to PoolInfo, which contains onchain state information about the pool (whether initialized or not). If the pool is initialized, the information will include liquidity data and pool configuration. If the pool is not yet initialized, it returns default values with the property `initialized` set to `false`.

## Basic Usage

```tsx title="getPoolInfo.ts"
import { fetchPool } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';

async function getPoolInfo() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();

  const tokenMintOne = "TOKEN_MINT_ONE";
  const tokenMintTwo = "TOKEN_MINT_TWO";
  const tickSpacing = 64;
  
  const poolInfo = await fetchPool(connection, tokenMintOne, tokenMintTwo, tickSpacing);

  if (poolInfo.initialized) {
    console.log("Initialized Pool State:", poolInfo);
  } else {
    console.log("Uninitialized Pool Info (Defaults):", poolInfo);
  }
}

getPoolInfo().catch((err) => console.error(err));
```