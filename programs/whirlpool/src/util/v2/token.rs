use crate::state::{token_badge, Whirlpool};
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::spl_token_2022::extension::BaseStateWithExtensions;

use anchor_spl::token::Token;
use anchor_spl::token_2022::spl_token_2022::{self, extension::{self, StateWithExtensions}, state::AccountState};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::{self, Memo, BuildMemo};
use spl_transfer_hook_interface;

use token_badge::TokenBadge;

pub fn transfer_from_owner_to_vault_v2<'info>(
    authority: &Signer<'info>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_owner_account: &InterfaceAccount<'info, TokenAccount>,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    transfer_hook_accounts: &Option<Vec<AccountInfo<'info>>>,
    amount: u64,
) -> Result<()> {
    // The vault doesn't have MemoTransfer extension, so we don't need to use memo_program

    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        &token_owner_account.key(), // from
        &token_mint.key(), // mint
        &token_vault.key(), // to
        authority.key, // authority
        &[],
        amount,
        token_mint.decimals,
    )?;

    let mut account_infos = vec![
        token_program.to_account_info(),
        token_owner_account.to_account_info(),
        token_mint.to_account_info(),
        token_vault.to_account_info(),
        authority.to_account_info(),
    ];

    // TransferHook extension
    if let Some(hook_program_id) = get_transfer_hook_program_id(token_mint)? {
        if transfer_hook_accounts.is_none() {
            return Err(ErrorCode::NoExtraAccountsForTransferHook.into());
        }

        spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi(
            &mut instruction,
            &mut account_infos,
            &hook_program_id,
            token_owner_account.to_account_info(),
            token_mint.to_account_info(),
            token_vault.to_account_info(),
            authority.to_account_info(),
            amount,
            &transfer_hook_accounts.clone().unwrap(),
        )?;    
    }

    solana_program::program::invoke_signed(
        &instruction,
        &account_infos,
        &[],
    )?;

    Ok(())
}

pub fn transfer_from_vault_to_owner_v2<'info>(
    whirlpool: &Account<'info, Whirlpool>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    memo_program: &Program<'info, Memo>,
    transfer_hook_accounts: &Option<Vec<AccountInfo<'info>>>,
    amount: u64,
    memo: &[u8],
) -> Result<()> {
    // MemoTransfer extension
    if is_transfer_memo_required(&token_owner_account)? {
        memo::build_memo(
            CpiContext::new(
                memo_program.to_account_info(),
                BuildMemo {}
            ),
            memo
        )?;
    }

    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        &token_vault.key(), // from
        &token_mint.key(), // mint
        &token_owner_account.key(), // to
        &whirlpool.key(), // authority
        &[],
        amount,
        token_mint.decimals,
    )?;

    let mut account_infos = vec![
        token_program.to_account_info(),
        token_vault.to_account_info(),
        token_mint.to_account_info(),
        token_owner_account.to_account_info(),
        whirlpool.to_account_info(),
    ];

    // TransferHook extension
    if let Some(hook_program_id) = get_transfer_hook_program_id(token_mint)? {
        if transfer_hook_accounts.is_none() {
            return Err(ErrorCode::NoExtraAccountsForTransferHook.into());
        }

        spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi(
            &mut instruction,
            &mut account_infos,
            &hook_program_id,
            token_owner_account.to_account_info(),
            token_mint.to_account_info(),
            token_vault.to_account_info(),
            whirlpool.to_account_info(),
            amount,
            &transfer_hook_accounts.clone().unwrap(),
        )?;    
    }

    solana_program::program::invoke_signed(
        &instruction,
        &account_infos,
        &[&whirlpool.seeds()],
    )?;

    Ok(())
}

fn get_transfer_hook_program_id<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
) -> Result<Option<Pubkey>> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(None);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    Ok(extension::transfer_hook::get_program_id(&token_mint_unpacked))
}

fn is_transfer_memo_required<'info>(token_account: &InterfaceAccount<'info, TokenAccount>) -> Result<bool> {
    let token_account_info = token_account.to_account_info();
    if *token_account_info.owner == Token::id() {
        return Ok(false);
    }

    let token_account_data = token_account_info.try_borrow_data()?;
    let token_account_unpacked = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&token_account_data)?;
    let extension = token_account_unpacked.get_extension::<extension::memo_transfer::MemoTransfer>();

    if let Ok(memo_transfer) = extension {
        return Ok(memo_transfer.require_incoming_transfer_memos.into());
    } else {
        return Ok(false);
    }
}

pub fn is_supported_token_mint<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
    is_token_badge_initialized: bool,
) -> Result<bool> {
    // if mint has initialized token badge, it is clearly supported
    if is_token_badge_initialized {
        return Ok(true);
    }

    let token_mint_info = token_mint.to_account_info();

    // if mint is owned by Token Program, it is supported (compatible to initialize_pool / initialize_reward)
    if *token_mint_info.owner == Token::id() {
        return Ok(true);
    }

    // now mint is owned by Token-2022 Program

    // reject if mint has freeze_authority
    if token_mint.freeze_authority.is_some() && !is_token_badge_initialized {
        return Ok(false);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;

    let extensions = token_mint_unpacked.get_extension_types()?;
    for extension in extensions {
        match extension {
            // supported
            extension::ExtensionType::TransferFeeConfig => {}
            extension::ExtensionType::TokenMetadata => {}
            extension::ExtensionType::MetadataPointer => {}
            // partially supported
            extension::ExtensionType::ConfidentialTransferMint => {
                // Supported, but non-confidential transfer only
                //
                // WhirlpoolProgram invokes TransferChecked instruction and it supports non-confidential transfer only.
                //
                // Because the vault accounts are not configured to support confidential transfer,
                // it is impossible to send tokens directly to the vault accounts confidentially.
                // Note: Only the owner (Whirlpool account) can call ConfidentialTransferInstruction::ConfigureAccount.
            }
            // not supported without token badge
            extension::ExtensionType::PermanentDelegate => {
                if !is_token_badge_initialized { return Ok(false); }
            }
            extension::ExtensionType::TransferHook => {
                if !is_token_badge_initialized { return Ok(false); }
            }
            extension::ExtensionType::MintCloseAuthority => {
                if !is_token_badge_initialized { return Ok(false); }
            }
            extension::ExtensionType::DefaultAccountState => {
                if !is_token_badge_initialized { return Ok(false); }

                // reject if default state is not Initialized even if it has token badge
                let default_state = token_mint_unpacked.get_extension::<extension::default_account_state::DefaultAccountState>()?;
                let initialized: u8 = AccountState::Initialized.into();
                if default_state.state != initialized {
                    return Ok(false);
                }
            }
            // No possibility to support the following extensions
            extension::ExtensionType::NonTransferable => { return Ok(false); }
            // mint has unknown or unsupported extensions
            _ => { return Ok(false); }
        }
    }

    return Ok(true);
}

pub fn is_token_badge_initialized<'info>(
    whirlpools_config_key: Pubkey,
    token_mint_key: Pubkey,
    token_badge: &UncheckedAccount<'info>,
) -> Result<bool> {
    if *token_badge.owner != crate::id() {
        return Ok(false);
    }

    let token_badge = TokenBadge::try_deserialize(
        &mut token_badge.data.borrow().as_ref()
    )?;

    Ok(
        token_badge.whirlpools_config == whirlpools_config_key &&
        token_badge.token_mint == token_mint_key
    )
}

#[derive(Debug)]
pub struct AmountWithTransferFee {
    pub amount: u64,
    pub transfer_fee: u64,
}

pub fn calculate_transfer_fee_excluded_amount<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
    transfer_fee_included_amount: u64,
) -> Result<AmountWithTransferFee> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(AmountWithTransferFee { amount: transfer_fee_included_amount, transfer_fee: 0 });
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    if let Ok(transfer_fee_config) = token_mint_unpacked.get_extension::<extension::transfer_fee::TransferFeeConfig>() {
        let epoch = Clock::get()?.epoch;
        let transfer_fee = transfer_fee_config.calculate_epoch_fee(epoch, transfer_fee_included_amount).unwrap();
        let transfer_fee_excluded_amount = transfer_fee_included_amount.checked_sub(transfer_fee).unwrap();
        return Ok(AmountWithTransferFee { amount: transfer_fee_excluded_amount, transfer_fee });            
    }
    
    Ok(AmountWithTransferFee { amount: transfer_fee_included_amount, transfer_fee: 0 })
} 

pub fn calculate_transfer_fee_included_amount<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
    transfer_fee_excluded_amount: u64,
) -> Result<AmountWithTransferFee> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(AmountWithTransferFee { amount: transfer_fee_excluded_amount, transfer_fee: 0 });
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    if let Ok(transfer_fee_config) = token_mint_unpacked.get_extension::<extension::transfer_fee::TransferFeeConfig>() {
        let epoch = Clock::get()?.epoch;
        let transfer_fee = transfer_fee_config.calculate_inverse_epoch_fee(epoch, transfer_fee_excluded_amount).unwrap();
        let transfer_fee_included_amount = transfer_fee_excluded_amount.checked_add(transfer_fee).unwrap();
        return Ok(AmountWithTransferFee { amount: transfer_fee_included_amount, transfer_fee });
    }

    Ok(AmountWithTransferFee { amount: transfer_fee_excluded_amount, transfer_fee: 0 })
}
