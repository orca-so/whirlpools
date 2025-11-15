use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::{error::Error, str::FromStr};

use agave_feature_set::FeatureSet;
use async_trait::async_trait;
use litesvm::LiteSVM;
use litesvm_token::create_native_mint;
use orca_whirlpools_client::{
    get_fee_tier_address, get_whirlpools_config_extension_address, FEE_TIER_DISCRIMINATOR,
    WHIRLPOOLS_CONFIG_DISCRIMINATOR, WHIRLPOOLS_CONFIG_EXTENSION_DISCRIMINATOR, WHIRLPOOL_ID,
};
use serde_json::{from_value, to_value, Value};
use solana_account::{Account, ReadableAccount};
use solana_account_decoder::{encode_ui_account, UiAccountEncoding};
use solana_client::client_error::Result as ClientResult;
use solana_client::{
    client_error::{ClientError, ClientErrorKind},
    nonblocking::rpc_client::RpcClient,
    rpc_client::{RpcClientConfig, SerializableTransaction},
    rpc_request::RpcRequest,
    rpc_response::{Response, RpcBlockhash, RpcResponseContext, RpcVersionInfo},
    rpc_sender::{RpcSender, RpcTransportStats},
};
use solana_clock::Clock;
use solana_epoch_info::EpochInfo;
use solana_instruction::Instruction;
use solana_keypair::{Keypair, Signer};
use solana_message::{v0::Message, VersionedMessage};
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_signature::Signature;
use solana_sysvar::Sysvar;
use solana_sysvar_id::SysvarId;
use solana_transaction::versioned::VersionedTransaction;
use solana_version::Version;
use spl_memo_interface::instruction::build_memo;
use tokio::sync::Mutex;

use crate::tests::anchor_programs;
use crate::{SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS};

lazy_static::lazy_static! {
    static ref PROGRAMS: Vec<(String, Pubkey)> = anchor_programs("../..").unwrap();
}

pub struct RpcContext {
    pub rpc: RpcClient,
    pub signer: Keypair,
    keypairs: Vec<Keypair>,
    keypair_index: AtomicUsize,
}

impl RpcContext {
    pub fn new() -> Self {
        let signer = Keypair::new();

        // Use the default feature set instead of `all_enabled()` to avoid an issue when trying to realloc
        // inside `open_position_with_token_extensions` instruction where the realloc fails. The suspected
        // problematic feature is `stricter_abi_and_runtime_constraints`, but deactivating it doesn't
        // resolve the issue.
        let mut svm = LiteSVM::new()
            .with_feature_set(FeatureSet::default())
            .with_default_programs();

        svm.airdrop(&signer.pubkey(), 100_000_000_000).unwrap();
        create_native_mint(&mut svm);

        let config = *WHIRLPOOLS_CONFIG_ADDRESS.lock().unwrap();
        svm.set_account(
            config,
            Account {
                lamports: 100_000_000_000,
                data: [
                    WHIRLPOOLS_CONFIG_DISCRIMINATOR.as_slice(),
                    &signer.pubkey().to_bytes(), // fee_authority
                    &signer.pubkey().to_bytes(), // collect_protocol_fee_authority
                    &signer.pubkey().to_bytes(), // reward_emissions_super_authority
                    &[0; 2],                     // default_protocol_fee_rate
                    &[0; 2],                     // feature_flags
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        let default_fee_tier = get_fee_tier_address(&config, 128).unwrap().0;
        svm.set_account(
            default_fee_tier,
            Account {
                lamports: 100_000_000_000,
                data: [
                    FEE_TIER_DISCRIMINATOR.as_slice(),
                    &config.to_bytes(),
                    &128u16.to_le_bytes(),
                    &1000u16.to_le_bytes(),
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        let concentrated_fee_tier = get_fee_tier_address(&config, 64).unwrap().0;
        svm.set_account(
            concentrated_fee_tier,
            Account {
                lamports: 100_000_000_000,
                data: [
                    FEE_TIER_DISCRIMINATOR.as_slice(),
                    &config.to_bytes(),
                    &64u16.to_le_bytes(),
                    &300u16.to_le_bytes(),
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        let splash_fee_tier = get_fee_tier_address(&config, SPLASH_POOL_TICK_SPACING)
            .unwrap()
            .0;
        svm.set_account(
            splash_fee_tier,
            Account {
                lamports: 100_000_000_000,
                data: [
                    FEE_TIER_DISCRIMINATOR.as_slice(),
                    &config.to_bytes(),
                    &SPLASH_POOL_TICK_SPACING.to_le_bytes(),
                    &1000u16.to_le_bytes(),
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        // Create the metadata_update_auth account required by OpenPositionWithTokenExtensions
        let metadata_update_auth =
            Pubkey::try_from("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr").unwrap();
        svm.set_account(
            metadata_update_auth,
            Account {
                lamports: 100_000_000_000,
                data: vec![],
                owner: solana_system_interface::program::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        // Create the whirlpools config extension account
        let config_extension = get_whirlpools_config_extension_address(&config).unwrap().0;
        svm.set_account(
            config_extension,
            Account {
                lamports: 100_000_000_000,
                data: [
                    WHIRLPOOLS_CONFIG_EXTENSION_DISCRIMINATOR.as_slice(),
                    &config.to_bytes(),          // whirlpools_config
                    &signer.pubkey().to_bytes(), // config_extension_authority
                    &signer.pubkey().to_bytes(), // token_badge_authority
                ]
                .concat(),
                owner: WHIRLPOOL_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        // Initialize Rent sysvar
        let rent = Rent::default();
        svm.set_account(
            Rent::id(),
            Account {
                lamports: 1_000_000,
                data: bincode::serialize(&rent).unwrap(),
                owner: solana_rent::sysvar::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

        for (name, pubkey) in PROGRAMS.iter() {
            let program_path = format!("../../target/deploy/{}.so", name);
            let program_bytes = std::fs::read(&program_path)
                .unwrap_or_else(|_| panic!("Failed to read program file: {}", program_path));
            svm.add_program(*pubkey, &program_bytes)
                .expect("Failed to add program");
        }

        let svm = Arc::new(Mutex::new(svm));
        let rpc = RpcClient::new_sender(MockRpcSender { svm }, RpcClientConfig::default());

        let mut keypairs = (0..100).map(|_| Keypair::new()).collect::<Vec<_>>();
        keypairs.sort_by_key(|x| x.pubkey());

        Self {
            rpc,
            signer,
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
        let instructions = [
            instructions,
            vec![build_memo(
                &spl_memo_interface::v3::ID,
                memo.as_bytes(),
                &[],
            )],
        ]
        .concat();
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
        let value = to_value(encode_ui_account(address, &account, encoding, None, None))?;
        Ok(value)
    } else {
        Ok(Value::Null)
    }
}

fn send(svm: &mut LiteSVM, method: &str, params: &[Value]) -> Result<Value, Box<dyn Error>> {
    let clock = Clock::get().unwrap_or_default();
    let slot = clock.slot;

    let response = match method {
        "getAccountInfo" => {
            let address_str = params[0].as_str().unwrap_or_default();
            let address = Pubkey::from_str(address_str)?;
            let account = svm.get_account(&address);
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
                let account = svm.get_account(&address);
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
            let rent = Rent::default();
            to_value(rent.minimum_balance(data_len))?
        }
        "getLatestBlockhash" => {
            let blockhash = svm.latest_blockhash();
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
            let result = svm.send_transaction(transaction.clone());
            match result {
                Ok(_) => {
                    let signature = transaction.get_signature();
                    let signature_base58 = bs58::encode(signature).into_string();
                    to_value(signature_base58)?
                }
                Err(e) => {
                    return Err(format!("Transaction failed: {:?}", e).into());
                }
            }
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
        "getProgramAccounts" => {
            let program_id_str = params[0].as_str().unwrap_or_default();
            let program_id = Pubkey::from_str(program_id_str)?;
            let config = &params[1];
            let encoding = get_encoding(config);

            let filters = config
                .get("filters")
                .and_then(|f| f.as_array())
                .cloned()
                .unwrap_or_default();

            let accounts_db = svm.accounts_db();
            let all_accounts: Vec<(Pubkey, Account)> = accounts_db
                .inner
                .iter()
                .filter(|(_, account)| account.owner() == &program_id)
                .map(|(pubkey, account)| (*pubkey, account.clone().into()))
                .collect();

            let mut result = Vec::new();
            for (address, account) in all_accounts {
                let mut passes_filters = true;
                for filter in &filters {
                    if let Some(memcmp) = filter.get("memcmp") {
                        let offset =
                            memcmp.get("offset").and_then(|o| o.as_u64()).unwrap_or(0) as usize;

                        let filter_bytes = if let Some(bytes_array) =
                            memcmp.get("bytes").and_then(|b| b.as_array())
                        {
                            bytes_array
                                .iter()
                                .filter_map(|v| v.as_u64())
                                .map(|v| v as u8)
                                .collect()
                        } else if let Some(bytes_str) = memcmp.get("bytes").and_then(|b| b.as_str())
                        {
                            bs58::decode(bytes_str).into_vec().unwrap_or_default()
                        } else {
                            Vec::new()
                        };

                        if filter_bytes.is_empty() {
                            passes_filters = false;
                            break;
                        }

                        if account.data.len() < offset + filter_bytes.len() {
                            passes_filters = false;
                            break;
                        }

                        if &account.data[offset..offset + filter_bytes.len()]
                            != filter_bytes.as_slice()
                        {
                            passes_filters = false;
                            break;
                        }
                    }

                    if let Some(data_size) = filter.get("dataSize").and_then(|s| s.as_u64()) {
                        if account.data.len() != data_size as usize {
                            passes_filters = false;
                            break;
                        }
                    }
                }

                if passes_filters {
                    let account_value = to_wire_account(&address, Some(account), encoding)?;
                    result.push(to_value(serde_json::json!({
                        "pubkey": address.to_string(),
                        "account": account_value
                    }))?);
                }
            }

            to_value(result)?
        }
        "getTokenAccountsByOwner" => {
            let owner_str = params[0].as_str().unwrap_or_default();
            let owner = Pubkey::from_str(owner_str)?;
            let filter_config = &params[1];
            let encoding_config = if params.len() > 2 {
                &params[2]
            } else {
                &Value::Null
            };
            let encoding = get_encoding(encoding_config);

            let program_ids = if let Some(program_id_str) =
                filter_config.get("programId").and_then(|p| p.as_str())
            {
                vec![Pubkey::from_str(program_id_str)?]
            } else if filter_config.get("mint").is_some() {
                // If filtering by mint, we still need to check token programs
                // For now, we'll return empty since mint filtering is more complex
                vec![]
            } else {
                return Err("Invalid filter for getTokenAccountsByOwner".into());
            };

            const SPL_TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
            let accounts_db = svm.accounts_db();
            let token_accounts: Vec<(Pubkey, Account)> = accounts_db
                .inner
                .iter()
                .filter(|(_, account)| program_ids.contains(account.owner()))
                .filter_map(|(pubkey, account)| {
                    let account_clone: Account = account.clone().into();
                    if account_clone.data.len() >= SPL_TOKEN_ACCOUNT_OWNER_OFFSET {
                        let account_owner_bytes =
                            &account_clone.data[SPL_TOKEN_ACCOUNT_OWNER_OFFSET..64];
                        if account_owner_bytes == owner.to_bytes() {
                            return Some((*pubkey, account_clone));
                        }
                    }
                    None
                })
                .collect();

            let mut result = Vec::new();
            for (address, account) in token_accounts {
                let account_value = to_wire_account(&address, Some(account), encoding)?;
                result.push(to_value(serde_json::json!({
                    "pubkey": address.to_string(),
                    "account": account_value
                }))?);
            }

            to_value(Response {
                context: RpcResponseContext {
                    slot,
                    api_version: None,
                },
                value: result,
            })?
        }
        _ => return Err(format!("Method not implemented: {}", method).into()),
    };

    Ok(response)
}

struct MockRpcSender {
    svm: Arc<Mutex<LiteSVM>>,
}

#[async_trait]
impl RpcSender for MockRpcSender {
    async fn send(&self, request: RpcRequest, params: Value) -> ClientResult<Value> {
        let request_json = request.build_request_json(42, params.clone());
        let method = request_json["method"].as_str().unwrap_or_default();
        let default_params = Vec::new();
        let params = request_json["params"].as_array().unwrap_or(&default_params);
        let mut svm = self.svm.lock().await;
        let response = send(&mut svm, method, params).map_err(|e| {
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
