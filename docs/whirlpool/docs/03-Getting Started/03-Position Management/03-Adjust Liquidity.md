---
sidebar_label: Adjust Liquidity
---

# Adjusting Liquidity in Your Positions

Once you’ve opened a position in an Orca Whirlpool, you might want to adjust the amount of liquidity you’ve provided. Whether it’s adding more liquidity to maximize potential fees or withdrawing some to realize profits or reduce exposure, the SDK provides functions for both actions.

This guide explains how to use the `increaseLiquidityInstructions()` and `decreaseLiquidityInstructions()` functions to adjust your position.

## Function overview

Both the `increaseLiquidityInstructions()` and `decreaseLiquidityInstructions()` functions operate in a similar way, allowing you to adjust the liquidity of an existing position. You can specify the liquidity directly or provide amounts of token A or token B to increase or decrease liquidity.

- **Inputs:**
    - `rpc`: A Solana RPC client used to communicate with the blockchain
    - `poolAddress`: The address of the Liquidity Pool where you want to adjust a position.
    - `param`: Defines how you want to provide or withdraw liquidity. This can be done in one of three ways:
        - `liquidity`: Specify the liquidity to add or remove.
        - `tokenA`: Specify how much of tokenA to add or withdraw
        - `tokenB`: Specify how much of tokenB to add or withdraw.
    - `slippageTolerance`: The maximum price slippage you are willing to accept during the liquidity adjustment process (optional, defaults to 0.01%).
    - `funder`: The account funding the transaction and providing liquidity.
    
- **Outputs:** The function returns a promise resolving to an object containing:
    - `quote`: A breakdown of the liquidity and tokens you are adding or removing
    - `instructions`: A list of instructions to initialize the position.
    - `initializationCost`: The minimum balance required for rent exemption, in lamports.

## Basic Usage

The example below demonstrates how to adjust liquidity in a position, whether you are increasing or decreasing liquidity. Before proceeding with the transaction, check the `quote` object to ensure you have enough balance (for increasing liquidity) or verify the amount you will receive back (for decreasing liquidity).

```tsx
import { increaseLiquidityInstructions } from '@orca-so/whirlpools';
import { generateKeyPair, createSolanaRpc, devnet, getAddressFromPublicKey } from '@solana/web3.js';

const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
const wallet = await generateKeyPairSigner();
devnetRpc.requestAirdrop(
  wallet.address,
  lamports(1000000000n)
).send()

const positionMint = "POSITION_MINT";  

const param = { tokenA: 1_000_000 } 

const {quote, instructions, initializationCost} = await increaseLiquidityInstructions(
    devnetRpc, 
    positionMint, 
    param, 
    0.01, 
    wallet
)

console.log(`Increase Liquidity Quote:`, quote);
console.log(`Decrease Liquidity Instructions:`, instructions);
console.log("Rent (lamports):", initializationCost);
```