use serde::{Deserialize, Serialize};

/// Percentile for priority fee calculation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Percentile {
    P25,
    P50,
    P75,
    P95,
    P99,
}

impl Percentile {
    /// Convert to a numeric value (0-100)
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

/// Percentile for Jito tip calculation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JitoPercentile {
    P25,
    P50,
    P50Ema, // 50th percentile exponential moving average
    P75,
    P95,
    P99,
}

/// Priority fee strategy for Solana transactions
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PriorityFeeStrategy {
    /// Dynamically calculate priority fee based on recent fees
    Dynamic {
        #[serde(default = "default_priority_percentile")]
        percentile: Percentile,
        #[serde(default = "default_max_priority_fee")]
        max_lamports: u64,
    },
    /// Use a fixed priority fee
    Exact(u64),
    /// Disable priority fees
    Disabled,
}

/// Jito tip strategy for Solana transactions
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum JitoFeeStrategy {
    /// Dynamically calculate Jito tip based on recent tips
    Dynamic {
        #[serde(default = "default_jito_percentile")]
        percentile: JitoPercentile,
        #[serde(default = "default_max_jito_tip")]
        max_lamports: u64,
    },
    /// Use a fixed Jito tip
    Exact(u64),
    /// Disable Jito tips
    Disabled,
}

/// Fee configuration for Solana transactions
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeeConfig {
    /// Priority fee strategy (Solana network)
    pub priority_fee: PriorityFeeStrategy,

    /// Jito tip strategy (requires block engine URL)
    pub jito: JitoFeeStrategy,

    /// Multiplier for compute unit budget estimation
    /// Default: 1.1
    #[serde(default = "default_compute_margin")]
    pub compute_unit_margin_multiplier: f64,

    /// Jito block engine URL
    /// Default: "https://bundles.jito.wtf"
    #[serde(default = "default_jito_url")]
    pub jito_block_engine_url: String,
}

impl Default for FeeConfig {
    fn default() -> Self {
        Self {
            priority_fee: PriorityFeeStrategy::Disabled,
            jito: JitoFeeStrategy::Disabled,
            compute_unit_margin_multiplier: default_compute_margin(),
            jito_block_engine_url: default_jito_url(),
        }
    }
}

// Default values for configuration
fn default_priority_percentile() -> Percentile {
    Percentile::P50
}

fn default_max_priority_fee() -> u64 {
    4_000_000 // 0.004 SOL in lamports
}

fn default_jito_percentile() -> JitoPercentile {
    JitoPercentile::P50Ema
}

fn default_max_jito_tip() -> u64 {
    4_000_000 // 0.004 SOL in lamports
}

fn default_compute_margin() -> f64 {
    1.1
}

fn default_jito_url() -> String {
    "https://bundles.jito.wtf".to_string()
}
