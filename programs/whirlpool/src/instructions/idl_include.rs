use anchor_lang::prelude::*;

// This struct is only here so that DynamicTickArray is included in the IDL.
// Anchor only adds accounts to the IDL if they are used in at least one instruction.
// DynamicTickArray is never used as an Account (because it is too large) or as an
// AccountLoader (because it can't be dynamic and zero-copy). This is a workaround to
// make sure that the IDL includes it.
// To avoid generating stack overflow warnings, tick_array account is listed when
// idl-build feature is enabled.
#[derive(Accounts)]
pub struct IdlInclude<'info> {
    #[cfg(feature = "idl-build")]
    pub tick_array: Account<'info, crate::state::DynamicTickArray>,
    pub system_program: Program<'info, System>,
}
