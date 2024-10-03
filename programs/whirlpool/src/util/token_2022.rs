use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token_2022::spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use anchor_spl::token_2022::spl_token_2022::{
    self, extension::ExtensionType, instruction::AuthorityType,
};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use solana_program::program::{invoke, invoke_signed};
use solana_program::system_instruction::{create_account, transfer};

use crate::constants::{
    WP_2022_METADATA_NAME_PREFIX, WP_2022_METADATA_SYMBOL,
    WP_2022_METADATA_URI_BASE,
};
use crate::state::*;

pub fn initialize_position_mint_2022<'info>(
    position_mint: &Signer<'info>,
    funder: &Signer<'info>,
    position: &Account<'info, Position>,
    system_program: &Program<'info, System>,
    token_2022_program: &Program<'info, Token2022>,
    use_token_metadata_extension: bool,
) -> Result<()> {
    let space = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(
        if use_token_metadata_extension {
            &[
                ExtensionType::MintCloseAuthority,
                ExtensionType::MetadataPointer,
            ]
        } else {
            &[ExtensionType::MintCloseAuthority]
        },
    )?;

    let lamports = Rent::get()?.minimum_balance(space);

    let authority = position;

    // create account
    invoke(
        &create_account(
            funder.key,
            position_mint.key,
            lamports,
            space as u64,
            token_2022_program.key,
        ),
        &[
            funder.to_account_info(),
            position_mint.to_account_info(),
            token_2022_program.to_account_info(),
            system_program.to_account_info(),
        ],
    )?;

    // initialize MintCloseAuthority extension
    // authority: Position account (PDA)
    invoke(
        &spl_token_2022::instruction::initialize_mint_close_authority(
            token_2022_program.key,
            position_mint.key,
            Some(&authority.key()),
        )?,
        &[
            position_mint.to_account_info(),
            authority.to_account_info(),
            token_2022_program.to_account_info(),
        ],
    )?;

    if use_token_metadata_extension {
        // TokenMetadata extension requires MetadataPointer extension to be initialized

        // initialize MetadataPointer extension
        // authority: None
        invoke(
            &spl_token_2022::extension::metadata_pointer::instruction::initialize(
                token_2022_program.key,
                position_mint.key,
                None,
                Some(position_mint.key()),
            )?,
            &[
                position_mint.to_account_info(),
                authority.to_account_info(),
                token_2022_program.to_account_info(),
            ],
        )?;
    }

    // initialize Mint
    // mint authority: Position account (PDA) (will be removed in the transaction)
    // freeze authority: None
    invoke(
        &spl_token_2022::instruction::initialize_mint2(
            token_2022_program.key,
            position_mint.key,
            &authority.key(),
            None,
            0,
        )?,
        &[
            position_mint.to_account_info(),
            authority.to_account_info(),
            token_2022_program.to_account_info(),
        ],
    )?;

    Ok(())
}

pub fn initialize_token_metadata_extension<'info>(
    name: String,
    symbol: String,
    uri: String,
    position_mint: &Signer<'info>,
    position: &Account<'info, Position>,
    metadata_update_authority: &UncheckedAccount<'info>,
    funder: &Signer<'info>,
    system_program: &Program<'info, System>,
    token_2022_program: &Program<'info, Token2022>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let mint_authority = position;

    let metadata = spl_token_metadata_interface::state::TokenMetadata {
        name,
        symbol,
        uri,
        ..Default::default()
    };

    // we need to add rent for TokenMetadata extension to reallocate space
    let token_mint_data = position_mint.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    let new_account_len = token_mint_unpacked.try_get_new_account_len::<spl_token_metadata_interface::state::TokenMetadata>(
        &metadata,
    )?;
    let new_rent_exempt_minimum = Rent::get()?.minimum_balance(new_account_len);
    let additional_rent = new_rent_exempt_minimum.saturating_sub(position_mint.lamports());
    drop(token_mint_data); // CPI call will borrow the account data

    // transfer additional rent
    invoke(
        &transfer(
            funder.key,
            position_mint.key,
            additional_rent,
        ),
        &[
            funder.to_account_info(),
            position_mint.to_account_info(),
            system_program.to_account_info(),
        ],
    )?;

    // initialize TokenMetadata extension
    // update authority: WP_NFT_UPDATE_AUTH
    invoke_signed(
        &spl_token_metadata_interface::instruction::initialize(
            token_2022_program.key,
            position_mint.key,
            metadata_update_authority.key,
            position_mint.key,
            &mint_authority.key(),
            metadata.name,
            metadata.symbol,
            metadata.uri,
        ),
        &[
            position_mint.to_account_info(),
            mint_authority.to_account_info(),
            metadata_update_authority.to_account_info(),
            token_2022_program.to_account_info(),
        ],
        &[position_seeds],
    )?;

    Ok(())
}

pub fn initialize_position_token_account_2022<'info>(
    position_token_account: &UncheckedAccount<'info>,
    position_mint: &Signer<'info>,
    funder: &Signer<'info>,
    owner: &UncheckedAccount<'info>,
    token_2022_program: &Program<'info, Token2022>,
    system_program: &Program<'info, System>,
    associated_token_program: &Program<'info, AssociatedToken>,
) -> Result<()> {
    associated_token::create(CpiContext::new(
        associated_token_program.to_account_info(),
        associated_token::Create {
            payer: funder.to_account_info(),
            associated_token: position_token_account.to_account_info(),
            authority: owner.to_account_info(),
            mint: position_mint.to_account_info(),
            system_program: system_program.to_account_info(),
            token_program: token_2022_program.to_account_info(),
        },
    ))
}

pub fn mint_position_token_2022_and_remove_authority<'info>(
    position: &Account<'info, Position>,
    position_mint: &Signer<'info>,
    position_token_account: &UncheckedAccount<'info>,
    token_2022_program: &Program<'info, Token2022>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let authority = position;

    // mint
    invoke_signed(
        &spl_token_2022::instruction::mint_to(
            token_2022_program.key,
            position_mint.to_account_info().key,
            position_token_account.to_account_info().key,
            authority.to_account_info().key,
            &[authority.to_account_info().key],
            1,
        )?,
        &[
            position_mint.to_account_info(),
            position_token_account.to_account_info(),
            authority.to_account_info(),
            token_2022_program.to_account_info(),
        ],
        &[position_seeds],
    )?;

    // remove mint authority
    invoke_signed(
        &spl_token_2022::instruction::set_authority(
            token_2022_program.key,
            position_mint.to_account_info().key,
            Option::None,
            AuthorityType::MintTokens,
            authority.to_account_info().key,
            &[authority.to_account_info().key],
        )?,
        &[
            position_mint.to_account_info(),
            authority.to_account_info(),
            token_2022_program.to_account_info(),
        ],
        &[position_seeds],
    )?;

    Ok(())
}

pub fn burn_and_close_user_position_token_2022<'info>(
    token_authority: &Signer<'info>,
    receiver: &UncheckedAccount<'info>,
    position_mint: &InterfaceAccount<'info, Mint>,
    position_token_account: &InterfaceAccount<'info, TokenAccount>,
    token_2022_program: &Program<'info, Token2022>,
    position: &Account<'info, Position>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    // Burn a single token in user account
    invoke(
        &spl_token_2022::instruction::burn_checked(
            token_2022_program.key,
            position_token_account.to_account_info().key,
            position_mint.to_account_info().key,
            token_authority.key,
            &[],
            1,
            position_mint.decimals,
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account.to_account_info(),
            position_mint.to_account_info(),
            token_authority.to_account_info(),
        ],
    )?;

    // Close user account
    invoke(
        &spl_token_2022::instruction::close_account(
            token_2022_program.key,
            position_token_account.to_account_info().key,
            receiver.key,
            token_authority.key,
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account.to_account_info(),
            receiver.to_account_info(),
            token_authority.to_account_info(),
        ],
    )?;

    // Close mint
    invoke_signed(
        &spl_token_2022::instruction::close_account(
            token_2022_program.key,
            position_mint.to_account_info().key,
            receiver.key,
            &position.key(),
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            position_mint.to_account_info(),
            receiver.to_account_info(),
            position.to_account_info(),
        ],
        &[position_seeds],
    )?;

    Ok(())
}

pub fn build_position_token_metadata<'info>(
    position_mint: &Signer<'info>,
    position: &Account<'info, Position>,
    whirlpool: &Account<'info, Whirlpool>,
) -> (String, String, String) {
    // WP_2022_METADATA_NAME_PREFIX + " xxxx...yyyy"
    // xxxx and yyyy are the first and last 4 chars of mint address
    let mint_address = position_mint.key().to_string();
    let name = format!(
        "{} {}...{}",
        WP_2022_METADATA_NAME_PREFIX,
        &mint_address[0..4],
        &mint_address[mint_address.len() - 4..],
    );

    // WP_2022_METADATA_URI_BASE + "/" + pool address + "/" + position address
    // Must be less than 128 bytes
    let uri = format!(
        "{}/{}/{}",
        WP_2022_METADATA_URI_BASE,
        whirlpool.key(),
        position.key(),
    );

    (name, WP_2022_METADATA_SYMBOL.to_string(), uri)
}
