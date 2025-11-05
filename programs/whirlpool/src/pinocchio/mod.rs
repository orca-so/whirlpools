mod constants;
mod cpi;
mod errors;
mod ported;
mod state;
mod utils;

pub mod instructions;

pub type Result<T> = core::result::Result<T, errors::UnifiedError>;
