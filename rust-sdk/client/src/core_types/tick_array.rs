use orca_whirlpools_core::TickArrayFacade;

use crate::TickArray;

impl From<TickArray> for TickArrayFacade {
    fn from(val: TickArray) -> Self {
        val.into()
    }
}
