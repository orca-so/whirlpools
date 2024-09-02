use crate::errors::ErrorCode;
use crate::state::{TokenBadge, Whirlpool};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::{
    TransferFee, MAX_FEE_BASIS_POINTS,
};
use anchor_spl::token_interface::spl_token_2022::extension::BaseStateWithExtensions;

use anchor_spl::memo::{self, BuildMemo, Memo};
use anchor_spl::token::Token;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{self, StateWithExtensions},
    state::AccountState,
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_transfer_hook_interface;

#[allow(clippy::too_many_arguments)]
pub fn transfer_from_owner_to_vault_v2<'info>(
    authority: &Signer<'info>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_owner_account: &InterfaceAccount<'info, TokenAccount>,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    memo_program: &Program<'info, Memo>,
    transfer_hook_accounts: &Option<Vec<AccountInfo<'info>>>,
    amount: u64,
) -> Result<()> {
    // TransferFee extension
    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(token_mint)? {
        // log applied transfer fee
        // - Not must, but important for ease of investigation and replay when problems occur
        // - Use Memo because logs risk being truncated
        let transfer_fee_memo = format!(
            "TFe: {}, {}",
            u16::from(epoch_transfer_fee.transfer_fee_basis_points),
            u64::from(epoch_transfer_fee.maximum_fee),
        );
        memo::build_memo(
            CpiContext::new(memo_program.to_account_info(), BuildMemo {}),
            transfer_fee_memo.as_bytes(),
        )?;
    }

    // MemoTransfer extension
    // The vault doesn't have MemoTransfer extension, so we don't need to use memo_program here

    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        // owner to vault
        &token_owner_account.key(), // from (owner account)
        &token_mint.key(),          // mint
        &token_vault.key(),         // to (vault account)
        authority.key,              // authority (owner)
        &[],
        amount,
        token_mint.decimals,
    )?;

    let mut account_infos = vec![
        token_program.to_account_info(),
        // owner to vault
        token_owner_account.to_account_info(), // from (owner account)
        token_mint.to_account_info(),          // mint
        token_vault.to_account_info(),         // to (vault account)
        authority.to_account_info(),           // authority (owner)
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
            // owner to vault
            token_owner_account.to_account_info(), // from (owner account)
            token_mint.to_account_info(), // mint
            token_vault.to_account_info(), // to (vault account)
            authority.to_account_info(), // authority (owner)
            amount,
            &transfer_hook_accounts.clone().unwrap(),
        )?;
    }

    solana_program::program::invoke_signed(&instruction, &account_infos, &[])?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
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
    // TransferFee extension
    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(token_mint)? {
        // log applied transfer fee
        // - Not must, but important for ease of investigation and replay when problems occur
        // - Use Memo because logs risk being truncated
        let transfer_fee_memo = format!(
            "TFe: {}, {}",
            u16::from(epoch_transfer_fee.transfer_fee_basis_points),
            u64::from(epoch_transfer_fee.maximum_fee),
        );
        memo::build_memo(
            CpiContext::new(memo_program.to_account_info(), BuildMemo {}),
            transfer_fee_memo.as_bytes(),
        )?;
    }

    // MemoTransfer extension
    if is_transfer_memo_required(token_owner_account)? {
        memo::build_memo(
            CpiContext::new(memo_program.to_account_info(), BuildMemo {}),
            memo,
        )?;
    }

    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        // vault to owner
        &token_vault.key(),         // from (vault account)
        &token_mint.key(),          // mint
        &token_owner_account.key(), // to (owner account)
        &whirlpool.key(),           // authority (pool)
        &[],
        amount,
        token_mint.decimals,
    )?;

    let mut account_infos = vec![
        token_program.to_account_info(),
        // vault to owner
        token_vault.to_account_info(), // from (vault account)
        token_mint.to_account_info(), // mint
        token_owner_account.to_account_info(), // to (owner account)
        whirlpool.to_account_info(), // authority (pool)
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
            // vault to owner
            token_vault.to_account_info(), // from (vault account)
            token_mint.to_account_info(), // mint
            token_owner_account.to_account_info(), // to (owner account)
            whirlpool.to_account_info(), // authority (pool)
            amount,
            &transfer_hook_accounts.clone().unwrap(),
        )?;
    }

    solana_program::program::invoke_signed(&instruction, &account_infos, &[&whirlpool.seeds()])?;

    Ok(())
}

fn get_transfer_hook_program_id(token_mint: &InterfaceAccount<'_, Mint>) -> Result<Option<Pubkey>> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(None);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    Ok(extension::transfer_hook::get_program_id(
        &token_mint_unpacked,
    ))
}

fn is_transfer_memo_required(token_account: &InterfaceAccount<'_, TokenAccount>) -> Result<bool> {
    let token_account_info = token_account.to_account_info();
    if *token_account_info.owner == Token::id() {
        return Ok(false);
    }

    let token_account_data = token_account_info.try_borrow_data()?;
    let token_account_unpacked =
        StateWithExtensions::<spl_token_2022::state::Account>::unpack(&token_account_data)?;
    let extension =
        token_account_unpacked.get_extension::<extension::memo_transfer::MemoTransfer>();

    if let Ok(memo_transfer) = extension {
        Ok(memo_transfer.require_incoming_transfer_memos.into())
    } else {
        Ok(false)
    }
}

pub fn is_supported_token_mint(
    token_mint: &InterfaceAccount<'_, Mint>,
    is_token_badge_initialized: bool,
) -> Result<bool> {
    let token_mint_info = token_mint.to_account_info();

    // if mint is owned by Token Program, it is supported (compatible to initialize_pool / initialize_reward)
    if *token_mint_info.owner == Token::id() {
        return Ok(true);
    }

    // now mint is owned by Token-2022 Program

    // reject native mint of Token-2022 Program to avoid SOL liquidity fragmentation
    if spl_token_2022::native_mint::check_id(&token_mint.key()) {
        return Ok(false);
    }

    // reject if mint has freeze_authority
    if token_mint.freeze_authority.is_some() && !is_token_badge_initialized {
        return Ok(false);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;

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
            extension::ExtensionType::ConfidentialTransferFeeConfig => {
                // Supported, but non-confidential transfer only
                // When both TransferFeeConfig and ConfidentialTransferMint are initialized,
                // ConfidentialTransferFeeConfig is also initialized to store encrypted transfer fee amount.
            }
            // supported if token badge is initialized
            extension::ExtensionType::PermanentDelegate => {
                if !is_token_badge_initialized {
                    return Ok(false);
                }
            }
            extension::ExtensionType::TransferHook => {
                if !is_token_badge_initialized {
                    return Ok(false);
                }
            }
            extension::ExtensionType::MintCloseAuthority => {
                if !is_token_badge_initialized {
                    return Ok(false);
                }
            }
            extension::ExtensionType::DefaultAccountState => {
                if !is_token_badge_initialized {
                    return Ok(false);
                }

                // reject if default state is not Initialized even if it has token badge
                let default_state = token_mint_unpacked
                    .get_extension::<extension::default_account_state::DefaultAccountState>(
                )?;
                let initialized: u8 = AccountState::Initialized.into();
                if default_state.state != initialized {
                    return Ok(false);
                }
            }
            // No possibility to support the following extensions
            extension::ExtensionType::NonTransferable => {
                return Ok(false);
            }
            // mint has unknown or unsupported extensions
            _ => {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

pub fn is_token_badge_initialized(
    whirlpools_config_key: Pubkey,
    token_mint_key: Pubkey,
    token_badge: &UncheckedAccount<'_>,
) -> Result<bool> {
    if *token_badge.owner != crate::id() {
        return Ok(false);
    }

    let token_badge = TokenBadge::try_deserialize(&mut token_badge.data.borrow().as_ref())?;

    Ok(token_badge.whirlpools_config == whirlpools_config_key
        && token_badge.token_mint == token_mint_key)
}

#[derive(Debug)]
pub struct TransferFeeIncludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

#[derive(Debug)]
pub struct TransferFeeExcludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

pub fn calculate_transfer_fee_excluded_amount(
    token_mint: &InterfaceAccount<'_, Mint>,
    transfer_fee_included_amount: u64,
) -> Result<TransferFeeExcludedAmount> {
    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(token_mint)? {
        let transfer_fee = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .unwrap();
        let transfer_fee_excluded_amount = transfer_fee_included_amount
            .checked_sub(transfer_fee)
            .unwrap();
        return Ok(TransferFeeExcludedAmount {
            amount: transfer_fee_excluded_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeExcludedAmount {
        amount: transfer_fee_included_amount,
        transfer_fee: 0,
    })
}

pub fn calculate_transfer_fee_included_amount(
    token_mint: &InterfaceAccount<'_, Mint>,
    transfer_fee_excluded_amount: u64,
) -> Result<TransferFeeIncludedAmount> {
    if transfer_fee_excluded_amount == 0 {
        return Ok(TransferFeeIncludedAmount {
            amount: 0,
            transfer_fee: 0,
        });
    }

    // now transfer_fee_excluded_amount > 0

    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(token_mint)? {
        let transfer_fee: u64 =
            if u16::from(epoch_transfer_fee.transfer_fee_basis_points) == MAX_FEE_BASIS_POINTS {
                // edge-case: if transfer fee rate is 100%, current SPL implementation returns 0 as inverse fee.
                // https://github.com/solana-labs/solana-program-library/blob/fe1ac9a2c4e5d85962b78c3fc6aaf028461e9026/token/program-2022/src/extension/transfer_fee/mod.rs#L95

                // But even if transfer fee is 100%, we can use maximum_fee as transfer fee.
                // if transfer_fee_excluded_amount + maximum_fee > u64 max, the following checked_add should fail.
                u64::from(epoch_transfer_fee.maximum_fee)
            } else {
                epoch_transfer_fee
                    .calculate_inverse_fee(transfer_fee_excluded_amount)
                    .ok_or(ErrorCode::TransferFeeCalculationError)?
            };

        let transfer_fee_included_amount = transfer_fee_excluded_amount
            .checked_add(transfer_fee)
            .ok_or(ErrorCode::TransferFeeCalculationError)?;

        // verify transfer fee calculation for safety
        let transfer_fee_verification = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .unwrap();
        if transfer_fee != transfer_fee_verification {
            // We believe this should never happen
            return Err(ErrorCode::TransferFeeCalculationError.into());
        }

        return Ok(TransferFeeIncludedAmount {
            amount: transfer_fee_included_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeIncludedAmount {
        amount: transfer_fee_excluded_amount,
        transfer_fee: 0,
    })
}

pub fn get_epoch_transfer_fee(
    token_mint: &InterfaceAccount<'_, Mint>,
) -> Result<Option<TransferFee>> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(None);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    if let Ok(transfer_fee_config) =
        token_mint_unpacked.get_extension::<extension::transfer_fee::TransferFeeConfig>()
    {
        let epoch = Clock::get()?.epoch;
        return Ok(Some(*transfer_fee_config.get_epoch_fee(epoch)));
    }

    Ok(None)
}

// special thanks for OtterSec
#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;

    struct SyscallStubs {}
    impl solana_program::program_stubs::SyscallStubs for SyscallStubs {
        fn sol_get_clock_sysvar(&self, _var_addr: *mut u8) -> u64 {
            0
        }
    }

    #[derive(Default, AnchorSerialize)]
    struct MintWithTransferFeeConfigLayout {
        // 82 for Mint
        pub coption_mint_authority: u32,   // 4
        pub mint_authority: Pubkey,        // 32
        pub supply: u64,                   // 8
        pub decimals: u8,                  // 1
        pub is_initialized: bool,          // 1
        pub coption_freeze_authority: u32, // 4
        pub freeze_authority: Pubkey,      // 4 + 32

        // 83 for padding
        pub padding1: [u8; 32],
        pub padding2: [u8; 32],
        pub padding3: [u8; 19],

        pub account_type: u8, // 1

        pub extension_type: u16,   // 2
        pub extension_length: u16, // 2
        // 108 for TransferFeeConfig data
        pub transfer_fee_config_authority: Pubkey, // 32
        pub withdraw_withheld_authority: Pubkey,   // 32
        pub withheld_amount: u64,                  // 8
        pub older_epoch: u64,                      // 8
        pub older_maximum_fee: u64,                // 8
        pub older_transfer_fee_basis_point: u16,   // 2
        pub newer_epoch: u64,                      // 8
        pub newer_maximum_fee: u64,                // 8
        pub newer_transfer_fee_basis_point: u16,   // 2
    }
    impl MintWithTransferFeeConfigLayout {
        pub const LEN: usize = 82 + 83 + 1 + 2 + 2 + 108;
    }

    /// Maximum possible fee in basis points is 100%, aka 10_000 basis points
    const MAX_FEE_BASIS_POINTS: u16 = 10_000;
    const MAX_FEE: u64 = 1_000_000_000;
    const MAX_AMOUNT: u64 = 0xFFFFFFFF;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100000))]
        #[test]
        fn test_calculate_transfer_fee_included_amount(
            amount in 0..MAX_AMOUNT,
            maximum_fee in 0..MAX_FEE,
            transfer_fee_basis_point in 0..MAX_FEE_BASIS_POINTS
        ) {
            // stub Clock
            solana_program::program_stubs::set_syscall_stubs(Box::new(SyscallStubs {}));
            assert_eq!(Clock::get().unwrap().epoch, 0);

            let mint_with_transfer_fee_config = MintWithTransferFeeConfigLayout {
                is_initialized: true,
                account_type: 1, // Mint
                extension_type: 1, // TransferFeeConfig
                extension_length: 108,
                older_epoch: 0,
                older_maximum_fee: maximum_fee,
                older_transfer_fee_basis_point: transfer_fee_basis_point,
                newer_epoch: 0,
                newer_maximum_fee: maximum_fee,
                newer_transfer_fee_basis_point: transfer_fee_basis_point,
                ..Default::default()
            };

            let mut data = Vec::<u8>::new();
            mint_with_transfer_fee_config.serialize(&mut data).unwrap();
            assert_eq!(data.len(), MintWithTransferFeeConfigLayout::LEN);

            let key = Pubkey::default();
            let mut lamports = 0u64;
            let owner = anchor_spl::token_2022::ID;
            let rent_epoch = 0;
            let is_signer = false;
            let is_writable = false;
            let executable = false;
            let account_info = AccountInfo::new(
                &key,
                is_signer,
                is_writable,
                &mut lamports,
                &mut data,
                &owner,
                executable,
                rent_epoch
            );

            let interface_account_mint = InterfaceAccount::<Mint>::try_from(&account_info).unwrap();

            let transfer_fee = get_epoch_transfer_fee(&interface_account_mint).unwrap().unwrap();
            assert_eq!(u64::from(transfer_fee.maximum_fee), maximum_fee);
            assert_eq!(u16::from(transfer_fee.transfer_fee_basis_points), transfer_fee_basis_point);

            let _ = calculate_transfer_fee_included_amount(&interface_account_mint, amount)?;
        }
    }
}
