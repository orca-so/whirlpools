use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed_unchecked,
    instruction::{AccountMeta, Instruction, Signer},
    ProgramResult,
};

pub struct Transfer<'a> {
    pub program: &'a AccountInfo,
    pub from: &'a AccountInfo,
    pub to: &'a AccountInfo,
    pub authority: &'a AccountInfo,
    pub amount: u64,
}

impl Transfer<'_> {
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // account metadata
        let account_metas: [AccountMeta; 3] = [
            AccountMeta::writable(self.from.key()),
            AccountMeta::writable(self.to.key()),
            AccountMeta::readonly_signer(self.authority.key()),
        ];

        // Instruction data layout:
        // -  1 byte discriminator
        // -  8 bytes amount
        let mut instruction_data = [0u8; 9];
        instruction_data[0] = 3;
        instruction_data[1..9].copy_from_slice(&self.amount.to_le_bytes());

        let instruction = Instruction {
            program_id: self.program.key(),
            accounts: &account_metas,
            data: &instruction_data,
        };

        unsafe {
            invoke_signed_unchecked(
                &instruction,
                &[
                    self.from.into(),
                    self.to.into(),
                    self.authority.into(),
                ],
                signers,
            );
        }

        Ok(())
    }
}
