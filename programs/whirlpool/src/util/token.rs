use crate::state::{PositionBundle, Whirlpool};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use solana_program::program::invoke_signed;
use spl_token::instruction::{burn_checked, close_account, mint_to, set_authority, AuthorityType};


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
