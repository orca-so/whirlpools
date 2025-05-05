---
"@orca-so/whirlpools-rust-core": patch
---

Add 'swap' feature that enables/disables swap quote. These functions cannot be used on-chain as they would cause a stack overflow. By disabling this feature on-chain you can remove stack-overflow errors when building an on-chain program.
