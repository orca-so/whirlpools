#![allow(unexpected_cfgs)]

use pinocchio::pubkey::Pubkey;

#[inline(always)]
pub fn find_program_address(seeds: &[&[u8]], program_id: &Pubkey) -> (Pubkey, u8) {
  // pinocchio::pubkey::Pubkey::find_program_address does have off-chain implementation.
  #[cfg(target_os = "solana")]
    {
    pinocchio::pubkey::Pubkey::find_program_address(&seeds, &program_id)
    }

    #[cfg(not(target_os = "solana"))]
    { let (pubkey, bump) = anchor_lang::solana_program::pubkey::Pubkey::find_program_address(&seeds, &
        anchor_lang::solana_program::pubkey::Pubkey::new_from_array(*program_id)
        );

        (pubkey.to_bytes(), bump)
      }
}
