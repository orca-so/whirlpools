# @orca-so/whirlpools

## 7.0.2

### Patch Changes

- [#1273](https://github.com/orca-so/whirlpools/pull/1273) [`357eed6`](https://github.com/orca-so/whirlpools/commit/357eed6f14a77357110e45855656ad8adb7ad18b) Thanks [@jshiohaha](https://github.com/jshiohaha)! - fix typo: Rage -> Range

## 7.0.1

### Patch Changes

- [#1252](https://github.com/orca-so/whirlpools/pull/1252) [`505cbe0`](https://github.com/orca-so/whirlpools/commit/505cbe07ebadee7e3e130abc034b32c9b27248d7) Thanks [@jshiohaha](https://github.com/jshiohaha)! - replace create_associated_token_account with create_associated_token_account_idempotent in prepare_token_accounts_instructions

## 7.0.0

### Major Changes

- [#1247](https://github.com/orca-so/whirlpools/pull/1247) [`0324ac8`](https://github.com/orca-so/whirlpools/commit/0324ac8f1658c201e73abace077f734a38b9dcb7) Thanks [@josh-orca](https://github.com/josh-orca)! - Refactors the increase-liquidity API in both TypeScript and Rust SDKs to use token maximum amounts. Both SDKs now require specifying `tokenMaxA` and `tokenMaxB` — the program adds the maximum liquidity achievable within those limits.

  ## Breaking changes

  ### TypeScript SDK (`@orca-so/whirlpools`)

  The increase-liquidity and open-position functions now take `tokenMaxAmounts: { tokenMaxA, tokenMaxB }` instead of a param object with `liquidity`, `tokenA`, or `tokenB`. The return value no longer includes a `quote` — callers must compute quotes separately if needed.

  ```ts
  // Before
  { liquidity: 10_000n }
  { tokenA: 1_000_000n }
  { tokenB: 1_000_000n }
  // Returned: { quote, instructions, ... }

  // After
  { tokenMaxA: 1_000_000n, tokenMaxB: 1_000_000n }
  // One-sided: { tokenMaxA: 1_000_000n, tokenMaxB: 0n } or { tokenMaxA: 0n, tokenMaxB: 1_000_000n }
  // Returned: { instructions } (no quote)
  ```

  ### Rust SDK (`@orca-so/whirlpools-rust`)

  `IncreaseLiquidityParam` has been removed and replaced with `IncreaseLiquidityTokenMaxAmounts`, a struct constructed via `IncreaseLiquidityTokenMaxAmounts::new(token_max_a, token_max_b)`. The increase-liquidity and open-position functions no longer return a quote.

  ```rust
  // Before
  IncreaseLiquidityParam::Liquidity(amount)
  IncreaseLiquidityParam::TokenA(amount)
  IncreaseLiquidityParam::TokenB(amount)
  // Returned: IncreaseLiquidityInstruction { quote, instructions, ... }

  // After
  IncreaseLiquidityTokenMaxAmounts::new(1_000_000, 1_000_000)
  // One-sided: IncreaseLiquidityTokenMaxAmounts::new(1_000_000, 0) or ::new(0, 1_000_000)
  // Returned: IncreaseLiquidityInstruction { instructions, additional_signers } (no quote)
  ```

- [#1243](https://github.com/orca-so/whirlpools/pull/1243) [`7290d86`](https://github.com/orca-so/whirlpools/commit/7290d869c004bb07671e160dc0b73fdae1ac5609) Thanks [@jshiohaha](https://github.com/jshiohaha)! - propagate withTokenMetadataExtension parameter to allow caller to pass metadata preferences, add new openPositionInstructionsWithTickBounds function, change getIncreaseLiquidityQuote visibility modifier

### Minor Changes

- [#1242](https://github.com/orca-so/whirlpools/pull/1242) [`022bd2a`](https://github.com/orca-so/whirlpools/commit/022bd2ae49a19a8ec143cd7998b6f436663eebac) Thanks [@wjthieme](https://github.com/wjthieme)! - Use increaseLiquidityByTokenAmounts as default.

  BREAKING: increaseLiquidity now expects ByTokenAmounts params (tokenMaxA/B and
  min/max sqrt price bounds) rather than the previous default liquidity-based
  instruction.

  @orca-so/whirlpools-sdk is still in major version zero so the breaking changes
  are a minor update.

  It avoids an intermediate liquidity calculation and is more natural for
  callers to provide token amounts; the instruction derives the liquidity change
  under price-deviation constraints.

  Update callers to pass ByTokenAmountsParams (tokenMaxA/B plus minSqrtPrice
  and maxSqrtPrice).

- [#1250](https://github.com/orca-so/whirlpools/pull/1250) [`1d34846`](https://github.com/orca-so/whirlpools/commit/1d348463128ffca6d45fb5bd5a167007a11522f2) Thanks [@josh-orca](https://github.com/josh-orca)! - Update sqrt price math precision

### Patch Changes

- Updated dependencies [[`1d34846`](https://github.com/orca-so/whirlpools/commit/1d348463128ffca6d45fb5bd5a167007a11522f2)]:
  - @orca-so/whirlpools-core@3.1.0

## 6.0.0

### Major Changes

- [#1163](https://github.com/orca-so/whirlpools/pull/1163) [`c2c96da`](https://github.com/orca-so/whirlpools/commit/c2c96dae47cf0102afc2ec41d9ba5cf0c99fa340) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update solana ts dependencies, migrate from tests from bankrun to litesvm

### Patch Changes

- Updated dependencies [[`c2c96da`](https://github.com/orca-so/whirlpools/commit/c2c96dae47cf0102afc2ec41d9ba5cf0c99fa340)]:
  - @orca-so/tx-sender@3.0.0
  - @orca-so/whirlpools-client@6.0.0

## 5.0.0

### Major Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update dependencies to support contract upgrade to Anchor 0.29->0.31.1 and Solana Program 1.17->2.1

### Patch Changes

- [#1090](https://github.com/orca-so/whirlpools/pull/1090) [`cb68301`](https://github.com/orca-so/whirlpools/commit/cb68301efabc5d24b6a9b88ed73d5d2d140cf18d) Thanks [@calintje](https://github.com/calintje)! - Update deps

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update to Anchor 0.32.1

- Updated dependencies [[`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278), [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278), [`cb68301`](https://github.com/orca-so/whirlpools/commit/cb68301efabc5d24b6a9b88ed73d5d2d140cf18d), [`743e758`](https://github.com/orca-so/whirlpools/commit/743e758740622475691866ca34d571799880fdd3), [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278)]:
  - @orca-so/tx-sender@2.0.0
  - @orca-so/whirlpools-core@3.0.0
  - @orca-so/whirlpools-client@5.0.0

## 4.0.0

### Major Changes

- [#1038](https://github.com/orca-so/whirlpools/pull/1038) [`19875ce`](https://github.com/orca-so/whirlpools/commit/19875ce6595c7e15ad07cd2ede3966b05d34ab62) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Support non transferable position, Whirlpool account layout update (repurpose reward authority field)

### Patch Changes

- Updated dependencies [[`36f14df`](https://github.com/orca-so/whirlpools/commit/36f14dfdc940a7b8d7561a6871d80671efe98b68), [`19875ce`](https://github.com/orca-so/whirlpools/commit/19875ce6595c7e15ad07cd2ede3966b05d34ab62)]:
  - @orca-so/whirlpools-client@4.0.0

## 3.0.0

### Major Changes

- [#970](https://github.com/orca-so/whirlpools/pull/970) [`2509ad9`](https://github.com/orca-so/whirlpools/commit/2509ad9d9894a38c922e6e84a6a3a9de5e9ccd2d) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Dynamic TickArray

### Patch Changes

- [#974](https://github.com/orca-so/whirlpools/pull/974) [`6352a9b`](https://github.com/orca-so/whirlpools/commit/6352a9b61a574fb62440a7dca9a933af02847db5) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Relax DefaultAccountState restriction, Add ScaledUiAmount and Pausable support, Use ImmutableOwner for vault accounts

- Updated dependencies [[`2509ad9`](https://github.com/orca-so/whirlpools/commit/2509ad9d9894a38c922e6e84a6a3a9de5e9ccd2d)]:
  - @orca-so/whirlpools-client@3.0.0

## 2.2.0

### Minor Changes

- [#971](https://github.com/orca-so/whirlpools/pull/971) [`aa69979`](https://github.com/orca-so/whirlpools/commit/aa699796d86a6d51825df4214de5334ea8630636) Thanks [@calintje](https://github.com/calintje)! - Add configurable balance checking in token account preparation, allowing users to disable balance validation to get quotes and instructions even with insufficient token balances.

## 2.1.1

### Patch Changes

- [#963](https://github.com/orca-so/whirlpools/pull/963) [`49cc8c8`](https://github.com/orca-so/whirlpools/commit/49cc8c86c99428ea0feb1fbf2d8bff0c396637ba) Thanks [@calintje](https://github.com/calintje)! - Add tx-sender to peerDeps

- Updated dependencies [[`49cc8c8`](https://github.com/orca-so/whirlpools/commit/49cc8c86c99428ea0feb1fbf2d8bff0c396637ba)]:
  - @orca-so/tx-sender@1.0.2

## 2.1.0

### Minor Changes

- [#943](https://github.com/orca-so/whirlpools/pull/943) [`8a76634`](https://github.com/orca-so/whirlpools/commit/8a76634176e716c902dd9a23694c5a029b23de7a) Thanks [@boosik-sol](https://github.com/boosik-sol)! - Implements resetPositionRange instruction for ts-sdk

### Patch Changes

- [#958](https://github.com/orca-so/whirlpools/pull/958) [`63a5323`](https://github.com/orca-so/whirlpools/commit/63a5323425d22840bc226039db3e5faae7232a94) Thanks [@boosik-sol](https://github.com/boosik-sol)! - return rpc object on setRpc

## 2.0.0

### Major Changes

- [#926](https://github.com/orca-so/whirlpools/pull/926) [`49fa31a`](https://github.com/orca-so/whirlpools/commit/49fa31a042254c4f4a7c16594344f66e9c208c2b) Thanks [@yugure-orca](https://github.com/yugure-orca)! - Adaptive Fee SDK update

### Patch Changes

- Updated dependencies [[`49fa31a`](https://github.com/orca-so/whirlpools/commit/49fa31a042254c4f4a7c16594344f66e9c208c2b)]:
  - @orca-so/whirlpools-client@2.0.0
  - @orca-so/whirlpools-core@2.0.0

## 1.1.2

### Patch Changes

- [#912](https://github.com/orca-so/whirlpools/pull/912) [`4642811`](https://github.com/orca-so/whirlpools/commit/46428111241653addd0f3a7076a452bef7ab99c7) Thanks [@calintje](https://github.com/calintje)! - Expose useful utility functions

- Updated dependencies [[`11a8c04`](https://github.com/orca-so/whirlpools/commit/11a8c0420da5f6cf4cde26f82216bef5a703c2ea)]:
  - @orca-so/whirlpools-client@1.0.6

## 1.1.1

### Patch Changes

- [#884](https://github.com/orca-so/whirlpools/pull/884) [`6cd51d6`](https://github.com/orca-so/whirlpools/commit/6cd51d64de8fe0f310c1bf2f3a5e659a68c426d0) Thanks [@calintje](https://github.com/calintje)! - Update e2e tests to prevent INVALID_TICK_ARRAY_SEQUENCE error thrown from core library

## 1.1.0

### Minor Changes

- [#795](https://github.com/orca-so/whirlpools/pull/795) [`3cf441a`](https://github.com/orca-so/whirlpools/commit/3cf441ae5b7a32dffdef4d28a59baf7de1447917) Thanks [@parhim](https://github.com/parhim)! - Added actions (wrapped with execution logic)

## 1.0.4

### Patch Changes

- [#782](https://github.com/orca-so/whirlpools/pull/782) [`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb) Thanks [@wjthieme](https://github.com/wjthieme)! - Update LICENSE file

- [#788](https://github.com/orca-so/whirlpools/pull/788) [`7d2f507`](https://github.com/orca-so/whirlpools/commit/7d2f507081398973e712390281df535b3fc8988c) Thanks [@wjthieme](https://github.com/wjthieme)! - Switch from @solana/web3.js v2 to @solana/kit

- Updated dependencies [[`ca5f054`](https://github.com/orca-so/whirlpools/commit/ca5f054066d34943eefe72228b442525e849eaeb), [`7d2f507`](https://github.com/orca-so/whirlpools/commit/7d2f507081398973e712390281df535b3fc8988c), [`188fad0`](https://github.com/orca-so/whirlpools/commit/188fad03422a55369f1ad50278c59030b786fc72), [`7488726`](https://github.com/orca-so/whirlpools/commit/748872685428e0dd6a12b16091d31f9882f91541)]:
  - @orca-so/whirlpools-client@1.0.4
  - @orca-so/whirlpools-core@1.0.4

## 1.0.3

### Patch Changes

- [#680](https://github.com/orca-so/whirlpools/pull/680) [`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial changeset version

- Updated dependencies [[`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27)]:
  - @orca-so/whirlpools-client@1.0.3
  - @orca-so/whirlpools-core@1.0.3
