use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ErrorCode,
    state::*,
    util::{to_timestamp_u64, verify_supported_token_mint},
};

#[derive(Accounts)]
pub struct InitializePoolWithAdaptiveFee<'info> {
    pub whirlpools_config: Box<Account<'info, WhirlpoolsConfig>>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    #[account(seeds = [b"token_badge", whirlpools_config.key().as_ref(), token_mint_a.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_a: UncheckedAccount<'info>,
    #[account(seeds = [b"token_badge", whirlpools_config.key().as_ref(), token_mint_b.key().as_ref()], bump)]
    /// CHECK: checked in the handler
    pub token_badge_b: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(constraint = adaptive_fee_tier.is_valid_initialize_pool_authority(initialize_pool_authority.key()))]
    pub initialize_pool_authority: Signer<'info>,

    #[account(init,
      seeds = [
        b"whirlpool".as_ref(),
        whirlpools_config.key().as_ref(),
        token_mint_a.key().as_ref(),
        token_mint_b.key().as_ref(),
        adaptive_fee_tier.fee_tier_index.to_le_bytes().as_ref()
      ],
      bump,
      payer = funder,
      space = Whirlpool::LEN)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(
        init,
        payer = funder,
        seeds = [b"oracle", whirlpool.key().as_ref()],
        bump,
        space = Oracle::LEN)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_a,
      token::mint = token_mint_a,
      token::authority = whirlpool)]
    pub token_vault_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init,
      payer = funder,
      token::token_program = token_program_b,
      token::mint = token_mint_b,
      token::authority = whirlpool)]
    pub token_vault_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(has_one = whirlpools_config)]
    pub adaptive_fee_tier: Account<'info, AdaptiveFeeTier>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePoolWithAdaptiveFee>,
    initial_sqrt_price: u128,
    trade_enable_timestamp: Option<u64>,
) -> Result<()> {
    let token_mint_a = ctx.accounts.token_mint_a.key();
    let token_mint_b = ctx.accounts.token_mint_b.key();

    let whirlpool = &mut ctx.accounts.whirlpool;
    let whirlpools_config = &ctx.accounts.whirlpools_config;

    let fee_tier_index = ctx.accounts.adaptive_fee_tier.fee_tier_index;

    let tick_spacing = ctx.accounts.adaptive_fee_tier.tick_spacing;

    let default_fee_rate = ctx.accounts.adaptive_fee_tier.default_base_fee_rate;

    // ignore the bump passed and use one Anchor derived
    let bump = ctx.bumps.whirlpool;

    // Don't allow creating a pool with unsupported token mints
    verify_supported_token_mint(
        &ctx.accounts.token_mint_a,
        whirlpools_config.key(),
        &ctx.accounts.token_badge_a,
    )?;
    verify_supported_token_mint(
        &ctx.accounts.token_mint_b,
        whirlpools_config.key(),
        &ctx.accounts.token_badge_b,
    )?;

    // Don't allow setting trade_enable_timestamp for permission-less adaptive fee tier
    let clock = Clock::get()?;
    let timestamp = to_timestamp_u64(clock.unix_timestamp)?;
    if !is_valid_trade_enable_timestamp(
        trade_enable_timestamp,
        timestamp,
        ctx.accounts.adaptive_fee_tier.is_permissioned(),
    ) {
        return Err(ErrorCode::InvalidTradeEnableTimestamp.into());
    }

    whirlpool.initialize(
        whirlpools_config,
        fee_tier_index,
        bump,
        tick_spacing,
        initial_sqrt_price,
        default_fee_rate,
        token_mint_a,
        ctx.accounts.token_vault_a.key(),
        token_mint_b,
        ctx.accounts.token_vault_b.key(),
    )?;

    let mut oracle = ctx.accounts.oracle.load_init()?;
    oracle.initialize(
        ctx.accounts.whirlpool.key(),
        trade_enable_timestamp,
        tick_spacing,
        ctx.accounts.adaptive_fee_tier.filter_period,
        ctx.accounts.adaptive_fee_tier.decay_period,
        ctx.accounts.adaptive_fee_tier.reduction_factor,
        ctx.accounts.adaptive_fee_tier.adaptive_fee_control_factor,
        ctx.accounts.adaptive_fee_tier.max_volatility_accumulator,
        ctx.accounts.adaptive_fee_tier.tick_group_size,
        ctx.accounts.adaptive_fee_tier.major_swap_threshold_ticks,
    )
}

fn is_valid_trade_enable_timestamp(
    trade_enable_timestamp: Option<u64>,
    current_timestamp: u64,
    is_permissioned_adaptive_fee_tier: bool,
) -> bool {
    match trade_enable_timestamp {
        None => true,
        Some(trade_enable_timestamp) => {
            if !is_permissioned_adaptive_fee_tier {
                // If the adaptive fee tier is permission-less, trade_enable_timestamp is not allowed
                false
            } else if trade_enable_timestamp > current_timestamp {
                // reject far future timestamp
                trade_enable_timestamp - current_timestamp <= MAX_TRADE_ENABLE_TIMESTAMP_DELTA
            } else {
                // reject too old timestamp (> 30 seconds)
                // if pool initialize authority want to enable trading immediately, trade_enable_timestamp should be set to None
                current_timestamp - trade_enable_timestamp <= 30
            }
        }
    }
}

#[cfg(test)]
mod is_valid_trade_enable_timestamp_unit_tests {
    use super::*;

    #[test]
    fn trade_enable_timestamp_is_none() {
        // should always return true

        assert!(is_valid_trade_enable_timestamp(None, 0, true));
        assert!(is_valid_trade_enable_timestamp(None, 0, false));
        assert!(is_valid_trade_enable_timestamp(None, u16::MAX as u64, true));
        assert!(is_valid_trade_enable_timestamp(
            None,
            u16::MAX as u64,
            false
        ));
        assert!(is_valid_trade_enable_timestamp(None, u32::MAX as u64, true));
        assert!(is_valid_trade_enable_timestamp(
            None,
            u32::MAX as u64,
            false
        ));
        assert!(is_valid_trade_enable_timestamp(None, u64::MAX, true));
        assert!(is_valid_trade_enable_timestamp(None, u64::MAX, false));
    }

    #[test]
    fn trade_enable_timestamp_is_some_but_permission_less() {
        let current_timestamp = u32::MAX as u64;

        assert!(!is_valid_trade_enable_timestamp(
            Some(0),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp - 60),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp - 31),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp - 30),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp + 60),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp + MAX_TRADE_ENABLE_TIMESTAMP_DELTA),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp + MAX_TRADE_ENABLE_TIMESTAMP_DELTA + 1),
            current_timestamp,
            false
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(u64::MAX),
            current_timestamp,
            false
        ));
    }

    #[test]
    fn trade_enable_timestamp_is_some_but_too_far_future() {
        let current_timestamp = u32::MAX as u64;

        // should be valid
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp),
            current_timestamp,
            true
        ));
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp + 1),
            current_timestamp,
            true
        ));
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp + MAX_TRADE_ENABLE_TIMESTAMP_DELTA - 1),
            current_timestamp,
            true
        ));
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp + MAX_TRADE_ENABLE_TIMESTAMP_DELTA),
            current_timestamp,
            true
        ));

        // should be invalid
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp + MAX_TRADE_ENABLE_TIMESTAMP_DELTA + 1),
            current_timestamp,
            true
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp + MAX_TRADE_ENABLE_TIMESTAMP_DELTA + 2),
            current_timestamp,
            true
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(u64::MAX),
            current_timestamp,
            true
        ));
    }

    #[test]
    fn trade_enable_timestamp_is_some_but_too_old() {
        let current_timestamp = u32::MAX as u64;

        // should be valid
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp),
            current_timestamp,
            true
        ));
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp - 1),
            current_timestamp,
            true
        ));
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp - 29),
            current_timestamp,
            true
        ));
        assert!(is_valid_trade_enable_timestamp(
            Some(current_timestamp - 30),
            current_timestamp,
            true
        ));

        // should be invalid
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp - 30 - 1),
            current_timestamp,
            true
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(current_timestamp - 30 - 2),
            current_timestamp,
            true
        ));
        assert!(!is_valid_trade_enable_timestamp(
            Some(0),
            current_timestamp,
            true
        ));
    }
}
