# @orca-so/rust-tx-sender

## 1.0.1

### Patch Changes

- [#924](https://github.com/orca-so/whirlpools/pull/924) [`661acea`](https://github.com/orca-so/whirlpools/commit/661acea57e54627753d9904c05f2784882801eee) Thanks [@wjthieme](https://github.com/wjthieme)! - Overload main functions to make tx-sender usable in a multi-thread environment

## 1.0.0

### Major Changes

- [#921](https://github.com/orca-so/whirlpools/pull/921) [`356d585`](https://github.com/orca-so/whirlpools/commit/356d5858fa45e6a13dd6d2b9f032550357748ef8) Thanks [@calintje](https://github.com/calintje)! - BREAKING: Changed build_transaction to accept signers array instead of single payer. Fixed transaction signature mismatch in compute unit estimation that caused "accounts offsets" errors.
