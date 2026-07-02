use super::super::{BytesI32, BytesU128, BytesU16, BytesU64, Pubkey};
use crate::pinocchio::state::WhirlpoolProgramAccount;
use pinocchio::instruction::Seed;

#[repr(C)]
pub struct MemoryMappedWhirlpoolRewardInfo {
    mint: Pubkey,
    vault: Pubkey,
    extension: [u8; 32],
    emissions_per_second_x64: BytesU128,
    growth_global_x64: BytesU128,
}

impl MemoryMappedWhirlpoolRewardInfo {
    #[inline(always)]
    pub fn mint(&self) -> &Pubkey {
        &self.mint
    }

    #[inline(always)]
    pub fn vault(&self) -> &Pubkey {
        &self.vault
    }

    #[inline(always)]
    pub fn extension(&self) -> &[u8; 32] {
        &self.extension
    }

    #[inline(always)]
    pub fn extension_mut(&mut self) -> &mut [u8; 32] {
        &mut self.extension
    }

    #[inline(always)]
    pub fn emissions_per_second_x64(&self) -> u128 {
        u128::from_le_bytes(self.emissions_per_second_x64)
    }

    #[inline(always)]
    pub fn growth_global_x64(&self) -> u128 {
        u128::from_le_bytes(self.growth_global_x64)
    }

    #[inline(always)]
    pub fn initialized(&self) -> bool {
        self.mint != Pubkey::default()
    }
}

#[repr(C)]
pub struct MemoryMappedWhirlpool {
    discriminator: [u8; 8],

    whirlpools_config: Pubkey,
    whirlpool_bump: [u8; 1],
    tick_spacing: BytesU16,
    fee_tier_index_seed: [u8; 2],
    fee_rate: BytesU16,
    protocol_fee_rate: BytesU16,
    liquidity: BytesU128,
    sqrt_price: BytesU128,
    tick_current_index: BytesI32,
    protocol_fee_owed_a: BytesU64,
    protocol_fee_owed_b: BytesU64,
    token_mint_a: Pubkey,
    token_vault_a: Pubkey,
    fee_growth_global_a: BytesU128,
    token_mint_b: Pubkey,
    token_vault_b: Pubkey,
    fee_growth_global_b: BytesU128,
    reward_last_updated_timestamp: BytesU64,
    reward_infos: [MemoryMappedWhirlpoolRewardInfo; crate::state::NUM_REWARDS],
}

impl WhirlpoolProgramAccount for MemoryMappedWhirlpool {
    const DISCRIMINATOR: [u8; 8] = [0x3f, 0x95, 0xd1, 0x0c, 0xe1, 0x80, 0x63, 0x09];
}

impl MemoryMappedWhirlpool {
    #[inline(always)]
    pub fn seeds(&self) -> [Seed<'_>; 6] {
        [
            Seed::from(b"whirlpool"),
            Seed::from(&self.whirlpools_config),
            Seed::from(&self.token_mint_a),
            Seed::from(&self.token_mint_b),
            Seed::from(&self.fee_tier_index_seed),
            Seed::from(&self.whirlpool_bump),
        ]
    }

    #[inline(always)]
    pub fn tick_spacing(&self) -> u16 {
        u16::from_le_bytes(self.tick_spacing)
    }

    #[inline(always)]
    pub fn liquidity(&self) -> u128 {
        u128::from_le_bytes(self.liquidity)
    }

    #[inline(always)]
    pub fn sqrt_price(&self) -> u128 {
        u128::from_le_bytes(self.sqrt_price)
    }

    #[inline(always)]
    pub fn tick_current_index(&self) -> i32 {
        i32::from_le_bytes(self.tick_current_index)
    }

    #[inline(always)]
    pub fn token_mint_a(&self) -> &Pubkey {
        &self.token_mint_a
    }

    #[inline(always)]
    pub fn token_mint_b(&self) -> &Pubkey {
        &self.token_mint_b
    }

    #[inline(always)]
    pub fn token_vault_a(&self) -> &Pubkey {
        &self.token_vault_a
    }

    #[inline(always)]
    pub fn token_vault_b(&self) -> &Pubkey {
        &self.token_vault_b
    }

    #[inline(always)]
    pub fn fee_growth_global_a(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_global_a)
    }

    #[inline(always)]
    pub fn fee_growth_global_b(&self) -> u128 {
        u128::from_le_bytes(self.fee_growth_global_b)
    }

    #[inline(always)]
    pub fn reward_last_updated_timestamp(&self) -> u64 {
        u64::from_le_bytes(self.reward_last_updated_timestamp)
    }

    #[inline(always)]
    pub fn reward_infos(&self) -> &[MemoryMappedWhirlpoolRewardInfo; crate::state::NUM_REWARDS] {
        &self.reward_infos
    }

    pub fn update_liquidity_and_reward_growth_global(
        &mut self,
        liquidity: u128,
        reward_growth_global: &[u128; crate::state::NUM_REWARDS],
        reward_last_updated_timestamp: u64,
    ) {
        self.set_liquidity(liquidity);
        self.set_reward_growth_global(reward_growth_global);
        self.set_reward_last_updated_timestamp(reward_last_updated_timestamp);
        self.advance_state_sequence();
    }

    fn set_liquidity(&mut self, liquidity: u128) {
        self.liquidity = liquidity.to_le_bytes();
    }

    fn set_reward_growth_global(
        &mut self,
        reward_growth_global: &[u128; crate::state::NUM_REWARDS],
    ) {
        self.reward_infos[0].growth_global_x64 = reward_growth_global[0].to_le_bytes();
        self.reward_infos[1].growth_global_x64 = reward_growth_global[1].to_le_bytes();
        self.reward_infos[2].growth_global_x64 = reward_growth_global[2].to_le_bytes();
    }

    fn set_reward_last_updated_timestamp(&mut self, last_updated_timestamp: u64) {
        self.reward_last_updated_timestamp = last_updated_timestamp.to_le_bytes();
    }

    fn advance_state_sequence(&mut self) {
        let extension = self.reward_infos[1].extension_mut();
        let state_sequence =
            u32::from_le_bytes([extension[2], extension[3], extension[4], extension[5]]);

        let next_state_sequence = state_sequence.wrapping_add(1);
        extension[2..6].copy_from_slice(&next_state_sequence.to_le_bytes());
    }
}

#[cfg(test)]
mod state_sequence_tests {
    use super::*;

    fn new_memory_mapped_whirlpool() -> MemoryMappedWhirlpool {
        unsafe { std::mem::MaybeUninit::<MemoryMappedWhirlpool>::zeroed().assume_init() }
    }

    // test only for now
    impl MemoryMappedWhirlpool {
        pub fn state_sequence(&self) -> u32 {
            let extension = &self.reward_infos[1].extension;
            u32::from_le_bytes([extension[2], extension[3], extension[4], extension[5]])
        }
    }

    #[test]
    fn test_state_sequence() {
        let mut whirlpool = new_memory_mapped_whirlpool();

        assert_eq!(whirlpool.state_sequence(), 0);
        whirlpool.reward_infos[1].extension = [
            0xff, 0xff, 0x11, 0x22, 0x33, 0x44, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0xff, 0xff,
        ];
        assert_eq!(whirlpool.state_sequence(), 0x44332211); // little endian
    }

    #[test]
    fn test_advance_state_sequence_increment() {
        let mut whirlpool = new_memory_mapped_whirlpool();

        assert_eq!(whirlpool.state_sequence(), 0);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 1);
        for expected in 2..100 {
            whirlpool.advance_state_sequence();
            assert_eq!(whirlpool.state_sequence(), expected);
        }

        whirlpool.reward_infos[1].extension[2..6].copy_from_slice(&[0xff, 0x00, 0x00, 0x00]);
        assert_eq!(whirlpool.state_sequence(), 0x000000ff);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0x000000ff + 1);

        whirlpool.reward_infos[1].extension[2..6].copy_from_slice(&[0xff, 0xff, 0x00, 0x00]);
        assert_eq!(whirlpool.state_sequence(), 0x0000ffff);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0x0000ffff + 1);

        whirlpool.reward_infos[1].extension[2..6].copy_from_slice(&[0xff, 0xff, 0xff, 0x00]);
        assert_eq!(whirlpool.state_sequence(), 0x00ffffff);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0x00ffffff + 1);
    }

    #[test]
    fn test_advance_state_sequence_other_field_check() {
        let mut whirlpool = new_memory_mapped_whirlpool();

        whirlpool.reward_infos[0].extension = [0xf0u8; 32];
        whirlpool.reward_infos[1].extension = [
            0xaa, 0xbb, 0x11, 0x22, 0x33, 0x44, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0xff, 0xff,
        ];
        whirlpool.reward_infos[2].extension = [0x0fu8; 32];

        assert_eq!(whirlpool.state_sequence(), 0x44332211);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0x44332212);

        assert_eq!(whirlpool.reward_infos[0].extension, [0xf0u8; 32]);
        assert_eq!(
            whirlpool.reward_infos[1].extension,
            [
                0xaa, 0xbb, 0x12, 0x22, 0x33, 0x44, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
                0xff, 0xff, 0xff, 0xff,
            ]
        );
        assert_eq!(whirlpool.reward_infos[2].extension, [0x0fu8; 32]);
    }

    #[test]
    fn test_advance_state_sequence_wrap() {
        let mut whirlpool = new_memory_mapped_whirlpool();

        whirlpool.reward_infos[1].extension[2..6].copy_from_slice(&[0xfe, 0xff, 0xff, 0xff]);
        assert_eq!(whirlpool.state_sequence(), 0xfffffffe);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0xffffffff);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0x00000000);
        whirlpool.advance_state_sequence();
        assert_eq!(whirlpool.state_sequence(), 0x00000001);
    }

    #[test]
    fn mut_functions_increment_state_sequence() {
        let mut whirlpool = new_memory_mapped_whirlpool();

        let mut expected_state_sequence = 0;

        assert_eq!(whirlpool.state_sequence(), expected_state_sequence);

        // update_liquidity_and_reward_growth_global
        whirlpool.update_liquidity_and_reward_growth_global(
            whirlpool.liquidity(),
            &[0, 0, 0],
            whirlpool.reward_last_updated_timestamp(),
        );
        expected_state_sequence += 1;
        assert_eq!(whirlpool.state_sequence(), expected_state_sequence);
    }
}
