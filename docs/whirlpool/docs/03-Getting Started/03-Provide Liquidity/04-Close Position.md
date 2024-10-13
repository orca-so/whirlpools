---
sidebar_label: Close Position
---

# Close a Position

Once you've provided liquidity in a pool, there might come a time when you want to close your position entirely. The `closePositionInstructions()` function allows you to fully remove liquidity from the pool, collect any outstanding fees and rewards, and close the position.

## Function Overview
**`closePositionInstructions()`**

This function provides instructions for closing a position in an Orca Whirlpool. It performs several key actions:

1. Collect Fees: Retrieves any fees earned from trades involving your liquidity.
2. Collect Rewards: Retrieves any rewards you've accumulated for the pool.
3. Decrease Liquidity: Removes any remaining liquidity in the position.
4. Close Position: Closes the position and returns the tokens in your account.

- **Inputs**
    - `rpc`: A Solana RPC client used to communicate with the blockchain.
    - `positionMint`: The mint address of the position you want to close.
    - `param`: The parameters for decreasing liquidity. This can be specified in terms of liquidity amount or tokens.
    - `slippageTolerance`: The maximum price slippage you're willing to accept during liquidity removal (optional, defaults to 0.1%).
    - `authority`: The account authorizing the transaction (optional, defaults to your funder wallet).
- **Outputs**
The function returns a promise resolving to an object containing:
    - `instructions`: A list of instructions to execute the position close.
    - `quote`: A breakdown of the liquidity being withdrawn.
    - `feesQuote`: A breakdown of the fees owed to you.
    - `rewardsQuote`: A breakdown of the rewards owed to you for up to three different tokens.

## Basic Usage
This code example demonstrates how to close a position in a Whirlpool, which includes withdrawing liquidity, collecting any earned fees, and receiving any rewards.

```tsx title="closePosition.ts"
import { closePositionInstructions } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';
import { airdropSolIfNeeded } from './airdrop';

async function closePosition() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  await airdropSolIfNeeded(connection, wallet);

  const positionMint = "POSITION_MINT";
  
  const param = { liquidity: 500_000n };

  const { instructions, quote, feesQuote, rewardsQuote } = await closePositionInstructions(
    connection,
    positionMint,
    param,
    0.01, 
    wallet 
  );
  
  console.log("Fees Quote (Fees Collected):", feesQuote);
  console.log("Rewards Quote (Rewards Collected):", rewardsQuote);
  console.log("Close Position Instructions:", instructions);
  console.log("Liquidity Quote (Liquidity Removed):", quote);
}

closePosition();
```