use anchor_lang::prelude::*;

#[account]
pub struct LockConfig {
    pub position: Pubkey,       // 32
    pub position_owner: Pubkey, // 32
    pub whirlpool: Pubkey,      // 32
    pub locked_timestamp: u64,  // 8
    pub lock_type: LockTypeLabel, // 1
                                // 128 RESERVE
}

#[non_exhaustive]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum LockType {
    Permanent,
}

// To avoid storing an enum that may be extended in the future to the account, separate the variant label and value. The value is added flatly to the account.
#[non_exhaustive]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum LockTypeLabel {
    Permanent,
}

impl LockConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1 + 128;

    pub fn initialize(
        &mut self,
        position: Pubkey,
        position_owner: Pubkey,
        whirlpool: Pubkey,
        locked_timestamp: u64,
        lock_type: LockType,
    ) -> Result<()> {
        self.position = position;
        self.position_owner = position_owner;
        self.whirlpool = whirlpool;
        self.locked_timestamp = locked_timestamp;
        match lock_type {
            LockType::Permanent => self.lock_type = LockTypeLabel::Permanent,
        }
        Ok(())
    }

    pub fn update_position_owner(&mut self, position_owner: Pubkey) {
        self.position_owner = position_owner;
    }
}

#[cfg(test)]
mod lock_config_initialize_tests {
    use super::*;

    #[test]
    fn test_initialize() {
        let mut lock_config = LockConfig {
            position: Pubkey::default(),
            position_owner: Pubkey::default(),
            whirlpool: Pubkey::default(),
            lock_type: LockTypeLabel::Permanent,
            locked_timestamp: 0,
        };

        let position = Pubkey::new_unique();
        let position_owner = Pubkey::new_unique();
        let whirlpool = Pubkey::new_unique();
        let locked_timestamp = 1711385715u64;

        let result = lock_config.initialize(
            position,
            position_owner,
            whirlpool,
            locked_timestamp,
            LockType::Permanent,
        );
        assert!(result.is_ok());

        assert_eq!(position, lock_config.position);
        assert_eq!(position_owner, lock_config.position_owner);
        assert_eq!(whirlpool, lock_config.whirlpool);
        assert_eq!(LockTypeLabel::Permanent, lock_config.lock_type);
        assert_eq!(locked_timestamp, lock_config.locked_timestamp);
    }
}

#[cfg(test)]
mod data_layout_tests {
    use anchor_lang::Discriminator;

    use super::*;

    #[test]
    fn test_lock_config_data_layout() {
        let lock_config_position = Pubkey::new_unique();
        let lock_config_position_owner = Pubkey::new_unique();
        let lock_config_whirlpool = Pubkey::new_unique();
        let lock_config_locked_timestamp = 1711385715u64;
        let lock_config_lock_type = LockTypeLabel::Permanent;
        let lock_config_reserved = [0u8; 128];

        let mut lock_config_data = [0u8; LockConfig::LEN];
        let mut offset = 0;
        lock_config_data[offset..offset + 8].copy_from_slice(&LockConfig::discriminator());
        offset += 8;
        lock_config_data[offset..offset + 32].copy_from_slice(&lock_config_position.to_bytes());
        offset += 32;
        lock_config_data[offset..offset + 32]
            .copy_from_slice(&lock_config_position_owner.to_bytes());
        offset += 32;
        lock_config_data[offset..offset + 32].copy_from_slice(&lock_config_whirlpool.to_bytes());
        offset += 32;
        lock_config_data[offset..offset + 8]
            .copy_from_slice(&lock_config_locked_timestamp.to_le_bytes());
        offset += 8;
        lock_config_data[offset] = lock_config_lock_type as u8;
        offset += 1;
        lock_config_data[offset..offset + lock_config_reserved.len()]
            .copy_from_slice(&lock_config_reserved);
        offset += lock_config_reserved.len();
        assert_eq!(offset, LockConfig::LEN);

        // deserialize
        let deserialized = LockConfig::try_deserialize(&mut lock_config_data.as_ref()).unwrap();

        assert_eq!(lock_config_position, deserialized.position);
        assert_eq!(lock_config_position_owner, deserialized.position_owner);
        assert_eq!(lock_config_whirlpool, deserialized.whirlpool);
        assert_eq!(lock_config_locked_timestamp, deserialized.locked_timestamp);
        assert_eq!(lock_config_lock_type, deserialized.lock_type);

        // serialize
        let mut serialized = Vec::new();
        deserialized.try_serialize(&mut serialized).unwrap();
        serialized.extend_from_slice(&lock_config_reserved);

        assert_eq!(serialized.as_slice(), lock_config_data.as_ref());
    }
}
