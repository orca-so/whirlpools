# Environment setup

This document covers the essential setup required to start building on Orca’s SDK using the Whirlpools protocol. It includes wallet setup, RPC client configuration, airdropping tokens for testing, and the basics of interacting with the Solana ecosystem.

## Prerequisites

Before you start, ensure you have Node.js version 20 or higher installed on your machine. Download it from the official website: https://nodejs.org/.

## 1. Initialize a new project
Create a new project directory:

```bash
mkdir whirlpools
cd whirlpools
```

Initialize a new Node.js project:

```bash
npm init -y
```

Install the necessary packages:

```bash
npm install typescript @orca-so/whirlpools @solana/web3.js@rc
```

Initialize the project as a TypeScript project:

```bash
npx tsc --init
```

## 2. Wallet Creation

You can [generate a file system wallet using the Solana CLI](https://docs.solanalabs.com/cli/wallets/file-system). You can load it using `createKeyPairSignerFromBytes`.

```tsx
import { createKeyPairSignerFromBytes } from '@solana/web3.js';
import fs from 'fs';

const keyPairBytes = new Uint8Array(JSON.parse(fs.readFileSync('path/to/solana-keypair.json', 'utf8')));
const wallet = await createKeyPairSignerFromBytes(keyPairBytes);
```

> ⚠️ Important: Never share your private key publicly.

## 3. Configure the Whirlpools SDK for Your Network
Orca's Whirlpools SDK supports several networks: Solana Mainnet, Solana Devnet, Eclipse Mainnet, and Eclipse Testnet. To select a network, use the `setWhirlpoolsConfig` function. This ensures compatibility with the network you’re deploying on.

#### Example: Setting the SDK Configuration to Solana Devnet
```tsx
import { setWhirlpoolsConfig } from '@orca-so/whirlpools';

await setWhirlpoolsConfig('solanaDevnet');
```
Available networks are:

- solanaMainnet
- solanaDevnet
- eclipseMainnet
- eclipseTestnet

> ℹ️ The `setWhirlpoolsConfig` function accepts either one of Orca's default network keys or a custom `Address`. This allows you to specify a WhirlpoolsConfig account of your choice, including configurations not owned by Orca. To learn more about WhirlpoolsConfig read our [Account Architecture](../02-Architecture%20Overview/01-Account%20Architecture.md) documentation.

## 4. Airdrop SOL to Your Wallet

Once your wallet is created, you will need some SOL to pay for transactions. You can request an airdrop of SOL from the network, but this is only available on **Devnet** and **Testnet**.

```tsx
import { generateKeyPair, createSolanaRpc, devnet, getAddressFromPublicKey } from '@solana/web3.js';

const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
const wallet = await generateKeyPairSigner();
devnetRpc.requestAirdrop(
  wallet.address,
  lamports(1000000000n)
).send()
```

## 5. Set the FUNDER for Transactions

After funding your wallet, you can set the wallet as the **FUNDER** for future transactions within the SDK. The funder is the account that will cover the transaction costs for initializing pools, providing liquidity, etc.
```tsx
import { setDefaultFunder } from '@orca-so/whirlpools';

setDefaultFunder(wallet);
```

## Next steps

Once you’ve completed the setup, you can move on to building more complex functionalities using the Orca SDK, such as creating and managing pools, providing liquidity, etc. Refer to individual function documentation to use this wallet setup in action.