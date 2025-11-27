pub mod initialize_config_ix;
pub mod initialize_fee_tier_ix;
pub mod initialize_pool_ix;
pub mod initialize_pool_step_1_ix;

use crate::constants::PROGRAM_ID;
use base64::decode;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use std::sync::Arc;

pub struct BaseBuilder {
    pub last_result: Arc<Result<TransactionMetadata, FailedTransactionMetadata>>,
}

impl BaseBuilder {
    pub fn new() -> Self {
        Self {
            last_result: Arc::new(Ok(TransactionMetadata::default())),
        }
    }
}

pub trait BaseBuilderTrait: Sized {
    fn last_result(&self) -> &Arc<Result<TransactionMetadata, FailedTransactionMetadata>>;

    fn get_logs(self) -> Vec<String> {
        let tx_metadata = self.last_result().clone();
        let logs: Vec<String>;

        match tx_metadata.as_ref() {
            Ok(tx_metadata) => {
                logs = tx_metadata.logs.clone();
            }
            Err(failed_meta) => {
                logs = failed_meta.meta.logs.clone();
            }
        }

        logs
    }

    fn get_compute_units(self) -> u64 {
        let logs = self.get_logs();

        for line in logs {
            if line.contains(PROGRAM_ID.to_string().as_str()) && line.contains("consumed") {
                // "Program ABC consumed 47371 of 200000 compute units"
                let parts: Vec<&str> = line.split_whitespace().collect();

                for (i, part) in parts.iter().enumerate() {
                    if *part == "consumed" {
                        if let Some(num_str) = parts.get(i + 1) {
                            if let Ok(num) = num_str.parse::<u64>() {
                                return num;
                            }
                        }
                    }
                }
            }
        }

        return 0;
    }

    fn display_logs(self) -> Self {
        let tx_metadata = self.last_result().clone();
        let logs: Vec<String>;

        match tx_metadata.as_ref() {
            Ok(tx_metadata) => {
                logs = tx_metadata.logs.clone();
            }
            Err(failed_meta) => {
                logs = failed_meta.meta.logs.clone();
            }
        }

        for log in logs {
            println!("{}", log);
        }

        self
    }

    fn ok(self) -> Self {
        let last_result = self.last_result().clone();
        match last_result.as_ref() {
            Ok(_) => {}
            Err(failed_meta) => {
                println!("{}", failed_meta.meta.pretty_logs());

                panic!("Transaction should have succeeded");
            }
        }

        self
    }

    fn get_event(self) -> Vec<u8> {
        let tx_metadata = self.last_result().clone();

        let logs: Vec<String>;

        match tx_metadata.as_ref() {
            Ok(tx_metadata) => {
                logs = tx_metadata.logs.clone();
            }
            Err(_) => {
                panic!("Transaction should have succeeded");
            }
        }

        let data_line = logs
            .iter()
            .find(|l| l.starts_with("Program data:"))
            .unwrap();

        let b64_str = data_line.strip_prefix("Program data: ").unwrap();

        let bytes = decode(b64_str).unwrap();

        bytes
    }

    fn error(
        &self,
        result: Arc<Result<TransactionMetadata, FailedTransactionMetadata>>,
        error_message: &str,
    ) {
        match result.as_ref() {
            Ok(_) => {
                panic!("Transaction should have failed")
            }
            Err(failed_meta) => {
                let logs = failed_meta.meta.logs.clone();
                let found = format!("{:?}", logs).contains(error_message);

                if !found {
                    println!("{}", failed_meta.meta.pretty_logs());
                }

                assert!(found);
            }
        }
    }

    fn custom_error(self, error_code: &str) -> Self {
        let error_message = format!("Error Code: {}", error_code);

        self.error(self.last_result().clone(), &error_message);
        self
    }

    fn seed_error(self, account_name: &str) -> Self {
        let error_message = format!(
            "AnchorError caused by account: {}. Error Code: ConstraintSeeds",
            account_name
        );

        self.error(self.last_result().clone(), &error_message);
        self
    }

    fn discriminator_mismatch_error(self, account_name: &str) -> Self {
        let error_message = format!(
            "AnchorError caused by account: {}. Error Code: AccountDiscriminatorMismatch",
            account_name
        );
        self.error(self.last_result().clone(), &error_message);
        self
    }

    fn account_not_initialized_error(self, account_name: &str) -> Self {
        let error_message = format!(
            "AnchorError caused by account: {}. Error Code: AccountNotInitialized",
            account_name
        );
        self.error(self.last_result().clone(), &error_message);
        self
    }

    fn account_owned_by_wrong_program_error(self, account_name: &str) -> Self {
        let error_message = format!(
            "AnchorError caused by account: {}. Error Code: AccountOwnedByWrongProgram",
            account_name
        );
        self.error(self.last_result().clone(), &error_message);
        self
    }

    fn constraint_error_has_one(self, account_name: &str) -> Self {
        let error_message = format!(
            "AnchorError caused by account: {}. Error Code: ConstraintHasOne",
            account_name
        );
        self.error(self.last_result().clone(), &error_message);
        self
    }
}
