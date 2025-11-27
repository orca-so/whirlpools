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

pub struct InitializeConfigIxBuilder<'a> {
    svm: &'a mut LiteSVM,
    admin: &'a Keypair,
    whirlpools_config: &'a Keypair,
    funder: &'a Keypair,
    last_result: Arc<Result<TransactionMetadata, FailedTransactionMetadata>>,
}

impl<'a> InitializeConfigIxBuilder<'a> {
    pub fn new(svm: &'a mut LiteSVM, admin: &'a Keypair, whirlpools_config: &'a Keypair) -> Self {
        Self {
            svm,
            admin,
            whirlpools_config,
            funder: admin,
            last_result: Arc::new(Ok(TransactionMetadata::default())),
        }
    }

    pub fn run(mut self) -> Self {
        let program = init_program(&self.admin);

        let ixs = program
            .request()
            .accounts(whirlpool_optimization::accounts::InitializeConfig {
                config: self.whirlpools_config.pubkey(),
                system_program: SYSTEM_PROGRAM_ID,
                funder: self.funder.pubkey(),
            })
            .args(whirlpool_optimization::instruction::InitializeConfig {
                fee_authority: self.admin.pubkey(),
                collect_protocol_fees_authority: self.admin.pubkey(),
                reward_emissions_super_authority: self.admin.pubkey(),
                default_protocol_fee_rate: 1000,
            })
            .instructions()
            .unwrap();

        let result = send_tx(
            self.svm,
            &self.funder,
            &[&self.funder, &self.whirlpools_config],
            ixs,
        );

        self.last_result = Arc::new(result);

        self
    }
}

impl<'a> BaseBuilderTrait for InitializeConfigIxBuilder<'a> {
    fn last_result(&self) -> &Arc<Result<TransactionMetadata, FailedTransactionMetadata>> {
        &self.last_result
    }
}
