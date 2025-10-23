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
            let data_mut = self.tick_data_mut();
            let shift_data = &mut data_mut[byte_offset..];
            shift_data.rotate_right(DynamicTickData::LEN);

            // sync bitmap
            self.update_tick_bitmap(tick_offset, true);
        }

        // If the tick needs to be uninitialized, we need to left-shift everything after byte_offset by DynamicTickData::LEN
        if tick.initialized && !update.initialized {
            let data_mut = self.tick_data_mut();
            let shift_data = &mut data_mut[byte_offset..];
            shift_data.rotate_left(DynamicTickData::LEN);

            // sync bitmap
            self.update_tick_bitmap(tick_offset, false);
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

    fn update_tick_bitmap(&mut self, tick_offset: isize, initialized: bool) {
        let mut tick_bitmap = self.tick_bitmap();
        if initialized {
            tick_bitmap |= 1 << tick_offset;
        } else {
            tick_bitmap &= !(1 << tick_offset);
        }
        self.0[Self::TICK_BITMAP_OFFSET..Self::TICK_BITMAP_OFFSET + 16]
            .copy_from_slice(&tick_bitmap.to_le_bytes());
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

    #[test]
    fn initialize_tick_successfully() {
        let mut array = tick_array();
        let tick_index = 7;

        let before = array.get_tick(tick_index, 1).unwrap();
        assert_eq!(before, uninitialized_tick().into());
        assert!(array.is_tick_bitmap_off(tick_index, 1));

        array
            .update_tick(tick_index, 1, &initialized_tick())
            .unwrap();

        assert_eq!(array.start_tick_index(), 0);
        assert_eq!(array.whirlpool(), Pubkey::default());

        for i in 0..TICK_ARRAY_SIZE {
            let tick = array.get_tick(i, 1).unwrap();
            if i == tick_index || i % 2 == 0 {
                assert_eq!(tick, initialized_tick().into());
                assert!(array.is_tick_bitmap_on(i, 1));
            } else {
                assert_eq!(tick, uninitialized_tick().into());
                assert!(array.is_tick_bitmap_off(i, 1));
            }
        }
    }

    #[test]
    fn uninitialize_tick_successfully() {
        let mut array = tick_array();
        let tick_index = 8;

        let before = array.get_tick(tick_index, 1).unwrap();
        assert_eq!(before, initialized_tick().into());
        assert!(array.is_tick_bitmap_on(tick_index, 1));

        array
            .update_tick(tick_index, 1, &uninitialized_tick())
            .unwrap();

        assert_eq!(array.start_tick_index(), 0);
        assert_eq!(array.whirlpool(), Pubkey::default());

        for i in 0..TICK_ARRAY_SIZE {
            let tick = array.get_tick(i, 1).unwrap();
            if i % 2 == 0 && i != tick_index {
                assert_eq!(tick, initialized_tick().into());
                assert!(array.is_tick_bitmap_on(i, 1));
            } else {
                assert_eq!(tick, uninitialized_tick().into());
                assert!(array.is_tick_bitmap_off(i, 1));
            }
        }
    }

    mod initialize_all_ticks_then_uninitialize_all_ticks {
        use super::*;

        const ASC: [usize; TICK_ARRAY_SIZE_USIZE] = [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
            46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67,
            68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
        ];
        const DESC: [usize; TICK_ARRAY_SIZE_USIZE] = [
            87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66,
            65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44,
            43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22,
            21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
        ];

        const PINGPONG: [usize; TICK_ARRAY_SIZE_USIZE] = [
            0, 87, 1, 86, 2, 85, 3, 84, 4, 83, 5, 82, 6, 81, 7, 80, 8, 79, 9, 78, 10, 77, 11, 76,
            12, 75, 13, 74, 14, 73, 15, 72, 16, 71, 17, 70, 18, 69, 19, 68, 20, 67, 21, 66, 22, 65,
            23, 64, 24, 63, 25, 62, 26, 61, 27, 60, 28, 59, 29, 58, 30, 57, 31, 56, 32, 55, 33, 54,
            34, 53, 35, 52, 36, 51, 37, 50, 38, 49, 39, 48, 40, 47, 41, 46, 42, 45, 43, 44,
        ];
        const PONGPING: [usize; TICK_ARRAY_SIZE_USIZE] = [
            44, 43, 45, 42, 46, 41, 47, 40, 48, 39, 49, 38, 50, 37, 51, 36, 52, 35, 53, 34, 54, 33,
            55, 32, 56, 31, 57, 30, 58, 29, 59, 28, 60, 27, 61, 26, 62, 25, 63, 24, 64, 23, 65, 22,
            66, 21, 67, 20, 68, 19, 69, 18, 70, 17, 71, 16, 72, 15, 73, 14, 74, 13, 75, 12, 76, 11,
            77, 10, 78, 9, 79, 8, 80, 7, 81, 6, 82, 5, 83, 4, 84, 3, 85, 2, 86, 1, 87, 0,
        ];

        const ALL_UNINITIALIZED_BITMAP: u128 = 0;
        const ALL_INITIALIZED_BITMAP: u128 = 309485009821345068724781055; // 2^88 - 1

        fn initialized_tick(offset: usize) -> TickUpdate {
            TickUpdate {
                initialized: true,
                liquidity_net: 0x11002233445566778899aabbccddeeffi128 + offset as i128,
                liquidity_gross: 0xff00eeddccbbaa998877665544332211u128 + offset as u128,
                fee_growth_outside_a: 0x11220033445566778899aabbccddeeffu128 + offset as u128,
                fee_growth_outside_b: 0xffee00ddccbbaa998877665544332211u128 + offset as u128,
                reward_growths_outside: [
                    0x11223300445566778899aabbccddeeffu128 + offset as u128,
                    0x11223344005566778899aabbccddeeffu128 + offset as u128,
                    0x11223344550066778899aabbccddeeffu128 + offset as u128,
                ],
            }
        }

        fn offset_to_tick_index(offset: usize, start_tick_index: i32, tick_spacing: u16) -> i32 {
            start_tick_index + tick_spacing as i32 * offset as i32
        }

        fn test(
            start_tick_index: i32,
            tick_spacing: u16,
            initialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
            uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
        ) {
            let whirlpool = Pubkey::new_unique();

            let mut buf = [0u8; DynamicTickArray::MAX_LEN];

            buf[0..4].copy_from_slice(&start_tick_index.to_le_bytes());
            buf[4..36].copy_from_slice(&whirlpool.to_bytes());

            // all ticks are not initialized
            let array = DynamicTickArrayLoader::load_mut(&mut buf);
            assert!(array.whirlpool() == whirlpool);
            assert!(array.start_tick_index() == start_tick_index);
            assert!(array.tick_bitmap() == ALL_UNINITIALIZED_BITMAP);
            for offset in 0..TICK_ARRAY_SIZE_USIZE {
                assert!(
                    !array
                        .get_tick(
                            offset_to_tick_index(offset, start_tick_index, tick_spacing),
                            tick_spacing
                        )
                        .unwrap()
                        .initialized
                );
            }

            // initialize all ticks
            let mut initialized = 0;
            let mut bitmap = ALL_UNINITIALIZED_BITMAP;
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let offset = initialize_order[i];
                let tick_index = offset_to_tick_index(offset, start_tick_index, tick_spacing);

                // initialize
                let array = DynamicTickArrayLoader::load_mut(&mut buf);
                array
                    .update_tick(tick_index, tick_spacing, &initialized_tick(offset))
                    .unwrap();

                initialized += 1;
                let uninitialized = TICK_ARRAY_SIZE_USIZE - initialized;

                bitmap |= 1 << offset;

                let allocated_buf_size = 32
                    + 4
                    + 16
                    + DynamicTick::INITIALIZED_LEN * initialized
                    + DynamicTick::UNINITIALIZED_LEN * uninitialized;

                // clear not-allocated buf range
                buf[allocated_buf_size..].fill(0u8);

                // check state
                let array = DynamicTickArrayLoader::load(&buf);
                assert!(array.whirlpool() == whirlpool);
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in initialize_order.iter().take(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(tick.initialized);
                    assert_eq!(tick, initialized_tick(*offset).into());
                }

                // dirty write to non-allocated buf range
                buf[allocated_buf_size..].fill(255u8);

                let array = DynamicTickArrayLoader::load(&buf);
                assert!(array.whirlpool() == whirlpool);
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in initialize_order.iter().skip(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(!tick.initialized);
                    assert_eq!(tick, uninitialized_tick().into());
                }
            }

            // all ticks are initialized
            let array = DynamicTickArrayLoader::load(&buf);
            assert!(array.whirlpool() == whirlpool);
            assert!(array.start_tick_index() == start_tick_index);
            assert!(array.tick_bitmap() == ALL_INITIALIZED_BITMAP);
            for offset in 0..TICK_ARRAY_SIZE_USIZE {
                assert!(
                    array
                        .get_tick(
                            offset_to_tick_index(offset, start_tick_index, tick_spacing),
                            tick_spacing
                        )
                        .unwrap()
                        .initialized
                );
            }

            // uninitialize all ticks
            let mut uninitialized = 0;
            let mut bitmap = ALL_INITIALIZED_BITMAP;
            for i in 0..TICK_ARRAY_SIZE_USIZE {
                let offset = uninitialize_order[i];
                let tick_index = offset_to_tick_index(offset, start_tick_index, tick_spacing);

                // uninitialize
                let array = DynamicTickArrayLoader::load_mut(&mut buf);
                array
                    .update_tick(tick_index, tick_spacing, &uninitialized_tick())
                    .unwrap();

                uninitialized += 1;
                let initialized = TICK_ARRAY_SIZE_USIZE - uninitialized;

                bitmap &= !(1 << offset);

                let allocated_buf_size = 32
                    + 4
                    + 16
                    + DynamicTick::INITIALIZED_LEN * initialized
                    + DynamicTick::UNINITIALIZED_LEN * uninitialized;

                // dirty write to non-allocated buf range
                buf[allocated_buf_size..].fill(255u8);

                // check state
                let array = DynamicTickArrayLoader::load(&buf);
                assert!(array.whirlpool() == whirlpool);
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in uninitialize_order.iter().take(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(!tick.initialized);
                    assert_eq!(tick, uninitialized_tick().into());
                }

                // clear not-allocated buf range
                buf[allocated_buf_size..].fill(0u8);

                let array = DynamicTickArrayLoader::load(&buf);
                assert!(array.whirlpool() == whirlpool);
                assert!(array.start_tick_index() == start_tick_index);
                assert!(array.tick_bitmap() == bitmap);
                for offset in uninitialize_order.iter().skip(i + 1) {
                    let tick_index = offset_to_tick_index(*offset, start_tick_index, tick_spacing);
                    let tick = array.get_tick(tick_index, tick_spacing).unwrap();
                    assert!(tick.initialized);
                    assert_eq!(tick, initialized_tick(*offset).into());
                }
            }

            // all ticks are not initialized
            let array = DynamicTickArrayLoader::load(&buf);
            assert!(array.whirlpool() == whirlpool);
            assert!(array.start_tick_index() == start_tick_index);
            assert!(array.tick_bitmap() == ALL_UNINITIALIZED_BITMAP);
            for offset in 0..TICK_ARRAY_SIZE_USIZE {
                assert!(
                    !array
                        .get_tick(
                            offset_to_tick_index(offset, start_tick_index, tick_spacing),
                            tick_spacing
                        )
                        .unwrap()
                        .initialized
                );
            }
        }

        fn tests(
            initialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
            uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE],
        ) {
            test(-176, 1, initialize_order, uninitialize_order);
            test(176, 1, initialize_order, uninitialize_order);
            test(-28160, 64, initialize_order, uninitialize_order);
            test(28160, 64, initialize_order, uninitialize_order);
        }

        #[test]
        fn asc_asc() {
            tests(ASC, ASC);
        }

        #[test]
        fn asc_desc() {
            tests(ASC, DESC);
        }

        #[test]
        fn desc_asc() {
            tests(DESC, ASC);
        }

        #[test]
        fn desc_desc() {
            tests(DESC, DESC);
        }

        #[test]
        fn pingpong_pingpong() {
            tests(PINGPONG, PINGPONG);
        }

        #[test]
        fn pingpong_pongping() {
            tests(PINGPONG, PONGPING);
        }

        #[test]
        fn pongping_pingpong() {
            tests(PONGPING, PINGPONG);
        }

        #[test]
        fn pongping_pongping() {
            tests(PONGPING, PONGPING);
        }

        #[test]
        fn random_random_one() {
            // generated random order
            let initialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                87, 81, 73, 4, 64, 83, 49, 35, 86, 58, 45, 62, 66, 51, 84, 8, 3, 14, 63, 68, 43,
                27, 71, 67, 60, 85, 34, 19, 56, 21, 20, 65, 77, 48, 57, 23, 41, 7, 17, 12, 36, 16,
                22, 52, 69, 55, 18, 44, 24, 28, 47, 6, 13, 29, 31, 53, 2, 61, 37, 42, 76, 32, 39,
                0, 25, 11, 5, 33, 54, 70, 1, 72, 59, 15, 30, 10, 78, 79, 38, 40, 46, 74, 82, 50,
                75, 26, 80, 9,
            ];
            let uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                59, 23, 32, 37, 43, 1, 56, 65, 46, 61, 34, 20, 58, 67, 40, 42, 21, 36, 11, 6, 0,
                29, 13, 82, 75, 76, 30, 57, 81, 73, 24, 68, 79, 18, 51, 74, 10, 12, 15, 71, 38, 7,
                72, 27, 16, 83, 44, 48, 33, 25, 50, 63, 39, 5, 4, 53, 17, 2, 86, 26, 8, 9, 80, 31,
                19, 77, 47, 35, 70, 87, 45, 54, 78, 28, 22, 66, 60, 85, 69, 62, 49, 14, 52, 84, 55,
                3, 41, 64,
            ];
            tests(initialize_order, uninitialize_order);
        }

        #[test]
        fn random_random_two() {
            // generated random order
            let initialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                31, 58, 79, 60, 29, 3, 0, 85, 8, 38, 71, 19, 82, 69, 86, 28, 49, 37, 2, 44, 23, 21,
                10, 73, 18, 32, 76, 41, 42, 67, 63, 64, 78, 9, 45, 16, 35, 26, 46, 13, 59, 40, 74,
                51, 81, 53, 84, 25, 57, 34, 65, 56, 17, 5, 48, 39, 4, 36, 54, 87, 72, 66, 62, 77,
                83, 24, 52, 50, 14, 47, 27, 15, 6, 55, 11, 80, 20, 68, 30, 7, 43, 75, 61, 33, 70,
                1, 22, 12,
            ];
            let uninitialize_order: [usize; TICK_ARRAY_SIZE_USIZE] = [
                9, 41, 33, 39, 31, 54, 24, 82, 42, 19, 20, 30, 21, 2, 49, 72, 80, 14, 62, 7, 44,
                84, 46, 48, 58, 50, 71, 76, 35, 0, 43, 1, 22, 51, 29, 64, 75, 10, 61, 53, 6, 47,
                87, 40, 81, 65, 36, 4, 38, 85, 59, 66, 83, 86, 52, 70, 69, 16, 78, 18, 34, 8, 5,
                27, 63, 13, 37, 68, 57, 23, 32, 25, 28, 56, 26, 15, 55, 67, 3, 77, 79, 73, 45, 17,
                60, 11, 12, 74,
            ];
            tests(initialize_order, uninitialize_order);
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
