# tx-sender

A lightweight TypeScript package for building and sending Solana transactions with support for priority fees and Jito tips. (based on @solana/web3.js 2.0)

## Key Features

- Simple initialization via `setRpc()` function to configure RPC endpoints and default transaction settings
- Main entry point `buildAndSendTransaction()` handles transaction building, signing, and confirmation
- Built-in support for priority fees and Jito MEV tips
- Configurable compute unit margin multiplier to ensure sufficient compute budget

## Testing

```
yarn test
```

## Example

```ts
import { setRpc, setPriorityFeeSetting, setJitoTipSetting, setComputeUnitMarginMultiplier, buildAndSendTransaction } from "@orca-so/tx-sender";

const kp = await createKeyPairFromBytes(new Uint8Array([1, 2, 3, 4,...]));
const signer = await createSignerFromKeyPair(kp);

// Initialize RPC connection
await setRpc("https://api.mainnet-beta.solana.com");

// Optional: Configure priority fees
setPriorityFeeSetting({
  type: "dynamic",
  maxCapLamports: BigInt(5_000_000), // Cap at 0.005 SOL
});

// Optional: Configure Jito tips
setJitoTipSetting({
  type: "dynamic"
});

// Optional: Adjust compute unit margin
setComputeUnitMarginMultiplier(1.04); // 4% margin for compute units

const txHash = await buildAndSendTransaction(
  [instruction1, instruction2],
  keypairSigner
);
```
