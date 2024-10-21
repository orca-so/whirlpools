# Environment setup

This document covers the essential setup required to start building on Orca’s SDK using the Whirlpools protocol. It includes wallet setup, RPC client configuration, airdropping tokens for testing, and the basics of interacting with the Solana ecosystem.

## Prerequisites

Before you start, ensure you have Node.js installed on your machine. Download it from the official website: https://nodejs.org/.

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
npm install typescript @orca-so/whirlpools @solana/web3.js
```

Initialize the project as a TypeScript project

```bash
npx tsc --init
```

## 3. Wallet Creation

You can create a wallet using `generateKeyPairSigner()` from the Solana SDK.

```tsx
import { generateKeyPairSigner } from '@solana/web3.js';

const wallet = await generateKeyPairSigner();
```

> ⚠️ Important: Never share your private key publicly.

## 4. Airdrop SOL to Your Wallet

Once your wallet is created, you will need some SOL to pay for transactions.

```tsx
import { generateKeyPair, createSolanaRpc, devnet, getAddressFromPublicKey } from '@solana/web3.js';

const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
const wallet = await generateKeyPairSigner();
devnetRpc.requestAirdrop(
  wallet.address,
  lamports(1000000000n)
).send()
```

## Next steps

Once you’ve completed the setup, you can move on to building more complex functionalities using the Orca SDK, such as creating and managing pools, providing liquidity, etc. Refer to individual function documentation to use this wallet setup in action.