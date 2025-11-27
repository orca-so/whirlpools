use crate::helper::{init_program, send_tx};
use crate::instructions::BaseBuilderTrait;
use crate::pda::*;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use std::sync::Arc;

pub struct InitializePoolStep1IxBuilder<'a> {
    svm: &'a mut LiteSVM,
    admin: &'a Keypair,
    whirlpools_config: Pubkey,
    token_mint_a: Pubkey,
    token_mint_b: Pubkey,
    token_badge_a: Pubkey,
    token_badge_b: Pubkey,
    funder: &'a Keypair,
    whirlpool: Pubkey,
    token_vault_a: &'a Keypair,
    token_vault_b: &'a Keypair,
    fee_tier: Pubkey,
    token_program_a: Pubkey,
    token_program_b: Pubkey,
    system_program: Pubkey,
    rent: Pubkey,
    tick_spacing: u16,
    initial_sqrt_price: u128,
    last_result: Arc<Result<TransactionMetadata, FailedTransactionMetadata>>,
}

impl<'a> InitializePoolStep1IxBuilder<'a> {
    pub fn new(
        svm: &'a mut LiteSVM,
        admin: &'a Keypair,
        whirlpools_config: Pubkey,
        token_mint_a: Pubkey,
        token_mint_b: Pubkey,
        funder: &'a Keypair,
        token_vault_a: &'a Keypair,
        token_vault_b: &'a Keypair,
        token_program_a: Pubkey,
        token_program_b: Pubkey,
        system_program: Pubkey,
        rent: Pubkey,
        tick_spacing: u16,
        initial_sqrt_price: u128,
    ) -> Self {
        let whirlpool =
            whirlpool::address(whirlpools_config, token_mint_a, token_mint_b, tick_spacing);
        let token_badge_a = token_badge::address(whirlpools_config, token_mint_a);
        let token_badge_b = token_badge::address(whirlpools_config, token_mint_b);
        let fee_tier = fee_tier::address(whirlpools_config, tick_spacing);

        Self {
            svm,
            admin,
            whirlpools_config,
            token_mint_a,
            token_mint_b,
            token_badge_a,
            token_badge_b,
            funder,
            whirlpool,
            token_vault_a,
            token_vault_b,
            fee_tier,
            token_program_a,
            token_program_b,
            system_program,
            rent,
            tick_spacing,
            initial_sqrt_price,
            last_result: Arc::new(Ok(TransactionMetadata::default())),
        }
    }

    pub fn run(mut self, step: u8) -> Self {
        let program = init_program(&self.admin);

        let ixs = program
            .request()
            .accounts(whirlpool_optimization::accounts::InitializePoolV2Step1 {
                whirlpools_config: self.whirlpools_config,
                token_mint_a: self.token_mint_a,
                token_mint_b: self.token_mint_b,
                token_badge_a: self.token_badge_a,
                token_badge_b: self.token_badge_b,
                funder: self.funder.pubkey(),
                whirlpool: self.whirlpool,
                token_vault_a: self.token_vault_a.pubkey(),
                token_vault_b: self.token_vault_b.pubkey(),
                fee_tier: self.fee_tier,
                token_program_a: self.token_program_a,
                token_program_b: self.token_program_b,
                system_program: self.system_program,
                rent: self.rent,
            })
            .args(whirlpool_optimization::instruction::InitializePoolV2Step1 {
                tick_spacing: self.tick_spacing,
                initial_sqrt_price: self.initial_sqrt_price,
                step,
            })
            .instructions()
            .unwrap();

        let result = send_tx(
            self.svm,
            &self.funder,
            &[&self.funder, &self.token_vault_a, &self.token_vault_b],
            ixs,
        );

        self.last_result = Arc::new(result);

        self
    }
}

impl<'a> BaseBuilderTrait for InitializePoolStep1IxBuilder<'a> {
    fn last_result(&self) -> &Arc<Result<TransactionMetadata, FailedTransactionMetadata>> {
        &self.last_result
    }
}
