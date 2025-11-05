use crate::pinocchio::{
    errors::WhirlpoolErrorCode,
    state::whirlpool::{
        tick_array::{TickUpdate, NUM_REWARDS},
        MemoryMappedPosition, MemoryMappedTick, MemoryMappedWhirlpool,
        MemoryMappedWhirlpoolRewardInfo, TickArray,
    },
    Result,
};
use crate::{
    manager::tick_array_manager::{TickArrayRentTransfer, TickArraySizeUpdate, TickArrayUpdate},
    math::{
        add_liquidity_delta, checked_mul_div, checked_mul_shift_right, get_amount_delta_a,
        get_amount_delta_b, sqrt_price_from_tick_index,
    },
    state::PositionUpdate,
};

pub struct PinoModifyLiquidityUpdate {
    pub whirlpool_liquidity: u128,
    pub tick_lower_update: TickUpdate,
    pub tick_upper_update: TickUpdate,
    pub next_reward_growth_global: [u128; NUM_REWARDS],
    pub position_update: PositionUpdate,
    pub tick_array_lower_update: TickArrayUpdate,
    pub tick_array_upper_update: TickArrayUpdate,
}

pub fn pino_calculate_modify_liquidity(
    whirlpool: &MemoryMappedWhirlpool,
    position: &MemoryMappedPosition,
    tick_array_lower: &dyn TickArray,
    tick_array_upper: &dyn TickArray,
    liquidity_delta: i128,
    timestamp: u64,
) -> Result<PinoModifyLiquidityUpdate> {
    let tick_lower =
        tick_array_lower.get_tick(position.tick_lower_index(), whirlpool.tick_spacing())?;

    let tick_upper =
        tick_array_upper.get_tick(position.tick_upper_index(), whirlpool.tick_spacing())?;

    _pino_calculate_modify_liquidity(
        whirlpool,
        position,
        tick_lower,
        tick_upper,
        position.tick_lower_index(),
        position.tick_upper_index(),
        tick_array_lower.is_variable_size(),
        tick_array_upper.is_variable_size(),
        liquidity_delta,
        timestamp,
    )
}

#[inline(always)]
#[allow(clippy::too_many_arguments)]
fn _pino_calculate_modify_liquidity(
    whirlpool: &MemoryMappedWhirlpool,
    position: &MemoryMappedPosition,
    tick_lower: &MemoryMappedTick,
    tick_upper: &MemoryMappedTick,
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_array_lower_variable_size: bool,
    tick_array_upper_variable_size: bool,
    liquidity_delta: i128,
    timestamp: u64,
) -> Result<PinoModifyLiquidityUpdate> {
    // Disallow only updating position fee and reward growth when position has zero liquidity
    if liquidity_delta == 0 && position.liquidity() == 0 {
        return Err(WhirlpoolErrorCode::LiquidityZero.into());
    }

    let next_reward_growth_global = pino_next_whirlpool_reward_growth_global(whirlpool, timestamp)?;

    let next_global_liquidity = pino_next_whirlpool_liquidity(
        whirlpool,
        position.tick_upper_index(),
        position.tick_lower_index(),
        liquidity_delta,
    )?;

    let tick_lower_update = pino_next_tick_modify_liquidity_update(
        tick_lower,
        tick_lower_index,
        whirlpool.tick_current_index(),
        whirlpool.fee_growth_global_a(),
        whirlpool.fee_growth_global_b(),
        &next_reward_growth_global,
        liquidity_delta,
        false,
    )?;

    let tick_upper_update = pino_next_tick_modify_liquidity_update(
        tick_upper,
        tick_upper_index,
        whirlpool.tick_current_index(),
        whirlpool.fee_growth_global_a(),
        whirlpool.fee_growth_global_b(),
        &next_reward_growth_global,
        liquidity_delta,
        true,
    )?;

    let (fee_growth_inside_a, fee_growth_inside_b) = pino_next_fee_growths_inside(
        whirlpool.tick_current_index(),
        tick_lower,
        tick_lower_index,
        tick_upper,
        tick_upper_index,
        whirlpool.fee_growth_global_a(),
        whirlpool.fee_growth_global_b(),
    );

    let reward_growths_inside = pino_next_reward_growths_inside(
        whirlpool.tick_current_index(),
        tick_lower,
        tick_lower_index,
        tick_upper,
        tick_upper_index,
        whirlpool.reward_infos(),
        &next_reward_growth_global,
    );

    let position_update = pino_next_position_modify_liquidity_update(
        position,
        liquidity_delta,
        fee_growth_inside_a,
        fee_growth_inside_b,
        &reward_growths_inside,
    )?;

    let tick_array_lower_update = pino_calculate_modify_tick_array(
        position,
        &position_update,
        tick_array_lower_variable_size,
        tick_lower,
        &tick_lower_update,
    )?;

    let tick_array_upper_update = pino_calculate_modify_tick_array(
        position,
        &position_update,
        tick_array_upper_variable_size,
        tick_upper,
        &tick_upper_update,
    )?;

    Ok(PinoModifyLiquidityUpdate {
        whirlpool_liquidity: next_global_liquidity,
        next_reward_growth_global,
        position_update,
        tick_lower_update,
        tick_upper_update,
        tick_array_lower_update,
        tick_array_upper_update,
    })
}

fn pino_next_whirlpool_reward_growth_global(
    whirlpool: &MemoryMappedWhirlpool,
    next_timestamp: u64,
) -> Result<[u128; NUM_REWARDS]> {
    let curr_timestamp = whirlpool.reward_last_updated_timestamp();
    if next_timestamp < curr_timestamp {
        return Err(WhirlpoolErrorCode::InvalidTimestamp.into());
    }

    let reward_infos = whirlpool.reward_infos();

    let mut next_reward_infos = [
        reward_infos[0].growth_global_x64(),
        reward_infos[1].growth_global_x64(),
        reward_infos[2].growth_global_x64(),
    ];

    // No-op if no liquidity or no change in timestamp
    if whirlpool.liquidity() == 0 || next_timestamp == curr_timestamp {
        return Ok(next_reward_infos);
    }

    // Calculate new global reward growth
    let time_delta = u128::from(next_timestamp - curr_timestamp);
    for i in 0..NUM_REWARDS {
        // It is same to !reward_info.initialized() and also it can skip mul_div with 0 value
        if reward_infos[i].emissions_per_second_x64() == 0 {
            continue;
        }

        // Calculate the new reward growth delta.
        // If the calculation overflows, set the delta value to zero.
        // This will halt reward distributions for this reward.
        let reward_growth_delta = checked_mul_div(
            time_delta,
            reward_infos[i].emissions_per_second_x64(),
            whirlpool.liquidity(),
        )
        .unwrap_or(0);

        // Add the reward growth delta to the global reward growth.
        let curr_growth_global = next_reward_infos[i];
        next_reward_infos[i] = curr_growth_global.wrapping_add(reward_growth_delta);
    }

    Ok(next_reward_infos)
}

fn pino_next_whirlpool_liquidity(
    whirlpool: &MemoryMappedWhirlpool,
    tick_upper_index: i32,
    tick_lower_index: i32,
    liquidity_delta: i128,
) -> Result<u128> {
    if whirlpool.tick_current_index() < tick_upper_index
        && whirlpool.tick_current_index() >= tick_lower_index
    {
        Ok(add_liquidity_delta(whirlpool.liquidity(), liquidity_delta)?)
    } else {
        Ok(whirlpool.liquidity())
    }
}

fn pino_next_position_modify_liquidity_update(
    position: &MemoryMappedPosition,
    liquidity_delta: i128,
    fee_growth_inside_a: u128,
    fee_growth_inside_b: u128,
    reward_growths_inside: &[u128; NUM_REWARDS],
) -> Result<PositionUpdate> {
    let mut update = PositionUpdate::default();

    // Calculate fee deltas.
    // If fee deltas overflow, default to a zero value. This means the position loses
    // all fees earned since the last time the position was modified or fees collected.
    let growth_delta_a = fee_growth_inside_a.wrapping_sub(position.fee_growth_checkpoint_a());
    let fee_delta_a = checked_mul_shift_right(position.liquidity(), growth_delta_a).unwrap_or(0);

    let growth_delta_b = fee_growth_inside_b.wrapping_sub(position.fee_growth_checkpoint_b());
    let fee_delta_b = checked_mul_shift_right(position.liquidity(), growth_delta_b).unwrap_or(0);

    update.fee_growth_checkpoint_a = fee_growth_inside_a;
    update.fee_growth_checkpoint_b = fee_growth_inside_b;

    // Overflows allowed. Must collect fees owed before overflow.
    update.fee_owed_a = position.fee_owed_a().wrapping_add(fee_delta_a);
    update.fee_owed_b = position.fee_owed_b().wrapping_add(fee_delta_b);

    let position_reward_infos = position.reward_infos();
    for (i, update) in update.reward_infos.iter_mut().enumerate() {
        let reward_growth_inside = reward_growths_inside[i];
        let curr_reward_info = &position_reward_infos[i];

        // Calculate reward delta.
        // If reward delta overflows, default to a zero value. This means the position loses all
        // rewards earned since the last time the position was modified or rewards were collected.
        let reward_growth_delta =
            reward_growth_inside.wrapping_sub(curr_reward_info.growth_inside_checkpoint());
        let amount_owed_delta =
            checked_mul_shift_right(position.liquidity(), reward_growth_delta).unwrap_or(0);

        update.growth_inside_checkpoint = reward_growth_inside;

        // Overflows allowed. Must collect rewards owed before overflow.
        update.amount_owed = curr_reward_info
            .amount_owed()
            .wrapping_add(amount_owed_delta);
    }

    update.liquidity = add_liquidity_delta(position.liquidity(), liquidity_delta)?;

    Ok(update)
}

fn pino_calculate_modify_tick_array(
    position: &MemoryMappedPosition,
    position_update: &PositionUpdate,
    is_variable_size_tick_array: bool,
    tick: &MemoryMappedTick,
    tick_update: &TickUpdate,
) -> Result<TickArrayUpdate> {
    if !is_variable_size_tick_array {
        // Fixed size tick arrays don't need to be updated
        return Ok(TickArrayUpdate::default());
    }

    let mut transfer_rent = TickArrayRentTransfer::None;
    let mut size_update = TickArraySizeUpdate::None;

    // If liquidity is 0 and is being increased, transfer rent to tick array
    // As this might potentially initialize a new tick in the array
    if position.liquidity() == 0 && position_update.liquidity != 0 {
        transfer_rent = TickArrayRentTransfer::TransferToTickArray;
    }

    // If liquidity is being decreased to 0, transfer rent to position
    // As this might potentially deinitialize a tick in the array
    if position.liquidity() != 0 && position_update.liquidity == 0 {
        transfer_rent = TickArrayRentTransfer::TransferToPosition;
    }

    // If tick is not initialized and is being initialized, increase tick array size
    if !tick.initialized() && tick_update.initialized {
        size_update = TickArraySizeUpdate::Increase;
    }

    // If tick is initialized and is being deinitialized, decrease tick array size
    if tick.initialized() && !tick_update.initialized {
        size_update = TickArraySizeUpdate::Decrease;
    }

    Ok(TickArrayUpdate {
        transfer_rent,
        size_update,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn pino_next_tick_modify_liquidity_update(
    tick: &MemoryMappedTick,
    tick_index: i32,
    tick_current_index: i32,
    fee_growth_global_a: u128,
    fee_growth_global_b: u128,
    reward_growth_global: &[u128; NUM_REWARDS],
    liquidity_delta: i128,
    is_upper_tick: bool,
) -> Result<TickUpdate> {
    // noop if there is no change in liquidity
    if liquidity_delta == 0 {
        return Ok(TickUpdate {
            initialized: tick.initialized(),
            liquidity_net: tick.liquidity_net(),
            liquidity_gross: tick.liquidity_gross(),
            fee_growth_outside_a: tick.fee_growth_outside_a(),
            fee_growth_outside_b: tick.fee_growth_outside_b(),
            reward_growths_outside: tick.reward_growths_outside(),
        });
    }

    let liquidity_gross = add_liquidity_delta(tick.liquidity_gross(), liquidity_delta)?;

    // Update to an uninitialized tick if remaining liquidity is being removed
    if liquidity_gross == 0 {
        return Ok(TickUpdate::default());
    }

    let (fee_growth_outside_a, fee_growth_outside_b, reward_growths_outside) =
        if tick.liquidity_gross() == 0 {
            // By convention, assume all prior growth happened below the tick
            if tick_current_index >= tick_index {
                (
                    fee_growth_global_a,
                    fee_growth_global_b,
                    *reward_growth_global,
                )
            } else {
                (0, 0, [0; NUM_REWARDS])
            }
        } else {
            (
                tick.fee_growth_outside_a(),
                tick.fee_growth_outside_b(),
                tick.reward_growths_outside(),
            )
        };

    let liquidity_net = if is_upper_tick {
        tick.liquidity_net()
            .checked_sub(liquidity_delta)
            .ok_or(WhirlpoolErrorCode::LiquidityNetError)?
    } else {
        tick.liquidity_net()
            .checked_add(liquidity_delta)
            .ok_or(WhirlpoolErrorCode::LiquidityNetError)?
    };

    Ok(TickUpdate {
        initialized: true,
        liquidity_net,
        liquidity_gross,
        fee_growth_outside_a,
        fee_growth_outside_b,
        reward_growths_outside,
    })
}

pub fn pino_next_fee_growths_inside(
    tick_current_index: i32,
    tick_lower: &MemoryMappedTick,
    tick_lower_index: i32,
    tick_upper: &MemoryMappedTick,
    tick_upper_index: i32,
    fee_growth_global_a: u128,
    fee_growth_global_b: u128,
) -> (u128, u128) {
    // By convention, when initializing a tick, all fees have been earned below the tick.
    let (fee_growth_below_a, fee_growth_below_b) = if !tick_lower.initialized() {
        (fee_growth_global_a, fee_growth_global_b)
    } else if tick_current_index < tick_lower_index {
        (
            fee_growth_global_a.wrapping_sub(tick_lower.fee_growth_outside_a()),
            fee_growth_global_b.wrapping_sub(tick_lower.fee_growth_outside_b()),
        )
    } else {
        (
            tick_lower.fee_growth_outside_a(),
            tick_lower.fee_growth_outside_b(),
        )
    };

    // By convention, when initializing a tick, no fees have been earned above the tick.
    let (fee_growth_above_a, fee_growth_above_b) = if !tick_upper.initialized() {
        (0, 0)
    } else if tick_current_index < tick_upper_index {
        (
            tick_upper.fee_growth_outside_a(),
            tick_upper.fee_growth_outside_b(),
        )
    } else {
        (
            fee_growth_global_a.wrapping_sub(tick_upper.fee_growth_outside_a()),
            fee_growth_global_b.wrapping_sub(tick_upper.fee_growth_outside_b()),
        )
    };

    (
        fee_growth_global_a
            .wrapping_sub(fee_growth_below_a)
            .wrapping_sub(fee_growth_above_a),
        fee_growth_global_b
            .wrapping_sub(fee_growth_below_b)
            .wrapping_sub(fee_growth_above_b),
    )
}

pub fn pino_next_reward_growths_inside(
    tick_current_index: i32,
    tick_lower: &MemoryMappedTick,
    tick_lower_index: i32,
    tick_upper: &MemoryMappedTick,
    tick_upper_index: i32,
    reward_infos: &[MemoryMappedWhirlpoolRewardInfo; NUM_REWARDS],
    next_reward_growth_global: &[u128; NUM_REWARDS],
) -> [u128; NUM_REWARDS] {
    let mut reward_growths_inside = [0; NUM_REWARDS];

    for i in 0..NUM_REWARDS {
        if !reward_infos[i].initialized() {
            continue;
        }

        // By convention, assume all prior growth happened below the tick
        let tick_lower_reward_growths_outside = tick_lower.reward_growths_outside();
        let reward_growths_below = if !tick_lower.initialized() {
            next_reward_growth_global[i]
        } else if tick_current_index < tick_lower_index {
            next_reward_growth_global[i].wrapping_sub(tick_lower_reward_growths_outside[i])
        } else {
            tick_lower_reward_growths_outside[i]
        };

        // By convention, assume all prior growth happened below the tick, not above
        let tick_upper_reward_growths_outside = tick_upper.reward_growths_outside();
        let reward_growths_above = if !tick_upper.initialized() {
            0
        } else if tick_current_index < tick_upper_index {
            tick_upper_reward_growths_outside[i]
        } else {
            next_reward_growth_global[i].wrapping_sub(tick_upper_reward_growths_outside[i])
        };

        reward_growths_inside[i] = next_reward_growth_global[i]
            .wrapping_sub(reward_growths_below)
            .wrapping_sub(reward_growths_above);
    }

    reward_growths_inside
}

pub fn pino_sync_modify_liquidity_values(
    whirlpool: &mut MemoryMappedWhirlpool,
    position: &mut MemoryMappedPosition,
    tick_array_lower: &mut dyn TickArray,
    tick_array_upper: Option<&mut dyn TickArray>,
    modify_liquidity_update: &PinoModifyLiquidityUpdate,
    reward_last_updated_timestamp: u64,
) -> Result<()> {
    position.update(&modify_liquidity_update.position_update);

    tick_array_lower.update_tick(
        position.tick_lower_index(),
        whirlpool.tick_spacing(),
        &modify_liquidity_update.tick_lower_update,
    )?;

    if let Some(tick_array_upper) = tick_array_upper {
        tick_array_upper.update_tick(
            position.tick_upper_index(),
            whirlpool.tick_spacing(),
            &modify_liquidity_update.tick_upper_update,
        )?;
    } else {
        // Upper and lower tick arrays are the same so we only have one ref
        tick_array_lower.update_tick(
            position.tick_upper_index(),
            whirlpool.tick_spacing(),
            &modify_liquidity_update.tick_upper_update,
        )?;
    }

    whirlpool.update_liquidity_and_reward_growth_global(
        modify_liquidity_update.whirlpool_liquidity,
        &modify_liquidity_update.next_reward_growth_global,
        reward_last_updated_timestamp,
    );

    Ok(())
}

pub fn pino_calculate_liquidity_token_deltas(
    current_tick_index: i32,
    sqrt_price: u128,
    position: &MemoryMappedPosition,
    liquidity_delta: i128,
) -> Result<(u64, u64)> {
    if liquidity_delta == 0 {
        return Err(WhirlpoolErrorCode::LiquidityZero.into());
    }

    let mut delta_a: u64 = 0;
    let mut delta_b: u64 = 0;

    let liquidity: u128 = liquidity_delta.unsigned_abs();
    let round_up = liquidity_delta > 0;

    let lower_price = sqrt_price_from_tick_index(position.tick_lower_index());
    let upper_price = sqrt_price_from_tick_index(position.tick_upper_index());

    if current_tick_index < position.tick_lower_index() {
        // current tick below position
        delta_a = get_amount_delta_a(lower_price, upper_price, liquidity, round_up)?;
    } else if current_tick_index < position.tick_upper_index() {
        // current tick inside position
        delta_a = get_amount_delta_a(sqrt_price, upper_price, liquidity, round_up)?;
        delta_b = get_amount_delta_b(lower_price, sqrt_price, liquidity, round_up)?;
    } else {
        // current tick above position
        delta_b = get_amount_delta_b(lower_price, upper_price, liquidity, round_up)?;
    }

    Ok((delta_a, delta_b))
}
