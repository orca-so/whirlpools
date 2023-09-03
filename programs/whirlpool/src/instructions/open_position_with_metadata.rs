use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::{state::*, util::mint_position_token_with_metadata_and_remove_authority};

use crate::constants::nft::whirlpool_nft_update_auth::ID as WP_NFT_UPDATE_AUTH;

#[derive(Accounts)]
#[instruction(bumps: OpenPositionWithMetadataBumps)]
pub struct OpenPositionWithMetadata<'info> {
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

    #[account(init,
        payer = funder,
        mint::authority = whirlpool,
        mint::decimals = 0,
    )]
    pub position_mint: Account<'info, Mint>,

    /// CHECK: checked via the Metadata CPI call
    /// https://github.com/metaplex-foundation/metaplex-program-library/blob/master/token-metadata/program/src/utils.rs#L873
    #[account(mut)]
    pub position_metadata_account: UncheckedAccount<'info>,

    #[account(init,
      payer = funder,
      associated_token::mint = position_mint,
      associated_token::authority = owner,
    )]
    pub position_token_account: Box<Account<'info, TokenAccount>>,

    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// CHECK: checked via account constraints
    #[account(address = token_metadata::ID)]
    pub metadata_program: UncheckedAccount<'info>,

    /// CHECK: checked via account constraints
    #[account(address = WP_NFT_UPDATE_AUTH)]
    pub metadata_update_auth: UncheckedAccount<'info>,
}

/*
  Opens a new Whirlpool Position with Metadata account.
*/
pub fn handler(
    ctx: Context<OpenPositionWithMetadata>,
    _bumps: OpenPositionWithMetadataBumps,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    let whirlpool = &ctx.accounts.whirlpool;
    let position_mint = &ctx.accounts.position_mint;
    let position = &mut ctx.accounts.position;

    position.open_position(
        whirlpool,
        position_mint.key(),
        tick_lower_index,
        tick_upper_index,
    )?;

    mint_position_token_with_metadata_and_remove_authority(
        whirlpool,
        position_mint,
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_metadata_account,
        &ctx.accounts.metadata_update_auth,
        &ctx.accounts.funder,
        &ctx.accounts.metadata_program,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
        &ctx.accounts.rent,
    )
}
