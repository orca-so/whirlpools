#[rustfmt::skip]
mod generated;

mod pda;

#[cfg(feature = "fetch")]
mod gpa;

#[cfg(feature = "core-types")]
mod core_types;

pub use generated::accounts::*;
pub use generated::errors::*;
pub use generated::instructions::*;
pub use generated::programs::WHIRLPOOL_ID as ID;
pub use generated::programs::*;
pub use generated::types::*;

#[cfg(feature = "fetch")]
pub use generated::shared::*;

#[cfg(feature = "fetch")]
pub(crate) use generated::*;

pub use pda::*;

#[cfg(feature = "fetch")]
pub use gpa::*;
