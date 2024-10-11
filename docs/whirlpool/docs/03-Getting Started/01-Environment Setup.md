# Environment setup

This document covers the essential setup required to start building on Orca’s SDK using the Whirlpools protocol. It includes wallet setup, RPC client configuration, airdropping tokens for testing, and the basics of interacting with the Solana ecosystem.

## Prerequisites

Before you start, ensure you have Node.js installed on your machine. Download it from the official website: https://nodejs.org/.

## 1. Initialize a new project
Create a new project directory:

```bash
mkdir whirlpool-env-setup
cd whirlpool-env-setup
```

Initialize a new Node.js project:

```bash
npm init -y
```

Install the necessary packages:

```bash
npm install typescript ts-node @orca-so/whirlpools-client @solana/web3.js fs
```

Initialize the project as a typescript project

```bash
npx tsc --init
```

## 3. Wallet Creation and Management

To simplify wallet management, we’ll generate a wallet programmatically and store its private key in a .env file for future use.

First, create a `wallet.ts` file in you current directory and add the following code.

```tsx title="wallet.ts"
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const ENV_FILE_PATH = path.resolve(__dirname, './.env');

function createWallet(): Keypair {
  const keypair = Keypair.generate();
  const secretKey = `[${keypair.secretKey.toString()}]`;
  fs.appendFileSync(ENV_FILE_PATH, `\nPRIVATE_KEY=${secretKey}\n`);
  console.log(`New wallet created with address: ${keypair.publicKey.toBase5()}`);
  return keypair;
}

export function getWallet(): Keypair {
  const privateKeyString = process.env.PRIVATE_KEY;

  if (privateKeyString) {
    const privateKeyArray = JSON.parse(privateKeyString) as number[];
    const wallet = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    console.log(`Using wallet: ${wallet.publicKey.toBase58()}`);
    return wallet;
  } else {
    return createWallet();
  }
}
```

### Explanation

1. `createWallet()`: Uses `Keypair.generate()` to create a new wallet and appends the private key to the .env file under PRIVATE_KEY.

2. `getWallet()`: Loads the private key from the `.env` file if it exists, otherwise it creates a new wallet using createWallet().

> ⚠️ Important: Never share your private key publicly.

## 4. Aidrop SOL to Your Wallet

Once your wallet is created, you will need some SOL to pay for transactions. We will create a function that checks if you have some SOL on **Devnet** and airdrops if you don't.

```ts title="airdrop.ts"
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

export async function airdropSolIfNeeded(rpc: Connection, wallet: Keypair) {
  const rpcUrl = rpc.rpcEndpoint;

  if (!rpcUrl.includes('devnet')) {
    console.log('Airdrop is only available on Devnet. Current RPC URL:', rpcUrl);
    return;
  }

  const balance = await rpc.getBalance(wallet.publicKey);

  const solBalance = balance / LAMPORTS_PER_SOL;

  if (solBalance < 0.1) {
    console.log(`Balance is ${solBalance} SOL. Requesting airdrop of 1 SOL...`);
    const airdropSignature = await rpc.requestAirdrop(wallet.publicKey, 1 * LAMPORTS_PER_SOL);
    await rpc.confirmTransaction(airdropSignature);
    const solscanUrl = `https://solscan.io/tx/${airdropSignature}?cluster=devnet`;
    console.log(`Airdrop of 1 SOL successful! View transaction: ${solscanUrl}`);
  } else {
    console.log(`Current balance: ${solBalance} SOL`);
  }
}

```

## 5. Putting it all together

Here’s a basic flow of how you can use the `getWallet()` function to load your wallet, check its balance, and request an airdrop if needed (only on **Devnet**):

```tsx title="main.ts"
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { getWallet } from './wallet';
import { airdropSolIfNeeded } from './airdrop';

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = getWallet();
  await airdropSolIfNeeded(connection, wallet);
}

main();
```

Execute this code by running `ts-node main.ts` in your terminal.

## Next steps

Once you’ve completed the setup, you can move on to building more complex functionalities using the Orca SDK, such as creating and managing pools, providing liquidity, etc. Refer to individual function documentation to use this wallet setup in action.