use crate::constants::PROGRAM_ID;
use crate::helper::init_dummy_pda;
use litesvm::LiteSVM;
use solana_program::borsh::try_from_slice_unchecked;
use solana_pubkey::Pubkey;
use whirlpool_optimization::state::Whirlpool;

pub fn address(
    whirlpools_config: Pubkey,
    token_mint_a: Pubkey,
    token_mint_b: Pubkey,
    tick_spacing: u16,
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"whirlpool",
            whirlpools_config.as_ref(),
            token_mint_a.as_ref(),
            token_mint_b.as_ref(),
            tick_spacing.to_le_bytes().as_ref(),
        ],
        &PROGRAM_ID,
    )
    .0
}

pub fn data(
    svm: &LiteSVM,
    whirlpools_config: Pubkey,
    token_mint_a: Pubkey,
    token_mint_b: Pubkey,
    tick_spacing: u16,
) -> Whirlpool {
    let whirlpool_account = svm
        .get_account(&address(
            whirlpools_config,
            token_mint_a,
            token_mint_b,
            tick_spacing,
        ))
        .unwrap();
    let mut buffer = &whirlpool_account.data[8..];
    try_from_slice_unchecked::<Whirlpool>(buffer).unwrap()
}
