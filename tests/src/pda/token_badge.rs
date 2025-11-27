use crate::constants::PROGRAM_ID;
use crate::helper::init_dummy_pda;
use litesvm::LiteSVM;
use solana_program::borsh::try_from_slice_unchecked;
use solana_pubkey::Pubkey;
use whirlpool_optimization::state::TokenBadge;

pub fn address(whirlpools_config: Pubkey, token_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"token_badge",
            whirlpools_config.as_ref(),
            token_mint.as_ref(),
        ],
        &PROGRAM_ID,
    )
    .0
}

pub fn data(svm: &LiteSVM, whirlpools_config: Pubkey, token_mint: Pubkey) -> TokenBadge {
    let token_badge_account = svm
        .get_account(&address(whirlpools_config, token_mint))
        .unwrap();
    let mut buffer = &token_badge_account.data[8..];
    try_from_slice_unchecked::<TokenBadge>(buffer).unwrap()
}
