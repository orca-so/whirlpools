use crate::pinocchio::Result;
use pinocchio::pubkey::Pubkey;

use crate::state::{MAX_TICK_INDEX, MIN_TICK_INDEX};

pub mod dynamic_tick_array;
pub mod fixed_tick_array;
pub mod loader;
pub mod tick;

pub const TICK_ARRAY_SIZE: i32 = 88;
pub const TICK_ARRAY_SIZE_USIZE: usize = 88;
pub const NUM_REWARDS: usize = 3;

#[derive(Default)]
pub struct TickUpdate {
    pub initialized: bool,
    pub liquidity_net: i128,
    pub liquidity_gross: u128,
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    pub reward_growths_outside: [u128; NUM_REWARDS],
}

pub trait TickArray {
    fn is_variable_size(&self) -> bool;

    fn whirlpool(&self) -> &Pubkey;
    fn start_tick_index(&self) -> i32;

    // TODO: if we implement swap feature using Pinocchio
    // get_next_init_tick_index(

    fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<&tick::MemoryMappedTick>;

    fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()>;

    fn in_search_range(&self, tick_index: i32, tick_spacing: u16, shifted: bool) -> bool {
        let mut lower = self.start_tick_index();
        let mut upper = self.start_tick_index() + TICK_ARRAY_SIZE * tick_spacing as i32;
        if shifted {
            lower -= tick_spacing as i32;
            upper -= tick_spacing as i32;
        }
        tick_index >= lower && tick_index < upper
    }

    fn check_in_array_bounds(&self, tick_index: i32, tick_spacing: u16) -> bool {
        self.in_search_range(tick_index, tick_spacing, false)
    }

    fn is_min_tick_array(&self) -> bool {
        self.start_tick_index() <= MIN_TICK_INDEX
    }

    fn is_max_tick_array(&self, tick_spacing: u16) -> bool {
        self.start_tick_index() + TICK_ARRAY_SIZE * (tick_spacing as i32) > MAX_TICK_INDEX
    }

    fn tick_offset(&self, tick_index: i32, tick_spacing: u16) -> Result<isize> {
        if tick_spacing == 0 {
            return Err(crate::errors::ErrorCode::InvalidTickSpacing.into());
        }

        Ok(get_offset(
            tick_index,
            self.start_tick_index(),
            tick_spacing,
        ))
    }
}

fn get_offset(tick_index: i32, start_tick_index: i32, tick_spacing: u16) -> isize {
    // TODO: replace with i32.div_floor once not experimental
    let lhs = tick_index - start_tick_index;
    // rhs(tick_spacing) is always positive number (non zero)
    let rhs = tick_spacing as i32;
    // TODO: remove / and %
    let d = lhs / rhs;
    let r = lhs % rhs;
    let o = if r < 0 { d - 1 } else { d };
    o as isize
}

pub fn check_is_out_of_bounds(tick_index: i32) -> bool {
    !(MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_index)
}

pub fn check_is_usable_tick_and_get_offset(
    tick_index: i32,
    tick_spacing: u16,
    start_tick_index: i32,
) -> Option<isize> {
    if check_is_out_of_bounds(tick_index) {
        return None; // false;
    }

    let tick_spacing_u32 = tick_spacing as u32;

    let mut remaining = (tick_index - start_tick_index).unsigned_abs();
    let mut offset: isize = 0;
    assert!(remaining < tick_spacing_u32 * TICK_ARRAY_SIZE as u32);

    // manual division
    // 64, 32, 16, 8, 4, 2, 1
    let mut dividor = tick_spacing_u32 * 64;
    let mut multiplier: isize = 64;
    while dividor >= tick_spacing_u32 {
        if remaining >= dividor {
            remaining -= dividor;
            offset += multiplier;
        }
        dividor >>= 1;
        multiplier >>= 1;
    }

    if remaining == 0 {
        Some(offset)
    } else {
        None
    }
}
