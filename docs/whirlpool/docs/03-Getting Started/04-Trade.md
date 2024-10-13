---
sidebar_label: Trade
---

# Executing a Token Swap

The `swapInstructions()` function generates all the instructions necessary to execute a token swap in an Orca Whirlpool pool. Whether you're swapping a specific amount of input tokens or looking to receive a precise amount of output tokens, this function handles the preparation of token accounts, liquidity data, and transaction assembly. It also manages slippage tolerance to ensure that swaps are executed within acceptable price changes.

## Function Overview
**`swapInstructions()`**

- **Inputs**
    - `rpc`: A Solana RPC client used to interact with the blockchain and fetch necessary accounts and pool data.
    - `params`: A swap parameter object that can contain:
        - `inputAmount` for exact input swaps or `outputAmount` for exact output swaps. 
        - `mint`: Mint address of the token you want to swap out.
    - `poolAddress`: The address of the Orca Whirlpool pool where the swap will take place.
    - `slippageToleranceBps`: The acceptable slippage tolerance for the swap, in basis points (BPS).
    - `signer`: The wallet or signer executing the swap.
- **Outputs:** The function returns a `Promise` that resolves to an object containing:
    - `instructions`: The list of instructions needed to perform the swap.
    - `quote`: The swap quote (details on the amounts involved in the swap).

## Basic usage

```tsx title="performSwap.ts"
import { swapInstructions } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';
import { airdropSolIfNeeded } from './airdrop';

async function performSwap() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  await airdropSolIfNeeded(connection, wallet);

  const poolAddress = "POOL_ADDRESS";
  const mintAddress = "TOKEN_MINT";
  const inputAmount = 1_000_000;

  const { instructions, quote } = await swapInstructions(
    connection, 
    { inputAmount, mint: mintAddress }, 
    poolAddress, 
    0.01,
    wallet
  );

  console.log("Swap Quote:", quote);
  console.log("Swap Instructions:", instructions);
}

performSwap();
```