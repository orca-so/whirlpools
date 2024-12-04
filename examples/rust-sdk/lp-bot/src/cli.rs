use clap::Parser;

use crate::utils::PriorityFeeTier;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
pub struct Args {
    #[arg(
        short = 'p',
        long,
        help = "The position mint address to monitor and rebalance."
    )]
    pub position_mint_address: String,

    #[arg(
        short = 't',
        long,
        default_value_t = 1.0,
        help = "Threshold for repositioning in percentage.\n"
    )]
    pub threshold: f64,

    #[arg(
        short = 'i',
        long,
        default_value_t = 60,
        help = "Time interval for checking in seconds.\n"
    )]
    pub interval: u64,

    #[arg(
        short = 'f',
        long,
        value_enum,
        default_value_t = PriorityFeeTier::Medium,
        help = "Priority fee tier for transaction processing based on recently paid priority fees. Options:\n  \
                - `none`: No priority fee\n  \
                - `low`: Lower 25th quartile prioritization fee\n  \
                - `medium`: Median prioritization fee\n  \
                - `high`: Upper 75th quartile prioritization fee\n  \
                - `turbo`: Upper 95th quartile prioritization fee\n"
    )]
    pub priority_fee_tier: PriorityFeeTier,

    #[arg(
        short = 'm',
        long,
        default_value_t = 10_000_000,
        help = "Maximum total priority fee in lamports.\n"
    )]
    pub max_priority_fee_lamports: u64,
}
