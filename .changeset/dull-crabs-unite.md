---
"@orca-so/whirlpools-sdk": minor
"@orca-so/whirlpools-rust": minor
"@orca-so/whirlpools": minor
---

Use increaseLiquidityByTokenAmounts as default.

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
