# @orca-so/whirlpools-program

## 0.9.0

### Minor Changes

- [#1226](https://github.com/orca-so/whirlpools/pull/1226) [`822f213`](https://github.com/orca-so/whirlpools/commit/822f21312d2f0020e9b4f9cfcc6c68e9c200016f) Thanks [@josh-orca](https://github.com/josh-orca)! - Pinocchio Updates

## 0.8.0

### Minor Changes

- [#1189](https://github.com/orca-so/whirlpools/pull/1189) [`a9d760d`](https://github.com/orca-so/whirlpools/commit/a9d760d980f1552deb7a722ec88c8d31ff74efdf) Thanks [@josh-orca](https://github.com/josh-orca)! - Add open one-sided position logic to open position instructions

- [#1187](https://github.com/orca-so/whirlpools/pull/1187) [`f9f3a43`](https://github.com/orca-so/whirlpools/commit/f9f3a43ecf67c0d5984ba607e191e99a9d218fef) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Add `set_adaptive_fee_constants` instruction to set individual adaptive fee constants for a pool

### Patch Changes

- [#1218](https://github.com/orca-so/whirlpools/pull/1218) [`9c8479a`](https://github.com/orca-so/whirlpools/commit/9c8479a9ae9e8861d5f2df023d20355ec72ac679) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update position NFT metadata handling to support dynamic position NFTs

## 0.7.0

### Minor Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Upgrade to Anchor 0.31.1 and Solana Program 2.1.0, add support for token-2022 program, and update SPL dependencies to their latest versions

### Patch Changes

- [#1094](https://github.com/orca-so/whirlpools/pull/1094) [`99363f9`](https://github.com/orca-so/whirlpools/commit/99363f9f01b97fdf31ecbd47d2066df6818f1960) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Add unit tests to validate account discriminators

- [#1120](https://github.com/orca-so/whirlpools/pull/1120) [`def0d40`](https://github.com/orca-so/whirlpools/commit/def0d4041b7effc436dcd6442fdd1662743fb604) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Improve repository setup

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update to Anchor 0.32.1

## 0.6.1

### Patch Changes

- [#1061](https://github.com/orca-so/whirlpools/pull/1061) [`648f632`](https://github.com/orca-so/whirlpools/commit/648f632d10edfe6b692e3e3ec8f9beb6fcd507fa) Thanks [@yugure-orca](https://github.com/yugure-orca)! - make ADMINS (solana) multi-sig

## 0.6.0

### Minor Changes

- [#1038](https://github.com/orca-so/whirlpools/pull/1038) [`19875ce`](https://github.com/orca-so/whirlpools/commit/19875ce6595c7e15ad07cd2ede3966b05d34ab62) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Support non transferable position, Whirlpool account layout update (repurpose reward authority field)

### Patch Changes

- [#1006](https://github.com/orca-so/whirlpools/pull/1006) [`a55723f`](https://github.com/orca-so/whirlpools/commit/a55723f8aa1c71525f51f264d67493697b1b316b) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Refactors on DynamicTickArrays

- [#1010](https://github.com/orca-so/whirlpools/pull/1010) [`d5a8bfd`](https://github.com/orca-so/whirlpools/commit/d5a8bfd83a11de7c1412fe68a2bd42e8f7359c0f) Thanks [@yugure-orca](https://github.com/yugure-orca)! - safer account initialization for position mint and pool token vaults (random Keypair)

- [#1004](https://github.com/orca-so/whirlpools/pull/1004) [`95e9ddb`](https://github.com/orca-so/whirlpools/commit/95e9ddb0af6f4b3029d3cee03b49a2ae5b0517c6) Thanks [@Arrowana](https://github.com/Arrowana)! - Remove unnecessary transfer hook token program account info

## 0.5.0

### Minor Changes

- [#970](https://github.com/orca-so/whirlpools/pull/970) [`2509ad9`](https://github.com/orca-so/whirlpools/commit/2509ad9d9894a38c922e6e84a6a3a9de5e9ccd2d) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Dynamic TickArray

### Patch Changes

- [#974](https://github.com/orca-so/whirlpools/pull/974) [`6352a9b`](https://github.com/orca-so/whirlpools/commit/6352a9b61a574fb62440a7dca9a933af02847db5) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Relax DefaultAccountState restriction, Add ScaledUiAmount and Pausable support, Use ImmutableOwner for vault accounts

## 0.4.1

### Patch Changes

- [#946](https://github.com/orca-so/whirlpools/pull/946) [`d014eac`](https://github.com/orca-so/whirlpools/commit/d014eac11e55a9abdbff042b2a124149f543fac9) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Reduce stack usage in initializePoolWithAdaptiveFee

## 0.4.0

### Minor Changes

- [#918](https://github.com/orca-so/whirlpools/pull/918) [`03525a8`](https://github.com/orca-so/whirlpools/commit/03525a880b7fc60c325aa26d26c5ab7dec79c659) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Adaptive Fee feature Contract release

## 0.3.6

### Patch Changes

- [#902](https://github.com/orca-so/whirlpools/pull/902) [`11a8c04`](https://github.com/orca-so/whirlpools/commit/11a8c0420da5f6cf4cde26f82216bef5a703c2ea) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Add reset position range feature, lock concentrated positions feature, transfer locked position feature

- [#905](https://github.com/orca-so/whirlpools/pull/905) [`cca0ce2`](https://github.com/orca-so/whirlpools/commit/cca0ce245ceb5a0f69acc6fd04a5f625208c2f86) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Fix transfer fee value on Traded event

## 0.3.5

### Patch Changes

- [#782](https://github.com/orca-so/whirlpools/pull/782) [`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb) Thanks [@wjthieme](https://github.com/wjthieme)! - Update LICENSE file

- [#768](https://github.com/orca-so/whirlpools/pull/768) [`188fad0`](https://github.com/orca-so/whirlpools/commit/188fad03422a55369f1ad50278c59030b786fc72) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Add liquidity locking feature

- [#778](https://github.com/orca-so/whirlpools/pull/778) [`7488726`](https://github.com/orca-so/whirlpools/commit/748872685428e0dd6a12b16091d31f9882f91541) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Add event emission feature

## 0.3.4

### Patch Changes

- [#743](https://github.com/orca-so/whirlpools/pull/743) [`0f478e7`](https://github.com/orca-so/whirlpools/commit/0f478e7a5fdbe136269b0f2c20a6c71db961cc5b) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Increase MAX_FEE_RATE, new max fee rate is 6%

## 0.3.3

### Patch Changes

- [#680](https://github.com/orca-so/whirlpools/pull/680) [`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial changeset version
