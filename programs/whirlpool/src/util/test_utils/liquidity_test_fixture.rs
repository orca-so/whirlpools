use crate::manager::liquidity_manager::ModifyLiquidityUpdate;
use crate::manager::tick_manager::next_tick_cross_update;
use crate::manager::whirlpool_manager::*;
use crate::math::{add_liquidity_delta, Q64_RESOLUTION};
use crate::state::position_builder::PositionBuilder;
use crate::state::{tick_builder::TickBuilder, whirlpool_builder::WhirlpoolBuilder, Whirlpool};
use crate::state::{
    Position, PositionRewardInfo, PositionUpdate, Tick, TickUpdate, WhirlpoolRewardInfo,
    NUM_REWARDS,
};
use anchor_lang::prelude::*;

const BELOW_LOWER_TICK_INDEX: i32 = -120;
const ABOVE_UPPER_TICK_INDEX: i32 = 120;

pub enum CurrIndex {
    Below,
    Inside,
    Above,
}

pub enum TickLabel {
    Upper,
    Lower,
}

pub enum Direction {
    Left,
    Right,
}

// State for testing modifying liquidity in a single whirlpool position
pub struct LiquidityTestFixture {
    pub whirlpool: Whirlpool,
    pub position: Position,
    pub tick_lower: Tick,
    pub tick_upper: Tick,
}

pub struct LiquidityTestFixtureInfo {
    pub curr_index_loc: CurrIndex,
    pub whirlpool_liquidity: u128,
    pub position_liquidity: u128,
    pub tick_lower_liquidity_gross: u128,
    pub tick_upper_liquidity_gross: u128,
    pub fee_growth_global_a: u128,
    pub fee_growth_global_b: u128,
    pub reward_infos: [WhirlpoolRewardInfo; NUM_REWARDS],
}

impl LiquidityTestFixture {
    pub fn new(info: LiquidityTestFixtureInfo) -> LiquidityTestFixture {
        assert!(info.tick_lower_liquidity_gross < i64::MAX as u128);
        assert!(info.tick_upper_liquidity_gross < i64::MAX as u128);

        // Tick's must have enough at least enough liquidity to support the position
        assert!(info.tick_lower_liquidity_gross >= info.position_liquidity);
        assert!(info.tick_upper_liquidity_gross >= info.position_liquidity);

        let curr_index = match info.curr_index_loc {
            CurrIndex::Below => BELOW_LOWER_TICK_INDEX,
            CurrIndex::Inside => 0,
            CurrIndex::Above => ABOVE_UPPER_TICK_INDEX,
        };

        let whirlpool = WhirlpoolBuilder::new()
            .tick_current_index(curr_index)
            .liquidity(info.whirlpool_liquidity)
            .reward_infos(info.reward_infos)
            .fee_growth_global_a(info.fee_growth_global_a)
            .fee_growth_global_b(info.fee_growth_global_b)
            .build();

        let tick_lower_initialized = info.tick_lower_liquidity_gross > 0;
        let tick_upper_initialized = info.tick_upper_liquidity_gross > 0;

        LiquidityTestFixture {
            whirlpool,
            position: PositionBuilder::new(-100, 100)
                .liquidity(info.position_liquidity)
                .build(),
            tick_lower: TickBuilder::default()
                .initialized(tick_lower_initialized)
                .liquidity_gross(info.tick_lower_liquidity_gross)
                .liquidity_net(info.tick_lower_liquidity_gross as i128)
                .build(),
            tick_upper: TickBuilder::default()
                .initialized(tick_upper_initialized)
                .liquidity_gross(info.tick_upper_liquidity_gross)
                .liquidity_net(-(info.tick_upper_liquidity_gross as i128))
                .build(),
        }
    }

    pub fn increment_whirlpool_fee_growths(
        &mut self,
        fee_growth_delta_a: u128,
        fee_growth_delta_b: u128,
    ) {
        self.whirlpool.fee_growth_global_a = self
            .whirlpool
            .fee_growth_global_a
            .wrapping_add(fee_growth_delta_a);
        self.whirlpool.fee_growth_global_b = self
            .whirlpool
            .fee_growth_global_b
            .wrapping_add(fee_growth_delta_b);
    }

    pub fn increment_whirlpool_reward_growths_by_time(&mut self, seconds: u64) {
        let next_timestamp = self.whirlpool.reward_last_updated_timestamp + seconds;
        self.whirlpool.reward_infos =
            next_whirlpool_reward_infos(&self.whirlpool, next_timestamp).unwrap();
        self.whirlpool.reward_last_updated_timestamp = next_timestamp;
    }

    /// Simulates crossing a tick within the test fixture.
    pub fn cross_tick(&mut self, tick_label: TickLabel, direction: Direction) {
        let tick = match tick_label {
            TickLabel::Lower => &mut self.tick_lower,
            TickLabel::Upper => &mut self.tick_upper,
        };
        let update = next_tick_cross_update(
            tick,
            self.whirlpool.fee_growth_global_a,
            self.whirlpool.fee_growth_global_b,
            &self.whirlpool.reward_infos,
        )
        .unwrap();

        tick.update(&update);

        self.whirlpool.liquidity = add_liquidity_delta(
            self.whirlpool.liquidity,
            match direction {
                Direction::Left => -tick.liquidity_net,
                Direction::Right => tick.liquidity_net,
            },
        )
        .unwrap();

        match tick_label {
            TickLabel::Lower => match direction {
                Direction::Right => self.whirlpool.tick_current_index = 0,
                Direction::Left => self.whirlpool.tick_current_index = BELOW_LOWER_TICK_INDEX,
            },
            TickLabel::Upper => match direction {
                Direction::Left => self.whirlpool.tick_current_index = 0,
                Direction::Right => self.whirlpool.tick_current_index = ABOVE_UPPER_TICK_INDEX,
            },
        }
    }

    pub fn apply_update(
        &mut self,
        update: &ModifyLiquidityUpdate,
        reward_last_updated_timestamp: u64,
    ) {
        assert!(reward_last_updated_timestamp >= self.whirlpool.reward_last_updated_timestamp);
        self.whirlpool.reward_last_updated_timestamp = reward_last_updated_timestamp;
        self.whirlpool.liquidity = update.whirlpool_liquidity;
        self.whirlpool.reward_infos = update.reward_infos;
        self.tick_lower.update(&update.tick_lower_update);
        self.tick_upper.update(&update.tick_upper_update);
        self.position.update(&update.position_update);
    }
}

pub fn create_whirlpool_reward_infos(
    emissions_per_second_x64: u128,
    growth_global_x64: u128,
) -> [WhirlpoolRewardInfo; NUM_REWARDS] {
    [
        WhirlpoolRewardInfo {
            mint: Pubkey::new_unique(),
            emissions_per_second_x64,
            growth_global_x64,
            ..Default::default()
        },
        WhirlpoolRewardInfo {
            mint: Pubkey::new_unique(),
            emissions_per_second_x64,
            growth_global_x64,
            ..Default::default()
        },
        WhirlpoolRewardInfo {
            mint: Pubkey::new_unique(),
            emissions_per_second_x64,
            growth_global_x64,
            ..Default::default()
        },
    ]
}

pub fn create_position_reward_infos(
    growth_inside_checkpoint: u128,
    amount_owed: u64,
) -> [PositionRewardInfo; NUM_REWARDS] {
    [
        PositionRewardInfo {
            growth_inside_checkpoint,
            amount_owed,
        },
        PositionRewardInfo {
            growth_inside_checkpoint,
            amount_owed,
        },
        PositionRewardInfo {
            growth_inside_checkpoint,
            amount_owed,
        },
    ]
}

pub fn create_reward_growths(growth_global_x64: u128) -> [u128; NUM_REWARDS] {
    [growth_global_x64, growth_global_x64, growth_global_x64]
}

pub fn to_x64(n: u128) -> u128 {
    n << Q64_RESOLUTION
}

pub fn assert_whirlpool_reward_growths(
    reward_infos: &[WhirlpoolRewardInfo; NUM_REWARDS],
    expected_growth: u128,
) {
    assert_eq!(
        WhirlpoolRewardInfo::to_reward_growths(reward_infos),
        create_reward_growths(expected_growth)
    )
}

pub struct ModifyLiquidityExpectation {
    pub whirlpool_liquidity: u128,
    pub whirlpool_reward_growths: [u128; NUM_REWARDS],
    pub position_update: PositionUpdate,
    pub tick_lower_update: TickUpdate,
    pub tick_upper_update: TickUpdate,
}

pub fn assert_modify_liquidity(
    update: &ModifyLiquidityUpdate,
    expect: &ModifyLiquidityExpectation,
) {
    assert_eq!(update.whirlpool_liquidity, expect.whirlpool_liquidity);
    assert_eq!(
        WhirlpoolRewardInfo::to_reward_growths(&update.reward_infos),
        expect.whirlpool_reward_growths
    );
    assert_eq!(update.tick_lower_update, expect.tick_lower_update);
    assert_eq!(update.tick_upper_update, expect.tick_upper_update);
    assert_eq!(update.position_update, expect.position_update);
}
