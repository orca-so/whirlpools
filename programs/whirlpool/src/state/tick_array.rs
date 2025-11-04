use std::{
    cell::{Ref, RefMut},
    ops::{Deref, DerefMut},
};

use crate::errors::ErrorCode as OrcaError;
use anchor_lang::{prelude::*, Discriminator};
use arrayref::array_ref;

use super::{
    DynamicTickArray, DynamicTickArrayLoader, FixedTickArray, Tick, TickUpdate, MAX_TICK_INDEX,
    MIN_TICK_INDEX,
};

// We have two consts because most of our code uses it as a i32. However,
// for us to use it in tick array declarations, anchor requires it to be a usize.
pub const TICK_ARRAY_SIZE: i32 = 88;
pub const TICK_ARRAY_SIZE_USIZE: usize = 88;

pub trait TickArrayType {
    fn is_variable_size(&self) -> bool;
    fn start_tick_index(&self) -> i32;
    fn whirlpool(&self) -> Pubkey;

    fn get_next_init_tick_index(
        &self,
        tick_index: i32,
        tick_spacing: u16,
        a_to_b: bool,
    ) -> Result<Option<i32>>;

    fn get_tick(&self, tick_index: i32, tick_spacing: u16) -> Result<Tick>;

    fn update_tick(
        &mut self,
        tick_index: i32,
        tick_spacing: u16,
        update: &TickUpdate,
    ) -> Result<()>;

    /// Checks that this array holds the next tick index for the current tick index, given the pool's tick spacing & search direction.
    ///
    /// unshifted checks on [start, start + TICK_ARRAY_SIZE * tick_spacing)
    /// shifted checks on [start - tick_spacing, start + (TICK_ARRAY_SIZE - 1) * tick_spacing) (adjusting range by -tick_spacing)
    ///
    /// shifted == !a_to_b
    ///
    /// For a_to_b swaps, price moves left. All searchable ticks in this tick-array's range will end up in this tick's usable ticks.
    /// The search range is therefore the range of the tick-array.
    ///
    /// For b_to_a swaps, this tick-array's left-most ticks can be the 'next' usable tick-index of the previous tick-array.
    /// The right-most ticks also points towards the next tick-array. The search range is therefore shifted by 1 tick-spacing.
    fn in_search_range(&self, tick_index: i32, tick_spacing: u16, shifted: bool) -> bool {
        let mut lower = self.start_tick_index();
        let mut upper = self.start_tick_index() + TICK_ARRAY_SIZE * tick_spacing as i32;
        if shifted {
            lower -= tick_spacing as i32;
            upper -= tick_spacing as i32;
        }
        tick_index >= lower && tick_index < upper
    }

    fn check_in_array_bounds(&self, tick_index: i32, tick_spacing: u16) -> bool {
        self.in_search_range(tick_index, tick_spacing, false)
    }

    fn is_min_tick_array(&self) -> bool {
        self.start_tick_index() <= MIN_TICK_INDEX
    }

    fn is_max_tick_array(&self, tick_spacing: u16) -> bool {
        self.start_tick_index() + TICK_ARRAY_SIZE * (tick_spacing as i32) > MAX_TICK_INDEX
    }

    fn tick_offset(&self, tick_index: i32, tick_spacing: u16) -> Result<isize> {
        if tick_spacing == 0 {
            return Err(OrcaError::InvalidTickSpacing.into());
        }

        Ok(get_offset(
            tick_index,
            self.start_tick_index(),
            tick_spacing,
        ))
    }
}

fn get_offset(tick_index: i32, start_tick_index: i32, tick_spacing: u16) -> isize {
    // TODO: replace with i32.div_floor once not experimental
    let lhs = tick_index - start_tick_index;
    // rhs(tick_spacing) is always positive number (non zero)
    let rhs = tick_spacing as i32;
    let d = lhs / rhs;
    let r = lhs % rhs;
    let o = if r < 0 { d - 1 } else { d };
    o as isize
}

pub type LoadedTickArray<'a> = Ref<'a, dyn TickArrayType>;

pub fn load_tick_array<'a>(
    account: &'a AccountInfo<'_>,
    whirlpool: &Pubkey,
) -> Result<LoadedTickArray<'a>> {
    if *account.owner != crate::ID {
        return Err(ErrorCode::AccountOwnedByWrongProgram.into());
    }

    let data = account.try_borrow_data()?;

    if data.len() < 8 {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let discriminator = array_ref![data, 0, 8];
    let tick_array: LoadedTickArray<'a> = if discriminator == FixedTickArray::DISCRIMINATOR {
        Ref::map(data, |data| {
            let tick_array: &FixedTickArray = bytemuck::from_bytes(&data[8..]);
            tick_array
        })
    } else if discriminator == DynamicTickArray::DISCRIMINATOR {
        Ref::map(data, |data| {
            let tick_array: &DynamicTickArrayLoader = DynamicTickArrayLoader::load(&data[8..]);
            tick_array
        })
    } else {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    };

    if tick_array.whirlpool() != *whirlpool {
        return Err(OrcaError::DifferentWhirlpoolTickArrayAccount.into());
    }

    Ok(tick_array)
}

pub type LoadedTickArrayMut<'a> = RefMut<'a, dyn TickArrayType>;

pub fn load_tick_array_mut<'a, 'info>(
    account: &'a AccountInfo<'info>,
    whirlpool: &Pubkey,
) -> Result<LoadedTickArrayMut<'a>> {
    if !account.is_writable {
        return Err(ErrorCode::AccountNotMutable.into());
    }

    if *account.owner != crate::ID {
        return Err(ErrorCode::AccountOwnedByWrongProgram.into());
    }

    let data = account.try_borrow_mut_data()?;

    if data.len() < 8 {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let discriminator = array_ref![data, 0, 8];
    let tick_array: LoadedTickArrayMut<'a> = if discriminator == FixedTickArray::DISCRIMINATOR {
        RefMut::map(data, |data| {
            let tick_array: &mut FixedTickArray =
                bytemuck::from_bytes_mut(&mut data.deref_mut()[8..]);
            tick_array
        })
    } else if discriminator == DynamicTickArray::DISCRIMINATOR {
        RefMut::map(data, |data| {
            let tick_array: &mut DynamicTickArrayLoader =
                DynamicTickArrayLoader::load_mut(&mut data.deref_mut()[8..]);
            tick_array
        })
    } else {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    };

    if tick_array.whirlpool() != *whirlpool {
        return Err(OrcaError::DifferentWhirlpoolTickArrayAccount.into());
    }

    Ok(tick_array)
}

/// In increase and decrease liquidity, we directly load the tick arrays mutably.
/// Lower and upper ticker arrays might refer to the same account. We cannot load
/// the same account mutably twice so we just return None if the accounts are the same.
pub struct TickArraysMut<'a> {
    lower_tick_array_ref: LoadedTickArrayMut<'a>,
    upper_tick_array_ref: Option<LoadedTickArrayMut<'a>>,
}

impl<'a> TickArraysMut<'a> {
    pub fn load(
        lower_tick_array_info: &'a AccountInfo<'_>,
        upper_tick_array_info: &'a AccountInfo<'_>,
        whirlpool: &Pubkey,
    ) -> Result<Self> {
        let lower_tick_array = load_tick_array_mut(lower_tick_array_info, whirlpool)?;
        let upper_tick_array = if lower_tick_array_info.key() == upper_tick_array_info.key() {
            None
        } else {
            Some(load_tick_array_mut(upper_tick_array_info, whirlpool)?)
        };
        Ok(Self {
            lower_tick_array_ref: lower_tick_array,
            upper_tick_array_ref: upper_tick_array,
        })
    }

    pub fn deref(&self) -> (&dyn TickArrayType, &dyn TickArrayType) {
        if let Some(upper_tick_array_ref) = &self.upper_tick_array_ref {
            (
                self.lower_tick_array_ref.deref(),
                upper_tick_array_ref.deref(),
            )
        } else {
            (
                self.lower_tick_array_ref.deref(),
                self.lower_tick_array_ref.deref(),
            )
        }
    }

    // Since we can only borrow mutably once, we return None if the upper tick array
    // is the same as the lower tick array
    pub fn deref_mut(&mut self) -> (&mut dyn TickArrayType, Option<&mut dyn TickArrayType>) {
        if let Some(upper_tick_array_ref) = &mut self.upper_tick_array_ref {
            (
                self.lower_tick_array_ref.deref_mut(),
                Some(upper_tick_array_ref.deref_mut()),
            )
        } else {
            (self.lower_tick_array_ref.deref_mut(), None)
        }
    }
}

#[cfg(test)]
mod fuzz_tests {
    use crate::state::tick_array_builder::TickArrayBuilder;

    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_get_search_and_offset(
            tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            start_tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            tick_spacing in 1u16..u16::MAX,
            a_to_b in proptest::bool::ANY,
        ) {
            let array = TickArrayBuilder::default()
                .whirlpool(Pubkey::new_unique())
                .start_tick_index(start_tick_index)
                .build();

            let in_search = array.in_search_range(tick_index, tick_spacing, !a_to_b);

            let mut lower_bound = start_tick_index;
            let mut upper_bound = start_tick_index + TICK_ARRAY_SIZE * tick_spacing as i32;
            let mut offset_lower = 0;
            let mut offset_upper = TICK_ARRAY_SIZE as isize;

            // If we are doing b_to_a, we shift the index bounds by -tick_spacing
            // and the offset bounds by -1
            if !a_to_b {
                lower_bound -= tick_spacing as i32;
                upper_bound -= tick_spacing as i32;
                offset_lower = -1;
                offset_upper -= 1;
            }

            // in_bounds should be identical to search
            let in_bounds = tick_index >= lower_bound && tick_index < upper_bound;
            assert!(in_bounds == in_search);

            if in_search {
                let offset = get_offset(tick_index, start_tick_index, tick_spacing);
                assert!(offset >= offset_lower && offset < offset_upper)
            }
        }

        #[test]
        fn test_get_offset(
            tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            start_tick_index in 2 * MIN_TICK_INDEX..2 * MAX_TICK_INDEX,
            tick_spacing in 1u16..u16::MAX,
        ) {
            let offset = get_offset(tick_index, start_tick_index, tick_spacing);
            let rounded = start_tick_index >= tick_index;
            let raw = (tick_index - start_tick_index) / tick_spacing as i32;
            let d = raw as isize;
            if !rounded {
                assert_eq!(offset, d);
            } else {
                assert!(offset == d || offset == (raw - 1) as isize);
            }
        }
    }
}

#[cfg(test)]
mod fixed_tick_array_tests {
    use std::{mem, ops::Deref};

    use anchor_lang::solana_program::clock::Epoch;

    use crate::state::tick_array_builder::TickArrayBuilder;

    use super::*;

    #[test]
    fn test_load() {
        let start_tick_index = 1234;
        let tick = Tick {
            initialized: true,
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        };
        let tick_array = TickArrayBuilder::default()
            .whirlpool(Pubkey::new_unique())
            .start_tick_index(start_tick_index)
            .ticks([tick; TICK_ARRAY_SIZE_USIZE])
            .build();
        let tick_array_data = bytemuck::bytes_of(&tick_array);
        let mut tick_array_data_with_discriminator = [0u8; mem::size_of::<FixedTickArray>() + 8];
        tick_array_data_with_discriminator[0..8].copy_from_slice(FixedTickArray::DISCRIMINATOR);
        tick_array_data_with_discriminator[8..].copy_from_slice(tick_array_data);
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data_with_discriminator,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array(&account, &tick_array.whirlpool()).unwrap();
        let read_tick_array = tick_array_ref.deref();
        assert_eq!(read_tick_array.start_tick_index(), start_tick_index);
        assert_eq!(read_tick_array.whirlpool(), tick_array.whirlpool());
        for i in 0..TICK_ARRAY_SIZE {
            assert_eq!(
                read_tick_array.get_tick(start_tick_index + i, 1).unwrap(),
                tick
            );
        }
    }

    #[test]
    fn test_load_mut() {
        let start_tick_index = 1234;
        let tick = Tick {
            initialized: true,
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        };
        let tick_array = TickArrayBuilder::default()
            .whirlpool(Pubkey::new_unique())
            .start_tick_index(start_tick_index)
            .ticks([tick; TICK_ARRAY_SIZE_USIZE])
            .build();

        let tick_array_data = bytemuck::bytes_of(&tick_array);
        let mut tick_array_data_with_discriminator = [0u8; mem::size_of::<FixedTickArray>() + 8];
        tick_array_data_with_discriminator[0..8].copy_from_slice(FixedTickArray::DISCRIMINATOR);
        tick_array_data_with_discriminator[8..].copy_from_slice(tick_array_data);
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data_with_discriminator,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array_mut(&account, &tick_array.whirlpool()).unwrap();
        let read_tick_array = tick_array_ref.deref();
        assert_eq!(read_tick_array.start_tick_index(), start_tick_index);
        assert_eq!(read_tick_array.whirlpool(), tick_array.whirlpool());
        for i in 0..TICK_ARRAY_SIZE {
            assert_eq!(
                read_tick_array.get_tick(start_tick_index + i, 1).unwrap(),
                tick
            );
        }
    }

    #[test]
    fn fail_on_wrong_whirlpool() {
        let start_tick_index = 1234;
        let tick = Tick {
            initialized: true,
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        };
        let tick_array = TickArrayBuilder::default()
            .whirlpool(Pubkey::new_unique())
            .start_tick_index(start_tick_index)
            .ticks([tick; TICK_ARRAY_SIZE_USIZE])
            .build();

        let tick_array_data = bytemuck::bytes_of(&tick_array);
        let mut tick_array_data_with_discriminator = [0u8; mem::size_of::<FixedTickArray>() + 8];
        tick_array_data_with_discriminator[0..8].copy_from_slice(FixedTickArray::DISCRIMINATOR);
        tick_array_data_with_discriminator[8..].copy_from_slice(tick_array_data);
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data_with_discriminator,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let other_whirlpool = Pubkey::new_unique();
        let tick_array_ref = load_tick_array(&account, &other_whirlpool);
        assert!(
            matches!(tick_array_ref, Err(err) if err == OrcaError::DifferentWhirlpoolTickArrayAccount.into())
        );
    }

    #[test]
    fn fail_on_wrong_whirlpool_mut() {
        let start_tick_index = 1234;
        let tick = Tick {
            initialized: true,
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        };
        let tick_array = TickArrayBuilder::default()
            .whirlpool(Pubkey::new_unique())
            .start_tick_index(start_tick_index)
            .ticks([tick; TICK_ARRAY_SIZE_USIZE])
            .build();

        let tick_array_data = bytemuck::bytes_of(&tick_array);
        let mut tick_array_data_with_discriminator = [0u8; mem::size_of::<FixedTickArray>() + 8];
        tick_array_data_with_discriminator[0..8].copy_from_slice(FixedTickArray::DISCRIMINATOR);
        tick_array_data_with_discriminator[8..].copy_from_slice(tick_array_data);
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data_with_discriminator,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let other_whirlpool = Pubkey::new_unique();
        let tick_array_ref = load_tick_array_mut(&account, &other_whirlpool);
        assert!(
            matches!(tick_array_ref, Err(err) if err == OrcaError::DifferentWhirlpoolTickArrayAccount.into())
        );
    }
}

#[cfg(test)]
mod dynamic_tick_array_tests {
    use std::ops::Deref;

    use anchor_lang::solana_program::clock::Epoch;

    use crate::state::{DynamicTick, DynamicTickData};

    use super::*;

    #[test]
    fn test_load() {
        let mut ticks = [DynamicTick::default(); TICK_ARRAY_SIZE_USIZE];
        ticks[0] = DynamicTick::Initialized(DynamicTickData {
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        });

        let tick_data = borsh::to_vec(&ticks).unwrap();
        let whirlpool = Pubkey::new_unique();
        let start_tick_index = 1234i32;

        let mut tick_array_data: Vec<u8> = vec![0u8; 8 + 4 + 32 + 16 + tick_data.len()];

        let mut offset = 0;
        tick_array_data[offset..offset + 8].copy_from_slice(DynamicTickArray::DISCRIMINATOR);
        offset += 8;
        tick_array_data[offset..offset + 4].copy_from_slice(&start_tick_index.to_le_bytes());
        offset += 4;
        tick_array_data[offset..offset + 32].copy_from_slice(&whirlpool.to_bytes());
        offset += 32;
        tick_array_data[offset..offset + 16].copy_from_slice(&1u128.to_le_bytes());
        offset += 16;
        tick_array_data[offset..offset + tick_data.len()].copy_from_slice(&tick_data);

        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array(&account, &whirlpool).unwrap();
        let read_tick_array = tick_array_ref.deref();
        assert_eq!(read_tick_array.start_tick_index(), start_tick_index);
        assert_eq!(read_tick_array.whirlpool(), whirlpool);
        assert_eq!(
            read_tick_array.get_tick(start_tick_index, 1).unwrap(),
            ticks[0].into()
        );
        for i in 1..TICK_ARRAY_SIZE {
            assert_eq!(
                read_tick_array.get_tick(start_tick_index + i, 1).unwrap(),
                Tick::default()
            );
        }
    }

    #[test]
    fn test_load_mut() {
        let mut ticks = [DynamicTick::default(); TICK_ARRAY_SIZE_USIZE];
        ticks[0] = DynamicTick::Initialized(DynamicTickData {
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        });

        let tick_data = borsh::to_vec(&ticks).unwrap();
        let whirlpool = Pubkey::new_unique();
        let start_tick_index = 1234i32;

        let mut tick_array_data: Vec<u8> = vec![0u8; 8 + 4 + 32 + 16 + tick_data.len()];

        let mut offset = 0;
        tick_array_data[offset..offset + 8].copy_from_slice(DynamicTickArray::DISCRIMINATOR);
        offset += 8;
        tick_array_data[offset..offset + 4].copy_from_slice(&start_tick_index.to_le_bytes());
        offset += 4;
        tick_array_data[offset..offset + 32].copy_from_slice(&whirlpool.to_bytes());
        offset += 32;
        tick_array_data[offset..offset + 16].copy_from_slice(&1u128.to_le_bytes());
        offset += 16;
        tick_array_data[offset..offset + tick_data.len()].copy_from_slice(&tick_data);

        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array_mut(&account, &whirlpool).unwrap();
        let read_tick_array = tick_array_ref.deref();
        assert_eq!(read_tick_array.start_tick_index(), start_tick_index);
        assert_eq!(read_tick_array.whirlpool(), whirlpool);
        assert_eq!(
            read_tick_array.get_tick(start_tick_index, 1).unwrap(),
            ticks[0].into()
        );
        for i in 1..TICK_ARRAY_SIZE {
            assert_eq!(
                read_tick_array.get_tick(start_tick_index + i, 1).unwrap(),
                Tick::default()
            );
        }
    }

    #[test]
    fn fail_on_wrong_whirlpool() {
        let mut ticks = [DynamicTick::default(); TICK_ARRAY_SIZE_USIZE];
        ticks[0] = DynamicTick::Initialized(DynamicTickData {
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        });

        let tick_data = borsh::to_vec(&ticks).unwrap();
        let whirlpool = Pubkey::new_unique();
        let start_tick_index = 1234i32;

        let mut tick_array_data: Vec<u8> = vec![0u8; tick_data.len() + 8 + 32 + 8];

        let mut offset = 0;
        tick_array_data[offset..offset + 8].copy_from_slice(DynamicTickArray::DISCRIMINATOR);
        offset += 8;
        tick_array_data[offset..offset + 4].copy_from_slice(&start_tick_index.to_le_bytes());
        offset += 4;
        tick_array_data[offset..offset + 32].copy_from_slice(&whirlpool.to_bytes());
        offset += 32;
        tick_array_data[offset..offset + tick_data.len()].copy_from_slice(&tick_data);

        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let other_whirlpool = Pubkey::new_unique();
        let tick_array_ref = load_tick_array(&account, &other_whirlpool);
        assert!(
            matches!(tick_array_ref, Err(err) if err == OrcaError::DifferentWhirlpoolTickArrayAccount.into())
        );
    }

    #[test]
    fn fail_on_wrong_whirlpool_mut() {
        let mut ticks = [DynamicTick::default(); TICK_ARRAY_SIZE_USIZE];
        ticks[0] = DynamicTick::Initialized(DynamicTickData {
            liquidity_net: 1,
            liquidity_gross: 2,
            fee_growth_outside_a: 3,
            fee_growth_outside_b: 4,
            reward_growths_outside: [5, 6, 7],
        });

        let tick_data = borsh::to_vec(&ticks).unwrap();
        let whirlpool = Pubkey::new_unique();
        let start_tick_index = 1234i32;

        let mut tick_array_data: Vec<u8> = vec![0u8; tick_data.len() + 8 + 32 + 8];

        let mut offset = 0;
        tick_array_data[offset..offset + 8].copy_from_slice(DynamicTickArray::DISCRIMINATOR);
        offset += 8;
        tick_array_data[offset..offset + 4].copy_from_slice(&start_tick_index.to_le_bytes());
        offset += 4;
        tick_array_data[offset..offset + 32].copy_from_slice(&whirlpool.to_bytes());
        offset += 32;
        tick_array_data[offset..offset + tick_data.len()].copy_from_slice(&tick_data);

        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut tick_array_data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let other_whirlpool = Pubkey::new_unique();
        let tick_array_ref = load_tick_array_mut(&account, &other_whirlpool);
        assert!(
            matches!(tick_array_ref, Err(err) if err == OrcaError::DifferentWhirlpoolTickArrayAccount.into())
        );
    }
}

#[cfg(test)]
mod tick_array_misc_tests {
    use anchor_lang::solana_program::clock::Epoch;

    use super::*;

    #[test]
    fn fail_on_wrong_discriminator() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 8];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array(&account, &Pubkey::new_unique());
        assert!(
            matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountDiscriminatorMismatch.into())
        );
    }

    #[test]
    fn fail_on_wrong_discriminator_mut() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 8];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array_mut(&account, &Pubkey::new_unique());
        assert!(
            matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountDiscriminatorMismatch.into())
        );
    }

    #[test]
    fn fail_on_data_too_small() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 2];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array(&account, &Pubkey::new_unique());
        assert!(
            matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountDiscriminatorNotFound.into())
        );
    }

    #[test]
    fn fail_on_data_too_small_mut() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 2];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array_mut(&account, &Pubkey::new_unique());
        assert!(
            matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountDiscriminatorNotFound.into())
        );
    }

    #[test]
    fn fail_on_wrong_owner() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 8];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut data,
            &anchor_spl::token::spl_token::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array(&account, &Pubkey::new_unique());
        assert!(
            matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountOwnedByWrongProgram.into())
        );
    }

    #[test]
    fn fail_on_wrong_owner_mut() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 8];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            true,
            &mut lamports,
            &mut data,
            &anchor_spl::token::spl_token::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array_mut(&account, &Pubkey::new_unique());
        assert!(
            matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountOwnedByWrongProgram.into())
        );
    }

    #[test]
    fn fail_on_not_writable() {
        let ta_addr = Pubkey::new_unique();
        let mut lamports = 0;
        let mut data = [0u8; 8];
        let account_info = AccountInfo::new(
            &ta_addr,
            false,
            false,
            &mut lamports,
            &mut data,
            &crate::ID,
            true,
            Epoch::default(),
        );
        let account = UncheckedAccount::try_from(&account_info);
        let tick_array_ref = load_tick_array_mut(&account, &Pubkey::new_unique());
        assert!(matches!(tick_array_ref, Err(err) if err == ErrorCode::AccountNotMutable.into()));
    }
}
