use crate::pinocchio::Result;
use pinocchio::pubkey::Pubkey;

use crate::state::{MAX_TICK_INDEX, MIN_TICK_INDEX};

pub mod dynamic_tick_array;
pub mod fixed_tick_array;
pub mod loader;
pub mod proxy;
pub mod tick;
pub mod zeroed_tick_array;

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

impl From<&tick::MemoryMappedTick> for TickUpdate {
    fn from(tick: &tick::MemoryMappedTick) -> Self {
        TickUpdate {
            initialized: tick.initialized(),
            liquidity_net: tick.liquidity_net(),
            liquidity_gross: tick.liquidity_gross(),
            fee_growth_outside_a: tick.fee_growth_outside_a(),
            fee_growth_outside_b: tick.fee_growth_outside_b(),
            reward_growths_outside: tick.reward_growths_outside(),
        }
    }
}

pub trait TickArray {
    fn is_variable_size(&self) -> bool;

    fn whirlpool(&self) -> &Pubkey;
    fn start_tick_index(&self) -> i32;

    fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>>;

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

    // Note: this function must not be used in get_next_init_tick_index because in that case,
    // offset can be -1 (b to a direction and shifted case)
    fn check_is_usable_tick_and_get_offset(
        &self,
        tick_index: i32,
        tick_spacing: u16,
    ) -> Option<usize> {
        if !self.check_in_array_bounds(tick_index, tick_spacing)
            || check_is_out_of_bounds(tick_index)
        {
            return None;
        }

        let tick_spacing_u32 = tick_spacing as u32;

        let mut remaining = (tick_index - self.start_tick_index()).unsigned_abs();
        let mut offset: usize = 0;

        // manual division
        // 64, 32, 16, 8, 4, 2, 1
        let mut divisor = tick_spacing_u32 * 64;
        let mut multiplier: usize = 64;
        while divisor >= tick_spacing_u32 {
            if remaining >= divisor {
                remaining -= divisor;
                offset += multiplier;
            }
            divisor >>= 1;
            multiplier >>= 1;
        }

        if remaining == 0 {
            Some(offset)
        } else {
            None
        }
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
    // TODO: remove / and % (NOTICE: offset may be negative(-1) when "shift" is applied)
    let d = lhs / rhs;
    let r = lhs % rhs;
    let o = if r < 0 { d - 1 } else { d };
    o as isize
}

pub fn check_is_out_of_bounds(tick_index: i32) -> bool {
    !(MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_index)
}
