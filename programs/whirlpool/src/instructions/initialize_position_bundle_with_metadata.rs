use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::Metadata;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use solana_program::sysvar;

use crate::constants::nft::whirlpool_nft_update_auth::ID as WPB_NFT_UPDATE_AUTH;
use crate::{state::*, util::mint_position_bundle_token_with_metadata_and_remove_authority};

#[derive(Accounts)]
pub struct InitializePositionBundleWithMetadata<'info> {
    #[account(init,
        payer = funder,
        space = PositionBundle::LEN,
        seeds = [b"position_bundle".as_ref(), position_bundle_mint.key().as_ref()],
        bump,
    )]
    pub position_bundle: Box<Account<'info, PositionBundle>>,

    #[account(init,
        payer = funder,
        mint::authority = position_bundle, // will be removed in the transaction
        mint::decimals = 0,
    )]
    pub position_bundle_mint: Account<'info, Mint>,

    /// CHECK: checked via the Metadata CPI call
    /// https://github.com/metaplex-foundation/metaplex-program-library/blob/773a574c4b34e5b9f248a81306ec24db064e255f/token-metadata/program/src/utils/metadata.rs#L100
    #[account(mut)]
    pub position_bundle_metadata: UncheckedAccount<'info>,

    #[account(init,
        payer = funder,
        associated_token::mint = position_bundle_mint,
        associated_token::authority = position_bundle_owner,
    )]
    pub position_bundle_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: safe, the account that will be the owner of the position bundle can be arbitrary
    pub position_bundle_owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: checked via account constraints
    #[account(address = WPB_NFT_UPDATE_AUTH)]
    pub metadata_update_auth: UncheckedAccount<'info>,

    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: checked via account constraints
    #[account(address = sysvar::rent::ID)]
    pub rent: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    pub metadata_program: Program<'info, Metadata>,
}

pub fn handler(ctx: Context<InitializePositionBundleWithMetadata>) -> Result<()> {
    let position_bundle_mint = &ctx.accounts.position_bundle_mint;
    let position_bundle = &mut ctx.accounts.position_bundle;

    position_bundle.initialize(position_bundle_mint.key())?;

    let bump = ctx.bumps.position_bundle;

    mint_position_bundle_token_with_metadata_and_remove_authority(
        &ctx.accounts.funder,
        &ctx.accounts.position_bundle,
        position_bundle_mint,
        &ctx.accounts.position_bundle_token_account,
        &ctx.accounts.position_bundle_metadata,
        &ctx.accounts.metadata_update_auth,
        &ctx.accounts.metadata_program,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
        &ctx.accounts.rent,
        &[
            b"position_bundle".as_ref(),
            position_bundle_mint.key().as_ref(),
            &[bump],
        ],
    )
}
