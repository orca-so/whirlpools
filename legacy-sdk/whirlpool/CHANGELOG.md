# @orca-so/whirlpools-sdk

## 0.19.0

### Minor Changes

- [#1226](https://github.com/orca-so/whirlpools/pull/1226) [`822f213`](https://github.com/orca-so/whirlpools/commit/822f21312d2f0020e9b4f9cfcc6c68e9c200016f) Thanks [@josh-orca](https://github.com/josh-orca)! - Pinocchio Updates

- [#1227](https://github.com/orca-so/whirlpools/pull/1227) [`6017e1d`](https://github.com/orca-so/whirlpools/commit/6017e1df57c1f9f14ec6895d0008a429749c0552) Thanks [@josh-orca](https://github.com/josh-orca)! - add optimized reposition liquidity instruction

- [#1229](https://github.com/orca-so/whirlpools/pull/1229) [`e5f089b`](https://github.com/orca-so/whirlpools/commit/e5f089bc5c49b01f5c8abb43c78457ab6c440568) Thanks [@josh-orca](https://github.com/josh-orca)! - add increase liquidity by token amounts instruction

## 0.18.0

### Minor Changes

- [#1189](https://github.com/orca-so/whirlpools/pull/1189) [`a9d760d`](https://github.com/orca-so/whirlpools/commit/a9d760d980f1552deb7a722ec88c8d31ff74efdf) Thanks [@josh-orca](https://github.com/josh-orca)! - Add open one-sided position logic to open position instructions

- [#1187](https://github.com/orca-so/whirlpools/pull/1187) [`f9f3a43`](https://github.com/orca-so/whirlpools/commit/f9f3a43ecf67c0d5984ba607e191e99a9d218fef) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Add `set_adaptive_fee_constants` instruction to set individual adaptive fee constants for a pool

### Patch Changes

- [#1218](https://github.com/orca-so/whirlpools/pull/1218) [`9c8479a`](https://github.com/orca-so/whirlpools/commit/9c8479a9ae9e8861d5f2df023d20355ec72ac679) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update position NFT metadata handling to support dynamic position NFTs

## 0.17.4

### Patch Changes

- [#1202](https://github.com/orca-so/whirlpools/pull/1202) [`9d7e56d`](https://github.com/orca-so/whirlpools/commit/9d7e56da10bb951bd7603bf14303664d3de2e252) Thanks [@parhim](https://github.com/parhim)! - Exposed an optional 'resolveATA' param for openPositionWithMetadata on whirlpoolClient

## 0.17.3

### Patch Changes

- [#1200](https://github.com/orca-so/whirlpools/pull/1200) [`2c2c266`](https://github.com/orca-so/whirlpools/commit/2c2c266f616d29b32efa544b7ffb6fb6d008131d) Thanks [@calintje](https://github.com/calintje)! - Fix: export missing InitializeRewardV2WithPubkeyParams

## 0.17.2

### Patch Changes

- [#1194](https://github.com/orca-so/whirlpools/pull/1194) [`0b2389e`](https://github.com/orca-so/whirlpools/commit/0b2389ea186c8e8c4da2f2fecb5faff0fc3bbee9) Thanks [@calintje](https://github.com/calintje)! - Add overloaded initializeRewardV2 params and builders so callers can either pass a vault keypair (SDK signs) or an existing vault PublicKey for external signing, without changing existing behavior.

## 0.17.1

### Patch Changes

- [#1192](https://github.com/orca-so/whirlpools/pull/1192) [`8b2c0f9`](https://github.com/orca-so/whirlpools/commit/8b2c0f9c311998ed0f118f0de76dc9925457d2d7) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update CollectFeesQuoteParam and CollectRewardsQuoteParam to accept TickData or DynamicTickData"

## 0.17.0

### Minor Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update dependencies to support contract upgrade to Anchor 0.29->0.31.1 and Solana Program 1.17->2.1

### Patch Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update to Anchor 0.32.1

- Updated dependencies [[`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278), [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278)]:
  - @orca-so/common-sdk@0.7.0

## 0.16.0

### Minor Changes

- [#1038](https://github.com/orca-so/whirlpools/pull/1038) [`19875ce`](https://github.com/orca-so/whirlpools/commit/19875ce6595c7e15ad07cd2ede3966b05d34ab62) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Support non transferable position, Whirlpool account layout update (repurpose reward authority field)

## 0.15.0

### Minor Changes

- [#970](https://github.com/orca-so/whirlpools/pull/970) [`2509ad9`](https://github.com/orca-so/whirlpools/commit/2509ad9d9894a38c922e6e84a6a3a9de5e9ccd2d) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Dynamic TickArray

### Patch Changes

- [#974](https://github.com/orca-so/whirlpools/pull/974) [`6352a9b`](https://github.com/orca-so/whirlpools/commit/6352a9b61a574fb62440a7dca9a933af02847db5) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Relax DefaultAccountState restriction, Add ScaledUiAmount and Pausable support, Use ImmutableOwner for vault accounts

## 0.14.0

### Minor Changes

- [#926](https://github.com/orca-so/whirlpools/pull/926) [`49fa31a`](https://github.com/orca-so/whirlpools/commit/49fa31a042254c4f4a7c16594344f66e9c208c2b) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Adaptive Fee SDK update

## 0.13.21

### Patch Changes

- [#918](https://github.com/orca-so/whirlpools/pull/918) [`03525a8`](https://github.com/orca-so/whirlpools/commit/03525a880b7fc60c325aa26d26c5ab7dec79c659) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Adaptive Fee feature Contract release

## 0.13.20

### Patch Changes

- [#902](https://github.com/orca-so/whirlpools/pull/902) [`11a8c04`](https://github.com/orca-so/whirlpools/commit/11a8c0420da5f6cf4cde26f82216bef5a703c2ea) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Add reset position range feature, lock concentrated positions feature, transfer locked position feature

## 0.13.19

### Patch Changes

- [#866](https://github.com/orca-so/whirlpools/pull/866) [`7db9161`](https://github.com/orca-so/whirlpools/commit/7db9161cd1a7d722d3341160be56410239ae86c9) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Fix: Remove isTickInitializable check on createPool function

## 0.13.18

### Patch Changes

- [#805](https://github.com/orca-so/whirlpools/pull/805) [`1e939cb`](https://github.com/orca-so/whirlpools/commit/1e939cb50a41f24240d46edf8a5601502c425f6f) Thanks [@pauldragonfly](https://github.com/pauldragonfly)! - Fix fetch_positions_for_owner() to perform batch calls

## 0.13.17

### Patch Changes

- [#782](https://github.com/orca-so/whirlpools/pull/782) [`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb) Thanks [@wjthieme](https://github.com/wjthieme)! - Update LICENSE file

- [#768](https://github.com/orca-so/whirlpools/pull/768) [`188fad0`](https://github.com/orca-so/whirlpools/commit/188fad03422a55369f1ad50278c59030b786fc72) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Add liquidity locking feature

- [#778](https://github.com/orca-so/whirlpools/pull/778) [`7488726`](https://github.com/orca-so/whirlpools/commit/748872685428e0dd6a12b16091d31f9882f91541) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Add event emission feature

- Updated dependencies [[`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb)]:
  - @orca-so/common-sdk@0.6.11

## 0.13.16

### Patch Changes

- [#767](https://github.com/orca-so/whirlpools/pull/767) [`16e070e`](https://github.com/orca-so/whirlpools/commit/16e070e3f7099fcc653c791940d6f40b8472c9b2) Thanks [@wjthieme](https://github.com/wjthieme)! - Update the docs url to dev.orca.so

## 0.13.15

### Patch Changes

- [#713](https://github.com/orca-so/whirlpools/pull/713) [`4f626d7`](https://github.com/orca-so/whirlpools/commit/4f626d7cd08df85e8e7d93e7d0155ac6efb4e1d5) Thanks [@wjthieme](https://github.com/wjthieme)! - Changed some peerDependencies to normal dependencies

- Updated dependencies [[`4f626d7`](https://github.com/orca-so/whirlpools/commit/4f626d7cd08df85e8e7d93e7d0155ac6efb4e1d5)]:
  - @orca-so/common-sdk@0.6.10

## 0.13.14

### Patch Changes

- [#680](https://github.com/orca-so/whirlpools/pull/680) [`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial changeset version

- Updated dependencies [[`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27)]:
  - @orca-so/common-sdk@0.6.9
