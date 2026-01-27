use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed_unchecked,
    instruction::{AccountMeta, Instruction, Signer},
    ProgramResult,
};

pub struct BuildMemo<'a, 'b> {
    pub program: &'a AccountInfo,
    pub memo: &'b [u8],
}

impl BuildMemo<'_, '_> {
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // account metadata
        let account_metas: [AccountMeta; 0] = [];

        // Instruction data layout:
        // -  memo in UTF-8
        let instruction_data = self.memo;

        let instruction = Instruction {
            program_id: self.program.key(),
            accounts: &account_metas,
            data: instruction_data,
        };

        unsafe {
            invoke_signed_unchecked(&instruction, &[], signers);
        }

        Ok(())
    }
}
