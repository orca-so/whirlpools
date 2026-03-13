# @orca-so/whirlpools-example-rust-repositioning-bot

## 0.4.1

### Patch Changes

- [#1266](https://github.com/orca-so/whirlpools/pull/1266) [`be8bd95`](https://github.com/orca-so/whirlpools/commit/be8bd9581705f75db31d2e589e69f84ee785fafb) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Remove unchecked index access in ts-sdk, update package lockfiles based on version bumps

## 0.4.0

### Minor Changes

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

## 0.3.0

### Minor Changes

- [#1162](https://github.com/orca-so/whirlpools/pull/1162) [`14c5655`](https://github.com/orca-so/whirlpools/commit/14c5655b664b1a7484b5a630ed65c7b13965ab5e) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update solana rust dependencies from v2 to v3. Fix some compilation warnings.

## 0.2.3

### Patch Changes

- [#1142](https://github.com/orca-so/whirlpools/pull/1142) [`3edef23`](https://github.com/orca-so/whirlpools/commit/3edef232f5e688082e6780a129689ef94d44d278) Thanks [@jshiohaha](https://github.com/jshiohaha)! - Update to Anchor 0.32.1

## 0.2.2

### Patch Changes

- [#884](https://github.com/orca-so/whirlpools/pull/884) [`6cd51d6`](https://github.com/orca-so/whirlpools/commit/6cd51d64de8fe0f310c1bf2f3a5e659a68c426d0) Thanks [@calintje](https://github.com/calintje)! - Updated cargo.lock

## 0.2.1

### Patch Changes

- [#821](https://github.com/orca-so/whirlpools/pull/821) [`c72652d`](https://github.com/orca-so/whirlpools/commit/c72652dbb21a57d2b715415e14f3fcd65f4b0728) Thanks [@calintje](https://github.com/calintje)! - Fix calculation of position deviation

## 0.2.0

### Minor Changes

- [#726](https://github.com/orca-so/whirlpools/pull/726) [`7f0ca73`](https://github.com/orca-so/whirlpools/commit/7f0ca73f49ce8354bb9156bba326cd5d9e93d665) Thanks [@wjthieme](https://github.com/wjthieme)! - Add support for solana v2 crates

## 0.1.1

### Patch Changes

- [#679](https://github.com/orca-so/whirlpools/pull/679) [`a685353`](https://github.com/orca-so/whirlpools/commit/a68535343396e425e05d65fa9e319dc34b4ace0e) Thanks [@calintje](https://github.com/calintje)! - Updated installation guide.

- [#680](https://github.com/orca-so/whirlpools/pull/680) [`bc70bfb`](https://github.com/orca-so/whirlpools/commit/bc70bfb40068bb13282a92a7b36f501429470b27) Thanks [@wjthieme](https://github.com/wjthieme)! - Initial changeset version
