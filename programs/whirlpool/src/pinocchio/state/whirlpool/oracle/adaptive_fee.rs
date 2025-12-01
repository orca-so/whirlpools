use crate::state::AdaptiveFeeVariables;

use super::super::super::{BytesI32, BytesU16, BytesU32, BytesU64};

#[derive(Debug)]
#[repr(C)]
pub struct MemoryMappedAdaptiveFeeConstants {
    filter_period: BytesU16,
    decay_period: BytesU16,
    reduction_factor: BytesU16,
    adaptive_fee_control_factor: BytesU32,
    max_volatility_accumulator: BytesU32,
    tick_group_size: BytesU16,
    major_swap_threshold_ticks: BytesU16,
    reserved: [u8; 16],
}

impl MemoryMappedAdaptiveFeeConstants {
    #[inline(always)]
    pub fn filter_period(&self) -> u16 {
        u16::from_le_bytes(self.filter_period)
    }

    #[inline(always)]
    pub fn decay_period(&self) -> u16 {
        u16::from_le_bytes(self.decay_period)
    }

    #[inline(always)]
    pub fn reduction_factor(&self) -> u16 {
        u16::from_le_bytes(self.reduction_factor)
    }

    #[inline(always)]
    pub fn adaptive_fee_control_factor(&self) -> u32 {
        u32::from_le_bytes(self.adaptive_fee_control_factor)
    }

    #[inline(always)]
    pub fn max_volatility_accumulator(&self) -> u32 {
        u32::from_le_bytes(self.max_volatility_accumulator)
    }

    #[inline(always)]
    pub fn tick_group_size(&self) -> u16 {
        u16::from_le_bytes(self.tick_group_size)
    }

    #[inline(always)]
    pub fn major_swap_threshold_ticks(&self) -> u16 {
        u16::from_le_bytes(self.major_swap_threshold_ticks)
    }
    /*

    #[allow(clippy::too_many_arguments)]
    pub fn validate_constants(
        tick_spacing: u16,
        filter_period: u16,
        decay_period: u16,
        reduction_factor: u16,
        adaptive_fee_control_factor: u32,
        max_volatility_accumulator: u32,
        tick_group_size: u16,
        major_swap_threshold_ticks: u16,
    ) -> bool {
        // filter_period validation
        // must be >= 1
        if filter_period == 0 {
            return false;
        }

        // decay_period validation
        // must be >= 1 and > filter_period
        if decay_period == 0 || decay_period <= filter_period {
            return false;
        }

        // adaptive_fee_control_factor validation
        // must be less than ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR
        if adaptive_fee_control_factor >= ADAPTIVE_FEE_CONTROL_FACTOR_DENOMINATOR {
            return false;
        }

        // max_volatility_accumulator validation
        // this constraint is to prevent overflow at FeeRateManager::compute_adaptive_fee_rate
        if u64::from(max_volatility_accumulator) * u64::from(tick_group_size) > u32::MAX as u64 {
            return false;
        }

        // reduction_factor validation
        if reduction_factor >= REDUCTION_FACTOR_DENOMINATOR {
            return false;
        }

        // tick_group_size validation
        if tick_group_size == 0
            || tick_group_size > tick_spacing
            || tick_spacing % tick_group_size != 0
        {
            return false;
        }

        // major_swap_threshold_ticks validation
        // there is no clear upper limit for major_swap_threshold_ticks, but as a safeguard, we set the limit to ticks in a TickArray
        let ticks_in_tick_array = tick_spacing as i32 * TICK_ARRAY_SIZE;
        if major_swap_threshold_ticks == 0
            || major_swap_threshold_ticks as i32 > ticks_in_tick_array
        {
            return false;
        }

        true
    }
    */
}

#[derive(Debug)]
#[repr(C)]
pub struct MemoryMappedAdaptiveFeeVariables {
    last_reference_update_timestamp: BytesU64,
    last_major_swap_timestamp: BytesU64,
    volatility_reference: BytesU32,
    tick_group_index_reference: BytesI32,
    volatility_accumulator: BytesU32,
    reserved: [u8; 16],
}

impl MemoryMappedAdaptiveFeeVariables {
    #[inline(always)]
    pub fn last_reference_update_timestamp(&self) -> u64 {
        u64::from_le_bytes(self.last_reference_update_timestamp)
    }

    #[inline(always)]
    pub fn last_major_swap_timestamp(&self) -> u64 {
        u64::from_le_bytes(self.last_major_swap_timestamp)
    }

    #[inline(always)]
    pub fn volatility_reference(&self) -> u32 {
        u32::from_le_bytes(self.volatility_reference)
    }

    #[inline(always)]
    pub fn tick_group_index_reference(&self) -> i32 {
        i32::from_le_bytes(self.tick_group_index_reference)
    }

    #[inline(always)]
    pub fn volatility_accumulator(&self) -> u32 {
        u32::from_le_bytes(self.volatility_accumulator)
    }

    pub fn update(&mut self, update: &AdaptiveFeeVariables) {
        self.last_reference_update_timestamp = update.last_reference_update_timestamp.to_le_bytes();
        self.last_major_swap_timestamp = update.last_major_swap_timestamp.to_le_bytes();
        self.volatility_reference = update.volatility_reference.to_le_bytes();
        self.tick_group_index_reference = update.tick_group_index_reference.to_le_bytes();
        self.volatility_accumulator = update.volatility_accumulator.to_le_bytes();
    }

    /*

    pub fn update_volatility_accumulator(
          &mut self,
          tick_group_index: i32,
          adaptive_fee_constants: &MemoryMappedAdaptiveFeeConstants,
      ) -> Result<()> {
          let index_delta = (self.tick_group_index_reference() - tick_group_index).unsigned_abs();
          let volatility_accumulator = u64::from(self.volatility_reference())
              + u64::from(index_delta) * u64::from(VOLATILITY_ACCUMULATOR_SCALE_FACTOR);

          self.volatility_accumulator = (std::cmp::min(
              volatility_accumulator,
              u64::from(adaptive_fee_constants.max_volatility_accumulator()),
          ) as u32).to_le_bytes();

          Ok(())
      }

      pub fn update_reference(
          &mut self,
          tick_group_index: i32,
          current_timestamp: u64,
          adaptive_fee_constants: &MemoryMappedAdaptiveFeeConstants,
      ) -> Result<()> {
          let max_timestamp = self
              .last_reference_update_timestamp()
              .max(self.last_major_swap_timestamp());
          if current_timestamp < max_timestamp {
              return Err(crate::errors::ErrorCode::InvalidTimestamp.into());
          }

          let reference_age = current_timestamp - self.last_reference_update_timestamp();
          if reference_age > MAX_REFERENCE_AGE {
              // The references are too old, so reset them
              self.tick_group_index_reference = tick_group_index.to_le_bytes();
              self.volatility_reference = 0u32.to_le_bytes();
              self.last_reference_update_timestamp = current_timestamp.to_le_bytes();
              return Ok(());
          }

          let elapsed = current_timestamp - max_timestamp;
          if elapsed < adaptive_fee_constants.filter_period() as u64 {
              // high frequency trade
              // no change
          } else if elapsed < adaptive_fee_constants.decay_period() as u64 {
              // NOT high frequency trade
              self.tick_group_index_reference = tick_group_index.to_le_bytes();
              self.volatility_reference = ((u64::from(self.volatility_accumulator())
                  * u64::from(adaptive_fee_constants.reduction_factor())
                  / u64::from(REDUCTION_FACTOR_DENOMINATOR))
                  as u32).to_le_bytes();
              self.last_reference_update_timestamp = current_timestamp.to_le_bytes();
          } else {
              // Out of decay time window
              self.tick_group_index_reference = tick_group_index.to_le_bytes();
              self.volatility_reference = 0u32.to_le_bytes();
              self.last_reference_update_timestamp = current_timestamp.to_le_bytes();
          }

          Ok(())
      }

      pub fn update_major_swap_timestamp(
          &mut self,
          pre_sqrt_price: u128,
          post_sqrt_price: u128,
          current_timestamp: u64,
          adaptive_fee_constants: &MemoryMappedAdaptiveFeeConstants,
      ) -> Result<()> {
          if Self::is_major_swap(
              pre_sqrt_price,
              post_sqrt_price,
              adaptive_fee_constants.major_swap_threshold_ticks(),
          )? {
              self.last_major_swap_timestamp = current_timestamp.to_le_bytes();
          }
          Ok(())
      }

      // Determine whether the difference between pre_sqrt_price and post_sqrt_price is equivalent to major_swap_threshold_ticks or more
      // Note: The error of less than 0.00000003% due to integer arithmetic of sqrt_price is acceptable
      fn is_major_swap(
          pre_sqrt_price: u128,
          post_sqrt_price: u128,
          major_swap_threshold_ticks: u16,
      ) -> Result<bool> {
          let (smaller_sqrt_price, larger_sqrt_price) =
              increasing_price_order(pre_sqrt_price, post_sqrt_price);

          // major_swap_sqrt_price_target
          //   = smaller_sqrt_price * sqrt(pow(1.0001, major_swap_threshold_ticks))
          //   = smaller_sqrt_price * sqrt_price_from_tick_index(major_swap_threshold_ticks) >> Q64_RESOLUTION
          //
          // Note: The following two are theoretically equal, but there is an integer arithmetic error.
          //       However, the error impact is less than 0.00000003% in sqrt price (x64) and is small enough.
          //       - sqrt_price_from_tick_index(a) * sqrt_price_from_tick_index(b) >> Q64_RESOLUTION   (mathematically, sqrt(pow(1.0001, a)) * sqrt(pow(1.0001, b)) = sqrt(pow(1.0001, a + b)))
          //       - sqrt_price_from_tick_index(a + b)                                                 (mathematically, sqrt(pow(1.0001, a + b)))
          let major_swap_sqrt_price_factor =
              sqrt_price_from_tick_index(major_swap_threshold_ticks as i32);
          let major_swap_sqrt_price_target = U256Muldiv::new(0, smaller_sqrt_price)
              .mul(U256Muldiv::new(0, major_swap_sqrt_price_factor))
              .shift_word_right()
              .try_into_u128()?;

          Ok(larger_sqrt_price >= major_swap_sqrt_price_target)
      }
      */
}

/*
pub struct MemoryMappedAdaptiveFeeInfo {
    pub constants: MemoryMappedAdaptiveFeeConstants,
    pub variables: MemoryMappedAdaptiveFeeVariables,
}
*/
