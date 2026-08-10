---
"@orca-so/whirlpools-sdk": minor
---

Add `createAtaMethod` to `AccountResolverOptions`, choosing between the ATA program's `Create` and `CreateIdempotent` for ATAs that don't exist yet. Existence is decided from a pre-flight fetch, so `Create` fails with `IllegalOwner` ("Provided owner is not allowed") when something else creates the ATA first — a preceding transaction in the same Jito bundle, for instance. Defaults to `create`, so existing behavior is unchanged; set `createIdempotent` when composing these instructions with anything that may create the same ATA. Honored by `openPosition`, `increaseLiquidity`, `decreaseLiquidity`, and `resolveAtaForMints`; `closePosition`, `collectRewards`, `collectAllForPositionsTxns`, and `swapAsync` already used `CreateIdempotent`. `AccountResolverOptions` is now merged over the defaults rather than replacing them.
