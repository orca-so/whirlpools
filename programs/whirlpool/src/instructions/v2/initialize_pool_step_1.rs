use crate::errors::ErrorCode;
use crate::{
    events::*,
    state::*,
    util::{
        initialize_vault_token_account, initialize_vault_token_account_optimized,
        is_non_transferable_position_required, verify_supported_token_mint,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::ID as SPL_TOKEN_2022_ID;
use anchor_spl::token_interface::{Mint, TokenInterface};

#[derive(Accounts)]
#[instruction(tick_spacing: u16)]
pub struct InitializePoolV2Step1<'info> {
    /// CHECK: checked in the handler
    pub whirlpools_config: UncheckedAccount<'info>,

    pub token_mint_a: InterfaceAccount<'info, Mint>,
    pub token_mint_b: InterfaceAccount<'info, Mint>,

    /// CHECK: checked in the handler
    pub token_badge_a: UncheckedAccount<'info>,
    /// CHECK: checked in the handler
    pub token_badge_b: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        init,
        seeds = [
            b"whirlpool".as_ref(),
            whirlpools_config.key().as_ref(),
            token_mint_a.key().as_ref(),
            token_mint_b.key().as_ref(),
            tick_spacing.to_le_bytes().as_ref()
        ],
        bump,
        payer = funder,
        space = Whirlpool::LEN)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    /// CHECK: initialized in the handler
    #[account(mut)]
    pub token_vault_a: Signer<'info>,

    /// CHECK: initialized in the handler
    #[account(mut)]
    pub token_vault_b: Signer<'info>,

    #[account(has_one = whirlpools_config, constraint = fee_tier.tick_spacing == tick_spacing)]
    pub fee_tier: Account<'info, FeeTier>,

    #[account(address = *token_mint_a.to_account_info().owner)]
    pub token_program_a: Interface<'info, TokenInterface>,
    #[account(address = *token_mint_b.to_account_info().owner)]
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializePoolV2Step1>,
    tick_spacing: u16,
    initial_sqrt_price: u128,
    _step: u8,
) -> Result<()> {
    let token_mint_a = ctx.accounts.token_mint_a.key();
    let token_mint_b = ctx.accounts.token_mint_b.key();

    let whirlpool = &mut ctx.accounts.whirlpool;
    let whirlpools_config = &ctx.accounts.whirlpools_config;

    let fee_tier_index = tick_spacing;

    let default_fee_rate = ctx.accounts.fee_tier.default_fee_rate;

    // ignore the bump passed and use one Anchor derived
    let bump = ctx.bumps.whirlpool;

    // if we are using token 2022, then we need to check seeds of token badge a & b
    if ctx.accounts.token_program_a.key() == SPL_TOKEN_2022_ID {
        let expected_address = Pubkey::find_program_address(
            &[
                b"token_badge",
                whirlpools_config.key().as_ref(),
                token_mint_a.as_ref(),
            ],
            &ctx.program_id,
        )
        .0;
        if ctx.accounts.token_badge_a.key() != expected_address {
            return Err(ErrorCode::TokenBadgeMismatch.into());
        }
    }
    if ctx.accounts.token_program_b.key() == SPL_TOKEN_2022_ID {
        let expected_address = Pubkey::find_program_address(
            &[
                b"token_badge",
                whirlpools_config.key().as_ref(),
                token_mint_b.as_ref(),
            ],
            &ctx.program_id,
        )
        .0;
        if ctx.accounts.token_badge_b.key() != expected_address {
            return Err(ErrorCode::TokenBadgeMismatch.into());
        }
    }

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

    initialize_vault_token_account_optimized(
        whirlpool,
        &ctx.accounts.token_vault_a,
        &ctx.accounts.token_mint_a,
        &ctx.accounts.funder,
        &ctx.accounts.token_program_a,
        &ctx.accounts.system_program,
    )?;

    initialize_vault_token_account_optimized(
        whirlpool,
        &ctx.accounts.token_vault_b,
        &ctx.accounts.token_mint_b,
        &ctx.accounts.funder,
        &ctx.accounts.token_program_b,
        &ctx.accounts.system_program,
    )?;

    let mut control_flags = WhirlpoolControlFlags::empty();
    if is_non_transferable_position_required(
        &ctx.accounts.token_badge_a,
        whirlpools_config.key(),
        &ctx.accounts.token_mint_a,
    )? {
        control_flags |= WhirlpoolControlFlags::REQUIRE_NON_TRANSFERABLE_POSITION;
    }

    if is_non_transferable_position_required(
        &ctx.accounts.token_badge_b,
        whirlpools_config.key(),
        &ctx.accounts.token_mint_b,
    )? {
        control_flags |= WhirlpoolControlFlags::REQUIRE_NON_TRANSFERABLE_POSITION;
    }

    let whirlpools_config_data = ctx.accounts.whirlpools_config.data.borrow();

    // check discriminator
    let expected_disc: [u8; 8] = [157, 20, 49, 224, 217, 87, 193, 254];
    let received_disc: [u8; 8] = whirlpools_config_data[0..8].try_into().unwrap();
    if expected_disc != received_disc {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }

    // check owner program id
    let received_account_program_id = ctx.accounts.whirlpools_config.owner;
    if received_account_program_id != ctx.program_id {
        return Err(ErrorCode::AccountOwnedByWrongProgram.into());
    }

    let default_protocol_fee_rate: u16 =
        u16::from_le_bytes([whirlpools_config_data[106], whirlpools_config_data[107]]);
    let pubkey_bytes: [u8; 32] = whirlpools_config_data[73..105]
        .try_into()
        .expect("slice with incorrect length");
    let reward_emissions_super_authority: Pubkey = Pubkey::new_from_array(pubkey_bytes);

    whirlpool.initialize(
        whirlpools_config.key(),
        fee_tier_index,
        bump,
        tick_spacing,
        initial_sqrt_price,
        default_fee_rate,
        token_mint_a,
        ctx.accounts.token_vault_a.key(),
        token_mint_b,
        ctx.accounts.token_vault_b.key(),
        control_flags,
        default_protocol_fee_rate,
        reward_emissions_super_authority,
    )?;
    emit!(PoolInitialized {
        whirlpool: ctx.accounts.whirlpool.key(),
        whirlpools_config: ctx.accounts.whirlpools_config.key(),
        token_mint_a: ctx.accounts.token_mint_a.key(),
        token_mint_b: ctx.accounts.token_mint_b.key(),
        tick_spacing,
        token_program_a: ctx.accounts.token_program_a.key(),
        token_program_b: ctx.accounts.token_program_b.key(),
        decimals_a: ctx.accounts.token_mint_a.decimals,
        decimals_b: ctx.accounts.token_mint_b.decimals,
        initial_sqrt_price,
    });
    Ok(())
}
