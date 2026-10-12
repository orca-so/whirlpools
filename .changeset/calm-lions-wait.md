---
"@orca-so/whirlpools-rust-core": patch
"@orca-so/whirlpools-core": patch
---

Fix `collect_rewards_quote` failing when `current_timestamp` is earlier than the pool's `reward_last_updated_timestamp`, and treat an overflowing reward growth delta as zero like the program does.
