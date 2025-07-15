# @orca-so/whirlpools-rust

## 4.0.0

### Major Changes

- [#970](https://github.com/orca-so/whirlpools/pull/970) [`2509ad9`](https://github.com/orca-so/whirlpools/commit/2509ad9d9894a38c922e6e84a6a3a9de5e9ccd2d) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Dynamic TickArray

### Patch Changes

- [#974](https://github.com/orca-so/whirlpools/pull/974) [`6352a9b`](https://github.com/orca-so/whirlpools/commit/6352a9b61a574fb62440a7dca9a933af02847db5) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Relax DefaultAccountState restriction, Add ScaledUiAmount and Pausable support, Use ImmutableOwner for vault accounts

## 3.1.0

### Minor Changes

- [#971](https://github.com/orca-so/whirlpools/pull/971) [`aa69979`](https://github.com/orca-so/whirlpools/commit/aa699796d86a6d51825df4214de5334ea8630636) Thanks [@calintje](https://github.com/calintje)! - Add configurable balance checking in token account preparation, allowing users to disable balance validation to get quotes and instructions even with insufficient token balances.

## 3.0.1

### Patch Changes

- [#938](https://github.com/orca-so/whirlpools/pull/938) [`1a72924`](https://github.com/orca-so/whirlpools/commit/1a72924533b793203db780dbec5526dc58bcc1a7) Thanks [@boosik-sol](https://github.com/boosik-sol)! - Checking if sqrt price is less than MIN_SQRT_PRICE or greater than MAX_SQRT_PRICE in rust-sdk

## 3.0.0

### Major Changes

- [#926](https://github.com/orca-so/whirlpools/pull/926) [`49fa31a`](https://github.com/orca-so/whirlpools/commit/49fa31a042254c4f4a7c16594344f66e9c208c2b) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Adaptive Fee SDK update

## 2.0.4

### Patch Changes

- [#884](https://github.com/orca-so/whirlpools/pull/884) [`6cd51d6`](https://github.com/orca-so/whirlpools/commit/6cd51d64de8fe0f310c1bf2f3a5e659a68c426d0) Thanks [@calintje](https://github.com/calintje)! - Updated cargo.lock

- [#884](https://github.com/orca-so/whirlpools/pull/884) [`6cd51d6`](https://github.com/orca-so/whirlpools/commit/6cd51d64de8fe0f310c1bf2f3a5e659a68c426d0) Thanks [@calintje](https://github.com/calintje)! - Update e2e tests to prevent INVALID_TICK_ARRAY_SEQUENCE error thrown from core library

## 2.0.3

### Patch Changes

- [#805](https://github.com/orca-so/whirlpools/pull/805) [`1e939cb`](https://github.com/orca-so/whirlpools/commit/1e939cb50a41f24240d46edf8a5601502c425f6f) Thanks [@pauldragonfly](https://github.com/pauldragonfly)! - Fix fetch_positions_for_owner() to perform batch calls

## 2.0.2

### Patch Changes

- [#782](https://github.com/orca-so/whirlpools/pull/782) [`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb) Thanks [@wjthieme](https://github.com/wjthieme)! - Update LICENSE file

## 2.0.1

### Patch Changes

- [#767](https://github.com/orca-so/whirlpools/pull/767) [`16e070e`](https://github.com/orca-so/whirlpools/commit/16e070e3f7099fcc653c791940d6f40b8472c9b2) Thanks [@wjthieme](https://github.com/wjthieme)! - Update the docs url to dev.orca.so

## 2.0.0

### Major Changes

- [#726](https://github.com/orca-so/whirlpools/pull/726) [`7f0ca73`](https://github.com/orca-so/whirlpools/commit/7f0ca73f49ce8354bb9156bba326cd5d9e93d665) Thanks [@wjthieme](https://github.com/wjthieme)! - Add support for solana v2 crates, to use solana v1 with orca_whirlpools_client please use the `solana-v1` feature

## 1.0.4

### Patch Changes

- [#729](https://github.com/orca-so/whirlpools/pull/729) [`3c185c7`](https://github.com/orca-so/whirlpools/commit/3c185c75cc8f1860befed2472c5ae99909683861) Thanks [@pplanel](https://github.com/pplanel)! - Fix a bug parsing rpc-response in get_token_accounts_for_owner

## 1.0.3

### Patch Changes

- [#697](https://github.com/orca-so/whirlpools/pull/697) [`3bcb851`](https://github.com/orca-so/whirlpools/commit/3bcb851f23776f765b2e6222ef0566c6a3123d3c) Thanks [@calintje](https://github.com/calintje)! - Fix example rust docs for `fetch_positions_for_owner`

- [#680](https://github.com/orca-so/whirlpools/pull/680) [`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial changeset version
