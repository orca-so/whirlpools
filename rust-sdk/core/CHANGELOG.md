# @orca-so/whirlpools-rust-core

## 2.0.1

### Patch Changes

- [#1168](https://github.com/orca-so/whirlpools/pull/1168) [`ebf9e96`](https://github.com/orca-so/whirlpools/commit/ebf9e96f474b41bec46d388c812eaad4fbacca00) Thanks [@calintje](https://github.com/calintje)! - **Hardening**: Add tests to tick.rs

- [#1162](https://github.com/orca-so/whirlpools/pull/1162) [`14c5655`](https://github.com/orca-so/whirlpools/commit/14c5655b664b1a7484b5a630ed65c7b13965ab5e) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update solana rust dependencies from v2 to v3. Fix some compilation warnings.

## 2.0.0

### Major Changes

- [#926](https://github.com/orca-so/whirlpools/pull/926) [`49fa31a`](https://github.com/orca-so/whirlpools/commit/49fa31a042254c4f4a7c16594344f66e9c208c2b) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Adaptive Fee SDK update

## 1.0.8

### Patch Changes

- [#931](https://github.com/orca-so/whirlpools/pull/931) [`9f3a4e6`](https://github.com/orca-so/whirlpools/commit/9f3a4e6c2cc26d62efae8448d97db215339f45ba) Thanks [@wjthieme](https://github.com/wjthieme)! - Add 'swap' feature that enables/disables swap quote. These functions cannot be used on-chain as they would cause a stack overflow. By disabling this feature on-chain you can remove stack-overflow errors when building an on-chain program.

- [#928](https://github.com/orca-so/whirlpools/pull/928) [`cecf391`](https://github.com/orca-so/whirlpools/commit/cecf3915abbadec88c09e84d89587115ca69f4e9) Thanks [@calintje](https://github.com/calintje)! - Fix error in collect_reward_quote where u64 mount owned could overflow. The fix reflects the logic used in the program and Legacy SDK.

## 1.0.7

### Patch Changes

- [#912](https://github.com/orca-so/whirlpools/pull/912) [`4642811`](https://github.com/orca-so/whirlpools/commit/46428111241653addd0f3a7076a452bef7ab99c7) Thanks [@calintje](https://github.com/calintje)! - Expose useful utility functions

## 1.0.6

### Patch Changes

- [#884](https://github.com/orca-so/whirlpools/pull/884) [`6cd51d6`](https://github.com/orca-so/whirlpools/commit/6cd51d64de8fe0f310c1bf2f3a5e659a68c426d0) Thanks [@calintje](https://github.com/calintje)! - Prevent endless swap loop when token amount exceeds available liquidity

## 1.0.5

### Patch Changes

- [#782](https://github.com/orca-so/whirlpools/pull/782) [`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb) Thanks [@wjthieme](https://github.com/wjthieme)! - Update LICENSE file

## 1.0.4

### Patch Changes

- [#767](https://github.com/orca-so/whirlpools/pull/767) [`16e070e`](https://github.com/orca-so/whirlpools/commit/16e070e3f7099fcc653c791940d6f40b8472c9b2) Thanks [@wjthieme](https://github.com/wjthieme)! - Update the docs url to dev.orca.so

## 1.0.3

### Patch Changes

- [#680](https://github.com/orca-so/whirlpools/pull/680) [`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial changeset version
