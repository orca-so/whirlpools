use crate::manager::tick_array_manager::collect_rent_for_ticks_in_position;
use crate::state::*;
use crate::util::build_position_token_metadata;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::Token2022;

use crate::constants::nft::whirlpool_nft_update_auth::ID as WP_NFT_UPDATE_AUTH;
use crate::events::*;
use crate::util::{
    initialize_position_mint_2022, initialize_position_token_account_2022,
    initialize_token_metadata_extension, mint_position_token_2022_and_remove_authority,
    resolve_one_sided_position_ticks,
};

#[derive(Accounts)]
pub struct OpenPositionWithTokenExtensions<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: safe, the account that will be the owner of the position can be arbitrary
    pub owner: UncheckedAccount<'info>,

    #[account(init,
      payer = funder,
      space = Position::LEN,
      seeds = [b"position".as_ref(), position_mint.key().as_ref()],
      bump,
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: initialized in the handler
    #[account(mut)]
    pub position_mint: Signer<'info>,

    /// CHECK: initialized in the handler
    #[account(mut)]
    pub position_token_account: UncheckedAccount<'info>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(address = spl_token_2022::ID)]
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: checked via account constraints
    #[account(address = WP_NFT_UPDATE_AUTH)]
    pub metadata_update_auth: UncheckedAccount<'info>,
}

/*
  Opens a new Whirlpool Position with Mint and TokenAccount owned by Token-2022.
*/
pub fn handler(
    ctx: Context<OpenPositionWithTokenExtensions>,
    tick_lower_index: i32,
    tick_upper_index: i32,
    with_token_metadata: bool,
) -> Result<()> {
    let whirlpool = &ctx.accounts.whirlpool;
    let position_mint = &ctx.accounts.position_mint;
    let position = &mut ctx.accounts.position;

    let position_seeds = [
        b"position".as_ref(),
        position_mint.key.as_ref(),
        &[ctx.bumps.position],
    ];

    collect_rent_for_ticks_in_position(
        &ctx.accounts.funder,
        position,
        &ctx.accounts.system_program,
    )?;

    let (resolved_tick_lower_index, resolved_tick_upper_index) = resolve_one_sided_position_ticks(
        tick_lower_index,
        tick_upper_index,
        whirlpool.tick_spacing,
        whirlpool.sqrt_price,
    )?;

    position.open_position(
        whirlpool,
        position_mint.key(),
        resolved_tick_lower_index,
        resolved_tick_upper_index,
    )?;

    emit!(PositionOpened {
        whirlpool: whirlpool.key(),
        position: position.key(),
        tick_lower_index: resolved_tick_lower_index,
        tick_upper_index: resolved_tick_upper_index,
    });

    let is_non_transferable_position_required = whirlpool.is_non_transferable_position_required();

    initialize_position_mint_2022(
        position_mint,
        &ctx.accounts.funder,
        position,
        &ctx.accounts.system_program,
        &ctx.accounts.token_2022_program,
        with_token_metadata,
        is_non_transferable_position_required,
    )?;

    if with_token_metadata {
        let (name, symbol, uri) = build_position_token_metadata(position_mint, position);

        initialize_token_metadata_extension(
            name,
            symbol,
            uri,
            position_mint,
            position,
            &ctx.accounts.metadata_update_auth,
            &ctx.accounts.funder,
            &ctx.accounts.system_program,
            &ctx.accounts.token_2022_program,
            &position_seeds,
        )?;
    }

    initialize_position_token_account_2022(
        &ctx.accounts.position_token_account,
        position_mint,
        &ctx.accounts.funder,
        &ctx.accounts.owner,
        &ctx.accounts.token_2022_program,
        &ctx.accounts.system_program,
        &ctx.accounts.associated_token_program,
    )?;

    mint_position_token_2022_and_remove_authority(
        position,
        position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.token_2022_program,
        &position_seeds,
    )?;

    Ok(())
}
