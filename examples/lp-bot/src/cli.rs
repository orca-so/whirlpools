use clap::Parser;

/// CLI arguments structure
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
pub struct Args {
    /// Position mint address
    #[arg(short, long)]
    pub position_mint_address: String,

    /// Threshold for repositioning (in percentage)
    #[arg(short, long, default_value_t = 1.0)]
    pub threshold: f64,

    /// Time interval for checking (in seconds)
    #[arg(short, long, default_value_t = 60)]
    pub interval: u64,
}
