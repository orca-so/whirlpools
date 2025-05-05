# @orca-so/rust-tx-sender

## 2.0.0

### Major Changes

- [#929](https://github.com/orca-so/whirlpools/pull/929) [`62ba4ca`](https://github.com/orca-so/whirlpools/commit/62ba4ca4e1eba67898865b2c1ccc78af6e1f860a) Thanks [@jshiohaha](https://github.com/jshiohaha)! - BREAKING: Changed build_transaction to accept the transaction payer instead of a list of signers because the caller might not have access to all signers when building a transaction. Under the hood, we rely on the `num_required_signers` in a compiled message to determine how many signatures to include when creating a VersionedTransaction

## 1.0.1

### Patch Changes

- [#924](https://github.com/orca-so/whirlpools/pull/924) [`661acea`](https://github.com/orca-so/whirlpools/commit/661acea57e54627753d9904c05f2784882801eee) Thanks [@wjthieme](https://github.com/wjthieme)! - Overload main functions to make tx-sender usable in a multi-thread environment

## 1.0.0

### Major Changes

- [#921](https://github.com/orca-so/whirlpools/pull/921) [`356d585`](https://github.com/orca-so/whirlpools/commit/356d5858fa45e6a13dd6d2b9f032550357748ef8) Thanks [@calintje](https://github.com/calintje)! - BREAKING: Changed build_transaction to accept signers array instead of single payer. Fixed transaction signature mismatch in compute unit estimation that caused "accounts offsets" errors.
