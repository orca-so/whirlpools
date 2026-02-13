---
"@orca-so/whirlpools-rust": major
"@orca-so/whirlpools": major
"@orca-so/whirlpools-example-rust-repositioning-bot": minor
"@orca-so/whirlpools-docs": minor
---

Refactors the increase-liquidity API in both TypeScript and Rust SDKs to use token maximum amounts. Both SDKs now require specifying `tokenMaxA` and `tokenMaxB` — the program adds the maximum liquidity achievable within those limits.

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
