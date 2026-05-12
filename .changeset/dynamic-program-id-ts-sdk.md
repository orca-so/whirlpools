---
"@orca-so/whirlpools": major
"@orca-so/whirlpools-client": major
"@orca-so/whirlpools-example-ts-next": major
---

Replace the global `WHIRLPOOLS_CONFIG_ADDRESS` / `setWhirlpoolsConfig` / `DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES` API with a per-call `WhirlpoolDeployment` (mainnet / devnet / mainnet-immutable / custom). PDA helpers in `@orca-so/whirlpools-client` no longer take `whirlpoolsConfig` positionally — pass a `WhirlpoolDeployment` (or program id) instead, and SDK function arguments are bundled into `…Config` option objects.
