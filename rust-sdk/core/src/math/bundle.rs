#[cfg(feature = "wasm")]
use orca_whirlpools_macros::wasm_expose;

use ethnum::U256;

use crate::POSITION_BUNDLE_SIZE;

const POSITION_BUNDLE_BYTES: usize = POSITION_BUNDLE_SIZE / 8;

/// Get the first unoccupied position in a bundle
///
/// # Arguments
/// * `bundle` - The bundle to check
///
/// # Returns
/// * `u32` - The first unoccupied position (None if full)
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn first_unoccupied_position_in_bundle(bitmap: &[u8]) -> Option<u32> {
    let value = bitmap_to_u256(bitmap);
    for i in 0..POSITION_BUNDLE_SIZE {
        if value & (U256::ONE << i) == 0 {
            return Some(i as u32);
        }
    }
    None
}

/// Check whether a position bundle is full
/// A position bundle can contain 256 positions
///
/// # Arguments
/// * `bundle` - The bundle to check
///
/// # Returns
/// * `bool` - Whether the bundle is full
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn is_position_bundle_full(bitmap: &[u8]) -> bool {
    let value = bitmap_to_u256(bitmap);
    value == U256::MAX
}

/// Check whether a position bundle is empty
///
/// # Arguments
/// * `bundle` - The bundle to check
///
/// # Returns
/// * `bool` - Whether the bundle is empty
#[cfg_attr(feature = "wasm", wasm_expose)]
pub fn is_position_bundle_empty(bitmap: &[u8]) -> bool {
    let value = bitmap_to_u256(bitmap);
    value == U256::MIN
}

// Private functions

#[allow(clippy::needless_range_loop)]
fn bitmap_to_u256(bitmap: &[u8]) -> U256 {
    let mut u256 = <U256>::from(0u32);
    for i in 0..POSITION_BUNDLE_BYTES {
        let byte = bitmap[i];
        u256 += <U256>::from(byte) << (i * 8);
    }
    u256
}

#[cfg(all(test, not(feature = "wasm")))]
mod tests {
    use super::*;

    #[test]
    fn test_first_unoccupied_position_in_bundle() {
        let bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        assert_eq!(first_unoccupied_position_in_bundle(&bundle), Some(0));

        let mut low_bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        low_bundle[0] = 0b11101111;
        assert_eq!(first_unoccupied_position_in_bundle(&low_bundle), Some(4));

        let mut high_bundle: [u8; POSITION_BUNDLE_BYTES] = [255; POSITION_BUNDLE_BYTES];
        high_bundle[10] = 0b10111111;
        assert_eq!(first_unoccupied_position_in_bundle(&high_bundle), Some(86));

        let full_bundle: [u8; POSITION_BUNDLE_BYTES] = [255; POSITION_BUNDLE_BYTES];
        assert_eq!(first_unoccupied_position_in_bundle(&full_bundle), None);
    }

    #[test]
    fn test_is_position_bundle_full() {
        let bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        assert!(!is_position_bundle_full(&bundle));

        let bundle: [u8; POSITION_BUNDLE_BYTES] = [255; POSITION_BUNDLE_BYTES];
        assert!(is_position_bundle_full(&bundle));

        let mut bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        bundle[0] = 0b11111111;
        assert!(!is_position_bundle_full(&bundle));
    }

    #[test]
    fn test_is_position_bundle_empty() {
        let bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        assert!(is_position_bundle_empty(&bundle));

        let bundle: [u8; POSITION_BUNDLE_BYTES] = [255; POSITION_BUNDLE_BYTES];
        assert!(!is_position_bundle_empty(&bundle));

        let mut bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        bundle[0] = 0b111111;
        assert!(!is_position_bundle_empty(&bundle));
    }
}
