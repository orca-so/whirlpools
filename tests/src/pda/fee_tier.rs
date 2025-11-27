use crate::constants::PROGRAM_ID;
use crate::helper::init_dummy_pda;
use litesvm::LiteSVM;
use solana_program::borsh::try_from_slice_unchecked;
use solana_pubkey::Pubkey;
use whirlpool_optimization::state::FeeTier;

pub fn address(config: Pubkey, tick_spacing: u16) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"fee_tier",
            config.as_ref(),
            tick_spacing.to_le_bytes().as_ref(),
        ],
        &PROGRAM_ID,
    )
    .0
}

pub fn data(svm: &LiteSVM, config: Pubkey, tick_spacing: u16) -> FeeTier {
    let fee_tier_account = svm.get_account(&address(config, tick_spacing)).unwrap();
    let mut buffer = &fee_tier_account.data[8..];
    try_from_slice_unchecked::<FeeTier>(buffer).unwrap()
}
