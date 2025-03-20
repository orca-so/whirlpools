#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Percentile {
    P25,
    P50,
    P75,
    P95,
    P99,
}

impl Percentile {
    pub fn as_value(&self) -> u8 {
        match self {
            Self::P25 => 25,
            Self::P50 => 50,
            Self::P75 => 75,
            Self::P95 => 95,
            Self::P99 => 99,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JitoPercentile {
    P25,
    P50,
    P50Ema, // 50th percentile exponential moving average
    P75,
    P95,
    P99,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PriorityFeeStrategy {
    Dynamic {
        percentile: Percentile,
        max_lamports: u64,
    },
    Exact(u64),
    Disabled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum JitoFeeStrategy {
    Dynamic {
        percentile: JitoPercentile,
        max_lamports: u64,
    },
    Exact(u64),
    Disabled,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FeeConfig {
    pub priority_fee: PriorityFeeStrategy,
    pub jito: JitoFeeStrategy,
    pub compute_unit_margin_multiplier: f64,
    pub jito_block_engine_url: String,
}

impl Default for FeeConfig {
    fn default() -> Self {
        Self {
            priority_fee: PriorityFeeStrategy::Disabled,
            jito: JitoFeeStrategy::Disabled,
            compute_unit_margin_multiplier: 1.1,
            jito_block_engine_url: "https://bundles.jito.wtf".to_string(),
        }
    }
}
