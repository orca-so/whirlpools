# @orca-so/tx-sender

A lightweight TypeScript package for building and sending Solana transactions with support for priority fees and Jito tips. (based on @solana/kit 2.0)

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

## Default Fee Settings

By default, tx-sender uses the following configuration:

- Priority Fees: Dynamic pricing with a max cap of 0.004 SOL (4,000,000 lamports), using the 50th percentile fee
- Jito Tips: Dynamic pricing with a max cap of 0.004 SOL (4,000,000 lamports), using the 50th percentile fee
- Compute Unit Margin: 1.1x multiplier for compute unit calculation (10% margin)
- Jito Block Engine URL: https://bundles.jito.wtf

These defaults can be overridden using the configuration functions shown in the example above.
