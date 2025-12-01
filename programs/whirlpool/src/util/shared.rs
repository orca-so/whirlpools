use anchor_lang::{
    prelude::{AccountInfo, Pubkey, Signer, *},
    ToAccountInfo,
};
use anchor_spl::token::TokenAccount;
use anchor_spl::token_interface::TokenAccount as TokenAccountInterface;
use solana_program::program_option::COption;
use std::convert::TryFrom;

use crate::{errors::ErrorCode, state};

pub fn verify_position_bundle_authority(
    position_bundle_token_account: &TokenAccount,
    position_bundle_authority: &Signer<'_>,
) -> Result<()> {
    // use same logic
    verify_position_authority(position_bundle_token_account, position_bundle_authority)
}

pub fn verify_position_authority(
    position_token_account: &TokenAccount,
    position_authority: &Signer<'_>,
) -> Result<()> {
    // Check token authority using validate_owner method...
    match position_token_account.delegate {
        COption::Some(ref delegate) if position_authority.key == delegate => {
            validate_owner(delegate, &position_authority.to_account_info())?;
            if position_token_account.delegated_amount != 1 {
                return Err(ErrorCode::InvalidPositionTokenAmount.into());
            }
        }
        _ => validate_owner(
            &position_token_account.owner,
            &position_authority.to_account_info(),
        )?,
    };
    Ok(())
}

pub fn verify_position_authority_interface(
    // position_token_account is owned by either TokenProgram or Token2022Program
    position_token_account: &InterfaceAccount<'_, TokenAccountInterface>,
    position_authority: &Signer<'_>,
) -> Result<()> {
    // Check token authority using validate_owner method...
    match position_token_account.delegate {
        COption::Some(ref delegate) if position_authority.key == delegate => {
            validate_owner(delegate, &position_authority.to_account_info())?;
            if position_token_account.delegated_amount != 1 {
                return Err(ErrorCode::InvalidPositionTokenAmount.into());
            }
        }
        _ => validate_owner(
            &position_token_account.owner,
            &position_authority.to_account_info(),
        )?,
    };
    Ok(())
}

pub fn validate_owner(expected_owner: &Pubkey, owner_account_info: &AccountInfo) -> Result<()> {
    if expected_owner != owner_account_info.key || !owner_account_info.is_signer {
        return Err(ErrorCode::MissingOrInvalidDelegate.into());
    }

    Ok(())
}

pub fn to_timestamp_u64(t: i64) -> Result<u64> {
    u64::try_from(t).or(Err(ErrorCode::InvalidTimestampConversion.into()))
}

pub fn is_locked_position(
    position_token_account: &InterfaceAccount<'_, TokenAccountInterface>,
) -> bool {
    position_token_account.is_frozen()
}

/// Resolve one-sided position ticks when one of the bounds is auto-derived from the current price.
///
/// Rules:
/// - Exactly one bound may be auto-derived:
///   - `tick_lower_index == i32::MIN` → lower = ceil(current_tick, tick_spacing)
///   - `tick_upper_index == i32::MAX` → upper = floor(current_tick, tick_spacing)
/// - If both sentinels are provided, return `InvalidTickIndex`.
/// - Ensure `lower < upper` after snapping; otherwise return `InvalidTickIndex`.
pub fn resolve_one_sided_position_ticks(
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_spacing: u16,
    current_tick: i32,
) -> Result<(i32, i32)> {
    let mut resolved_tick_lower_index = tick_lower_index;
    let mut resolved_tick_upper_index = tick_upper_index;
    let lower_is_sentinel = tick_lower_index == i32::MIN;
    let upper_is_sentinel = tick_upper_index == i32::MAX;
    if lower_is_sentinel || upper_is_sentinel {
        if lower_is_sentinel && upper_is_sentinel {
            return Err(ErrorCode::InvalidTickIndex.into());
        }
        let spacing: i32 = tick_spacing as i32;
        let floor_to_spacing = |t: i32| -> i32 { t - t.rem_euclid(spacing) };
        let ceil_to_spacing = |t: i32| -> i32 {
            let r = t.rem_euclid(spacing);
            if r == 0 {
                t
            } else {
                t + (spacing - r)
            }
        };
        if lower_is_sentinel {
            // Snap just above current tick to stay single-sided.
            let mut snapped = ceil_to_spacing(current_tick);
            if snapped > state::MAX_TICK_INDEX {
                snapped = floor_to_spacing(state::MAX_TICK_INDEX);
            }
            resolved_tick_lower_index = snapped;
        }
        if upper_is_sentinel {
            // Snap just below current tick to stay single-sided.
            let mut snapped = floor_to_spacing(current_tick);
            if snapped < state::MIN_TICK_INDEX {
                // ceil to spacing within bounds
                let r = state::MIN_TICK_INDEX.rem_euclid(spacing);
                snapped = if r == 0 {
                    state::MIN_TICK_INDEX
                } else {
                    state::MIN_TICK_INDEX + (spacing - r)
                };
            }
            resolved_tick_upper_index = snapped;
        }
        if resolved_tick_lower_index >= resolved_tick_upper_index {
            return Err(ErrorCode::InvalidTickIndex.into());
        }
    }
    Ok((resolved_tick_lower_index, resolved_tick_upper_index))
}
