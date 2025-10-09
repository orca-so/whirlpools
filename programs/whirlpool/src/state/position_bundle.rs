use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

pub const POSITION_BITMAP_USIZE: usize = 32;
pub const POSITION_BUNDLE_SIZE: u16 = 8 * POSITION_BITMAP_USIZE as u16;

#[account]
#[derive(Default)]
pub struct PositionBundle {
    pub position_bundle_mint: Pubkey, // 32
    pub position_bitmap: [u8; POSITION_BITMAP_USIZE], // 32
                                      // 64 RESERVE
}

impl PositionBundle {
    pub const LEN: usize = 8 + 32 + 32 + 64;

    pub fn initialize(&mut self, position_bundle_mint: Pubkey) -> Result<()> {
        self.position_bundle_mint = position_bundle_mint;
        // position_bitmap is initialized using Default trait
        Ok(())
    }

    pub fn is_deletable(&self) -> bool {
        for bitmap in self.position_bitmap.iter() {
            if *bitmap != 0 {
                return false;
            }
        }
        true
    }

    pub fn open_bundled_position(&mut self, bundle_index: u16) -> Result<()> {
        self.update_bitmap(bundle_index, true)
    }

    pub fn close_bundled_position(&mut self, bundle_index: u16) -> Result<()> {
        self.update_bitmap(bundle_index, false)
    }

    fn update_bitmap(&mut self, bundle_index: u16, open: bool) -> Result<()> {
        if !PositionBundle::is_valid_bundle_index(bundle_index) {
            return Err(ErrorCode::InvalidBundleIndex.into());
        }

        let bitmap_index = bundle_index / 8;
        let bitmap_offset = bundle_index % 8;
        let bitmap = self.position_bitmap[bitmap_index as usize];

        let mask = 1 << bitmap_offset;
        let bit = bitmap & mask;
        let opened = bit != 0;

        if open && opened {
            // UNREACHABLE
            // Anchor should reject with AccountDiscriminatorAlreadySet
            return Err(ErrorCode::BundledPositionAlreadyOpened.into());
        }
        if !open && !opened {
            // UNREACHABLE
            // Anchor should reject with AccountNotInitialized
            return Err(ErrorCode::BundledPositionAlreadyClosed.into());
        }

        let updated_bitmap = bitmap ^ mask;
        self.position_bitmap[bitmap_index as usize] = updated_bitmap;

        Ok(())
    }

    fn is_valid_bundle_index(bundle_index: u16) -> bool {
        bundle_index < POSITION_BUNDLE_SIZE
    }
}

#[cfg(test)]
mod position_bundle_initialize_tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_default() {
        let position_bundle = PositionBundle {
            ..Default::default()
        };
        assert_eq!(position_bundle.position_bundle_mint, Pubkey::default());
        for bitmap in position_bundle.position_bitmap.iter() {
            assert_eq!(*bitmap, 0);
        }
    }

    #[test]
    fn test_initialize() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };
        let position_bundle_mint =
            Pubkey::from_str("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE").unwrap();

        let result = position_bundle.initialize(position_bundle_mint);
        assert!(result.is_ok());

        assert_eq!(position_bundle.position_bundle_mint, position_bundle_mint);
        for bitmap in position_bundle.position_bitmap.iter() {
            assert_eq!(*bitmap, 0);
        }
    }
}

#[cfg(test)]
mod position_bundle_is_deletable_tests {
    use super::*;

    #[test]
    fn test_default_is_deletable() {
        let position_bundle = PositionBundle {
            ..Default::default()
        };
        assert!(position_bundle.is_deletable());
    }

    #[test]
    fn test_each_bit_detectable() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };
        for bundle_index in 0..POSITION_BUNDLE_SIZE {
            let index = bundle_index / 8;
            let offset = bundle_index % 8;
            position_bundle.position_bitmap[index as usize] = 1 << offset;
            assert!(!position_bundle.is_deletable());
            position_bundle.position_bitmap[index as usize] = 0;
            assert!(position_bundle.is_deletable());
        }
    }
}

#[cfg(test)]
mod position_bundle_open_and_close_tests {
    use super::*;

    #[test]
    fn test_open_and_close_zero() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        let r1 = position_bundle.open_bundled_position(0);
        assert!(r1.is_ok());
        assert_eq!(position_bundle.position_bitmap[0], 1);

        let r2 = position_bundle.close_bundled_position(0);
        assert!(r2.is_ok());
        assert_eq!(position_bundle.position_bitmap[0], 0);
    }

    #[test]
    fn test_open_and_close_middle() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        let r1 = position_bundle.open_bundled_position(130);
        assert!(r1.is_ok());
        assert_eq!(position_bundle.position_bitmap[16], 4);

        let r2 = position_bundle.close_bundled_position(130);
        assert!(r2.is_ok());
        assert_eq!(position_bundle.position_bitmap[16], 0);
    }

    #[test]
    fn test_open_and_close_max() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        let r1 = position_bundle.open_bundled_position(POSITION_BUNDLE_SIZE - 1);
        assert!(r1.is_ok());
        assert_eq!(
            position_bundle.position_bitmap[POSITION_BITMAP_USIZE - 1],
            128
        );

        let r2 = position_bundle.close_bundled_position(POSITION_BUNDLE_SIZE - 1);
        assert!(r2.is_ok());
        assert_eq!(
            position_bundle.position_bitmap[POSITION_BITMAP_USIZE - 1],
            0
        );
    }

    #[test]
    fn test_double_open_should_be_failed() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        let r1 = position_bundle.open_bundled_position(0);
        assert!(r1.is_ok());

        let r2 = position_bundle.open_bundled_position(0);
        assert!(r2.is_err());
    }

    #[test]
    fn test_double_close_should_be_failed() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        let r1 = position_bundle.open_bundled_position(0);
        assert!(r1.is_ok());

        let r2 = position_bundle.close_bundled_position(0);
        assert!(r2.is_ok());

        let r3 = position_bundle.close_bundled_position(0);
        assert!(r3.is_err());
    }

    #[test]
    fn test_all_open_and_all_close() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        for bundle_index in 0..POSITION_BUNDLE_SIZE {
            let r = position_bundle.open_bundled_position(bundle_index);
            assert!(r.is_ok());
        }

        for bitmap in position_bundle.position_bitmap.iter() {
            assert_eq!(*bitmap, 255);
        }

        for bundle_index in 0..POSITION_BUNDLE_SIZE {
            let r = position_bundle.close_bundled_position(bundle_index);
            assert!(r.is_ok());
        }

        for bitmap in position_bundle.position_bitmap.iter() {
            assert_eq!(*bitmap, 0);
        }
    }

    #[test]
    fn test_open_bundle_index_out_of_bounds() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        for bundle_index in POSITION_BUNDLE_SIZE..u16::MAX {
            let r = position_bundle.open_bundled_position(bundle_index);
            assert!(r.is_err());
        }
    }

    #[test]
    fn test_close_bundle_index_out_of_bounds() {
        let mut position_bundle = PositionBundle {
            ..Default::default()
        };

        for bundle_index in POSITION_BUNDLE_SIZE..u16::MAX {
            let r = position_bundle.close_bundled_position(bundle_index);
            assert!(r.is_err());
        }
    }
}

#[cfg(test)]
mod discriminator_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_discriminator() {
        let discriminator = PositionBundle::discriminator();
        // The discriminator is determined by the struct name and not depending on the program id.
        // $ echo -n account:PositionBundle | sha256sum | cut -c 1-16
        // 81a9af41b95f2064
        assert_eq!(discriminator, [129, 169, 175, 65, 185, 95, 32, 100]);
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_position_bundle_data_layout() {
        let position_bundle_position_bundle_mint = Pubkey::new_unique();
        let position_bundle_position_bitmap = [0xFFu8; POSITION_BITMAP_USIZE];
        let position_bundle_reserved = [0u8; 64];

        let mut position_bundle_data = [0u8; PositionBundle::LEN];
        let mut offset = 0;
        position_bundle_data[offset..offset + 8].copy_from_slice(&PositionBundle::discriminator());
        offset += 8;
        position_bundle_data[offset..offset + 32]
            .copy_from_slice(&position_bundle_position_bundle_mint.to_bytes());
        offset += 32;
        position_bundle_data[offset..offset + POSITION_BITMAP_USIZE]
            .copy_from_slice(&position_bundle_position_bitmap);
        offset += POSITION_BITMAP_USIZE;
        position_bundle_data[offset..offset + position_bundle_reserved.len()]
            .copy_from_slice(&position_bundle_reserved);
        offset += position_bundle_reserved.len();
        assert_eq!(offset, PositionBundle::LEN);

        // deserialize
        let deserialized =
            PositionBundle::try_deserialize(&mut position_bundle_data.as_ref()).unwrap();

        assert_eq!(
            position_bundle_position_bundle_mint,
            deserialized.position_bundle_mint
        );
        assert_eq!(
            position_bundle_position_bitmap,
            deserialized.position_bitmap
        );

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();
        serialized.extend_from_slice(&position_bundle_reserved);

        assert_eq!(serialized.as_slice(), position_bundle_data.as_ref());
    }
}
