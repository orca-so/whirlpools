use crate::constants::SYSTEM_PROGRAM_ID;
use crate::helper::{init_program, send_tx};
use crate::instructions::BaseBuilderTrait;
use crate::pda::*;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::sync::Arc;

pub struct InitializeFeeTierIxBuilder<'a> {
    svm: &'a mut LiteSVM,
    admin: &'a Keypair,
    config: Pubkey,
    funder: &'a Keypair,
    fee_authority: Pubkey,
    fee_tier: Pubkey,
    tick_spacing: u16,
    default_fee_rate: u16,
    last_result: Arc<Result<TransactionMetadata, FailedTransactionMetadata>>,
}

impl<'a> InitializeFeeTierIxBuilder<'a> {
    pub fn new(
        svm: &'a mut LiteSVM,
        admin: &'a Keypair,
        config: Pubkey,
        tick_spacing: u16,
        default_fee_rate: u16,
    ) -> Self {
        let fee_tier = fee_tier::address(config, tick_spacing);

        Self {
            svm,
            admin,
            config,
            funder: admin,
            fee_authority: admin.pubkey(),
            fee_tier,
            tick_spacing,
            default_fee_rate,
            last_result: Arc::new(Ok(TransactionMetadata::default())),
        }
    }

    pub fn run(mut self) -> Self {
        let program = init_program(&self.admin);

        let ixs = program
            .request()
            .accounts(whirlpool_optimization::accounts::InitializeFeeTier {
                config: self.config,
                fee_authority: self.fee_authority,
                fee_tier: self.fee_tier,
                system_program: SYSTEM_PROGRAM_ID,
                funder: self.funder.pubkey(),
            })
            .args(whirlpool_optimization::instruction::InitializeFeeTier {
                tick_spacing: self.tick_spacing,
                default_fee_rate: self.default_fee_rate,
            })
            .instructions()
            .unwrap();

        let result = send_tx(self.svm, &self.admin, &[&self.admin], ixs);

        self.last_result = Arc::new(result);

        self
    }
}

impl<'a> BaseBuilderTrait for InitializeFeeTierIxBuilder<'a> {
    fn last_result(&self) -> &Arc<Result<TransactionMetadata, FailedTransactionMetadata>> {
        &self.last_result
    }
}
