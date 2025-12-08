use crate::util::{to_timestamp_u64, AccountsType};
use crate::{
    constants::transfer_memo,
    pinocchio::{
        events::Event,
        ported::{
            util_remaining_accounts_utils::pino_parse_remaining_accounts,
            util_sparse_swap::SparseSwapTickSequenceBuilder,
            util_swap_tick_sequence::SwapTickSequence,
            util_token::{
                pino_calculate_transfer_fee_excluded_amount,
                pino_calculate_transfer_fee_included_amount, pino_transfer_from_owner_to_vault_v2,
                pino_transfer_from_vault_to_owner_v2,
            },
        },
        state::whirlpool::{
            oracle::accessor::OracleAccessor, MemoryMappedTick, MemoryMappedWhirlpool, TickArray,
            TickUpdate,
        },
        utils::{
            account_info_iter::AccountIterator,
            account_load::load_account_mut,
            verify::{verify_address, verify_whirlpool_program_address_seeds},
        },
        Result,
    },
    state::AdaptiveFeeInfo,
};
use pinocchio::account_info::AccountInfo;
use pinocchio::sysvars::{clock::Clock, Sysvar};

pub fn handler(accounts: &[AccountInfo], data: &[u8]) -> Result<()> {
    // data decode
    use anchor_lang::AnchorDeserialize;
    let data = crate::instruction::SwapV2::try_from_slice(&data[8..])?;

    // account labeling
    let mut iter = AccountIterator::new(accounts);
    let token_program_a_info = iter.next_program_token_or_token_2022()?;
    let token_program_b_info = iter.next_program_token_or_token_2022()?;
    let memo_program_info = iter.next_program_memo()?;
    let token_authority_info = iter.next_signer()?;
    let whirlpool_info = iter.next_mut()?;
    let token_mint_a_info = iter.next()?;
    let token_mint_b_info = iter.next()?;
    let token_owner_account_a_info = iter.next_mut()?;
    let token_vault_a_info = iter.next_mut()?;
    let token_owner_account_b_info = iter.next_mut()?;
    let token_vault_b_info = iter.next_mut()?;
    let tick_array_0_info = iter.next_mut()?;
    let tick_array_1_info = iter.next_mut()?;
    let tick_array_2_info = iter.next_mut()?;
    let oracle_info = iter.next_mut()?;
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
    // - supplemental TickArray accounts
    let remaining_accounts = iter.remaining_accounts();

    // account validation
    // token_program_a_info
    verify_address(token_program_a_info.key(), token_mint_a_info.owner())?;
    // token_program_b_info
    verify_address(token_program_b_info.key(), token_mint_b_info.owner())?;
    // memo_program_info: done
    // token_authority_info: done
    // whirlpool_info
    let mut whirlpool = load_account_mut::<MemoryMappedWhirlpool>(whirlpool_info)?;
    // token_mint_a_info
    verify_address(token_mint_a_info.key(), whirlpool.token_mint_a())?;
    // token_mint_b_info
    verify_address(token_mint_b_info.key(), whirlpool.token_mint_b())?;
    // token_owner_account_a_info: we don't need to verify this account, token program will verify it
    // token_vault_a_info
    verify_address(token_vault_a_info.key(), whirlpool.token_vault_a())?;
    // token_owner_account_b_info: we don't need to verify this account, token program will verify it
    // token_vault_b_info
    verify_address(token_vault_b_info.key(), whirlpool.token_vault_b())?;
    // TODO: tick_array_0_info
    // TODO: tick_array_1_info
    // TODO: tick_array_2_info
    // oracle_info
    verify_whirlpool_program_address_seeds(
        oracle_info.key(),
        &[b"oracle", whirlpool_info.key().as_ref()],
    )?;

    // The beginning of handler core logic

    let clock = Clock::get()?;
    // Update the global reward growth which increases as a function of time.
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    // Process remaining accounts
    let remaining_accounts = pino_parse_remaining_accounts(
        remaining_accounts,
        &data.remaining_accounts_info,
        &[
            AccountsType::TransferHookA,
            AccountsType::TransferHookB,
            AccountsType::SupplementalTickArrays,
        ],
    )?;

    let swap_tick_sequence_builder = SparseSwapTickSequenceBuilder::new(
        tick_array_0_info,
        tick_array_1_info,
        tick_array_2_info,
        &remaining_accounts.supplemental_tick_arrays,
    );
    let mut swap_tick_sequence = swap_tick_sequence_builder.try_build(
        whirlpool_info.key(),
        whirlpool.tick_current_index(),
        whirlpool.tick_spacing(),
        data.a_to_b,
    )?;

    let oracle_accessor = OracleAccessor::new(whirlpool_info.key(), oracle_info)?;
    if !oracle_accessor.is_trade_enabled(timestamp)? {
        return Err(ErrorCode::TradeIsNotEnabled.into());
    }
    let adaptive_fee_info = oracle_accessor.get_adaptive_fee_info()?;

    let swap_update = pino_swap_with_transfer_fee_extension(
        &whirlpool,
        token_mint_a_info,
        token_mint_b_info,
        &mut swap_tick_sequence,
        data.amount,
        data.sqrt_price_limit,
        data.amount_specified_is_input,
        data.a_to_b,
        timestamp,
        &adaptive_fee_info,
    )?;

    if data.amount_specified_is_input {
        let transfer_fee_excluded_output_amount = if data.a_to_b {
            pino_calculate_transfer_fee_excluded_amount(token_mint_b_info, swap_update.amount_b)?
                .amount
        } else {
            pino_calculate_transfer_fee_excluded_amount(token_mint_a_info, swap_update.amount_a)?
                .amount
        };
        if transfer_fee_excluded_output_amount < data.other_amount_threshold {
            return Err(ErrorCode::AmountOutBelowMinimum.into());
        }
    } else {
        let transfer_fee_included_input_amount = if data.a_to_b {
            swap_update.amount_a
        } else {
            swap_update.amount_b
        };
        if transfer_fee_included_input_amount > data.other_amount_threshold {
            return Err(ErrorCode::AmountInAboveMaximum.into());
        }
    }

    oracle_accessor.update_adaptive_fee_variables(&swap_update.next_adaptive_fee_info)?;

    let pre_sqrt_price = whirlpool.sqrt_price();
    let (input_amount, output_amount) = if data.a_to_b {
        (swap_update.amount_a, swap_update.amount_b)
    } else {
        (swap_update.amount_b, swap_update.amount_a)
    };
    let (token_mint_input_info, token_mint_output_info) = if data.a_to_b {
        (token_mint_a_info, token_mint_b_info)
    } else {
        (token_mint_b_info, token_mint_a_info)
    };
    let input_transfer_fee =
        pino_calculate_transfer_fee_excluded_amount(token_mint_input_info, input_amount)?
            .transfer_fee;
    let output_transfer_fee =
        pino_calculate_transfer_fee_excluded_amount(token_mint_output_info, output_amount)?
            .transfer_fee;
    let (lp_fee, protocol_fee) = (swap_update.lp_fee, swap_update.next_protocol_fee);

    pino_update_and_swap_whirlpool_v2(
        &mut whirlpool,
        whirlpool_info,
        token_authority_info,
        token_mint_a_info,
        token_mint_b_info,
        token_owner_account_a_info,
        token_owner_account_b_info,
        token_vault_a_info,
        token_vault_b_info,
        &remaining_accounts.transfer_hook_a,
        &remaining_accounts.transfer_hook_b,
        token_program_a_info,
        token_program_b_info,
        memo_program_info,
        &swap_update,
        data.a_to_b,
        timestamp,
        transfer_memo::TRANSFER_MEMO_SWAP.as_bytes(),
    )?;

    Event::Traded {
        whirlpool: whirlpool_info.key(),
        a_to_b: data.a_to_b,
        pre_sqrt_price,
        post_sqrt_price: whirlpool.sqrt_price(),
        input_amount,
        output_amount,
        input_transfer_fee,
        output_transfer_fee,
        lp_fee,
        protocol_fee,
    }
    .emit()?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn pino_swap_with_transfer_fee_extension(
    whirlpool: &MemoryMappedWhirlpool,
    token_mint_a_info: &AccountInfo,
    token_mint_b_info: &AccountInfo,
    swap_tick_sequence: &mut SwapTickSequence,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    timestamp: u64,
    adaptive_fee_info: &Option<AdaptiveFeeInfo>,
) -> Result<Box<PostSwapUpdate>> {
    let (input_token_mint_info, output_token_mint_info) = if a_to_b {
        (token_mint_a_info, token_mint_b_info)
    } else {
        (token_mint_b_info, token_mint_a_info)
    };

    // ExactIn
    if amount_specified_is_input {
        let transfer_fee_included_input = amount;
        let transfer_fee_excluded_input = pino_calculate_transfer_fee_excluded_amount(
            input_token_mint_info,
            transfer_fee_included_input,
        )?
        .amount;

        let swap_update = pino_swap(
            whirlpool,
            swap_tick_sequence,
            transfer_fee_excluded_input,
            sqrt_price_limit,
            amount_specified_is_input,
            a_to_b,
            timestamp,
            adaptive_fee_info,
        )?;

        let (swap_update_amount_input, swap_update_amount_output) = if a_to_b {
            (swap_update.amount_a, swap_update.amount_b)
        } else {
            (swap_update.amount_b, swap_update.amount_a)
        };

        let fullfilled = swap_update_amount_input == transfer_fee_excluded_input;

        let adjusted_transfer_fee_included_input = if fullfilled {
            transfer_fee_included_input
        } else {
            pino_calculate_transfer_fee_included_amount(
                input_token_mint_info,
                swap_update_amount_input,
            )?
            .amount
        };

        let transfer_fee_included_output = swap_update_amount_output;

        let (amount_a, amount_b) = if a_to_b {
            (
                adjusted_transfer_fee_included_input,
                transfer_fee_included_output,
            )
        } else {
            (
                transfer_fee_included_output,
                adjusted_transfer_fee_included_input,
            )
        };
        return Ok(Box::new(PostSwapUpdate {
            amount_a, // updated (transfer fee included)
            amount_b, // updated (transfer fee included)
            lp_fee: swap_update.lp_fee,
            next_liquidity: swap_update.next_liquidity,
            next_tick_index: swap_update.next_tick_index,
            next_sqrt_price: swap_update.next_sqrt_price,
            next_fee_growth_global: swap_update.next_fee_growth_global,
            next_reward_growths_global: swap_update.next_reward_growths_global,
            next_protocol_fee: swap_update.next_protocol_fee,
            next_adaptive_fee_info: swap_update.next_adaptive_fee_info,
        }));
    }

    // ExactOut
    let transfer_fee_excluded_output = amount;
    let transfer_fee_included_output = pino_calculate_transfer_fee_included_amount(
        output_token_mint_info,
        transfer_fee_excluded_output,
    )?
    .amount;

    let swap_update = pino_swap(
        whirlpool,
        swap_tick_sequence,
        transfer_fee_included_output,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        timestamp,
        adaptive_fee_info,
    )?;

    let (swap_update_amount_input, swap_update_amount_output) = if a_to_b {
        (swap_update.amount_a, swap_update.amount_b)
    } else {
        (swap_update.amount_b, swap_update.amount_a)
    };

    let transfer_fee_included_input = pino_calculate_transfer_fee_included_amount(
        input_token_mint_info,
        swap_update_amount_input,
    )?
    .amount;

    let adjusted_transfer_fee_included_output = swap_update_amount_output;

    let (amount_a, amount_b) = if a_to_b {
        (
            transfer_fee_included_input,
            adjusted_transfer_fee_included_output,
        )
    } else {
        (
            adjusted_transfer_fee_included_output,
            transfer_fee_included_input,
        )
    };
    Ok(Box::new(PostSwapUpdate {
        amount_a, // updated (transfer fee included)
        amount_b, // updated (transfer fee included)
        lp_fee: swap_update.lp_fee,
        next_liquidity: swap_update.next_liquidity,
        next_tick_index: swap_update.next_tick_index,
        next_sqrt_price: swap_update.next_sqrt_price,
        next_fee_growth_global: swap_update.next_fee_growth_global,
        next_reward_growths_global: swap_update.next_reward_growths_global,
        next_protocol_fee: swap_update.next_protocol_fee,
        next_adaptive_fee_info: swap_update.next_adaptive_fee_info,
    }))
}

// -------------------------------

// swap_manager

use crate::errors::ErrorCode;
use crate::manager::fee_rate_manager::FeeRateManager;
use crate::math::*;
use crate::state::{NUM_REWARDS, TICK_ARRAY_SIZE};

#[derive(Debug)]
pub struct PostSwapUpdate {
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_fee: u64,
    pub next_liquidity: u128,
    pub next_tick_index: i32,
    pub next_sqrt_price: u128,
    pub next_fee_growth_global: u128,
    pub next_reward_growths_global: [u128; NUM_REWARDS],
    pub next_protocol_fee: u64,
    pub next_adaptive_fee_info: Option<AdaptiveFeeInfo>,
}

struct PartialRewardInfo {
    initialized: bool,
    growth_global: u128,
}

#[allow(clippy::too_many_arguments)]
pub fn pino_swap(
    whirlpool: &MemoryMappedWhirlpool,
    swap_tick_sequence: &mut SwapTickSequence,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    timestamp: u64,
    adaptive_fee_info: &Option<AdaptiveFeeInfo>,
) -> Result<Box<PostSwapUpdate>> {
    let adjusted_sqrt_price_limit = if sqrt_price_limit == NO_EXPLICIT_SQRT_PRICE_LIMIT {
        if a_to_b {
            MIN_SQRT_PRICE_X64
        } else {
            MAX_SQRT_PRICE_X64
        }
    } else {
        sqrt_price_limit
    };

    if !(MIN_SQRT_PRICE_X64..=MAX_SQRT_PRICE_X64).contains(&adjusted_sqrt_price_limit) {
        return Err(ErrorCode::SqrtPriceOutOfBounds.into());
    }

    if a_to_b && adjusted_sqrt_price_limit >= whirlpool.sqrt_price()
        || !a_to_b && adjusted_sqrt_price_limit <= whirlpool.sqrt_price()
    {
        return Err(ErrorCode::InvalidSqrtPriceLimitDirection.into());
    }

    if amount == 0 {
        return Err(ErrorCode::ZeroTradableAmount.into());
    }

    let tick_spacing = whirlpool.tick_spacing();
    let fee_rate = whirlpool.fee_rate();
    let protocol_fee_rate = whirlpool.protocol_fee_rate();
    let next_reward_infos = next_whirlpool_reward_infos(whirlpool, timestamp)?;

    let mut amount_remaining: u64 = amount;
    let mut amount_calculated: u64 = 0;
    let mut curr_sqrt_price = whirlpool.sqrt_price();
    let mut curr_tick_index = whirlpool.tick_current_index();
    let mut curr_liquidity = whirlpool.liquidity();
    let mut curr_protocol_fee: u64 = 0;
    let mut curr_array_index: usize = 0;
    let mut curr_fee_growth_global_input = if a_to_b {
        whirlpool.fee_growth_global_a()
    } else {
        whirlpool.fee_growth_global_b()
    };
    let mut fee_sum: u64 = 0;

    let mut fee_rate_manager = FeeRateManager::new(
        a_to_b,
        whirlpool.tick_current_index(), // note:  -1 shift is acceptable
        timestamp,
        fee_rate,
        adaptive_fee_info,
    )?;

    while amount_remaining > 0 && adjusted_sqrt_price_limit != curr_sqrt_price {
        let (next_array_index, next_tick_index) = swap_tick_sequence
            .get_next_initialized_tick_index(
                curr_tick_index,
                tick_spacing,
                a_to_b,
                curr_array_index,
            )?;

        let (next_tick_sqrt_price, sqrt_price_target) =
            get_next_sqrt_prices(next_tick_index, adjusted_sqrt_price_limit, a_to_b);

        loop {
            fee_rate_manager.update_volatility_accumulator()?;

            let total_fee_rate = fee_rate_manager.get_total_fee_rate();
            let (bounded_sqrt_price_target, adaptive_fee_update_skipped) =
                fee_rate_manager.get_bounded_sqrt_price_target(sqrt_price_target, curr_liquidity);

            let swap_computation = compute_swap(
                amount_remaining,
                total_fee_rate,
                curr_liquidity,
                curr_sqrt_price,
                bounded_sqrt_price_target,
                amount_specified_is_input,
                a_to_b,
            )?;

            if amount_specified_is_input {
                amount_remaining = amount_remaining
                    .checked_sub(swap_computation.amount_in)
                    .ok_or(ErrorCode::AmountRemainingOverflow)?;
                amount_remaining = amount_remaining
                    .checked_sub(swap_computation.fee_amount)
                    .ok_or(ErrorCode::AmountRemainingOverflow)?;

                amount_calculated = amount_calculated
                    .checked_add(swap_computation.amount_out)
                    .ok_or(ErrorCode::AmountCalcOverflow)?;
            } else {
                amount_remaining = amount_remaining
                    .checked_sub(swap_computation.amount_out)
                    .ok_or(ErrorCode::AmountRemainingOverflow)?;

                amount_calculated = amount_calculated
                    .checked_add(swap_computation.amount_in)
                    .ok_or(ErrorCode::AmountCalcOverflow)?;
                amount_calculated = amount_calculated
                    .checked_add(swap_computation.fee_amount)
                    .ok_or(ErrorCode::AmountCalcOverflow)?;
            }

            fee_sum = fee_sum
                .checked_add(swap_computation.fee_amount)
                .ok_or(ErrorCode::AmountCalcOverflow)?;

            let (next_protocol_fee, next_fee_growth_global_input) = calculate_fees(
                swap_computation.fee_amount,
                protocol_fee_rate,
                curr_liquidity,
                curr_protocol_fee,
                curr_fee_growth_global_input,
            );
            curr_protocol_fee = next_protocol_fee;
            curr_fee_growth_global_input = next_fee_growth_global_input;

            if swap_computation.next_price == next_tick_sqrt_price {
                let (next_tick, next_tick_initialized) = swap_tick_sequence
                    .get_tick(next_array_index, next_tick_index, tick_spacing)
                    .map_or_else(|_| (None, false), |tick| (Some(tick), tick.initialized()));

                if next_tick_initialized {
                    let (fee_growth_global_a, fee_growth_global_b) = if a_to_b {
                        (
                            curr_fee_growth_global_input,
                            whirlpool.fee_growth_global_b(),
                        )
                    } else {
                        (
                            whirlpool.fee_growth_global_a(),
                            curr_fee_growth_global_input,
                        )
                    };

                    let (update, next_liquidity) = calculate_update(
                        next_tick.unwrap(),
                        a_to_b,
                        &curr_liquidity,
                        &fee_growth_global_a,
                        &fee_growth_global_b,
                        &next_reward_infos,
                    )?;

                    curr_liquidity = next_liquidity;
                    swap_tick_sequence.update_tick(
                        next_array_index,
                        next_tick_index,
                        tick_spacing,
                        &update,
                    )?;
                }

                let tick_offset = swap_tick_sequence.get_tick_offset(
                    next_array_index,
                    next_tick_index,
                    tick_spacing,
                )?;

                // Increment to the next tick array if either condition is true:
                //  - Price is moving left and the current tick is the start of the tick array
                //  - Price is moving right and the current tick is the end of the tick array
                curr_array_index = if (a_to_b && tick_offset == 0)
                    || (!a_to_b && tick_offset == TICK_ARRAY_SIZE as isize - 1)
                {
                    next_array_index + 1
                } else {
                    next_array_index
                };

                // The get_init_tick search is inclusive of the current index in an a_to_b trade.
                // We therefore have to shift the index by 1 to advance to the next init tick to the left.
                curr_tick_index = if a_to_b {
                    next_tick_index - 1
                } else {
                    next_tick_index
                };
            } else if swap_computation.next_price != curr_sqrt_price {
                curr_tick_index = tick_index_from_sqrt_price(&swap_computation.next_price);
            }

            curr_sqrt_price = swap_computation.next_price;

            if !adaptive_fee_update_skipped {
                // Note: curr_sqrt_price != bounded_sqrt_price_target implies the end of the loop.
                //       tick_group_index counter exists only in the memory of the FeeRateManager,
                //       so even if it is incremented one extra time at the end of the loop, there is no real harm.
                fee_rate_manager.advance_tick_group();
            } else {
                fee_rate_manager.advance_tick_group_after_skip(
                    curr_sqrt_price,
                    next_tick_sqrt_price,
                    next_tick_index,
                )?;
            }

            // do while loop
            if amount_remaining == 0 || curr_sqrt_price == sqrt_price_target {
                break;
            }
        }
    }

    // Reject partial fills if no explicit sqrt price limit is set and trade is exact out mode
    if amount_remaining > 0
        && !amount_specified_is_input
        && sqrt_price_limit == NO_EXPLICIT_SQRT_PRICE_LIMIT
    {
        return Err(ErrorCode::PartialFillError.into());
    }

    let (amount_a, amount_b) = if a_to_b == amount_specified_is_input {
        (amount - amount_remaining, amount_calculated)
    } else {
        (amount_calculated, amount - amount_remaining)
    };

    fee_rate_manager.update_major_swap_timestamp(
        timestamp,
        whirlpool.sqrt_price(),
        curr_sqrt_price,
    )?;

    Ok(Box::new(PostSwapUpdate {
        amount_a,
        amount_b,
        lp_fee: fee_sum - curr_protocol_fee,
        next_liquidity: curr_liquidity,
        next_tick_index: curr_tick_index,
        next_sqrt_price: curr_sqrt_price,
        next_fee_growth_global: curr_fee_growth_global_input,
        next_reward_growths_global: [
            next_reward_infos[0].growth_global,
            next_reward_infos[1].growth_global,
            next_reward_infos[2].growth_global,
        ],
        next_protocol_fee: curr_protocol_fee,
        next_adaptive_fee_info: fee_rate_manager.get_next_adaptive_fee_info(),
    }))
}

fn calculate_fees(
    fee_amount: u64,
    protocol_fee_rate: u16,
    curr_liquidity: u128,
    curr_protocol_fee: u64,
    curr_fee_growth_global_input: u128,
) -> (u64, u128) {
    let mut next_protocol_fee = curr_protocol_fee;
    let mut next_fee_growth_global_input = curr_fee_growth_global_input;
    let mut global_fee = fee_amount;
    if protocol_fee_rate > 0 {
        let delta = calculate_protocol_fee(global_fee, protocol_fee_rate);
        global_fee -= delta;
        next_protocol_fee = next_protocol_fee.wrapping_add(delta);
    }

    if curr_liquidity > 0 {
        next_fee_growth_global_input = next_fee_growth_global_input
            .wrapping_add(((global_fee as u128) << Q64_RESOLUTION) / curr_liquidity);
    }
    (next_protocol_fee, next_fee_growth_global_input)
}

fn calculate_protocol_fee(global_fee: u64, protocol_fee_rate: u16) -> u64 {
    ((global_fee as u128) * (protocol_fee_rate as u128) / PROTOCOL_FEE_RATE_MUL_VALUE)
        .try_into()
        .unwrap()
}

fn calculate_update(
    tick: &MemoryMappedTick,
    a_to_b: bool,
    liquidity: &u128,
    fee_growth_global_a: &u128,
    fee_growth_global_b: &u128,
    reward_infos: &[PartialRewardInfo; NUM_REWARDS],
) -> Result<(TickUpdate, u128)> {
    // Use updated fee_growth for crossing tick
    // Use -liquidity_net if going left, +liquidity_net going right
    let signed_liquidity_net = if a_to_b {
        -tick.liquidity_net()
    } else {
        tick.liquidity_net()
    };

    let update =
        next_tick_cross_update(tick, fee_growth_global_a, fee_growth_global_b, reward_infos)?;

    // Update the global liquidity to reflect the new current tick
    let next_liquidity = add_liquidity_delta(*liquidity, signed_liquidity_net)?;

    Ok((update, next_liquidity))
}

fn get_next_sqrt_prices(
    next_tick_index: i32,
    sqrt_price_limit: u128,
    a_to_b: bool,
) -> (u128, u128) {
    let next_tick_price = sqrt_price_from_tick_index(next_tick_index);
    let next_sqrt_price_limit = if a_to_b {
        sqrt_price_limit.max(next_tick_price)
    } else {
        sqrt_price_limit.min(next_tick_price)
    };
    (next_tick_price, next_sqrt_price_limit)
}

// ------------------------------------------------

// tick_manager

pub fn next_tick_cross_update(
    tick: &MemoryMappedTick,
    fee_growth_global_a: &u128,
    fee_growth_global_b: &u128,
    reward_infos: &[PartialRewardInfo; NUM_REWARDS],
) -> Result<TickUpdate> {
    let mut update = TickUpdate::from(tick);

    update.fee_growth_outside_a = fee_growth_global_a.wrapping_sub(tick.fee_growth_outside_a());
    update.fee_growth_outside_b = fee_growth_global_b.wrapping_sub(tick.fee_growth_outside_b());

    let tick_reward_growths_outside = tick.reward_growths_outside();
    for (i, reward_info) in reward_infos.iter().enumerate() {
        if !reward_info.initialized {
            continue;
        }

        update.reward_growths_outside[i] = reward_info
            .growth_global
            .wrapping_sub(tick_reward_growths_outside[i]);
    }
    Ok(update)
}

// ------------------------------------------------

// whirlpool_manager

// Calculates the next global reward growth variables based on the given timestamp.
// The provided timestamp must be greater than or equal to the last updated timestamp.
pub fn next_whirlpool_reward_infos(
    whirlpool: &MemoryMappedWhirlpool,
    next_timestamp: u64,
) -> Result<[PartialRewardInfo; NUM_REWARDS]> {
    let curr_timestamp = whirlpool.reward_last_updated_timestamp();
    if next_timestamp < curr_timestamp {
        return Err(ErrorCode::InvalidTimestamp.into());
    }

    let whirlpool_reward_infos = whirlpool.reward_infos();
    let mut next_reward_infos = [
        PartialRewardInfo {
            initialized: whirlpool_reward_infos[0].initialized(),
            growth_global: whirlpool_reward_infos[0].growth_global_x64(),
        },
        PartialRewardInfo {
            initialized: whirlpool_reward_infos[1].initialized(),
            growth_global: whirlpool_reward_infos[1].growth_global_x64(),
        },
        PartialRewardInfo {
            initialized: whirlpool_reward_infos[2].initialized(),
            growth_global: whirlpool_reward_infos[2].growth_global_x64(),
        },
    ];

    // No-op if no liquidity or no change in timestamp
    if whirlpool.liquidity() == 0 || next_timestamp == curr_timestamp {
        return Ok(next_reward_infos);
    }

    // Calculate new global reward growth
    let time_delta = u128::from(next_timestamp - curr_timestamp);
    for (i, reward_info) in whirlpool_reward_infos.iter().enumerate() {
        if !reward_info.initialized() {
            continue;
        }

        // Calculate the new reward growth delta.
        // If the calculation overflows, set the delta value to zero.
        // This will halt reward distributions for this reward.
        let reward_growth_delta = checked_mul_div(
            time_delta,
            reward_info.emissions_per_second_x64(),
            whirlpool.liquidity(),
        )
        .unwrap_or(0);

        // Add the reward growth delta to the global reward growth.
        next_reward_infos[i].growth_global = next_reward_infos[i]
            .growth_global
            .wrapping_add(reward_growth_delta);
    }

    Ok(next_reward_infos)
}

// ----------------------------------------

// swap utils

#[allow(clippy::too_many_arguments)]
pub fn pino_update_and_swap_whirlpool_v2(
    whirlpool: &mut MemoryMappedWhirlpool,
    whirlpool_info: &AccountInfo,
    token_authority_info: &AccountInfo,
    token_mint_a_info: &AccountInfo,
    token_mint_b_info: &AccountInfo,
    token_owner_account_a_info: &AccountInfo,
    token_owner_account_b_info: &AccountInfo,
    token_vault_a_info: &AccountInfo,
    token_vault_b_info: &AccountInfo,
    transfer_hook_a_infos: &Option<Vec<&AccountInfo>>,
    transfer_hook_b_infos: &Option<Vec<&AccountInfo>>,
    token_program_a_info: &AccountInfo,
    token_program_b_info: &AccountInfo,
    memo_program_info: &AccountInfo,
    swap_update: &PostSwapUpdate,
    is_token_fee_in_a: bool,
    reward_last_updated_timestamp: u64,
    memo: &[u8],
) -> Result<()> {
    whirlpool.update_after_swap(
        &swap_update.next_liquidity,
        swap_update.next_tick_index,
        &swap_update.next_sqrt_price,
        &swap_update.next_fee_growth_global,
        &swap_update.next_reward_growths_global,
        swap_update.next_protocol_fee,
        is_token_fee_in_a,
        reward_last_updated_timestamp,
    );

    pino_perform_swap_v2(
        whirlpool,
        whirlpool_info,
        token_authority_info,
        token_mint_a_info,
        token_mint_b_info,
        token_owner_account_a_info,
        token_owner_account_b_info,
        token_vault_a_info,
        token_vault_b_info,
        transfer_hook_a_infos,
        transfer_hook_b_infos,
        token_program_a_info,
        token_program_b_info,
        memo_program_info,
        swap_update.amount_a,
        swap_update.amount_b,
        is_token_fee_in_a,
        memo,
    )
}

#[allow(clippy::too_many_arguments)]
fn pino_perform_swap_v2(
    whirlpool: &MemoryMappedWhirlpool,
    whirlpool_info: &AccountInfo,
    token_authority_info: &AccountInfo,
    token_mint_a_info: &AccountInfo,
    token_mint_b_info: &AccountInfo,
    token_owner_account_a_info: &AccountInfo,
    token_owner_account_b_info: &AccountInfo,
    token_vault_a_info: &AccountInfo,
    token_vault_b_info: &AccountInfo,
    transfer_hook_a_infos: &Option<Vec<&AccountInfo>>,
    transfer_hook_b_infos: &Option<Vec<&AccountInfo>>,
    token_program_a_info: &AccountInfo,
    token_program_b_info: &AccountInfo,
    memo_program_info: &AccountInfo,
    amount_a: u64,
    amount_b: u64,
    a_to_b: bool,
    memo: &[u8],
) -> Result<()> {
    // Transfer from owner to vault
    let deposit_token_program_info;
    let deposit_mint_info;
    let deposit_account_owner_info;
    let deposit_account_vault_info;
    let deposit_transfer_hook_infos;
    let deposit_amount;

    // Transfer from vault to owner
    let withdrawal_token_program_info;
    let withdrawal_mint_info;
    let withdrawal_account_owner_info;
    let withdrawal_account_vault_info;
    let withdrawal_transfer_hook_infos;
    let withdrawal_amount;

    if a_to_b {
        deposit_token_program_info = token_program_a_info;
        deposit_mint_info = token_mint_a_info;
        deposit_account_owner_info = token_owner_account_a_info;
        deposit_account_vault_info = token_vault_a_info;
        deposit_transfer_hook_infos = transfer_hook_a_infos;
        deposit_amount = amount_a;

        withdrawal_token_program_info = token_program_b_info;
        withdrawal_mint_info = token_mint_b_info;
        withdrawal_account_owner_info = token_owner_account_b_info;
        withdrawal_account_vault_info = token_vault_b_info;
        withdrawal_transfer_hook_infos = transfer_hook_b_infos;
        withdrawal_amount = amount_b;
    } else {
        deposit_token_program_info = token_program_b_info;
        deposit_mint_info = token_mint_b_info;
        deposit_account_owner_info = token_owner_account_b_info;
        deposit_account_vault_info = token_vault_b_info;
        deposit_transfer_hook_infos = transfer_hook_b_infos;
        deposit_amount = amount_b;

        withdrawal_token_program_info = token_program_a_info;
        withdrawal_mint_info = token_mint_a_info;
        withdrawal_account_owner_info = token_owner_account_a_info;
        withdrawal_account_vault_info = token_vault_a_info;
        withdrawal_transfer_hook_infos = transfer_hook_a_infos;
        withdrawal_amount = amount_a;
    }

    pino_transfer_from_owner_to_vault_v2(
        token_authority_info,
        deposit_mint_info,
        deposit_account_owner_info,
        deposit_account_vault_info,
        deposit_token_program_info,
        memo_program_info,
        deposit_transfer_hook_infos,
        deposit_amount,
    )?;

    pino_transfer_from_vault_to_owner_v2(
        whirlpool,
        whirlpool_info,
        withdrawal_mint_info,
        withdrawal_account_vault_info,
        withdrawal_account_owner_info,
        withdrawal_token_program_info,
        memo_program_info,
        withdrawal_transfer_hook_infos,
        withdrawal_amount,
        memo,
    )?;

    Ok(())
}
