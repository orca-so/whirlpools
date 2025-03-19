# Orca Whirlpools SDK

Orca Whirlpools is an open-source concentrated liquidity AMM contract on the Solana and Eclipse blockchain. This SDK allows developers to interact with the Whirlpools program on both chains, enabling the creation and management of liquidity pools and positions, as well as performing swaps.

## Overview

The Orca Whirlpools SDK provides a comprehensive set of tools to interact with the Whirlpools program on Solana and Eclipse.

> **Note:** This SDK uses Solana Web3.js SDK v2. It is not compatible with the widely used v1.x.x version.

## Installation

To install the SDK, use the following command:

```sh
npm install @orca-so/whirlpools @solana/kit@2
```

## Basic Usage

### 1. Wallet Creation

You can [generate a file system wallet using the Solana CLI](https://docs.solanalabs.com/cli/wallets/file-system) and load it in your program.

```tsx
import { createKeyPairSignerFromBytes } from "@solana/kit";
import fs from "fs";

const keyPairBytes = new Uint8Array(
  JSON.parse(fs.readFileSync("path/to/solana-keypair.json", "utf8"))
);
const wallet = await createKeyPairSignerFromBytes(keyPairBytes);
```

### 2. Configure the Whirlpools SDK for Your Network

Orca's Whirlpools SDK supports several networks: Solana Mainnet, Solana Devnet, Eclipse Mainnet, and Eclipse Testnet. To select a network, use the `setWhirlpoolsConfig` function. This ensures compatibility with the network you’re deploying on.

Example: Setting the SDK Configuration to Solana Devnet.

```tsx
import { setWhirlpoolsConfig } from "@orca-so/whirlpools";

await setWhirlpoolsConfig("solanaDevnet");
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
import { swapInstructions } from "@orca-so/whirlpools";
const poolAddress = "POOL_ADDRESS";
const mintAddress = "TOKEN_MINT";
const amount = 1_000_000n;
const slippageTolerance = 100; // 100 bps = 1%

const { instructions, quote } = await swapInstructions(
  devnetRpc,
  {
    inputAmount: amount,
    mint: mintAddress,
  },
  poolAddress,
  slippageTolerance,
  wallet
);
```

### 4. Putting it all together

```tsx
import { swapInstructions, setWhirlpoolsConfig } from "@orca-so/whirlpools";
import { generateKeyPairSigner, createSolanaRpc, devnet } from "@solana/kit";

const devnetRpc = createSolanaRpc(devnet("https://api.devnet.solana.com"));
await setWhirlpoolsConfig("solanaDevnet");
const wallet = loadWallet();
await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();

/* Example Devnet Addresses:
 * -------------------------
 * SOL/devUSDC Whirlpool: 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
 * SOL Token Address: So11111111111111111111111111111111111111112
 * devUSDC Token Address: 3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt
 */

const poolAddress = "3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt";
const mintAddress = "So11111111111111111111111111111111111111112";
const amount = 1_000_000n; // 0.001 WSOL (SOL has 9 decimals)
const slippageTolerance = 100; // 100bps = 1%

const { instructions, quote } = await swapInstructions(
  devnetRpc,
  {
    inputAmount: amount,
    mint: mintAddress,
  },
  poolAddress,
  slippageTolerance,
  wallet
);
```

## ACTIONS

To use actions, you need to set some configuration first.
The only required configuration is the keypair of the payer, and the rpc url.

```tsx
import { setPayerFromBytes, setRpc } from "@orca-so/whirlpools";

// Set payer from a private key byte array
const privateKeyBytes = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
]);
await setPayerFromBytes(privateKeyBytes);

// Set rpc url
await setRpc("https://api.devnet.solana.com");
```

You can also optionally set up the prioritization fees and jito tip settings according to your needs.

```tsx
// Set priority fee settings
setPriorityFeeSetting({
  type: "dynamic",
  maxCapLamports: BigInt(4_000_000), // 0.004 SOL
});

// Set Jito tip settings
setJitoTipSetting({
  type: "dynamic",
  maxCapLamports: BigInt(4_000_000), // 0.004 SOL
});

// Set compute unit margin multiplier
setComputeUnitMarginMultiplier(1.1);

// Set priority fee percentile
setPriorityFeePercentile("50");

// Set Jito fee percentile (50ema is the default)
setJitoFeePercentile("50ema");

// Set Jito block engine URL
await setJitoBlockEngineUrl("https://bundles.jito.wtf");
```

### 1. Create a new whirlpool

```tsx
import { createSplashPool } from "@orca-so/whirlpools";
import { address } from "@solana/kit";

// Create a new splash pool between SOL and USDC
const { poolAddress, callback } = await createSplashPool(
  address("So11111111111111111111111111111111111111112"), // SOL
  address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") // USDC
);

// Execute the transaction
const signature = await callback();
console.log(`Pool created at ${poolAddress} in tx ${signature}`);
```

### 2. Add liquidity to a whirlpool

```tsx
import {
  openFullRangePosition,
  openConcentratedPosition,
} from "@orca-so/whirlpools";
import { address } from "@solana/kit";

// Add full range liquidity to a splash pool
const { positionAddress, callback: fullRangeCallback } =
  await openFullRangePosition(
    address("POOL_ADDRESS"), // The pool address
    {
      tokenA: BigInt(1_000_000), // Amount of token A to add (in native units)
    },
    50 // Optional: Slippage tolerance in basis points (0.5%)
  );

// Execute the transaction
const fullRangeSig = await fullRangeCallback();
console.log(
  `Full range position created at ${positionAddress} in tx ${fullRangeSig}`
);

// Add concentrated liquidity to a whirlpool
const { positionAddress: concPosAddress, callback: concCallback } =
  await openConcentratedPosition(
    address("POOL_ADDRESS"), // The pool address
    {
      tokenA: BigInt(1_000_000), // Amount of token A to add (in native units)
    },
    19.5, // Lower price bound
    20.5, // Upper price bound
    50 // Optional: Slippage tolerance in basis points (0.5%)
  );

// Execute the transaction
const concSig = await concCallback();
console.log(
  `Concentrated position created at ${concPosAddress} in tx ${concSig}`
);

// Increase liquidity in an existing position
const { callback: increaseLiqCallback, quote } = await increasePosLiquidity(
  address("POSITION_ADDRESS"), // The position address
  {
    tokenA: BigInt(1_000_000), // Amount of token A to add (in native units)
  },
  50 // Optional: Slippage tolerance in basis points (0.5%)
);

//optionally check quote
if (quote.tokenMaxB < 1_000_000n) {
  // Check if max token B amount is acceptable
  const increaseLiqSig = await increaseLiqCallback();
  console.log(`Added liquidity in tx ${increaseLiqSig}`);
} else {
  console.log(`Required token B amount ${quote.tokenMaxB} is too high`);
}
```

### 3. Harvest rewards from all positions

```tsx
// Harvest fees and rewards from all positions owned by the wallet
const signatures = await harvestAllPositionFees();
console.log(`Harvested all positions in ${signatures.length} transactions`);

// Harvest fees and rewards from a single position
const {
  callback: harvestCallback,
  feesQuote,
  rewardsQuote,
} = await harvestPosition(
  address("POSITION_ADDRESS") // The position address
);

// Check quotes
console.log(`Fees to collect: ${feesQuote.feeOwedA}, ${feesQuote.feeOwedB}`);
console.log(`Rewards to collect: ${rewardsQuote.rewards[0].rewardsOwed}`);

// Execute the transaction
const harvestSig = await harvestCallback();
console.log(`Harvested position in tx ${harvestSig}`);
```
