use anchor_lang::prelude::*;

fn assert_expected_rent_config() -> Result<()> {
    let rent = Rent::get()?;
    match (
        rent.exemption_threshold.to_bits(),
        rent.lamports_per_byte_year,
    ) {
        // floating point number operation is high cost, so we hardcode a precalculated value here
        // see also: https://github.com/anza-xyz/solana-sdk/blob/5390fa973897e969c5adea858079c7de1fa67d07/rent/src/lib.rs#L55-L59
        //           https://github.com/anza-xyz/agave/pull/7373  (SIMD-0194)
        //           https://github.com/anza-xyz/agave/pull/10126 (SIMD-0437 Rent reduction)
        //           https://github.com/anza-xyz/agave/pull/10127 (SIMD-0438 Rent reduction fallback)
        //
        // New params (after SIMD-0194 and Rent reduction (Agave 4.2))
        // - 0x3f_f0_00_00_00_00_00_00u64 = 1.0f64 in u64 bits representation
        // - 6960u64 = 1_000_000_000 / 100 * 365 / (1024 * 1024) * 2
        //
        // Why we use ..=6960u64 here:
        // To ensure that accounts remain rent-exempt even if the rent reduction fallback to 6960 occurs, any value below 6960 is treated as 6960.
        // This also keeps the amount of lamports transferred between Position and DynamicTickArray accounts constant,
        // even if the fallback never occurs.
        // If the amount is not kept constant, it may become possible to withdraw more/less lamports from a DynamicTickArray
        // than were transferred to it during increase liquidity, or the Position account may not have enough lamports to cover the required transfer.
        (0x3f_f0_00_00_00_00_00_00u64, ..=6960u64) |
        // Old params (before SIMD-0194)
        // - 0x40_00_00_00_00_00_00_00u64 = 2.0f64 in u64 bits representation
        // - 3480u64 = 1_000_000_000 / 100 * 365 / (1024 * 1024)
        (0x40_00_00_00_00_00_00_00u64, 3480u64) => { Ok(()) },
        _ => {
            unreachable!(
                "unexpected Rent configuration on the Solana network: lamports_per_byte_year={}, exemption_threshold_bits={:#018x}",
                rent.lamports_per_byte_year,
                rent.exemption_threshold.to_bits(),
            );
        }
    }
}

pub fn get_tick_rent_amount() -> Result<u64> {
    assert_expected_rent_config()?;
    Ok(779_520)
}

pub fn get_dynamic_tick_array_minimum_rent_amount() -> Result<u64> {
    assert_expected_rent_config()?;
    Ok(1_920_960)
}

pub fn get_position_minimum_rent_amount() -> Result<u64> {
    assert_expected_rent_config()?;
    Ok(2_394_240)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCOUNT_STORAGE_OVERHEAD: u64 = 128;
    const FIXED_LAMPORTS_PER_BYTE: u64 = 6960;

    #[test]
    fn assert_tick_len() {
        // get_tick_rent_amount depends on this assumption.
        assert_eq!(
            crate::manager::tick_array_manager::TICK_INITIALIZATION_SIZE,
            112
        );
        assert_eq!(
            get_tick_rent_amount().unwrap(),
            112 * FIXED_LAMPORTS_PER_BYTE
        );
    }

    fn assert_dynamic_tick_array_min_len() {
        // get_dynamic_tick_array_minimum_rent_amount depends on this assumption.
        assert_eq!(
            crate::state::dynamic_tick_array::DynamicTickArray::MIN_LEN,
            148
        );
        assert_eq!(
            get_dynamic_tick_array_minimum_rent_amount().unwrap(),
            (ACCOUNT_STORAGE_OVERHEAD + 148) * FIXED_LAMPORTS_PER_BYTE
        );
    }

    fn assert_position_len() {
        // get_position_minimum_rent_amount depends on this assumption.
        assert_eq!(crate::state::position::Position::LEN, 216);
        assert_eq!(
            get_position_minimum_rent_amount().unwrap(),
            (ACCOUNT_STORAGE_OVERHEAD + 216) * FIXED_LAMPORTS_PER_BYTE
        );
    }
}
