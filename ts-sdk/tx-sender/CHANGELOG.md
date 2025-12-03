# @orca-so/tx-sender

## 3.0.0

### Major Changes

- [#1163](https://github.com/orca-so/whirlpools/pull/1163) [`c2c96da`](https://github.com/orca-so/whirlpools/commit/c2c96dae47cf0102afc2ec41d9ba5cf0c99fa340) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update solana ts dependencies, migrate from tests from bankrun to litesvm

## 2.0.0

### Major Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update dependencies to support contract upgrade to Anchor 0.29->0.31.1 and Solana Program 1.17->2.1

- [#1076](https://github.com/orca-so/whirlpools/pull/1076) [`743e758`](https://github.com/orca-so/whirlpools/commit/743e758740622475691866ca34d571799880fdd3) Thanks [@boosik-sol](https://github.com/boosik-sol)! - Improve browser wallet compatibility and add configurable transaction sending strategy

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
  const { instructions } = await swapInstructions(
    rpc,
    params,
    pool,
    100,
    noopSigner,
  );
  await buildTransaction(instructions, noopSigner);
  ```

### Patch Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update to Anchor 0.32.1

## 1.0.2

### Patch Changes

- [#963](https://github.com/orca-so/whirlpools/pull/963) [`49cc8c8`](https://github.com/orca-so/whirlpools/commit/49cc8c86c99428ea0feb1fbf2d8bff0c396637ba) Thanks [@calintje](https://github.com/calintje)! - Fix RPC Proxy thenable interference in setRpc function.

## 1.0.1

### Patch Changes

- [#961](https://github.com/orca-so/whirlpools/pull/961) [`650ef26`](https://github.com/orca-so/whirlpools/commit/650ef26651f9b138cd8b698a4a4a1a4fcdc7184e) Thanks [@calintje](https://github.com/calintje)! - Improve error message readability during simulation

## 1.0.0

### Major Changes

- [#811](https://github.com/orca-so/whirlpools/pull/811) [`7b4bbf9`](https://github.com/orca-so/whirlpools/commit/7b4bbf907ee88b79351938e46b7e5da9cbf21414) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial release

## 0.2.0

### Minor Changes

- [#667](https://github.com/orca-so/whirlpools/pull/667) [`a3b7887`](https://github.com/orca-so/whirlpools/commit/a3b78879ff3aae4e0528f547a0efd4c76eddcdac) Thanks [@parhim](https://github.com/parhim)! - working tx-sender with configurable rpc and priority settings

### Patch Changes

- [#782](https://github.com/orca-so/whirlpools/pull/782) [`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb) Thanks [@wjthieme](https://github.com/wjthieme)! - Update LICENSE file

- [#788](https://github.com/orca-so/whirlpools/pull/788) [`7d2f507`](https://github.com/orca-so/whirlpools/commit/7d2f507081398973e712390281df535b3fc8988c) Thanks [@wjthieme](https://github.com/wjthieme)! - Switch from @solana/web3.js v2 to @solana/kit
