use orca_whirlpools_core::TickRange;

use crate::Position;

impl Into<TickRange> for Position {
  fn into(self) -> TickRange {
    TickRange {
      tick_lower_index: self.tick_lower_index,
      tick_upper_index: self.tick_upper_index,
    }
  }
}
