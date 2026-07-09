---
"@orca-so/whirlpools-rust-core": patch
---

fixes a panic in `position_ratio` caused by U256 overflow. the previous
implementation computed `current_sqrt_price^2` as an independent term and
then multiplied it into an already-large intermediate, which overflowed
U256 at high tick indexes. the new form is algebraically equivalent but
avoids ever materializing the squared term, so it stays within U256 range
across the full whirlpool tick range.