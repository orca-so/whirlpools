---
sidebar_label: Positions
---

# Fetching Positions in Orca Whirlpools

The `fetchPositions()` function is used to retrieve all positions that a given wallet owns in Orca Whirlpools. It gathers token accounts owned by the wallet, checks which ones correspond to positions, and decodes them to provide detailed information about the liquidity positions.

This guide explains how to use the `fetchPositions()` function to identify and retrieve all active positions for a wallet in Orca Whirlpools.

## Function Overview

The `fetchPositions()` function retrieves the liquidity positions held by an account (owner) by scanning both the standard SPL token program and the token-2022 program for token accounts with exactly 1 token (representing a position). It then decodes and returns these positions in a structured format.

- **Inputs**
    - `rpc`: A Solana RPC client used to interact with the blockchain, including fetching token accounts and multiple account data.
    - `owner`: The wallet address of the user for whom you want to fetch positions.
- **Outputs**
The function returns a Promise that resolves to an array of `PositionData[]`, where each item contains information about a position, including its address, associated program, and data related to the position.

## Basic Usage

```tsx title="getPositions()"
import { fetchPositions } from '@orca-so/whirlpools-sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';

async function getPositions() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  
  const ownerAddress = wallet.publicKey;

  const positions = await fetchPositions(connection, ownerAddress);

  console.log(`Found ${positions.length} position(s) for wallet ${ownerAddress}:`);
  positions.forEach(position => {
    console.log("Position Address:", position.address);
    console.log("Onchain Position State:", position.data);
  });
}

getPositions();
```