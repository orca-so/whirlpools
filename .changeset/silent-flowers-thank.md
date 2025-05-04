---
"@orca-so/whirlpools-rust-core": patch
---

Fix error in collect_reward_quote where u64 mount owned could overflow. The fix reflects the logic used in the program and Legacy SDK.
