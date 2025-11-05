---
"@orca-so/whirlpools-program": minor
"@orca-so/whirlpools-sdk": minor
"@orca-so/whirlpools-client": minor
---

feat: add `increase_liquidity_by_token_amounts_v2` instruction and SDK support

- New v2-only instruction to increase liquidity by specifying `token_max_a` / `token_max_b`.
- Supports Token-2022 (transfer-fee/transfer-hook) via SPL Token Interface.
- Emits `LiquidityIncreased` event (same schema as existing v2).
- Legacy SDK: new builder `increaseLiquidityByTokenAmountsV2Ix` and facade method `WhirlpoolIx.increaseLiquidityByTokenAmountsV2Ix`.
- Generated TS/Rust clients updated from IDL.
- Added extensive integration tests covering Token/Token-2022 variants, dynamic tick arrays, delegates, invalid accounts, and program/memo constraints.

