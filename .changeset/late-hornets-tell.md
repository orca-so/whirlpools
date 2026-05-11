---
"@orca-so/whirlpools-rust": major
"@orca-so/whirlpools-rust-client": major
"@orca-so/whirlpools-example-rust-repositioning-bot": major
---

Replace the global `WHIRLPOOLS_CONFIG_ADDRESS` / `set_whirlpools_config_address` / `WhirlpoolsConfigInput` API with a per-call `WhirlpoolDeployment` (mainnet / devnet / mainnet-immutable / custom), and move SDK function arguments into `…Config` structs.
