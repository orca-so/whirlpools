use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed_unchecked,
    instruction::{AccountMeta, Instruction, Signer},
    ProgramResult,
};

pub struct SystemTransfer<'a> {
    pub program: &'a AccountInfo,
    pub from: &'a AccountInfo,
    pub to: &'a AccountInfo,
    pub lamports: u64,
}

impl SystemTransfer<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let accounts = [
            AccountMeta::writable_signer(self.from.key()),
            AccountMeta::writable(self.to.key()),
        ];

        let mut instruction_data = [0u8; 12];
        instruction_data[..4].copy_from_slice(&2u32.to_le_bytes());
        instruction_data[4..].copy_from_slice(&self.lamports.to_le_bytes());

        let instruction = Instruction {
            program_id: self.program.key(),
            accounts: &accounts,
            data: &instruction_data,
        };

        unsafe {
            invoke_signed_unchecked(&instruction, &[self.from.into(), self.to.into()], signers);
        }

        Ok(())
    }
}
