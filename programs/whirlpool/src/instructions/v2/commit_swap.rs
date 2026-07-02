use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::transfer_memo,
    events::*,
    manager::swap_manager::*,
    state::*,
    util::{
        calculate_transfer_fee_excluded_amount, parse_remaining_accounts, to_timestamp_u64,
        v2::update_and_swap_whirlpool_v2, AccountsType, RemainingAccountsInfo,
        SparseSwapTickSequenceBuilder,
    },
};

#[derive(Accounts)]
pub struct CommitSwapV2<'info> {
    #[account(mut)]
    pub prepared_swap: AccountLoader<'info, PreparedSwap>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,

    pub token_authority: Signer<'info>,

    #[account(mut)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(address = whirlpool.token_mint_a)]
    pub token_mint_a: InterfaceAccount<'info, Mint>,
    #[account(address = whirlpool.token_mint_b)]
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(mut, constraint = token_owner_account_a.mint == whirlpool.token_mint_a)]
    pub token_owner_account_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_a)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, constraint = token_owner_account_b.mint == whirlpool.token_mint_b)]
    pub token_owner_account_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = whirlpool.token_vault_b)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_0: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_1: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: checked in the handler
    pub tick_array_2: UncheckedAccount<'info>,

    #[account(mut, seeds = [b"oracle", whirlpool.key().as_ref()], bump)]
    /// CHECK: Oracle is currently unused and will be enabled on subsequent updates
    pub oracle: UncheckedAccount<'info>,
    // remaining accounts
    // - accounts for transfer hook program of token_mint_a
    // - accounts for transfer hook program of token_mint_b
    // - supplemental TickArray accounts
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CommitSwapV2<'info>>,
    amount: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
    // Note: there is no other_amount_threshold parameter.
    // The caller should evaluate the return data from the prepare_swap_v2 instruction
    // and only call commit_swap_v2 if the result is acceptable.
) -> Result<()> {
    let clock = Clock::get()?;

    let mut prepared_swap = ctx.accounts.prepared_swap.load_mut()?;
    prepared_swap.validate_for_commit(
        ctx.accounts.token_authority.key(),
        ctx.accounts.whirlpool.key(),
        ctx.accounts.whirlpool.state_sequence(),
        amount,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
        clock.slot,
    )?;

    let whirlpool = &mut ctx.accounts.whirlpool;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        ctx.remaining_accounts,
        &remaining_accounts_info,
        &[
            AccountsType::TransferHookA,
            AccountsType::TransferHookB,
            AccountsType::SupplementalTickArrays,
        ],
    )?;

    let swap_tick_sequence_builder = SparseSwapTickSequenceBuilder::new(
        vec![
            ctx.accounts.tick_array_0.to_account_info(),
            ctx.accounts.tick_array_1.to_account_info(),
            ctx.accounts.tick_array_2.to_account_info(),
        ],
        remaining_accounts.supplemental_tick_arrays,
    );
    let mut swap_tick_sequence = swap_tick_sequence_builder.try_build(whirlpool, a_to_b)?;

    let oracle_accessor = OracleAccessor::new(whirlpool, ctx.accounts.oracle.to_account_info())?;

    // apply pending tick updates...
    let tick_spacing = whirlpool.tick_spacing;
    for pending_tick_update in &prepared_swap.pending_updates.pending_tick_updates
        [0..prepared_swap.pending_updates.pending_tick_updates_len as usize]
    {
        let array_index = pending_tick_update.array_index as usize;
        let tick_index = pending_tick_update.tick_index;

        // The following logic reproduces the behavior of the next_tick_cross_update function.
        // However, there are a couple of important differences to keep in mind:
        // - fee_growth_outside already stores the post-update value,
        //   so it can be applied via a simple assignment.
        // - reward_info.growth_global_x64 must use the value after the update has been applied.
        //   Therefore, the value from pending_whirlpool_update should be used.

        let tick = swap_tick_sequence.get_tick(array_index, tick_index, tick_spacing)?;
        let mut update = TickUpdate::from(tick);

        update.fee_growth_outside_a = pending_tick_update.next_fee_growth_outside_a;
        update.fee_growth_outside_b = pending_tick_update.next_fee_growth_outside_b;

        for (i, reward_info) in whirlpool.reward_infos.iter().enumerate() {
            if !reward_info.initialized() {
                continue;
            }
            update.reward_growths_outside[i] = prepared_swap
                .pending_updates
                .pending_post_swap_update
                .next_reward_growth_global[i]
                .wrapping_sub(update.reward_growths_outside[i]);
        }

        swap_tick_sequence.update_tick(array_index, tick_index, tick_spacing, &update)?;
    }

    // restore swap_update...
    let mut next_reward_infos = whirlpool.reward_infos;
    for i in 0..NUM_REWARDS {
        next_reward_infos[i].growth_global_x64 = prepared_swap
            .pending_updates
            .pending_post_swap_update
            .next_reward_growth_global[i];
    }

    let next_adaptive_fee_info = if prepared_swap
        .pending_updates
        .pending_post_swap_update
        .next_adaptive_fee_variables_is_some
    {
        if let Some(mut next_adaptive_fee_info) = oracle_accessor.get_adaptive_fee_info()? {
            next_adaptive_fee_info.variables = prepared_swap
                .pending_updates
                .pending_post_swap_update
                .next_adaptive_fee_variables;
            Some(next_adaptive_fee_info)
        } else {
            unreachable!("next_adaptive_fee_variables_is_some == true means that this Whirlpool has the initialized Oracle account");
        }
    } else {
        None
    };

    let swap_update = PostSwapUpdate {
        amount_a: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .amount_a,
        amount_b: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .amount_b,
        lp_fee: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .lp_fee,
        next_liquidity: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .next_liquidity,
        next_tick_index: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .next_tick_index,
        next_sqrt_price: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .next_sqrt_price,
        next_fee_growth_global: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .next_fee_growth_global,
        next_reward_infos,
        next_protocol_fee: prepared_swap
            .pending_updates
            .pending_post_swap_update
            .next_protocol_fee,
        next_adaptive_fee_info,
    };

    // apply pending oracle update
    oracle_accessor.update_adaptive_fee_variables(&swap_update.next_adaptive_fee_info)?;

    let pre_sqrt_price = whirlpool.sqrt_price;
    let (input_amount, output_amount) = if a_to_b {
        (swap_update.amount_a, swap_update.amount_b)
    } else {
        (swap_update.amount_b, swap_update.amount_a)
    };
    let (token_mint_input, token_mint_output) = if a_to_b {
        (&ctx.accounts.token_mint_a, &ctx.accounts.token_mint_b)
    } else {
        (&ctx.accounts.token_mint_b, &ctx.accounts.token_mint_a)
    };
    let input_transfer_fee =
        calculate_transfer_fee_excluded_amount(token_mint_input, input_amount)?.transfer_fee;
    let output_transfer_fee =
        calculate_transfer_fee_excluded_amount(token_mint_output, output_amount)?.transfer_fee;
    let (lp_fee, protocol_fee) = (swap_update.lp_fee, swap_update.next_protocol_fee);

    // apply pending whirlpool update
    update_and_swap_whirlpool_v2(
        whirlpool,
        &ctx.accounts.token_authority,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.token_owner_account_a,
        &ctx.accounts.token_owner_account_b,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_vault_b,
        &remaining_accounts.transfer_hook_a,
        &remaining_accounts.transfer_hook_b,
        &ctx.accounts.token_program_a,
        &ctx.accounts.token_program_b,
        &ctx.accounts.memo_program,
        &swap_update,
        a_to_b,
        timestamp,
        transfer_memo::TRANSFER_MEMO_SWAP.as_bytes(),
    )?;

    prepared_swap.set_state(PreparedSwapState::Committed);

    emit!(Traded {
        whirlpool: whirlpool.key(),
        a_to_b,
        pre_sqrt_price,
        post_sqrt_price: whirlpool.sqrt_price,
        input_amount,
        output_amount,
        input_transfer_fee,
        output_transfer_fee,
        lp_fee,
        protocol_fee,
    });

    Ok(())
}
