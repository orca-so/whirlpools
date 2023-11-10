use crate::state::{PositionBundle, Whirlpool};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use mpl_token_metadata::instruction::create_metadata_accounts_v3;
use solana_program::program::invoke_signed;
use spl_token::instruction::{burn_checked, close_account, mint_to, set_authority, AuthorityType};

use crate::constants::nft::{
    WPB_METADATA_NAME_PREFIX, WPB_METADATA_SYMBOL, WPB_METADATA_URI, WP_METADATA_NAME,
    WP_METADATA_SYMBOL, WP_METADATA_URI,
};

pub fn transfer_from_owner_to_vault<'info>(
    position_authority: &Signer<'info>,
    token_owner_account: &Account<'info, TokenAccount>,
    token_vault: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new(
            token_program.to_account_info(),
            Transfer {
                from: token_owner_account.to_account_info(),
                to: token_vault.to_account_info(),
                authority: position_authority.to_account_info(),
            },
        ),
        amount,
    )
}

pub fn transfer_from_vault_to_owner<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    token_vault: &Account<'info, TokenAccount>,
    token_owner_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: token_vault.to_account_info(),
                to: token_owner_account.to_account_info(),
                authority: whirlpool.to_account_info(),
            },
            &[&whirlpool.seeds()],
        ),
        amount,
    )
}

pub fn burn_and_close_user_position_token<'info>(
    token_authority: &Signer<'info>,
    receiver: &UncheckedAccount<'info>,
    position_mint: &Account<'info, Mint>,
    position_token_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    // Burn a single token in user account
    invoke_signed(
        &burn_checked(
            token_program.key,
            position_token_account.to_account_info().key,
            position_mint.to_account_info().key,
            token_authority.key,
            &[],
            1,
            position_mint.decimals,
        )?,
        &[
            token_program.to_account_info(),
            position_token_account.to_account_info(),
            position_mint.to_account_info(),
            token_authority.to_account_info(),
        ],
        &[],
    )?;

    // Close user account
    invoke_signed(
        &close_account(
            token_program.key,
            position_token_account.to_account_info().key,
            receiver.key,
            token_authority.key,
            &[],
        )?,
        &[
            token_program.to_account_info(),
            position_token_account.to_account_info(),
            receiver.to_account_info(),
            token_authority.to_account_info(),
        ],
        &[],
    )?;
    Ok(())
}

pub fn mint_position_token_and_remove_authority<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    position_mint: &Account<'info, Mint>,
    position_token_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    mint_position_token(
        whirlpool,
        position_mint,
        position_token_account,
        token_program,
    )?;
    remove_position_token_mint_authority(whirlpool, position_mint, token_program)
}

pub fn mint_position_token_with_metadata_and_remove_authority<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    position_mint: &Account<'info, Mint>,
    position_token_account: &Account<'info, TokenAccount>,
    position_metadata_account: &UncheckedAccount<'info>,
    metadata_update_auth: &UncheckedAccount<'info>,
    funder: &Signer<'info>,
    metadata_program: &UncheckedAccount<'info>,
    token_program: &Program<'info, Token>,
    system_program: &Program<'info, System>,
    rent: &Sysvar<'info, Rent>,
) -> Result<()> {
    mint_position_token(
        whirlpool,
        position_mint,
        position_token_account,
        token_program,
    )?;

    let metadata_mint_auth_account = whirlpool;
    invoke_signed(
        &create_metadata_accounts_v3(
            metadata_program.key(),
            position_metadata_account.key(),
            position_mint.key(),
            metadata_mint_auth_account.key(),
            funder.key(),
            metadata_update_auth.key(),
            WP_METADATA_NAME.to_string(),
            WP_METADATA_SYMBOL.to_string(),
            WP_METADATA_URI.to_string(),
            None,
            0,
            false,
            true,
            None,
            None,
            None,
        ),
        &[
            position_metadata_account.to_account_info(),
            position_mint.to_account_info(),
            metadata_mint_auth_account.to_account_info(),
            metadata_update_auth.to_account_info(),
            funder.to_account_info(),
            metadata_program.to_account_info(),
            system_program.to_account_info(),
            rent.to_account_info(),
        ],
        &[&metadata_mint_auth_account.seeds()],
    )?;

    remove_position_token_mint_authority(whirlpool, position_mint, token_program)
}

fn mint_position_token<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    position_mint: &Account<'info, Mint>,
    position_token_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    invoke_signed(
        &mint_to(
            token_program.key,
            position_mint.to_account_info().key,
            position_token_account.to_account_info().key,
            whirlpool.to_account_info().key,
            &[whirlpool.to_account_info().key],
            1,
        )?,
        &[
            position_mint.to_account_info(),
            position_token_account.to_account_info(),
            whirlpool.to_account_info(),
            token_program.to_account_info(),
        ],
        &[&whirlpool.seeds()],
    )?;
    Ok(())
}

fn remove_position_token_mint_authority<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    position_mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    invoke_signed(
        &set_authority(
            token_program.key,
            position_mint.to_account_info().key,
            Option::None,
            AuthorityType::MintTokens,
            whirlpool.to_account_info().key,
            &[whirlpool.to_account_info().key],
        )?,
        &[
            position_mint.to_account_info(),
            whirlpool.to_account_info(),
            token_program.to_account_info(),
        ],
        &[&whirlpool.seeds()],
    )?;
    Ok(())
}

pub fn mint_position_bundle_token_and_remove_authority<'info>(
    position_bundle: &Account<'info, PositionBundle>,
    position_bundle_mint: &Account<'info, Mint>,
    position_bundle_token_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    position_bundle_seeds: &[&[u8]],
) -> Result<()> {
    mint_position_bundle_token(
        position_bundle,
        position_bundle_mint,
        position_bundle_token_account,
        token_program,
        position_bundle_seeds,
    )?;
    remove_position_bundle_token_mint_authority(
        position_bundle,
        position_bundle_mint,
        token_program,
        position_bundle_seeds,
    )
}

pub fn mint_position_bundle_token_with_metadata_and_remove_authority<'info>(
    funder: &Signer<'info>,
    position_bundle: &Account<'info, PositionBundle>,
    position_bundle_mint: &Account<'info, Mint>,
    position_bundle_token_account: &Account<'info, TokenAccount>,
    position_bundle_metadata: &UncheckedAccount<'info>,
    metadata_update_auth: &UncheckedAccount<'info>,
    metadata_program: &UncheckedAccount<'info>,
    token_program: &Program<'info, Token>,
    system_program: &Program<'info, System>,
    rent: &Sysvar<'info, Rent>,
    position_bundle_seeds: &[&[u8]],
) -> Result<()> {
    mint_position_bundle_token(
        position_bundle,
        position_bundle_mint,
        position_bundle_token_account,
        token_program,
        position_bundle_seeds,
    )?;

    // Create Metadata
    // Orca Position Bundle xxxx...yyyy
    // xxxx and yyyy are the first and last 4 chars of mint address
    let mint_address = position_bundle_mint.key().to_string();
    let mut nft_name = String::from(WPB_METADATA_NAME_PREFIX);
    nft_name += " ";
    nft_name += &mint_address[0..4];
    nft_name += "...";
    nft_name += &mint_address[mint_address.len() - 4..];

    // Add ORCA collection nft for better approach

    invoke_signed(
        &create_metadata_accounts_v3(
            metadata_program.key(),
            position_bundle_metadata.key(),
            position_bundle_mint.key(),
            position_bundle.key(),
            funder.key(),
            metadata_update_auth.key(),
            nft_name,
            WPB_METADATA_SYMBOL.to_string(),
            WPB_METADATA_URI.to_string(),
            None,
            0,
            false,
            true,
            None,
            None,
            None,
        ),
        &[
            position_bundle.to_account_info(),
            position_bundle_metadata.to_account_info(),
            position_bundle_mint.to_account_info(),
            metadata_update_auth.to_account_info(),
            funder.to_account_info(),
            metadata_program.to_account_info(),
            system_program.to_account_info(),
            rent.to_account_info(),
        ],
        &[position_bundle_seeds],
    )?;

    remove_position_bundle_token_mint_authority(
        position_bundle,
        position_bundle_mint,
        token_program,
        position_bundle_seeds,
    )
}

fn mint_position_bundle_token<'info>(
    position_bundle: &Account<'info, PositionBundle>,
    position_bundle_mint: &Account<'info, Mint>,
    position_bundle_token_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    position_bundle_seeds: &[&[u8]],
) -> Result<()> {
    invoke_signed(
        &mint_to(
            token_program.key,
            position_bundle_mint.to_account_info().key,
            position_bundle_token_account.to_account_info().key,
            position_bundle.to_account_info().key,
            &[],
            1,
        )?,
        &[
            position_bundle_mint.to_account_info(),
            position_bundle_token_account.to_account_info(),
            position_bundle.to_account_info(),
            token_program.to_account_info(),
        ],
        &[position_bundle_seeds],
    )?;

    Ok(())
}

fn remove_position_bundle_token_mint_authority<'info>(
    position_bundle: &Account<'info, PositionBundle>,
    position_bundle_mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    position_bundle_seeds: &[&[u8]],
) -> Result<()> {
    invoke_signed(
        &set_authority(
            token_program.key,
            position_bundle_mint.to_account_info().key,
            Option::None,
            AuthorityType::MintTokens,
            position_bundle.to_account_info().key,
            &[],
        )?,
        &[
            position_bundle_mint.to_account_info(),
            position_bundle.to_account_info(),
            token_program.to_account_info(),
        ],
        &[position_bundle_seeds],
    )?;

    Ok(())
}

pub fn burn_and_close_position_bundle_token<'info>(
    position_bundle_authority: &Signer<'info>,
    receiver: &UncheckedAccount<'info>,
    position_bundle_mint: &Account<'info, Mint>,
    position_bundle_token_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    // use same logic
    burn_and_close_user_position_token(
        position_bundle_authority,
        receiver,
        position_bundle_mint,
        position_bundle_token_account,
        token_program,
    )
}
