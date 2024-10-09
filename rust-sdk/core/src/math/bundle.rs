#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use ethnum::U256;

use crate::POSITION_BUNDLE_SIZE;

const POSITION_BUNDLE_BYTES: usize = POSITION_BUNDLE_SIZE / 8;

/// Get the first unoccupied position in a bundle
///
/// # Arguments
/// * `bundle` - The bundle to check
///
/// # Returns
/// * `u32` - The first unoccupied position
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = firstUnoccupiedPositionInBundle, skip_jsdoc))]
pub fn first_unoccupied_position_in_bundle(bitmap: &[u8]) -> u32 {
    let value = bitmap_to_u256(bitmap);
    for i in 0..POSITION_BUNDLE_SIZE {
        if value & (U256::ONE << i) == 0 {
            return i as u32;
        }
    }
    panic!("No unoccupied position in bundle");
}

/// Check whether a position bundle is full
/// A position bundle can contain 256 positions
///
/// # Arguments
/// * `bundle` - The bundle to check
///
/// # Returns
/// * `bool` - Whether the bundle is full
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = isPositionBundleFull, skip_jsdoc))]
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
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = isPositionBundleEmpty, skip_jsdoc))]
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
        assert_eq!(first_unoccupied_position_in_bundle(&bundle), 0);

        let mut empty_bundle: [u8; POSITION_BUNDLE_BYTES] = [0; POSITION_BUNDLE_BYTES];
        empty_bundle[0] = 0b11101111;
        assert_eq!(first_unoccupied_position_in_bundle(&empty_bundle), 4);

        let mut full_bundle: [u8; POSITION_BUNDLE_BYTES] = [255; POSITION_BUNDLE_BYTES];
        full_bundle[10] = 0b10111111;
        assert_eq!(first_unoccupied_position_in_bundle(&full_bundle), 86);
    }

    #[test]
    #[should_panic(expected = "No unoccupied position in bundle")]
    fn test_first_unoccupied_position_in_bundle_panic() {
        let bundle: [u8; POSITION_BUNDLE_BYTES] = [255; POSITION_BUNDLE_BYTES];
        first_unoccupied_position_in_bundle(&bundle);
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
