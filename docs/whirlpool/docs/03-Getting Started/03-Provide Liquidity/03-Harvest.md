---
sidebar_label: Harvest Position
---

# Harvesting a Position

Harvesting a position in Orca Whirlpools allows you to collect any accumulated fees and rewards without closing the position. This process is useful when you want to claim your earnings while keeping your liquidity active in the pool.

The `harvestPositionInstructions()` function generates the instructions needed to collect fees and rewards from an open position.

## Function Overview

**`harvestPositionInstructions()`**

This function generates a set of instructions for collecting fees and rewards from a position in an Orca Whirlpool. The position remains open, and only the earnings are collected.

- **Inputs**
    - `rpc`: A Solana RPC client used to communicate with the blockchain.
    - `positionMint`: The mint address of the position from which you want to harvest fees and rewards.
    - `authority`: The account that authorizes the transaction. 
- **Outputs:** 
The function returns an object with the following properties:
    - `feesQuote`: A breakdown of the fees owed to you in token A and token B.
    - `rewardsQuote`: A breakdown of the rewards owed to you in up to three reward tokens.
    - `instructions`: A list of instructions to execute the harvesting of fees and rewards.

## Basic Usage

Here is an example of how to use `harvestPositionInstructions()` to collect the fees and rewards from an open position in an Orca Whirlpool.

```tsx title="harvestPosition.ts"
import { harvestPositionInstructions } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';
import { airdropSolIfNeeded } from './airdrop';

async function harvestPosition() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  await airdropSolIfNeeded(connection, wallet);

  const positionMint = "POSITION_MINT";

  const { feesQuote, rewardsQuote, instructions } = await harvestPositionInstructions(
    connection,
    positionMint,
    wallet
  );

  console.log("Fees Quote (Fees Collected):", feesQuote);
  console.log("Rewards Quote (Rewards Collected):", rewardsQuote);
  console.log("Harvest Position Instructions:", instructions);
}

harvestPosition();
```