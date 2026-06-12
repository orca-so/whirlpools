---
"@orca-so/whirlpools-sdk": minor
---

Add immutable whirlpool support. Adds the `ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE` and `ORCA_WHIRLPOOLS_CONFIG_IMMUTABLE` constants and an optional `programId` argument on `WhirlpoolContext.from`/`WhirlpoolContext.withProvider` (builds from the bundled IDL rebound to the given program). Pass `ORCA_WHIRLPOOL_PROGRAM_ID_IMMUTABLE` to target the immutable (non-upgradable) Whirlpool deployment.
