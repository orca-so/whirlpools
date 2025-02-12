# tx-sender

A lightweight TypeScript package for building and sending Solana transactions with support for priority fees and Jito tips. (based on @solana/web3.js 2.0)

## Key Features

- Simple initialization via `init()` function to configure RPC endpoints and default transaction settings
- Main entry point `buildAndSendTransaction()` handles transaction building, signing, and confirmation
- Supports both regular RPC and WebSocket connections for transaction confirmation
- Built-in support for priority fees and Jito MEV tips

## Testing

```
yarn test
```

## Example

```ts
import { init, buildAndSendTransaction } from "./tx-sender";

const kp = await createKeyPairFromBytes(new Uint8Array([1, 2, 3, 4,...]));
const signer = await createSignerFromKeyPair(kp);

init({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  transactionConfig: {
    priorityFee: {
      type: "dynamic",
      maxCapLamports: 5_000_000, // Cap at 0.005 SOL
    },
    jito: {
      type: "dynamic",
    },
    chainId: "solana",
    computeUnitMarginMultiplier: 1.04, // 4% margin for compute units
  },
  isTriton: false,
});

const txHash = await buildAndSendTransaction(
  [instruction1, instruction2],
  keypairSigner
);
```
