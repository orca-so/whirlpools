use crate::DynamicTickArray;

pub const DYNAMIC_TICK_ARRAY_DISCRIMINATOR: &[u8] = &[17, 216, 246, 142, 225, 199, 218, 56];

impl DynamicTickArray {
    pub const MIN_LEN: usize = 148;
    pub const MAX_LEN: usize = 10004;
}
