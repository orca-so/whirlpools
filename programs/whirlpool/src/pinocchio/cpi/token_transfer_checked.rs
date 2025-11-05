use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed_unchecked,
    instruction::{AccountMeta, Instruction, Signer},
    ProgramResult,
};

pub struct TransferChecked<'a> {
    pub program: &'a AccountInfo,
    pub from: &'a AccountInfo,
    pub mint: &'a AccountInfo,
    pub to: &'a AccountInfo,
    pub authority: &'a AccountInfo,
    pub amount: u64,
    pub decimals: u8,
}

impl TransferChecked<'_> {
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // account metadata
        let account_metas: [AccountMeta; 4] = [
            AccountMeta::writable(self.from.key()),
            AccountMeta::readonly(self.mint.key()),
            AccountMeta::writable(self.to.key()),
            AccountMeta::readonly_signer(self.authority.key()),
        ];

        // Instruction data layout:
        // -  1 byte discriminator
        // -  8 bytes amount
        // -  1 byte decimals
        let mut instruction_data = [0u8; 10];
        instruction_data[0] = 12;
        instruction_data[1..9].copy_from_slice(&self.amount.to_le_bytes());
        instruction_data[9] = self.decimals;

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
                    self.mint.into(),
                    self.to.into(),
                    self.authority.into(),
                ],
                signers,
            );
        }

        Ok(())
    }
}
