---
"@orca-so/whirlpools-sdk": patch
---

Add overloaded initializeRewardV2 params and builders so callers can either pass a vault keypair (SDK signs) or an existing vault PublicKey for external signing, without changing existing behavior.