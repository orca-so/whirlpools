---
"@orca-so/tx-sender": major
---

Improve browser wallet compatibility and add configurable transaction sending strategy

**Browser Wallet Support:**
- `buildTransaction` now accepts `KeyPairSigner | NoopSigner` and automatically detects signer type
- Performs partial signing for NoopSigner (browser wallets), full signing for KeyPairSigner (Node.js)
- `sendTransaction` now accepts `(FullySignedTransaction | Transaction) & TransactionWithLifetime` to support both workflows

**Configurable RPC Usage:**
- Added `pollIntervalMs` (default: 0) and `resendOnPoll` (default: true) options to `setRpc()`
- Allows control over confirmation polling frequency and transaction resending behavior
- Default settings optimized for premium RPCs; public RPC users can configure conservative settings

**Breaking Changes:**
- `buildTransaction` no longer accepts `Address` string parameter. Must pass `KeyPairSigner | NoopSigner` instance to ensure same object is used for both instruction building and transaction building (required by Solana's `@solana/kit` identity checks).

**Migration:**
```typescript
// Before
await buildTransaction(instructions, "7Td...zzc");

// After
const noopSigner = createNoopSigner(address("7Td...zzc"));
const { instructions } = await swapInstructions(rpc, params, pool, 100, noopSigner);
await buildTransaction(instructions, noopSigner);
```

