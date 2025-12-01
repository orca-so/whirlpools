pub mod oracle;
pub mod adaptive_fee;
pub mod accessor;

#[derive(Default)]
pub struct AdaptiveFeeVariablesUpdate {
    last_reference_update_timestamp: u64,
    last_major_swap_timestamp: u64,
    volatility_reference: u32,
    tick_group_index_reference: i32,
    volatility_accumulator: u32,
}
