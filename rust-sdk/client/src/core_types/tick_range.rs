use orca_whirlpools_core::TickRange;

use crate::Position;

impl From<Position> for TickRange {
    fn from(val: Position) -> Self {
        TickRange {
            tick_lower_index: val.tick_lower_index,
            tick_upper_index: val.tick_upper_index,
        }
    }
}
