---
"orca-so/whirlpools-rust-core": patch
---

**Hardening**: Added bounds checking to tick index functions. Functions `get_initializable_tick_index`, `get_prev_initializable_tick_index`, `get_next_initializable_tick_index`, and `is_tick_initializable` now validate that tick indices are within valid bounds and panic with a clear error message if out-of-bounds values are provided.