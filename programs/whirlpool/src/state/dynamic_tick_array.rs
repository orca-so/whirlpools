use anchor_lang::{prelude::*, Discriminator};
use arrayref::array_ref;

use crate::errors::ErrorCode;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug, PartialEq, Copy)]
pub struct DynamicTickData {
    pub liquidity_net: i128,   // 16
    pub liquidity_gross: u128, // 16

    // Q64.64
    pub fee_growth_outside_a: u128, // 16
    // Q64.64
    pub fee_growth_outside_b: u128, // 16

    // Array of Q64.64
    pub reward_growths_outside: [u128; NUM_REWARDS], // 48 = 16 * 3
}

impl DynamicTickData {
    pub const LEN: usize = 112;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug, PartialEq, Copy)]
pub enum DynamicTick {
    #[default]
    Uninitialized,
    Initialized(DynamicTickData),
}

impl DynamicTick {
    pub const UNINITIALIZED_LEN: usize = 1;
    pub const INITIALIZED_LEN: usize = DynamicTickData::LEN + 1;
}

impl From<&TickUpdate> for DynamicTick {
    fn from(update: &TickUpdate) -> Self {
        if update.initialized {
            DynamicTick::Initialized(DynamicTickData {
                liquidity_net: update.liquidity_net,
                liquidity_gross: update.liquidity_gross,
                fee_growth_outside_a: update.fee_growth_outside_a,
                fee_growth_outside_b: update.fee_growth_outside_b,
                reward_growths_outside: update.reward_growths_outside,
            })
        } else {
            DynamicTick::Uninitialized
        }
    }
}

impl From<DynamicTick> for Tick {
    fn from(val: DynamicTick) -> Self {
        match val {
            DynamicTick::Uninitialized => Tick::default(),
            DynamicTick::Initialized(tick_data) => Tick {
                initialized: true,
                liquidity_net: tick_data.liquidity_net,
                liquidity_gross: tick_data.liquidity_gross,
                fee_growth_outside_a: tick_data.fee_growth_outside_a,
                fee_growth_outside_b: tick_data.fee_growth_outside_b,
                reward_growths_outside: tick_data.reward_growths_outside,
            },
        }
    }
}

// This struct is never actually used anywhere.
// account attr is used to generate the definition in the IDL.
#[cfg_attr(feature = "idl-build", account)]
#[cfg_attr(
    all(not(feature = "idl-build"), test),
    derive(anchor_lang::AnchorDeserialize)
)]
pub struct DynamicTickArray {
    pub start_tick_index: i32, // 4 bytes
    pub whirlpool: Pubkey,     // 32 bytes
    // 0: uninitialized, 1: initialized
    pub tick_bitmap: u128, // 16 bytes
    pub ticks: [DynamicTick; TICK_ARRAY_SIZE_USIZE],
}

impl DynamicTickArray {
    pub const MIN_LEN: usize = DynamicTickArray::DISCRIMINATOR.len()
        + 4
        + 32
        + 16
        + DynamicTick::UNINITIALIZED_LEN * TICK_ARRAY_SIZE_USIZE;
    pub const MAX_LEN: usize = DynamicTickArray::DISCRIMINATOR.len()
        + 4
        + 32
        + 16
        + DynamicTick::INITIALIZED_LEN * TICK_ARRAY_SIZE_USIZE;
}

// Create a private module to generate the discriminator based on the struct name.
mod __private {
    use super::*;
    #[account]
    pub struct DynamicTickArray {}
}

#[cfg(not(feature = "idl-build"))]
impl Discriminator for DynamicTickArray {
    const DISCRIMINATOR: &'static [u8] = __private::DynamicTickArray::DISCRIMINATOR;
}

#[derive(Debug)]
pub struct DynamicTickArrayLoader([u8; DynamicTickArray::MAX_LEN]);

#[cfg(test)]
impl Default for DynamicTickArrayLoader {
    fn default() -> Self {
        Self([0; DynamicTickArray::MAX_LEN])
    }
}

impl DynamicTickArrayLoader {
    // Reimplement these functions from bytemuck::from_bytes_mut without
    // the size and alignment checks. If reading beyond the end of the underlying
    // data, the behavior is undefined.

    pub fn load(data: &[u8]) -> &DynamicTickArrayLoader {
        unsafe { &*(data.as_ptr() as *const DynamicTickArrayLoader) }
    }

    pub fn load_mut(data: &mut [u8]) -> &mut DynamicTickArrayLoader {
        unsafe { &mut *(data.as_mut_ptr() as *mut DynamicTickArrayLoader) }
    }

    // Data layout:
    // 4 bytes for start_tick_index i32
    // 32 bytes for whirlpool pubkey
    // 88 to 9944 bytes for tick data

    const START_TICK_INDEX_OFFSET: usize = 0;
    const WHIRLPOOL_OFFSET: usize = Self::START_TICK_INDEX_OFFSET + 4;
    const TICK_BITMAP_OFFSET: usize = Self::WHIRLPOOL_OFFSET + 32;
    const TICK_DATA_OFFSET: usize = Self::TICK_BITMAP_OFFSET + 16;

    pub fn initialize(
        &mut self,
        whirlpool: &Account<Whirlpool>,
        start_tick_index: i32,
    ) -> Result<()> {
        if !Tick::check_is_valid_start_tick(start_tick_index, whirlpool.tick_spacing) {
            return Err(ErrorCode::InvalidStartTick.into());
        }

        self.0[Self::START_TICK_INDEX_OFFSET..Self::START_TICK_INDEX_OFFSET + 4]
            .copy_from_slice(&start_tick_index.to_le_bytes());
        self.0[Self::WHIRLPOOL_OFFSET..Self::WHIRLPOOL_OFFSET + 32]
            .copy_from_slice(&whirlpool.key().to_bytes());
        Ok(())
    }

    fn tick_data(&self) -> &[u8] {
        &self.0[Self::TICK_DATA_OFFSET..]
    }

    fn tick_data_mut(&mut self) -> &mut [u8] {
        &mut self.0[Self::TICK_DATA_OFFSET..]
    }
}

impl TickArrayType for DynamicTickArrayLoader {
    fn is_variable_size(&self) -> bool {
        true
    }

    fn start_tick_index(&self) -> i32 {
        i32::from_le_bytes(*array_ref![self.0, Self::START_TICK_INDEX_OFFSET, 4])
    }

    fn whirlpool(&self) -> Pubkey {
        Pubkey::new_from_array(*array_ref![self.0, Self::WHIRLPOOL_OFFSET, 32])
    }

    fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>> {
        if !self.in_search_range(tick_index, tick_spacing, !a_to_b) {
            return Err(ErrorCode::InvalidTickArraySequence.into());
        }

        let mut curr_offset = match self.tick_offset(tick_index, tick_spacing) {
            Ok(value) => value as i32,
            Err(e) => return Err(e),
        };

        // For a_to_b searches, the search moves to the left. The next possible init-tick can be the 1st tick in the current offset
        // For b_to_a searches, the search moves to the right. The next possible init-tick cannot be within the current offset
        if !a_to_b {
            curr_offset += 1;
        }

        let tick_bitmap = self.tick_bitmap();
        while (0..TICK_ARRAY_SIZE).contains(&curr_offset) {
            let initialized = Self::is_initialized_tick(&tick_bitmap, curr_offset as isize);
            if initialized {
                return Ok(Some(
                    (curr_offset * tick_spacing as i32) + self.start_tick_index(),
                ));
            }

            curr_offset = if a_to_b {
                curr_offset - 1
            } else {
                curr_offset + 1
            };
        }

        Ok(None)
    }

    fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<Tick> {
        if !self.check_in_array_bounds(tick_index, tick_spacing)
            || !Tick::check_is_usable_tick(tick_index, tick_spacing)
        {
            return Err(ErrorCode::TickNotFound.into());
        }
        let tick_offset = self.tick_offset(tick_index, tick_spacing)?;
        let byte_offset = self.byte_offset(tick_offset)?;
        let ticks_data = self.tick_data();
        let mut tick_data = &ticks_data[byte_offset..byte_offset + DynamicTick::INITIALIZED_LEN];
        let tick = DynamicTick::deserialize(&mut tick_data)?;
        Ok(tick.into())
    }

    fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()> {
        if !self.check_in_array_bounds(tick_index, tick_spacing)
            || !Tick::check_is_usable_tick(tick_index, tick_spacing)
        {
            return Err(ErrorCode::TickNotFound.into());
        }
        let tick_offset = self.tick_offset(tick_index, tick_spacing)?;
        let byte_offset = self.byte_offset(tick_offset)?;
        let data = self.tick_data();
        let mut tick_data = &data[byte_offset..byte_offset + DynamicTick::INITIALIZED_LEN];
        let tick: Tick = DynamicTick::deserialize(&mut tick_data)?.into();

        // If the tick needs to be initialized, we need to right-shift everything after byte_offset by DynamicTickData::LEN
        if !tick.initialized && update.initialized {
            unreachable!("This path is only reachable when increasing liquidity, which is handled by the Pinocchio implementation");
        }

        // If the tick needs to be uninitialized, we need to left-shift everything after byte_offset by DynamicTickData::LEN
        if tick.initialized && !update.initialized {
            unreachable!("This path is only reachable when decreasing liquidity, which is handled by the Pinocchio implementation");
        }

        // Update the tick data at byte_offset
        let tick_data_len = if update.initialized {
            DynamicTick::INITIALIZED_LEN
        } else {
            DynamicTick::UNINITIALIZED_LEN
        };

        let data_mut = self.tick_data_mut();
        let mut tick_data = &mut data_mut[byte_offset..byte_offset + tick_data_len];
        DynamicTick::from(update).serialize(&mut tick_data)?;

        Ok(())
    }
}

impl DynamicTickArrayLoader {
    fn byte_offset(&self, tick_offset: isize) -> Result<usize> {
        if tick_offset < 0 {
            return Err(ErrorCode::TickNotFound.into());
        }

        let tick_bitmap = self.tick_bitmap();
        let mask = (1u128 << tick_offset) - 1;
        let initialized_ticks = (tick_bitmap & mask).count_ones() as usize;
        let uninitialized_ticks = tick_offset as usize - initialized_ticks;

        let offset = initialized_ticks * DynamicTick::INITIALIZED_LEN
            + uninitialized_ticks * DynamicTick::UNINITIALIZED_LEN;
        Ok(offset)
    }

    fn tick_bitmap(&self) -> u128 {
        u128::from_le_bytes(*array_ref![self.0, Self::TICK_BITMAP_OFFSET, 16])
    }

    #[inline(always)]
    fn is_initialized_tick(tick_bitmap: &u128, tick_offset: isize) -> bool {
        (*tick_bitmap & (1 << tick_offset)) != 0
    }
}

#[cfg(test)]
mod array_update_tests {
    use super::*;

    impl DynamicTickArrayLoader {
        fn set_tick_bitmap(&mut self, tick_bitmap: u128) {
            self.0[Self::TICK_BITMAP_OFFSET..Self::TICK_BITMAP_OFFSET + 16]
                .copy_from_slice(&tick_bitmap.to_le_bytes());
        }

        fn is_tick_bitmap_on(&self, tick_index: i32, tick_spacing: u16) -> bool {
            let bitmap = self.tick_bitmap();
            let tick_offset = self.tick_offset(tick_index, tick_spacing).unwrap();
            (bitmap & (1 << tick_offset)) != 0
        }

        fn is_tick_bitmap_off(&self, tick_index: i32, tick_spacing: u16) -> bool {
            !self.is_tick_bitmap_on(tick_index, tick_spacing)
        }
    }

    fn initialized_tick() -> TickUpdate {
        TickUpdate {
            initialized: true,
            liquidity_net: 123,
            liquidity_gross: 456,
            fee_growth_outside_a: 678,
            fee_growth_outside_b: 901,
            reward_growths_outside: [234, 567, 890],
        }
    }

    fn uninitialized_tick() -> TickUpdate {
        TickUpdate::default()
    }

    fn tick_array() -> DynamicTickArrayLoader {
        let mut array = DynamicTickArrayLoader::default();
        let data = array.tick_data_mut();

        // init every other tick
        let mut offset = 0;
        let mut tick_bitmap: u128 = 0;
        for i in 0..TICK_ARRAY_SIZE {
            let initialized = offset % 2 == 0;

            let tick_len = if initialized {
                DynamicTick::INITIALIZED_LEN
            } else {
                DynamicTick::UNINITIALIZED_LEN
            };
            let tick_data = &mut data[offset..offset + tick_len];
            let tick = DynamicTick::from(&if offset % 2 == 0 {
                initialized_tick()
            } else {
                uninitialized_tick()
            });
            tick_data.copy_from_slice(&tick.try_to_vec().unwrap());
            offset += tick_len;

            if initialized {
                tick_bitmap |= 1 << i;
            }
        }

        array.set_tick_bitmap(tick_bitmap);

        array
    }

    #[test]
    fn update_applies_successfully() {
        let update_index = 8;
        let mut array = tick_array();

        let before = array.get_tick(update_index, 1).unwrap();
        assert_eq!(before, initialized_tick().into());
        assert!(array.is_tick_bitmap_on(update_index, 1));

        let new_tick = TickUpdate {
            initialized: true,
            liquidity_net: 24128472184712i128,
            liquidity_gross: 353873892732u128,
            fee_growth_outside_a: 3928372892u128,
            fee_growth_outside_b: 12242u128,
            reward_growths_outside: [53264u128, 539282u128, 98744u128],
        };

        array.update_tick(update_index, 1, &new_tick).unwrap();

        assert_eq!(array.start_tick_index(), 0);
        assert_eq!(array.whirlpool(), Pubkey::default());

        for i in 0..TICK_ARRAY_SIZE {
            let tick = array.get_tick(i, 1).unwrap();
            if i == update_index {
                assert_eq!(tick, new_tick.clone().into());
                assert!(array.is_tick_bitmap_on(i, 1));
            } else if i % 2 == 0 {
                assert_eq!(tick, initialized_tick().into());
                assert!(array.is_tick_bitmap_on(i, 1));
            } else {
                assert_eq!(tick, uninitialized_tick().into());
                assert!(array.is_tick_bitmap_off(i, 1));
            }
        }
    }
}

#[cfg(test)]
mod data_layout_tests {
    use super::*;

    const TICK_ARRAY_START_TICK_INDEX: i32 = 1000;
    const TICK_ARRAY_WHIRLPOOL: Pubkey = Pubkey::new_from_array([5u8; 32]);

    const TICK_LIQUIDITY_NET: i128 = 0x11002233445566778899aabbccddeeffi128;
    const TICK_LIQUIDITY_GROSS: u128 = 0xff00eeddccbbaa998877665544332211u128;
    const TICK_FEE_GROWTH_OUTSIDE_A: u128 = 0x11220033445566778899aabbccddeeffu128;
    const TICK_FEE_GROWTH_OUTSIDE_B: u128 = 0xffee00ddccbbaa998877665544332211u128;
    const TICK_REWARD_GROWTHS_OUTSIDE: [u128; 3] = [
        0x11223300445566778899aabbccddeeffu128,
        0x11223344005566778899aabbccddeeffu128,
        0x11223344550066778899aabbccddeeffu128,
    ];

    // 252: 4 + 32 + 16 + 88 + 112 (no discriminator, 1 tick is initialized)
    fn get_tick_array_data_layout() -> [u8; 252] {
        // manually build the expected Tick data layout
        let mut tick_data = [0u8; DynamicTick::INITIALIZED_LEN];
        let mut offset = 0;
        tick_data[offset] = 1; // DynamicTick::Initialized
        offset += 1;
        tick_data[offset..offset + 16].copy_from_slice(&TICK_LIQUIDITY_NET.to_le_bytes());
        offset += 16;
        tick_data[offset..offset + 16].copy_from_slice(&TICK_LIQUIDITY_GROSS.to_le_bytes());
        offset += 16;
        tick_data[offset..offset + 16].copy_from_slice(&TICK_FEE_GROWTH_OUTSIDE_A.to_le_bytes());
        offset += 16;
        tick_data[offset..offset + 16].copy_from_slice(&TICK_FEE_GROWTH_OUTSIDE_B.to_le_bytes());
        offset += 16;
        for i in 0..NUM_REWARDS {
            tick_data[offset..offset + 16]
                .copy_from_slice(&TICK_REWARD_GROWTHS_OUTSIDE[i].to_le_bytes());
            offset += 16;
        }

        // manually build the expected TickArray data layout
        // note: no discriminator
        let mut tick_array_data = [0u8; 252];
        let mut offset = 0;
        tick_array_data[offset..offset + 4]
            .copy_from_slice(&TICK_ARRAY_START_TICK_INDEX.to_le_bytes());
        offset += 4;
        tick_array_data[offset..offset + 32].copy_from_slice(&TICK_ARRAY_WHIRLPOOL.to_bytes());
        offset += 32;

        // Only the second(offset=1) tick is initialized
        let bitmap = 1u128 << 1;
        tick_array_data[offset..offset + 16].copy_from_slice(&bitmap.to_le_bytes());
        offset += 16;

        offset += 1;
        tick_array_data[offset..offset + DynamicTick::INITIALIZED_LEN].copy_from_slice(&tick_data);
        tick_array_data
    }

    #[test]
    fn test_tick_array_data_layout_account() {
        let tick_array_data = get_tick_array_data_layout();
        let tick_array = DynamicTickArray::deserialize(&mut tick_array_data.as_slice()).unwrap();
        assert_eq!(tick_array.start_tick_index, TICK_ARRAY_START_TICK_INDEX);
        assert_eq!(tick_array.tick_bitmap, 1u128 << 1); // only second(offset=1) tick is initialized
        for i in 0..TICK_ARRAY_SIZE_USIZE {
            let read_tick = tick_array.ticks[i];

            match (read_tick, i) {
                (DynamicTick::Initialized(data), 1) => {
                    assert_eq!(data.liquidity_net, TICK_LIQUIDITY_NET);
                    assert_eq!(data.liquidity_gross, TICK_LIQUIDITY_GROSS);
                    assert_eq!(data.fee_growth_outside_a, TICK_FEE_GROWTH_OUTSIDE_A);
                    assert_eq!(data.fee_growth_outside_b, TICK_FEE_GROWTH_OUTSIDE_B);
                    assert_eq!(data.reward_growths_outside, TICK_REWARD_GROWTHS_OUTSIDE);
                }
                (DynamicTick::Uninitialized, _) => {
                    // All other ticks should be uninitialized
                }
                _ => {
                    // Fail if a tick other than the second is initialized
                    panic!();
                }
            }
        }
        assert_eq!(tick_array.whirlpool, TICK_ARRAY_WHIRLPOOL);
    }

    #[test]
    fn test_tick_array_data_layout_loader() {
        let tick_array_data = get_tick_array_data_layout();

        // cast from bytes to DynamicTickArray (re-interpret)
        let tick_array = DynamicTickArrayLoader::load(&tick_array_data);

        // check that the data layout matches the expected layout
        let read_start_tick_index = tick_array.start_tick_index();
        assert_eq!(read_start_tick_index, TICK_ARRAY_START_TICK_INDEX);
        let read_tick_bitmap = tick_array.tick_bitmap();
        assert_eq!(read_tick_bitmap, 1u128 << 1); // only second(offset=1) tick is initialized
        for i in 0..TICK_ARRAY_SIZE {
            let read_tick = tick_array
                .get_tick(TICK_ARRAY_START_TICK_INDEX + i, 1)
                .unwrap();

            // Only the second tick should be initialized
            if i == 1 {
                assert!(read_tick.initialized);
                let liquidity_net = read_tick.liquidity_net;
                assert_eq!(liquidity_net, TICK_LIQUIDITY_NET);
                let liquidity_gross = read_tick.liquidity_gross;
                assert_eq!(liquidity_gross, TICK_LIQUIDITY_GROSS);
                let fee_growth_outside_a = read_tick.fee_growth_outside_a;
                assert_eq!(fee_growth_outside_a, TICK_FEE_GROWTH_OUTSIDE_A);
                let fee_growth_outside_b = read_tick.fee_growth_outside_b;
                assert_eq!(fee_growth_outside_b, TICK_FEE_GROWTH_OUTSIDE_B);
                let reward_growths_outside = read_tick.reward_growths_outside;
                assert_eq!(reward_growths_outside, TICK_REWARD_GROWTHS_OUTSIDE);
            } else {
                assert!(!read_tick.initialized);
                let liquidity_net = read_tick.liquidity_net;
                assert_eq!(liquidity_net, 0);
                let liquidity_gross = read_tick.liquidity_gross;
                assert_eq!(liquidity_gross, 0);
                let fee_growth_outside_a = read_tick.fee_growth_outside_a;
                assert_eq!(fee_growth_outside_a, 0);
                let fee_growth_outside_b = read_tick.fee_growth_outside_b;
                assert_eq!(fee_growth_outside_b, 0);
                let reward_growths_outside = read_tick.reward_growths_outside;
                assert_eq!(reward_growths_outside, [0u128, 0u128, 0u128]);
            }
        }
        let read_whirlpool = tick_array.whirlpool();
        assert_eq!(read_whirlpool, TICK_ARRAY_WHIRLPOOL);
    }
}

#[cfg(test)]
mod discriminator_tests {
    use super::*;

    #[test]
    fn test_discriminator() {
        let discriminator: [u8; 8] = DynamicTickArray::DISCRIMINATOR.try_into().unwrap();
        // The discriminator is determined by the struct name and not depending on the program id.
        // $ echo -n account:DynamicTickArray | sha256sum | cut -c 1-16
        // 11d8f68ee1c7da38
        assert_eq!(
            discriminator,
            [0x11, 0xd8, 0xf6, 0x8e, 0xe1, 0xc7, 0xda, 0x38]
        );
    }
}

#[cfg(test)]
mod next_init_tick_tests {
    use super::*;

    impl DynamicTickArrayLoader {
        fn set_start_tick_index(&mut self, start_tick_index: i32) {
            self.0[Self::START_TICK_INDEX_OFFSET..Self::START_TICK_INDEX_OFFSET + 4]
                .copy_from_slice(&start_tick_index.to_le_bytes());
        }
    }

    fn tick_update() -> TickUpdate {
        TickUpdate {
            initialized: true,
            ..Default::default()
        }
    }

    #[test]
    fn a_to_b_search_returns_next_init_tick() {
        let mut array = DynamicTickArrayLoader::default();
        let tick_spacing = 8;

        array.update_tick(8, tick_spacing, &tick_update()).unwrap();

        let result = array
            .get_next_init_tick_index(64, tick_spacing, true)
            .unwrap();
        assert_eq!(result, Some(8));
    }

    #[test]
    fn a_to_b_negative_tick() {
        let mut array = DynamicTickArrayLoader::default();
        array.set_start_tick_index(-704);
        let tick_spacing = 8;

        array
            .update_tick(-64, tick_spacing, &tick_update())
            .unwrap();

        let result = array
            .get_next_init_tick_index(-8, tick_spacing, true)
            .unwrap();
        assert_eq!(result, Some(-64));
    }

    #[test]
    fn a_to_b_search_returns_none_if_no_init_tick() {
        let array = DynamicTickArrayLoader::default();
        let tick_index = 64;
        let tick_spacing = 8;

        let result = array
            .get_next_init_tick_index(tick_index, tick_spacing, true)
            .unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn b_to_a_search_returns_next_init_tick() {
        let mut array = DynamicTickArrayLoader::default();
        let tick_spacing = 8;

        array.update_tick(64, tick_spacing, &tick_update()).unwrap();

        let result = array
            .get_next_init_tick_index(8, tick_spacing, false)
            .unwrap();
        assert_eq!(result, Some(64));
    }

    #[test]
    fn b_to_a_negative_tick() {
        let mut array = DynamicTickArrayLoader::default();
        array.set_start_tick_index(-704);
        let tick_index = -64;
        let tick_spacing = 8;

        array.update_tick(-8, tick_spacing, &tick_update()).unwrap();

        let result = array
            .get_next_init_tick_index(tick_index, tick_spacing, false)
            .unwrap();
        assert_eq!(result, Some(-8));
    }

    #[test]
    fn b_to_a_search_returns_none_if_no_init_tick() {
        let array = DynamicTickArrayLoader::default();
        let tick_index = 8;
        let tick_spacing = 8;

        let result = array
            .get_next_init_tick_index(tick_index, tick_spacing, false)
            .unwrap();
        assert_eq!(result, None);
    }
}
