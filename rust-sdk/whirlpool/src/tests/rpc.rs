use std::sync::atomic::{AtomicUsize, Ordering};
use std::{error::Error, str::FromStr};

use async_trait::async_trait;
use orca_whirlpools_client::{
    get_fee_tier_address, FEE_TIER_DISCRIMINATOR, WHIRLPOOLS_CONFIG_DISCRIMINATOR, WHIRLPOOL_ID,
};
use serde_json::{from_value, to_value, Value};
use solana_account_decoder::{UiAccount, UiAccountEncoding};
use solana_client::client_error::Result as ClientResult;
use solana_client::{
    client_error::{ClientError, ClientErrorKind},
    nonblocking::rpc_client::RpcClient,
    rpc_client::{RpcClientConfig, SerializableTransaction},
    rpc_request::RpcRequest,
    rpc_response::{Response, RpcBlockhash, RpcResponseContext, RpcVersionInfo},
    rpc_sender::{RpcSender, RpcTransportStats},
};
use solana_program_test::tokio::sync::Mutex;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::bs58;
use solana_sdk::epoch_info::EpochInfo;
use solana_sdk::{
    account::Account,
    commitment_config::CommitmentLevel,
    instruction::Instruction,
    message::{v0::Message, VersionedMessage},
    pubkey::Pubkey,
    signature::{Keypair, Signature},
    signer::Signer,
    system_program,
    transaction::VersionedTransaction,
};
use solana_version::Version;
use spl_memo::build_memo;

use crate::tests::anchor_programs;
use crate::{SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS};

pub struct RpcContext {
    pub rpc: RpcClient,
    pub signer: Keypair,
    pub config: Pubkey,
    keypairs: Vec<Keypair>,
    keypair_index: AtomicUsize,
}

impl RpcContext {
    pub async fn new() -> Self {
        let signer = Keypair::new();
        let mut test = ProgramTest::default();
        test.prefer_bpf(true);

        test.add_account(
            signer.pubkey(),
            Account {
                lamports: 100_000_000_000,
                data: vec![],
                owner: system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        );

        let config = *WHIRLPOOLS_CONFIG_ADDRESS.lock().unwrap();

        test.add_account(
            config,
            Account {
                lamports: 100_000_000_000,
                data: [
                    WHIRLPOOLS_CONFIG_DISCRIMINATOR,
                    &signer.pubkey().to_bytes(),
                    &signer.pubkey().to_bytes(),
                    &signer.pubkey().to_bytes(),
                    &[0; 2],
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        );

        let default_fee_tier = get_fee_tier_address(&config, 128).unwrap().0;
        test.add_account(
            default_fee_tier,
            Account {
                lamports: 100_000_000_000,
                data: [
                    FEE_TIER_DISCRIMINATOR,
                    &config.to_bytes(),
                    &128u16.to_le_bytes(),
                    &1000u16.to_le_bytes(),
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        );

        let concentrated_fee_tier = get_fee_tier_address(&config, 64).unwrap().0;
        test.add_account(
            concentrated_fee_tier,
            Account {
                lamports: 100_000_000_000,
                data: [
                    FEE_TIER_DISCRIMINATOR,
                    &config.to_bytes(),
                    &64u16.to_le_bytes(),
                    &300u16.to_le_bytes(),
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        );

        let splash_fee_tier = get_fee_tier_address(&config, SPLASH_POOL_TICK_SPACING)
            .unwrap()
            .0;
        test.add_account(
            splash_fee_tier,
            Account {
                lamports: 100_000_000_000,
                data: [
                    FEE_TIER_DISCRIMINATOR,
                    &config.to_bytes(),
                    &SPLASH_POOL_TICK_SPACING.to_le_bytes(),
                    &1000u16.to_le_bytes(),
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        );

        let programs = anchor_programs("../..".to_string()).unwrap();
        for (name, pubkey) in programs {
            test.add_program(&name, pubkey, None);
        }
        let context = Mutex::new(test.start_with_context().await);
        let rpc = RpcClient::new_sender(MockRpcSender { context }, RpcClientConfig::default());

        let mut keypairs = (0..100).map(|_| Keypair::new()).collect::<Vec<_>>();
        keypairs.sort_by_key(|x| x.pubkey());

        Self {
            rpc,
            signer,
            config,
            keypairs,
            keypair_index: AtomicUsize::new(0),
        }
    }

    pub fn get_next_keypair(&self) -> &Keypair {
        let index = self.keypair_index.fetch_add(1, Ordering::Relaxed);
        &self.keypairs[index]
    }

    pub async fn send_transaction(
        &self,
        instructions: Vec<Instruction>,
    ) -> Result<Signature, Box<dyn Error>> {
        self.send_transaction_with_signers(instructions, vec![])
            .await
    }

    pub async fn send_transaction_with_signers(
        &self,
        instructions: Vec<Instruction>,
        signers: Vec<&Keypair>,
    ) -> Result<Signature, Box<dyn Error>> {
        let blockhash = self.rpc.get_latest_blockhash().await?;
        // Sine blockhash is not guaranteed to be unique, we need to add a random memo to the tx
        // so that we can fire two seemingly identical transactions in a row.
        let memo = Keypair::new().to_base58_string();
        let instructions = [instructions, vec![build_memo(memo.as_bytes(), &[])]].concat();
        let message = VersionedMessage::V0(Message::try_compile(
            &self.signer.pubkey(),
            &instructions,
            &[],
            blockhash,
        )?);
        let transaction =
            VersionedTransaction::try_new(message, &[signers, vec![&self.signer]].concat())?;
        let signature = self.rpc.send_transaction(&transaction).await?;
        Ok(signature)
    }
}

fn get_encoding(config: &Value) -> UiAccountEncoding {
    config
        .as_object()
        .and_then(|x| x.get("encoding"))
        .and_then(|x| x.as_str())
        .and_then(|x| from_value::<UiAccountEncoding>(x.into()).ok())
        .unwrap_or(UiAccountEncoding::Base64)
}

fn to_wire_account(
    address: &Pubkey,
    account: Option<Account>,
    encoding: UiAccountEncoding,
) -> Result<Value, Box<dyn Error>> {
    if let Some(account) = account {
        let value = to_value(UiAccount::encode(address, &account, encoding, None, None))?;
        Ok(value)
    } else {
        Ok(Value::Null)
    }
}

async fn send(
    context: &mut ProgramTestContext,
    method: &str,
    params: &Vec<Value>,
) -> Result<Value, Box<dyn Error>> {
    let slot = context.banks_client.get_root_slot().await?;

    let response = match method {
        "getAccountInfo" => {
            let address_str = params[0].as_str().unwrap_or_default();
            let address = Pubkey::from_str(address_str)?;
            let account = context
                .banks_client
                .get_account_with_commitment(address, CommitmentLevel::Confirmed)
                .await?;
            let encoding = get_encoding(&params[1]);
            to_value(Response {
                context: RpcResponseContext {
                    slot,
                    api_version: None,
                },
                value: to_wire_account(&address, account, encoding)?,
            })?
        }
        "getMultipleAccounts" => {
            let default_addresses = Vec::new();
            let addresses = params[0].as_array().unwrap_or(&default_addresses);
            let encoding = get_encoding(&params[1]);
            let mut accounts: Vec<Value> = Vec::new();
            for address_str in addresses {
                let address_str = address_str.as_str().unwrap_or_default();
                let address = Pubkey::from_str(address_str)?;
                let account = context
                    .banks_client
                    .get_account_with_commitment(address, CommitmentLevel::Confirmed)
                    .await?;
                accounts.push(to_wire_account(&address, account, encoding)?);
            }
            to_value(Response {
                context: RpcResponseContext {
                    slot,
                    api_version: None,
                },
                value: accounts,
            })?
        }
        "getMinimumBalanceForRentExemption" => {
            let data_len = params[0].as_u64().unwrap_or(0) as usize;
            let rent = context.banks_client.get_rent().await?;
            to_value(rent.minimum_balance(data_len))?
        }
        "getLatestBlockhash" => {
            let blockhash = context.banks_client.get_latest_blockhash().await?;
            to_value(Response {
                context: RpcResponseContext {
                    slot,
                    api_version: None,
                },
                value: RpcBlockhash {
                    blockhash: blockhash.to_string(),
                    last_valid_block_height: slot + 150,
                },
            })?
        }
        "sendTransaction" => {
            let transaction_base64 = params[0].as_str().unwrap_or_default();
            let transaction_bytes = base64::decode(transaction_base64)?;
            let transaction = bincode::deserialize::<VersionedTransaction>(&transaction_bytes)?;
            let meta = context
                .banks_client
                .process_transaction_with_metadata(transaction.clone())
                .await?;
            if let Err(e) = meta.result {
                return Err(e.to_string().into());
            }
            let signature = transaction.get_signature();
            let signature_base58 = bs58::encode(signature).into_string();
            to_value(signature_base58)?
        }
        "getEpochInfo" => to_value(EpochInfo {
            epoch: slot / 32,
            slot_index: slot % 32,
            slots_in_epoch: 32,
            absolute_slot: slot,
            block_height: slot,
            transaction_count: Some(0),
        })?,
        "getVersion" => {
            let version = Version::default();
            to_value(RpcVersionInfo {
                solana_core: version.to_string(),
                feature_set: Some(version.feature_set),
            })?
        }
        _ => return Err(format!("Method not implemented: {}", method).into()),
    };

    Ok(response)
}

struct MockRpcSender {
    context: Mutex<ProgramTestContext>,
}

#[async_trait]
impl RpcSender for MockRpcSender {
    async fn send(&self, request: RpcRequest, params: Value) -> ClientResult<Value> {
        let request_json = request.build_request_json(42, params.clone());
        let method = request_json["method"].as_str().unwrap_or_default();
        let default_params = Vec::new();
        let params = request_json["params"].as_array().unwrap_or(&default_params);
        let mut context = self.context.lock().await;
        let response = send(&mut context, method, params).await.map_err(|e| {
            ClientError::new_with_request(ClientErrorKind::Custom(e.to_string()), request)
        })?;

        Ok(response)
    }

    fn get_transport_stats(&self) -> RpcTransportStats {
        RpcTransportStats::default()
    }

    fn url(&self) -> String {
        "MockRpcSender".to_string()
    }
}
