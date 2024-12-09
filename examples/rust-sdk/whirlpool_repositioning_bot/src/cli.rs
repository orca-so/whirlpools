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
        default_value_t = 100,
        help = "Threshold for repositioning in bps.\n"
    )]
    pub threshold: u16,

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
                - `high`: Upper 80th quartile prioritization fee\n  \
                - `turbo`: Upper 99th quartile prioritization fee\n"
    )]
    pub priority_fee_tier: PriorityFeeTier,

    #[arg(
        short = 'm',
        long,
        default_value_t = 10_000_000,
        help = "Maximum total priority fee in lamports.\n"
    )]
    pub max_priority_fee_lamports: u64,

    #[arg(
        short = 's',
        long,
        default_value_t = 100,
        help = "Slippage tolerance in basis points (bps).\n"
    )]
    pub slippage_tolerance_bps: u16,
}
