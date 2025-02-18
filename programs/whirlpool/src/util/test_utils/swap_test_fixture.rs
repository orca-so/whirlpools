use crate::manager::swap_manager::*;
use crate::math::tick_math::*;
use crate::state::{
    tick::*, tick_builder::TickBuilder, whirlpool_builder::WhirlpoolBuilder, TickArray, Whirlpool,
};
use crate::state::{AdaptiveFeeInfo, WhirlpoolRewardInfo, NUM_REWARDS};
use crate::util::SwapTickSequence;
use anchor_lang::prelude::*;
use std::cell::RefCell;

pub const TS_8: u16 = 8;
pub const TS_128: u16 = 128;

const NO_TICKS_VEC: &Vec<TestTickInfo> = &vec![];

pub struct SwapTestFixture {
    pub whirlpool: Whirlpool,
    pub tick_arrays: Vec<RefCell<TickArray>>,
    pub trade_amount: u64,
    pub sqrt_price_limit: u128,
    pub amount_specified_is_input: bool,
    pub a_to_b: bool,
    pub reward_last_updated_timestamp: u64,
    pub adaptive_fee_info: Option<AdaptiveFeeInfo>,
}

#[derive(Default)]
pub struct TestTickInfo {
    pub index: i32,
    pub liquidity_net: i128,
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    pub reward_growths_outside: [u128; NUM_REWARDS],
}

pub struct SwapTestFixtureInfo<'info> {
    pub tick_spacing: u16,
    pub liquidity: u128,
    pub curr_tick_index: i32,
    pub curr_sqrt_price_override: Option<u128>,
    pub start_tick_index: i32,
    pub trade_amount: u64,
    pub sqrt_price_limit: u128,
    pub amount_specified_is_input: bool,
    pub a_to_b: bool,
    pub reward_last_updated_timestamp: u64,
    pub reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
    pub fee_growth_global_a: u128,
    pub fee_growth_global_b: u128,
    pub array_1_ticks: &'info Vec<TestTickInfo>,
    pub array_2_ticks: Option<&'info Vec<TestTickInfo>>,
    pub array_3_ticks: Option<&'info Vec<TestTickInfo>>,
    pub fee_rate: u16,
    pub protocol_fee_rate: u16,
    pub adaptive_fee_info: Option<AdaptiveFeeInfo>,
}

impl Default for SwapTestFixtureInfo<'_> {
    fn default() -> Self {
        SwapTestFixtureInfo {
            tick_spacing: TS_128,
            liquidity: 0,
            curr_tick_index: 0,
            curr_sqrt_price_override: None,
            start_tick_index: 0,
            trade_amount: 0,
            sqrt_price_limit: 0,
            amount_specified_is_input: false,
            a_to_b: false,
            reward_last_updated_timestamp: 0,
            reward_infos: [
                WhirlpoolRewardInfo::default(),
                WhirlpoolRewardInfo::default(),
                WhirlpoolRewardInfo::default(),
            ],
            fee_growth_global_a: 0,
            fee_growth_global_b: 0,
            array_1_ticks: NO_TICKS_VEC,
            array_2_ticks: None,
            array_3_ticks: None,
            fee_rate: 0,
            protocol_fee_rate: 0,
            adaptive_fee_info: None,
        }
    }
}

pub struct SwapTestExpectation {
    pub traded_amount_a: u64,
    pub traded_amount_b: u64,
    pub end_tick_index: i32,
    pub end_liquidity: u128,
    pub end_reward_growths: [u128; NUM_REWARDS],
}

#[derive(Default)]
pub struct TickExpectation {
    pub fee_growth_outside_a: u128,
    pub fee_growth_outside_b: u128,
    pub reward_growths_outside: [u128; NUM_REWARDS],
}

pub fn assert_swap(swap_update: &PostSwapUpdate, expect: &SwapTestExpectation) {
    assert_eq!(swap_update.amount_a, expect.traded_amount_a);
    assert_eq!(swap_update.amount_b, expect.traded_amount_b);
    assert_eq!(swap_update.next_tick_index, expect.end_tick_index);
    assert_eq!(swap_update.next_liquidity, expect.end_liquidity);
    assert_eq!(
        WhirlpoolRewardInfo::to_reward_growths(&swap_update.next_reward_infos),
        expect.end_reward_growths
    );
}

pub fn assert_swap_tick_state(tick: &Tick, expect: &TickExpectation) {
    assert_eq!({ tick.fee_growth_outside_a }, expect.fee_growth_outside_a);
    assert_eq!({ tick.fee_growth_outside_b }, expect.fee_growth_outside_b);
    assert_eq!(
        { tick.reward_growths_outside },
        expect.reward_growths_outside
    );
}

pub fn build_filled_tick_array(start_index: i32, tick_spacing: u16) -> Vec<TestTickInfo> {
    let mut array_ticks: Vec<TestTickInfo> = vec![];
    for n in 0..TICK_ARRAY_SIZE {
        let index = start_index + n * tick_spacing as i32;
        if (MIN_TICK_INDEX..MAX_TICK_INDEX).contains(&index) {
            array_ticks.push(TestTickInfo {
                index,
                liquidity_net: -5,
                ..Default::default()
            });
        }
    }
    array_ticks
}

impl SwapTestFixture {
    pub fn new(info: SwapTestFixtureInfo) -> SwapTestFixture {
        let whirlpool = WhirlpoolBuilder::new()
            .liquidity(info.liquidity)
            .sqrt_price(
                info.curr_sqrt_price_override
                    .unwrap_or(sqrt_price_from_tick_index(info.curr_tick_index)),
            )
            .tick_spacing(info.tick_spacing)
            .tick_current_index(info.curr_tick_index)
            .reward_last_updated_timestamp(info.reward_last_updated_timestamp)
            .reward_infos(info.reward_infos)
            .fee_growth_global_a(info.fee_growth_global_a)
            .fee_growth_global_b(info.fee_growth_global_b)
            .fee_rate(info.fee_rate)
            .protocol_fee_rate(info.protocol_fee_rate)
            .build();

        let array_ticks: Vec<Option<&Vec<TestTickInfo>>> = vec![
            Some(info.array_1_ticks),
            info.array_2_ticks,
            info.array_3_ticks,
        ];

        let mut ref_mut_tick_arrays = Vec::with_capacity(3);
        let direction: i32 = if info.a_to_b { -1 } else { 1 };

        for (i, array) in array_ticks.iter().enumerate() {
            let array_index = <i32>::from(i as u16);
            let array_start_tick_index = info.start_tick_index
                + info.tick_spacing as i32 * TICK_ARRAY_SIZE * array_index * direction;

            let mut new_ta = TickArray {
                start_tick_index: array_start_tick_index,
                ticks: [Tick::default(); TICK_ARRAY_SIZE_USIZE],
                whirlpool: Pubkey::default(),
            };

            if array.is_none() {
                ref_mut_tick_arrays.push(RefCell::new(new_ta));
                continue;
            }

            let tick_array = array.unwrap();

            for tick in tick_array {
                let update = TickUpdate::from(
                    &TickBuilder::default()
                        .initialized(true)
                        .liquidity_net(tick.liquidity_net)
                        .fee_growth_outside_a(tick.fee_growth_outside_a)
                        .fee_growth_outside_b(tick.fee_growth_outside_b)
                        .reward_growths_outside(tick.reward_growths_outside)
                        .build(),
                );
                let update_result = new_ta.update_tick(tick.index, info.tick_spacing, &update);
                if update_result.is_err() {
                    panic!("Failed to set tick {}", tick.index);
                }
            }

            ref_mut_tick_arrays.push(RefCell::new(new_ta));
        }

        SwapTestFixture {
            whirlpool,
            tick_arrays: ref_mut_tick_arrays,

            trade_amount: info.trade_amount,
            sqrt_price_limit: info.sqrt_price_limit,
            amount_specified_is_input: info.amount_specified_is_input,
            a_to_b: info.a_to_b,
            reward_last_updated_timestamp: info.reward_last_updated_timestamp,
            adaptive_fee_info: info.adaptive_fee_info,
        }
    }

    pub fn run(&self, tick_sequence: &mut SwapTickSequence, next_timestamp: u64) -> PostSwapUpdate {
        swap(
            &self.whirlpool,
            tick_sequence,
            self.trade_amount,
            self.sqrt_price_limit,
            self.amount_specified_is_input,
            self.a_to_b,
            next_timestamp,
            self.adaptive_fee_info.clone(),
        )
        .unwrap()
    }

    pub fn eval(
        &self,
        tick_sequence: &mut SwapTickSequence,
        next_timestamp: u64,
    ) -> Result<PostSwapUpdate> {
        swap(
            &self.whirlpool,
            tick_sequence,
            self.trade_amount,
            self.sqrt_price_limit,
            self.amount_specified_is_input,
            self.a_to_b,
            next_timestamp,
            self.adaptive_fee_info.clone(),
        )
    }
}
