use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_instruction::transfer;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::{
    self, extension::ExtensionType, instruction::AuthorityType,
};
use anchor_spl::token_2022::{get_account_data_size, GetAccountDataSize, Token2022};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    WP_2022_METADATA_NAME_PREFIX, WP_2022_METADATA_SYMBOL, WP_2022_METADATA_URI_BASE,
};
use crate::state::*;
use crate::util::safe_create_account;

pub fn initialize_position_mint_2022<'info>(
    position_mint: &Signer<'info>,
    funder: &Signer<'info>,
    position: &Account<'info, Position>,
    system_program: &Program<'info, System>,
    token_2022_program: &Program<'info, Token2022>,
    use_token_metadata_extension: bool,
    use_non_transferable_extension: bool,
) -> Result<()> {
    let mut extensions = vec![ExtensionType::MintCloseAuthority];
    if use_token_metadata_extension {
        extensions.push(ExtensionType::MetadataPointer);
    }
    if use_non_transferable_extension {
        extensions.push(ExtensionType::NonTransferable);
    }

    let space =
        ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&extensions)?;

    let lamports = Rent::get()?.minimum_balance(space);

    let authority = position;

    // create account
    safe_create_account(
        system_program.to_account_info(),
        funder.to_account_info(),
        position_mint.to_account_info(),
        &token_2022_program.key(),
        lamports,
        space as u64,
        &[],
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

    if use_non_transferable_extension {
        // initialize NonTransferable extension
        invoke(
            &spl_token_2022::instruction::initialize_non_transferable_mint(
                token_2022_program.key,
                position_mint.key,
            )?,
            &[
                position_mint.to_account_info(),
                token_2022_program.to_account_info(),
            ],
        )?;
    }

    // initialize Mint
    // mint authority: Position account (PDA) (will be removed in the transaction)
    // freeze authority: Position account (PDA) (reserved for future improvements)
    invoke(
        &spl_token_2022::instruction::initialize_mint2(
            token_2022_program.key,
            position_mint.key,
            &authority.key(),
            Some(&authority.key()),
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

#[allow(clippy::too_many_arguments)]
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
    let new_account_len = token_mint_unpacked
        .try_get_new_account_len_for_variable_len_extension::<spl_token_metadata_interface::state::TokenMetadata>(&metadata)?;

    let new_rent_exempt_minimum = Rent::get()?.minimum_balance(new_account_len);
    let additional_rent = new_rent_exempt_minimum.saturating_sub(position_mint.lamports());
    drop(token_mint_data); // CPI call will borrow the account data

    // transfer additional rent
    invoke(
        &transfer(funder.key, position_mint.key, additional_rent),
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

pub fn freeze_user_position_token_2022<'info>(
    position_mint: &InterfaceAccount<'info, Mint>,
    position_token_account: &InterfaceAccount<'info, TokenAccount>,
    token_2022_program: &Program<'info, Token2022>,
    position: &Account<'info, Position>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    // Note: Token-2022 program rejects the freeze instruction if the account is already frozen.
    invoke_signed(
        &spl_token_2022::instruction::freeze_account(
            token_2022_program.key,
            position_token_account.to_account_info().key,
            position_mint.to_account_info().key,
            &position.key(),
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account.to_account_info(),
            position_mint.to_account_info(),
            position.to_account_info(),
        ],
        &[position_seeds],
    )?;

    Ok(())
}

pub fn unfreeze_user_position_token_2022<'info>(
    position_mint: &InterfaceAccount<'info, Mint>,
    position_token_account: &InterfaceAccount<'info, TokenAccount>,
    token_2022_program: &Program<'info, Token2022>,
    position: &Account<'info, Position>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    // Note: Token-2022 program rejects the unfreeze instruction if the account is not frozen.
    invoke_signed(
        &spl_token_2022::instruction::thaw_account(
            token_2022_program.key,
            position_token_account.to_account_info().key,
            position_mint.to_account_info().key,
            &position.key(),
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account.to_account_info(),
            position_mint.to_account_info(),
            position.to_account_info(),
        ],
        &[position_seeds],
    )?;

    Ok(())
}

pub fn transfer_user_position_token_2022<'info>(
    authority: &Signer<'info>,
    position_mint: &InterfaceAccount<'info, Mint>,
    position_token_account: &InterfaceAccount<'info, TokenAccount>,
    destination_token_account: &InterfaceAccount<'info, TokenAccount>,
    token_2022_program: &Program<'info, Token2022>,
) -> Result<()> {
    invoke(
        &spl_token_2022::instruction::transfer_checked(
            token_2022_program.key,
            position_token_account.to_account_info().key,
            position_mint.to_account_info().key,
            destination_token_account.to_account_info().key,
            authority.key,
            &[],
            1,
            position_mint.decimals,
        )?,
        &[
            token_2022_program.to_account_info(),
            position_token_account.to_account_info(),
            position_mint.to_account_info(),
            destination_token_account.to_account_info(),
            authority.to_account_info(),
        ],
    )?;
    Ok(())
}

pub fn close_empty_token_account_2022<'info>(
    token_authority: &Signer<'info>,
    token_account: &InterfaceAccount<'info, TokenAccount>,
    token_2022_program: &Program<'info, Token2022>,
    receiver: &AccountInfo<'info>,
) -> Result<()> {
    invoke(
        &spl_token_2022::instruction::close_account(
            token_2022_program.key,
            token_account.to_account_info().key,
            receiver.key,
            token_authority.key,
            &[],
        )?,
        &[
            token_2022_program.to_account_info(),
            token_account.to_account_info(),
            receiver.to_account_info(),
            token_authority.to_account_info(),
        ],
    )?;

    Ok(())
}

// Initializes a vault token account for a Whirlpool.
// This works for both Token and Token-2022 programs.
pub fn initialize_vault_token_account<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    vault_token_account: &Signer<'info>,
    vault_mint: &InterfaceAccount<'info, Mint>,
    funder: &Signer<'info>,
    token_program: &Interface<'info, TokenInterface>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let is_token_2022 = token_program.key() == spl_token_2022::ID;

    // The size required for extensions that are mandatory on the TokenAccount side — based on the TokenExtensions enabled on the Mint —
    // is automatically accounted for. For non-mandatory extensions, however, they must be explicitly added,
    // so we specify ImmutableOwner explicitly.
    let space = get_account_data_size(
        CpiContext::new(
            token_program.to_account_info(),
            GetAccountDataSize {
                mint: vault_mint.to_account_info(),
            },
        ),
        // Needless to say, the program will never attempt to change the owner of the vault.
        // However, since the ImmutableOwner extension only increases the account size by 4 bytes, the overhead of always including it is negligible.
        // On the other hand, it makes it easier to comply with cases where ImmutableOwner is required, and it adds a layer of safety from a security standpoint.
        // Therefore, we'll include it by default going forward. (Vaults initialized after this change will have the ImmutableOwner extension.)
        if is_token_2022 {
            &[ExtensionType::ImmutableOwner]
        } else {
            &[]
        },
    )?;

    let lamports = Rent::get()?.minimum_balance(space as usize);

    // create account
    safe_create_account(
        system_program.to_account_info(),
        funder.to_account_info(),
        vault_token_account.to_account_info(),
        &token_program.key(),
        lamports,
        space,
        &[],
    )?;

    if is_token_2022 {
        // initialize ImmutableOwner extension
        invoke(
            &spl_token_2022::instruction::initialize_immutable_owner(
                token_program.key,
                vault_token_account.key,
            )?,
            &[
                token_program.to_account_info(),
                vault_token_account.to_account_info(),
            ],
        )?;
    }

    // initialize token account
    invoke(
        &spl_token_2022::instruction::initialize_account3(
            token_program.key,
            vault_token_account.key,
            &vault_mint.key(),
            &whirlpool.key(),
        )?,
        &[
            token_program.to_account_info(),
            vault_token_account.to_account_info(),
            vault_mint.to_account_info(),
            whirlpool.to_account_info(),
        ],
    )?;

    Ok(())
}
