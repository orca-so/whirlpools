use anchor_lang::{
    prelude::{AccountInfo, Pubkey, Signer, *},
    ToAccountInfo,
};
use anchor_spl::token::TokenAccount;
use anchor_spl::token_interface::TokenAccount as TokenAccountInterface;
use solana_program::program_option::COption;
use std::convert::TryFrom;

use crate::{
    errors::ErrorCode,
    math::{
        sqrt_price_from_tick_index, tick_index_from_sqrt_price,
        FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD,
    },
    state,
};

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
    // note: use .map_err, .or is high cost because it always generates a new error.
    u64::try_from(t).map_err(|_| ErrorCode::InvalidTimestampConversion.into())
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
///   - `tick_lower_index == i32::MIN` → lower becomes the first initializable tick at or above the
///     current sqrt-price (strictly above when the price sits between ticks).
///   - `tick_upper_index == i32::MAX` → upper becomes the last initializable tick at or below the
///     current sqrt-price.
/// - If both sentinels are provided, return `InvalidTickIndex`.
/// - Ensure `lower < upper` after snapping; otherwise return `InvalidTickIndex`.
pub fn resolve_one_sided_position_ticks(
    tick_lower_index: i32,
    tick_upper_index: i32,
    tick_spacing: u16,
    current_sqrt_price: u128,
) -> Result<(i32, i32)> {
    let lower_is_sentinel = tick_lower_index == i32::MIN;
    let upper_is_sentinel = tick_upper_index == i32::MAX;
    let is_full_range_only = tick_spacing >= FULL_RANGE_ONLY_TICK_SPACING_THRESHOLD;
    // If the pool is full-range only, or both bounds are provided, return the original bounds.
    if (!lower_is_sentinel && !upper_is_sentinel) || is_full_range_only {
        return Ok((tick_lower_index, tick_upper_index));
    }
    if lower_is_sentinel && upper_is_sentinel {
        return Err(ErrorCode::InvalidTickIndex.into());
    }
    // Either lower or upper is sentinel, so we need to resolve the other bound.
    let mut resolved_tick_lower_index = tick_lower_index;
    let mut resolved_tick_upper_index = tick_upper_index;

    let tick_spacing_i32: i32 = tick_spacing as i32;
    let snap_tick_down = |t: i32| -> i32 { t - t.rem_euclid(tick_spacing_i32) };
    let snap_tick_up = |t: i32| -> i32 {
        let r = t.rem_euclid(tick_spacing_i32);
        if r == 0 {
            t
        } else {
            t + (tick_spacing_i32 - r)
        }
    };
    let price_tick = tick_index_from_sqrt_price(&current_sqrt_price);
    let price_is_on_tick = sqrt_price_from_tick_index(price_tick) == current_sqrt_price;

    if lower_is_sentinel {
        // Snap just above the current sqrt price to stay single-sided.
        let anchor_tick = if price_is_on_tick {
            price_tick
        } else {
            price_tick + 1
        };
        let snapped = snap_tick_up(anchor_tick);
        if snapped > state::MAX_TICK_INDEX {
            return Err(ErrorCode::InvalidTickIndex.into());
        }
        resolved_tick_lower_index = snapped;
    }
    if upper_is_sentinel {
        // Snap just below the current sqrt price to stay single-sided.
        let snapped = snap_tick_down(price_tick);
        if snapped < state::MIN_TICK_INDEX {
            return Err(ErrorCode::InvalidTickIndex.into());
        }
        resolved_tick_upper_index = snapped;
    }
    Ok((resolved_tick_lower_index, resolved_tick_upper_index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{errors::ErrorCode, math::sqrt_price_from_tick_index, state};

    #[test]
    fn returns_original_bounds_when_no_sentinels_are_provided() {
        let sqrt_price = sqrt_price_from_tick_index(15);
        let result = resolve_one_sided_position_ticks(10, 20, 1, sqrt_price).unwrap();
        assert_eq!(result, (10, 20));
    }

    #[test]
    fn errors_when_both_sentinels_are_provided() {
        let sqrt_price = sqrt_price_from_tick_index(0);
        let err = resolve_one_sided_position_ticks(i32::MIN, i32::MAX, 1, sqrt_price).unwrap_err();
        assert_eq!(err, ErrorCode::InvalidTickIndex.into());
    }

    #[test]
    fn resolves_lower_sentinel_by_snapping_up_to_spacing() {
        let sqrt_price = sqrt_price_from_tick_index(37);
        let result = resolve_one_sided_position_ticks(i32::MIN, 200, 10, sqrt_price)
            .expect("lower sentinel ok");
        assert_eq!(result, (40, 200));
    }

    #[test]
    fn resolves_lower_sentinel_using_sqrt_price_when_between_ticks() {
        let sqrt_price_between_ticks = sqrt_price_from_tick_index(8).saturating_add(1);
        let result = resolve_one_sided_position_ticks(i32::MIN, 200, 4, sqrt_price_between_ticks)
            .expect("lower sentinel handles price between ticks");
        assert_eq!(result, (12, 200));
    }

    #[test]
    fn resolves_upper_sentinel_by_snapping_down_to_spacing() {
        let sqrt_price = sqrt_price_from_tick_index(37);
        let result = resolve_one_sided_position_ticks(-200, i32::MAX, 10, sqrt_price)
            .expect("upper sentinel ok");
        assert_eq!(result, (-200, 30));
    }

    #[test]
    fn resolves_upper_sentinel_using_sqrt_price_when_tick_shifted() {
        let sqrt_price_just_above_zero = sqrt_price_from_tick_index(0).saturating_add(1);
        let result =
            resolve_one_sided_position_ticks(-200, i32::MAX, 4, sqrt_price_just_above_zero)
                .expect("upper sentinel handles shifted tick index");
        assert_eq!(result, (-200, 0));
    }

    #[test]
    fn resolves_lower_sentinel_when_price_is_on_initializable_tick() {
        // sqrt price sits exactly on an initializable tick (8 with spacing 4)
        let sqrt_price = sqrt_price_from_tick_index(8);
        let result = resolve_one_sided_position_ticks(i32::MIN, 200, 4, sqrt_price)
            .expect("lower on-tick initializable");
        assert_eq!(result, (8, 200));
    }

    #[test]
    fn resolves_upper_sentinel_when_price_is_on_initializable_tick() {
        // sqrt price sits exactly on an initializable tick (8 with spacing 4)
        let sqrt_price = sqrt_price_from_tick_index(8);
        let result = resolve_one_sided_position_ticks(-200, i32::MAX, 4, sqrt_price)
            .expect("upper on-tick initializable");
        assert_eq!(result, (-200, 8));
    }

    #[test]
    fn resolves_lower_sentinel_with_negative_price_tick() {
        // current tick index is negative and not initializable for spacing 4 (-6)
        // snap up to the first initializable tick at or above: -4
        let sqrt_price = sqrt_price_from_tick_index(-6);
        let result = resolve_one_sided_position_ticks(i32::MIN, 200, 4, sqrt_price)
            .expect("lower sentinel negative tick");
        assert_eq!(result, (-4, 200));
    }

    #[test]
    fn resolves_upper_sentinel_with_negative_price_tick() {
        // current tick index is negative and not initializable for spacing 4 (-6)
        // snap down to the last initializable tick at or below: -8
        let sqrt_price = sqrt_price_from_tick_index(-6);
        let result = resolve_one_sided_position_ticks(-200, i32::MAX, 4, sqrt_price)
            .expect("upper sentinel negative tick");
        assert_eq!(result, (-200, -8));
    }

    #[test]
    fn errors_when_snapped_lower_exceeds_max_tick() {
        let sqrt_price = sqrt_price_from_tick_index(state::MAX_TICK_INDEX - 5).saturating_add(1);
        let err = resolve_one_sided_position_ticks(i32::MIN, state::MAX_TICK_INDEX, 10, sqrt_price)
            .unwrap_err();
        assert_eq!(err, ErrorCode::InvalidTickIndex.into());
    }

    #[test]
    fn errors_when_snapped_upper_drops_below_min_tick() {
        let sqrt_price = sqrt_price_from_tick_index(state::MIN_TICK_INDEX + 5).saturating_sub(1);
        let err = resolve_one_sided_position_ticks(state::MIN_TICK_INDEX, i32::MAX, 10, sqrt_price)
            .unwrap_err();
        assert_eq!(err, ErrorCode::InvalidTickIndex.into());
    }
}
