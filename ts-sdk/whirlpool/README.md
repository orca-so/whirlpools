# Orca Whirlpools SDK

Orca Whirlpools is an open-source concentrated liquidity AMM contract on the Solana and Eclipse blockchain. This SDK allows developers to interact with the Whirlpools program on both chains, enabling the creation and management of liquidity pools and positions, as well as performing swaps.

## Overview

The Orca Whirlpools SDK provides a comprehensive set of tools to interact with the Whirlpools program on Solana and Eclipse.

> **Note:** This SDK uses Solana Web3.js SDK v2, which is currently in Release Candidate (RC) status. It is not compatible with the widely used v1.x.x version.

## Installation

To install the SDK, use the following command:

```sh
npm install @orca-so/whirlpools
```

## Basic Usage

### 1. Wallet Creation
You can create a wallet using `generateKeyPairSigner()` from the Solana SDK.

```tsx
import { generateKeyPairSigner } from '@solana/web3.js';

const wallet = await generateKeyPairSigner();
```

### 2. Configure the Whirlpools SDK for Your Network
Orca's Whirlpools SDK supports several networks: Solana Mainnet, Solana Devnet, Eclipse Mainnet, and Eclipse Testnet. To select a network, use the `setWhirlpoolsConfig` function. This ensures compatibility with the network you’re deploying on.

Example: Setting the SDK Configuration to Solana Devnet. 
```tsx
import { setWhirlpoolsConfig } from '@orca-so/whirlpools';

await setWhirlpoolsConfig('solanaDevnet');
```

Available networks are:
- solanaMainnet
- solanaDevnet
- eclipseMainnet
- eclipseTestnet

> ℹ️ The setWhirlpoolsConfig function accepts either one of Orca's default network keys or a custom Address. This allows you to specify a custom configuration if needed.

### 3. Create the Swap Instructions
After configuring the SDK, you can perform a swap. Here is an example of how to perform a token swap using the Whirlpools SDK:

```tsx
import { swapInstructions } from '@orca-so/whirlpools';
const poolAddress = "POOL_ADDRESS";
const mintAddress = "TOKEN_MINT";
const amount = 1_000_000n;
const slippageTolerance = 100; // 1bps

const { instructions, quote } = await swapInstructions(
    devnetRpc,
    { 
        inputAmount: amount, 
        mint: mintAddress
    }, 
    poolAddress,
    slippageTolerance,
    wallet
);
```

### 4. Putting it all together
```tsx
import { swapInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';

const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
await setWhirlpoolsConfig('solanaDevnet');
const wallet = await generateKeyPairSigner();
await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();

/* Example Devnet Addresses:
 * -------------------------
 * SOL/devUSDC Whirlpool: 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
 * SOL Token Address: So11111111111111111111111111111111111111112
 * devUSDC Token Address: 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
 */

const poolAddress = "3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt";
const mintAddress = "So11111111111111111111111111111111111111112";
const amount = 1_000_000n;
const slippageTolerance = 100; // 1bps

const { instructions, quote } = await swapInstructions(
    devnetRpc,
    { 
        inputAmount: amount, 
        mint: mintAddress
    }, 
    poolAddress,
    slippageTolerance,
    wallet
);
```