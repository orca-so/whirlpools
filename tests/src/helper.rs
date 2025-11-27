#![allow(deprecated)]
#![allow(dead_code)]
use crate::constants::{PROGRAM_ID, RPC_URL};
use anchor_client::solana_sdk::account::Account;
use anchor_client::solana_sdk::commitment_config::CommitmentConfig;
use anchor_client::{Client, Cluster, Program};
use base64::decode;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use reqwest::blocking::Client as reqwest_client;
use serde_json::json;
use sha2::{Digest, Sha256};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_pubkey::Pubkey;
use solana_sdk::clock::Clock;
use solana_sdk::{signer::Signer, transaction::VersionedTransaction};
use std::fs;

#[allow(clippy::result_large_err)]
pub fn send_tx(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: Vec<Instruction>,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&ixs.to_vec(), Some(&payer.pubkey()), &blockhash);

    let vtx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).expect("vtx");

    // println!("vtx: {:?}", vtx);
    let result = svm.send_transaction(vtx);

    svm.expire_blockhash();

    result
}

pub fn init_svm(airdrops: &[&Keypair]) -> LiteSVM {
    // we have to extend log bytes limit, otherwise for the finalize test,
    // logs are truncated and fetching event fails
    let mut svm = LiteSVM::new().with_log_bytes_limit(Some(20_000));

    // Load the program binary into the SVM
    let so_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/deploy/whirlpool.so");
    let so_bytes = fs::read(&so_path).unwrap();
    svm.add_program(PROGRAM_ID, &so_bytes).unwrap();

    // Airdrop SOL to everyone in the airdrops array
    for airdrop in airdrops {
        svm.airdrop(&airdrop.pubkey(), 2_000_000_000)
            .expect("airdrop");
    }

    svm
}

pub fn get_balance(svm: &LiteSVM, pubkey: &Pubkey) -> u64 {
    let account = svm.get_account(pubkey).unwrap();
    account.lamports
}

pub fn load_keypair_from_fixture(keypair_name: &str) -> Keypair {
    let keypair_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("src/fixtures/{}.json", keypair_name));

    let data = fs::read_to_string(keypair_path).unwrap();
    let bytes: Vec<u8> = serde_json::from_str(&data).unwrap();

    let mut keypair_bytes = [0u8; 64];
    keypair_bytes.copy_from_slice(&bytes);

    Keypair::from_bytes(&keypair_bytes).expect("Invalid keypair bytes")
}

pub fn load_account_in_svm_from_public_key(svm: &mut LiteSVM, key: Pubkey) -> Result<(), String> {
    let account = svm.get_account(&key);

    if account.is_some() {
        return Ok(());
    }

    let client = reqwest_client::new();
    let payload = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getAccountInfo",
        "params": [
            key.to_string(),
            {
                "encoding": "base64"
            }
        ]
    });

    let resp = client
        .post(RPC_URL)
        .json(&payload)
        .send()
        .unwrap()
        .json::<serde_json::Value>()
        .unwrap();

    if let Some(_value) = resp["result"]["value"].as_object() {
        let data_base64 = resp["result"]["value"]["data"][0]
            .as_str()
            .expect(&format!("Expected base64 string for key: {:?}", resp));

        let data_bytes: Vec<u8> = STANDARD
            .decode(data_base64)
            .expect("Failed to decode base64");

        let executable = resp["result"]["value"]["executable"].as_bool().unwrap();

        let account = Account {
            lamports: resp["result"]["value"]["lamports"].as_u64().unwrap(),
            data: data_bytes.clone(),
            owner: Pubkey::from_str_const(resp["result"]["value"]["owner"].as_str().unwrap()),
            executable: executable,
            rent_epoch: resp["result"]["value"]["rentEpoch"].as_u64().unwrap(),
        };

        // if it's an executable account and not the system program
        // we need to also fetch the program executable data
        // and we have to do it before setting up the program in SVM
        if executable && key != Pubkey::from_str_const("11111111111111111111111111111111") {
            let data = data_bytes.clone();
            let start = 4;
            let slice: &[u8] = &data[start..start + 32];
            let array: [u8; 32] = slice.try_into().expect("slice doit faire 32 bytes");
            let pubkey = Pubkey::new_from_array(array);
            load_account_in_svm_from_public_key(svm, pubkey).unwrap();
        }

        match svm.set_account(key, account) {
            Ok(_) => (),
            Err(e) => eprintln!("Failed to set account for key {:?}: {:?}", key, e,),
        }
    }

    Ok(())
}

pub fn init_dummy_pda(svm: &mut LiteSVM, pda_name: &str, size: usize) -> Result<Pubkey, String> {
    let mut hasher = Sha256::new();
    hasher.update(format!("account:{}", pda_name).as_bytes());
    let hash = hasher.finalize();
    let discriminator: [u8; 8] = hash[0..8].try_into().unwrap();

    let mut data = discriminator.to_vec();
    data.extend_from_slice(&vec![0; size]);

    let pda = Pubkey::new_unique();

    svm.set_account(
        pda,
        Account {
            lamports: 100,
            data: data,
            owner: PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .expect("init_dummy_pda");

    Ok(pda)
}

pub fn init_keypair_with_airdrop(svm: &mut LiteSVM) -> Keypair {
    let keypair = Keypair::new();
    svm.airdrop(&keypair.pubkey(), 2_000_000_000)
        .expect("airdrop");
    keypair
}

pub fn init_program<'a>(admin: &'a Keypair) -> Program<&'a Keypair> {
    let client = Client::new_with_options(
        Cluster::Custom("http://localhost:8899".into(), "ws://localhost:8900".into()),
        admin,
        CommitmentConfig::processed(),
    );

    client.program(PROGRAM_ID).unwrap()
}

pub fn advance_clock(svm: &mut LiteSVM, seconds: i64) {
    let clock: Clock = svm.get_sysvar::<Clock>();
    let mut new_clock = clock.clone();
    new_clock.unix_timestamp += seconds;
    svm.set_sysvar(&new_clock);
}
