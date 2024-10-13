---
sidebar_label: Pools by Token Pairs
---

The fetchPools function is designed to fetch all possible liquidity pools between two token mints in Orca Whirlpools. Each pool may have different tick spacings, and this function retrieves both initialized and uninitialized pool data.

## Function overview
**`fetchPools ()`**
- **Inputs**
    - `rpc`: A Solana RPC client used to interact with the blockchain and fetch pool data.
    - `tokenMintOne`: The first token mint address in the pool.
    - `tokenMintTwo`: The second token mint address in the pool.
- **Outputs**
    - `PoolInfo[]`: The function returns a `Promise` that resolves to an array of `PoolInfo`, with each item representing the state of a pool between the two tokens. This includes details like whether the pool is initialized or not, the current price, its tick spacing, and fee rates.

## Basic Usage

```tsx title="getSplashPool.ts"
import { fetchPools } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';

async function getPoolsInfo() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();

  const tokenMintOne = "TOKEN_MINT_ONE";  
  const tokenMintTwo = "TOKEN_MINT_TWO"; 

  const pools = await fetchPools(connection, tokenMintOne, tokenMintTwo);

  pools.forEach(pool => {
    if (pool.initialized) {
      console.log("Initialized Pool Info:", pool);
    } else {
      console.log("Uninitialized Pool Info (Defaults):", pool);
    }
  });
}

getPoolsInfo().catch((err) => console.error(err));
```
