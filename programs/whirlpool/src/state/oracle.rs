use anchor_lang::prelude::*;

// Minimum time interval between consecutive observations, in seconds.
pub const OBSERVE_INTERVAL: u32 = 10; // 10
// Max number of observations stored by the price oracle.
pub const NUM_OBSERVATIONS: usize = 720; // at least 120 minutes (10 * 720 = 7200)

#[derive(Copy, Clone, Debug, PartialEq, Default)]
pub struct Observation {
    pub timestamp: u32,       // 4
    pub tick_cumulative: i64, // 8
}

impl Observation {
    pub fn initialized(self) -> bool {
        return self.timestamp != 0;
    }
}

#[account(zero_copy)]
pub struct Oracle {
    pub whirlpool: Pubkey,                             // 32
    pub observations: [Observation; NUM_OBSERVATIONS], // 8640
    pub observation_index: u16,                        // 2
}

impl Default for Oracle {
    #[inline]
    fn default() -> Oracle {
        Oracle {
            whirlpool: Pubkey::default(),
            observations: [Observation::default(); NUM_OBSERVATIONS],
            observation_index: 0,
        }
    }
}

impl Oracle {
    pub const LEN: usize = 8 + 32 + 12 * NUM_OBSERVATIONS + 2;

    /// Initializes a oracle account for a particular whirlpool.
    ///
    /// # Parameters
    /// - `whirlpool` - The public key of the whirlpool this oracle belongs to.
    /// - `timestamp` - The current block timestamp to initialize the oracle at.
    pub fn initialize(&mut self, whirlpool: Pubkey, timestamp: u32) {
        self.whirlpool = whirlpool;
        self.observations[0].timestamp = timestamp;
        self.observations[0].tick_cumulative = 0;
        self.observation_index = 0;
    }

    /// Add an observation to the oracle if the previous observation was at
    /// least `OBSERVE_INTERVAL` in the past.
    ///
    /// # Parameters
    /// - `before_swap_tick_index` - The current tick index _before_ the swap.
    /// - `timestamp` - The current block timestamp.
    pub fn add_observation_if_needed(&mut self, before_swap_tick_index: i32, timestamp: u32) {
        let last = self.observations[self.observation_index as usize];
        let time_delta = timestamp - last.timestamp;

        if time_delta < OBSERVE_INTERVAL {
            return;
        }

        self.add_observation(before_swap_tick_index, timestamp)
    }

    pub fn add_observation(&mut self, before_swap_tick_index: i32, timestamp: u32) {
        let last = self.observations[self.observation_index as usize];
        let time_delta = timestamp - last.timestamp;

        // Record the observation, with tick_cumulative being the geometric sum of prices.
        let tick_cumulative_delta = (before_swap_tick_index as i64).checked_mul(time_delta as i64).unwrap();
        let tick_cumulative = last.tick_cumulative.checked_add(tick_cumulative_delta).unwrap();

        let next_index = ((self.observation_index + 1) as usize) % NUM_OBSERVATIONS;
        self.observations[next_index].timestamp = timestamp;
        self.observations[next_index].tick_cumulative = tick_cumulative;
        self.observation_index = next_index as u16;
    }

}

#[cfg(test)]
mod add_observation_tests {
    use super::*;

    #[test]
    fn test_initializes_first_observation() {
        let whirlpool = solana_program::pubkey!("HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ");
        let timestamp: u32 = 12345;

        let mut oracle = Oracle::default();

        oracle.initialize(whirlpool, timestamp);

        assert_eq!(oracle.whirlpool, whirlpool);
        assert_eq!(oracle.observation_index, 0);

        let actual_observation0 = oracle.observations[0];
        let expected_observation0 = Observation {
            timestamp,
            tick_cumulative: 0,
        };
        assert_eq!(actual_observation0, expected_observation0);
        assert!(actual_observation0.initialized());

        let expected_observation = Observation {
            timestamp: 0,
            tick_cumulative: 0,
        };
        for i in 1..NUM_OBSERVATIONS {
            let actual_observation = oracle.observations[i];
            assert_eq!(actual_observation, expected_observation);
            assert!(!actual_observation.initialized());
        }

    }

    #[test]
    fn test_adds_observations() {
        let timestamp: u32 = 10000;

        let mut oracle = Oracle::default();
        oracle.initialize(Pubkey::default(), timestamp);

        oracle.add_observation(1, timestamp + OBSERVE_INTERVAL);
        oracle.add_observation(2, timestamp + OBSERVE_INTERVAL * 2);
        oracle.add_observation(3, timestamp + OBSERVE_INTERVAL * 4);

        let expectations = &[
            Observation {
                timestamp,
                tick_cumulative: 0,
            },
            Observation {
                timestamp: timestamp + OBSERVE_INTERVAL,
                tick_cumulative: ((1*1) * OBSERVE_INTERVAL) as i64,
            },
            Observation {
                timestamp: timestamp + OBSERVE_INTERVAL * 2,
                tick_cumulative: ((1*1 + 2*1) * OBSERVE_INTERVAL) as i64,
            },
            Observation {
                timestamp: timestamp + OBSERVE_INTERVAL * 4,
                tick_cumulative: ((1*1 + 2*1 + 3*2) * OBSERVE_INTERVAL) as i64,
            },
        ];

        assert_eq!(oracle.observation_index, 3);
        assert_eq!(oracle.observations[0], expectations[0]);
        assert_eq!(oracle.observations[1], expectations[1]);
        assert_eq!(oracle.observations[2], expectations[2]);
        assert_eq!(oracle.observations[3], expectations[3]);

        // not initialized
        let expected_observation = Observation {
            timestamp: 0,
            tick_cumulative: 0,
        };
        for i in ((oracle.observation_index + 1) as usize)..NUM_OBSERVATIONS {
            let actual_observation = oracle.observations[i];
            assert_eq!(actual_observation, expected_observation);
            assert!(!actual_observation.initialized());
        }
    }

    #[test]
    fn test_ignores_immediately_following_observations() {
        let timestamp: u32 = 10000;

        let mut oracle = Oracle::default();
        oracle.initialize(Pubkey::default(), timestamp);

        oracle.add_observation_if_needed(1, timestamp + OBSERVE_INTERVAL);
        // This one gets ignored
        oracle.add_observation_if_needed(2, timestamp + OBSERVE_INTERVAL + 5);
        oracle.add_observation_if_needed(2, timestamp + OBSERVE_INTERVAL * 2);

        let expectations = &[
            Observation {
                timestamp,
                tick_cumulative: 0,
            },
            Observation {
                timestamp: timestamp + OBSERVE_INTERVAL,
                tick_cumulative: (1 * OBSERVE_INTERVAL) as i64,
            },
            Observation {
                timestamp: timestamp + OBSERVE_INTERVAL * 2,
                tick_cumulative: (3 * OBSERVE_INTERVAL) as i64,
            },
        ];

        assert_eq!(oracle.observation_index, 2);
        assert_eq!(oracle.observations[0], expectations[0]);
        assert_eq!(oracle.observations[1], expectations[1]);
        assert_eq!(oracle.observations[2], expectations[2]);

        // not initialized
        let expected_observation = Observation {
            timestamp: 0,
            tick_cumulative: 0,
        };
        for i in ((oracle.observation_index + 1) as usize)..NUM_OBSERVATIONS {
            let actual_observation = oracle.observations[i];
            assert_eq!(actual_observation, expected_observation);
            assert!(!actual_observation.initialized());
        }

    }

    #[test]
    fn test_observations_loop_around() {
        let timestamp: u32 = 10000;

        let mut oracle = Oracle::default();
        oracle.initialize(Pubkey::default(), timestamp);

        for i in 1..(NUM_OBSERVATIONS + 5) {
            oracle.add_observation_if_needed(2, timestamp + ((i as u32) * OBSERVE_INTERVAL));
        }

        assert_eq!(oracle.observation_index, 4);

        // overwritten
        for i in 0..5 {
            let time_delta = ((NUM_OBSERVATIONS + i) as u32) * OBSERVE_INTERVAL;
            let actual_observation = oracle.observations[i];
            let expected_observation = Observation {
                timestamp: timestamp + time_delta,
                tick_cumulative: 2 * time_delta as i64,
            };
            assert_eq!(actual_observation, expected_observation);
        }

        // not overwritten
        for i in 5..NUM_OBSERVATIONS {
            let time_delta = (i as u32) * OBSERVE_INTERVAL;
            let actual_observation = oracle.observations[i];
            let expected_observation = Observation {
                timestamp: timestamp + time_delta,
                tick_cumulative: 2 * time_delta as i64,
            };
            assert_eq!(actual_observation, expected_observation);
        }
    }

}