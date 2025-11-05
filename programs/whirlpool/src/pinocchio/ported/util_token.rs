use crate::pinocchio::{
    cpi::{memo_build_memo::BuildMemo, token_transfer_checked::TransferChecked},
    errors::WhirlpoolErrorCode,
    state::token::{
        extensions::{parse_token_extensions, TokenExtensions},
        MemoryMappedTokenMint,
    },
    utils::account_load::{load_token_program_account, load_token_program_account_unchecked},
    Result,
};
use crate::util::TransferFeeIncludedAmount;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::{
    TransferFee, MAX_FEE_BASIS_POINTS,
};
use pinocchio::account_info::AccountInfo;
use pinocchio::pubkey::Pubkey;
use pinocchio::sysvars::{clock::Clock, Sysvar};

pub fn pino_calculate_transfer_fee_included_amount(
    token_mint_info: &AccountInfo,
    transfer_fee_excluded_amount: u64,
) -> Result<TransferFeeIncludedAmount> {
    if transfer_fee_excluded_amount == 0 {
        return Ok(TransferFeeIncludedAmount {
            amount: 0,
            transfer_fee: 0,
        });
    }

    // now transfer_fee_excluded_amount > 0

    // This mint account is stored as token_mint_a or token_mint_b of the whirlpool, so it must be valid Mint account.
    let token_mint =
        load_token_program_account_unchecked::<MemoryMappedTokenMint>(token_mint_info)?;
    let token_mint_extensions = parse_token_extensions(token_mint.extensions_tlv_data())?;
    if let Some(epoch_transfer_fee) = pino_get_epoch_transfer_fee(&token_mint_extensions)? {
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
                    .ok_or(WhirlpoolErrorCode::TransferFeeCalculationError)?
            };

        let transfer_fee_included_amount =
            transfer_fee_excluded_amount
                .checked_add(transfer_fee)
                .ok_or(WhirlpoolErrorCode::TransferFeeCalculationError)?;

        // verify transfer fee calculation for safety
        let transfer_fee_verification = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .unwrap();
        if transfer_fee != transfer_fee_verification {
            // We believe this should never happen
            return Err(WhirlpoolErrorCode::TransferFeeCalculationError.into());
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

fn pino_get_epoch_transfer_fee(token_extensions: &TokenExtensions) -> Result<Option<TransferFee>> {
    match token_extensions.transfer_fee_config {
        None => Ok(None),
        Some(config) => {
            let epoch = Clock::get()?.epoch;

            if epoch >= config.newer_transfer_fee_epoch() {
                Ok(Some(TransferFee {
                    epoch: config.newer_transfer_fee_epoch().into(),
                    transfer_fee_basis_points: config
                        .newer_transfer_fee_transfer_fee_basis_points()
                        .into(),
                    maximum_fee: config.newer_transfer_fee_maximum_fee().into(),
                }))
            } else {
                Ok(Some(TransferFee {
                    epoch: config.older_transfer_fee_epoch().into(),
                    transfer_fee_basis_points: config
                        .older_transfer_fee_transfer_fee_basis_points()
                        .into(),
                    maximum_fee: config.older_transfer_fee_maximum_fee().into(),
                }))
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn pino_transfer_from_owner_to_vault_v2(
    authority_info: &AccountInfo,
    token_mint_info: &AccountInfo,
    token_owner_account_info: &AccountInfo,
    token_vault_info: &AccountInfo,
    token_program: &AccountInfo,
    memo_program: &AccountInfo,
    transfer_hook_accounts: &Option<Vec<&AccountInfo>>,
    amount: u64,
) -> Result<()> {
    let token_mint = load_token_program_account::<MemoryMappedTokenMint>(token_mint_info)?;
    let decimals = token_mint.decimals();

    // This mint account is stored as token_mint_a or token_mint_b of the whirlpool, so it must be valid Mint account.
    let token_mint =
        load_token_program_account_unchecked::<MemoryMappedTokenMint>(token_mint_info)?;
    let token_mint_extensions = parse_token_extensions(token_mint.extensions_tlv_data())?;

    // TransferFee extension
    if let Some(epoch_transfer_fee) = pino_get_epoch_transfer_fee(&token_mint_extensions)? {
        // log applied transfer fee
        // - Not must, but important for ease of investigation and replay when problems occur
        // - Use Memo because logs risk being truncated
        let transfer_fee_memo = format!(
            "TFe: {}, {}",
            u16::from(epoch_transfer_fee.transfer_fee_basis_points),
            u64::from(epoch_transfer_fee.maximum_fee),
        );
        BuildMemo {
            program: memo_program,
            memo: &transfer_fee_memo,
        }
        .invoke_signed(&[])?;
    }

    // MemoTransfer extension
    // The vault doesn't have MemoTransfer extension, so we don't need to use memo_program here

    // TransferHook extension
    if let Some(hook_program_id) = pino_get_transfer_hook_program_id(&token_mint_extensions)? {
        // TODO: implement transfer with TransferHook CPI
        unimplemented!()
        /*
        solana_program::log::sol_log_compute_units();
        let mut account_infos = vec![
            // owner to vault
            token_owner_account.to_account_info(), // from (owner account)
            token_mint.to_account_info(),          // mint
            token_vault.to_account_info(),         // to (vault account)
            authority.to_account_info(),           // authority (owner)
        ];
        solana_program::log::sol_log_compute_units();

        let transfer_hook_accounts = transfer_hook_accounts
            .as_deref()
            .ok_or(ErrorCode::NoExtraAccountsForTransferHook)?;

        spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi(
            &mut instruction,
            &mut account_infos,
            &hook_program_id,
            // owner to vault
            token_owner_account.to_account_info(), // from (owner account)
            token_mint.to_account_info(),          // mint
            token_vault.to_account_info(),         // to (vault account)
            authority.to_account_info(),           // authority (owner)
            amount,
            transfer_hook_accounts,
        )?;
        solana_program::log::sol_log_compute_units();
        solana_program::program::invoke_signed(&instruction, &account_infos, &[])?;
        solana_program::log::sol_log_compute_units();
        */
    } else {
        TransferChecked {
            program: token_program,
            from: token_owner_account_info,
            mint: token_mint_info,
            to: token_vault_info,
            authority: authority_info,
            amount,
            decimals,
        }
        .invoke_signed(&[])?;
    }

    Ok(())
}

fn pino_get_transfer_hook_program_id<'a>(
    token_extensions: &'a TokenExtensions,
) -> Result<Option<&'a Pubkey>> {
    match token_extensions.transfer_hook {
        None => Ok(None),
        Some(hook) => Ok(Some(&hook.program_id())),
    }
}
