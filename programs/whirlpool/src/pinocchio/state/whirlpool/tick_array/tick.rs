use super::super::super::{ByteBool, BytesI128, BytesU128};
use super::TickUpdate;
use super::NUM_REWARDS;

#[repr(C)]
pub struct MemoryMappedTick {
    initialized: ByteBool,
    liquidity_net: BytesI128,
    liquidity_gross: BytesU128,
    fee_growth_outside_a: BytesU128,
    fee_growth_outside_b: BytesU128,
    reward_growths_outside: [BytesU128; NUM_REWARDS],
}

impl MemoryMappedTick {
    #[inline(always)]
    pub fn initialized(&self) -> bool {
        self.initialized != 0
    }

    #[inline(always)]
    pub fn liquidity_net(&self) -> i128 {
        i128::from_le_bytes(self.liquidity_net)
    }

    #[inline(always)]
    pub fn liquidity_gross(&self) -> u128 {
        u128::from_le_bytes(self.liquidity_gross)
    }

    #[inline(always)]
    pub fn fee_growth_outside_a(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_outside_a)
    }

    #[inline(always)]
    pub fn fee_growth_outside_b(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_outside_b)
    }

    #[inline(always)]
    pub fn reward_growths_outside(&self) -> [u128; NUM_REWARDS] {
        [
            u128::from_le_bytes(self.reward_growths_outside[0]),
            u128::from_le_bytes(self.reward_growths_outside[1]),
            u128::from_le_bytes(self.reward_growths_outside[2]),
        ]
    }

    #[inline(always)]
    pub fn update(&mut self, update: &TickUpdate) {
        self.initialized = 1;
        self.liquidity_net = update.liquidity_net.to_le_bytes();
        self.liquidity_gross = update.liquidity_gross.to_le_bytes();
        self.fee_growth_outside_a = update.fee_growth_outside_a.to_le_bytes();
        self.fee_growth_outside_b = update.fee_growth_outside_b.to_le_bytes();
        self.reward_growths_outside[0] = update.reward_growths_outside[0].to_le_bytes();
        self.reward_growths_outside[1] = update.reward_growths_outside[1].to_le_bytes();
        self.reward_growths_outside[2] = update.reward_growths_outside[2].to_le_bytes();
    }
}

pub static STATIC_ZEROED_MEMORY_MAPPED_TICK: MemoryMappedTick = MemoryMappedTick {
    initialized: 0,
    liquidity_net: [0; 16],
    liquidity_gross: [0; 16],
    fee_growth_outside_a: [0; 16],
    fee_growth_outside_b: [0; 16],
    reward_growths_outside: [[0; 16]; NUM_REWARDS],
};
