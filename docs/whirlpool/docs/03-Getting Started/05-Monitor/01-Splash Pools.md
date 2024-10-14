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

```tsx
import { fetchSplashPool } from '@orca-so/whirlpools';
import { generateKeyPair, createSolanaRpc, devnet, getAddressFromPublicKey } from '@solana/web3.js';

const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
const wallet = await generateKeyPairSigner();
devnetRpc.requestAirdrop(
  wallet.address,
  lamports(1000000000n)
).send()

const tokenMintOne = "TOKEN_MINT_ONE"; 
const tokenMintTwo = "TOKEN_MINT_TWO";

const poolInfo = await fetchSplashPool(
  devnetRpc,
  tokenMintOne,
  tokenMintTwo
);

console.log("Splash Pool State:", poolInfo);
```