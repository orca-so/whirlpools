use clap::ValueEnum;
use orca_whirlpools::close_position_instructions;
use orca_whirlpools_client::{Position, Whirlpool};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcSendTransactionConfig;
use solana_commitment_config::CommitmentLevel;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_keypair::Signer;
use solana_message::Message;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_signature::Signature;
use solana_transaction::Transaction;
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;
use spl_token_2022_interface::state::Mint;
use std::error::Error;
use tokio::time::{sleep, Duration, Instant};
use tokio_retry::strategy::ExponentialBackoff;
use tokio_retry::Retry;

pub async fn display_position_balances(
    rpc: &RpcClient,
    position: &Position,
    token_mint_a_address: &Pubkey,
    token_mint_b_address: &Pubkey,
    decimals_a: u8,
    decimals_b: u8,
    slippage_tolerance_bps: u16,
) -> Result<(), Box<dyn Error>> {
    let close_position_instructions = close_position_instructions(
        rpc,
        position.position_mint,
        Some(slippage_tolerance_bps),
        None,
    )
    .await?;

    let positon_balance_token_a =
        close_position_instructions.quote.token_est_a as f64 / 10u64.pow(decimals_a as u32) as f64;
    let positon_balance_token_b =
        close_position_instructions.quote.token_est_b as f64 / 10u64.pow(decimals_b as u32) as f64;

    println!(
        "Position Balances: \n\
        - Token A ({:?}): {} \n\
        - Token B ({:?}): {} \n",
        token_mint_a_address,
        positon_balance_token_a,
        token_mint_b_address,
        positon_balance_token_b
    );

    Ok(())
}

pub async fn display_wallet_balances(
    rpc: &RpcClient,
    wallet_address: &Pubkey,
    token_mint_a_address: &Pubkey,
    token_mint_b_address: &Pubkey,
) -> Result<(), Box<dyn Error>> {
    let token_a_balance = fetch_token_balance(rpc, wallet_address, token_mint_a_address).await?;
    let token_b_balance = fetch_token_balance(rpc, wallet_address, token_mint_b_address).await?;

    println!(
        "Wallet Balances: \n\
        - Token A ({:?}): {} \n\
        - Token B ({:?}): {}",
        token_mint_a_address, token_a_balance, token_mint_b_address, token_b_balance
    );

    Ok(())
}

pub async fn fetch_token_balance(
    rpc: &RpcClient,
    wallet_address: &Pubkey,
    token_mint_address: &Pubkey,
) -> Result<String, Box<dyn Error>> {
    let mint_account = rpc.get_account(token_mint_address).await?;
    let token_program_id = mint_account.owner;
    let token_address = get_associated_token_address_with_program_id(
        wallet_address,
        token_mint_address,
        &token_program_id,
    );
    let balance = rpc.get_token_account_balance(&token_address).await?;
    Ok(balance.ui_amount_string)
}

pub async fn fetch_position(
    rpc: &RpcClient,
    position_address: &Pubkey,
) -> Result<Position, Box<dyn Error>> {
    Retry::spawn(
        ExponentialBackoff::from_millis(500)
            .max_delay(Duration::from_secs(5))
            .take(5),
        || async {
            let position_account = rpc.get_account(position_address).await?;
            let position = Position::from_bytes(&position_account.data)?;
            Ok(position)
        },
    )
    .await
}

pub async fn fetch_whirlpool(
    rpc: &RpcClient,
    whirlpool_address: &Pubkey,
) -> Result<Whirlpool, Box<dyn Error>> {
    let whirlpool_account = rpc.get_account(whirlpool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_account.data)?;
    Ok(whirlpool)
}

pub async fn fetch_mint(rpc: &RpcClient, mint_address: &Pubkey) -> Result<Mint, Box<dyn Error>> {
    let mint_account = rpc.get_account(mint_address).await?;
    let mint = Mint::unpack(&mint_account.data)?;
    Ok(mint)
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum)]
pub enum PriorityFeeTier {
    None,
    Low,
    Medium,
    High,
    Turbo,
}

pub async fn send_transaction(
    rpc: &RpcClient,
    wallet: &dyn Signer,
    whirlpool_address: &Pubkey,
    instructions: Vec<solana_instruction::Instruction>,
    additional_signers: Vec<&dyn Signer>,
    tier: PriorityFeeTier,
    max_priority_fee: u64,
) -> Result<Signature, Box<dyn Error>> {
    let mut all_instructions = vec![];

    let recent_blockhash = rpc.get_latest_blockhash().await?;

    let compute_unit_instructions = get_compute_unit_instructions(
        rpc,
        &instructions,
        wallet,
        whirlpool_address,
        &additional_signers,
        tier,
        max_priority_fee,
        recent_blockhash,
    )
    .await?;
    all_instructions.extend(compute_unit_instructions);

    all_instructions.extend(instructions.clone());

    let message = Message::new(&all_instructions, Some(&wallet.pubkey()));
    let mut all_signers = vec![wallet];
    all_signers.extend(additional_signers.clone());

    let transaction = Transaction::new(&all_signers, message, recent_blockhash);
    let transaction_config = RpcSendTransactionConfig {
        skip_preflight: true,
        preflight_commitment: Some(CommitmentLevel::Confirmed),
        max_retries: Some(0),
        ..Default::default()
    };
    let start_time = Instant::now();
    let timeout = Duration::from_secs(90);

    let send_transaction_result = loop {
        if start_time.elapsed() >= timeout {
            break Err(Box::<dyn std::error::Error>::from("Transaction timed out"));
        }
        let signature: Signature = rpc
            .send_transaction_with_config(&transaction, transaction_config)
            .await?;
        let statuses = rpc.get_signature_statuses(&[signature]).await?.value;
        if let Some(status) = statuses[0].clone() {
            break Ok((status, signature));
        }
        sleep(Duration::from_millis(100)).await;
    };
    send_transaction_result.and_then(|(status, signature)| {
        if let Some(err) = status.err {
            Err(Box::new(err))
        } else {
            Ok(signature)
        }
    })
}

async fn get_compute_unit_instructions(
    rpc: &RpcClient,
    instructions: &[solana_instruction::Instruction],
    wallet: &dyn Signer,
    whirlpool_address: &Pubkey,
    additional_signers: &[&dyn Signer],
    tier: PriorityFeeTier,
    max_priority_fee_lamports: u64,
    recent_blockhash: solana_hash::Hash,
) -> Result<Vec<solana_instruction::Instruction>, Box<dyn Error>> {
    let mut compute_unit_instructions = vec![];

    let message = Message::new(instructions, Some(&wallet.pubkey()));
    let mut signers = vec![wallet];
    signers.extend(additional_signers);

    let transaction = Transaction::new(&signers, message, recent_blockhash);
    let simulated_transaction = rpc.simulate_transaction(&transaction).await?;

    if let Some(units_consumed) = simulated_transaction.value.units_consumed {
        let units_margin = std::cmp::max(100_000, (units_consumed as f32 * 0.2).ceil() as u32);
        let units_consumed_safe = units_consumed as u32 + units_margin;
        let compute_limit_instruction =
            ComputeBudgetInstruction::set_compute_unit_limit(units_consumed_safe);
        compute_unit_instructions.push(compute_limit_instruction);

        if let Some(priority_fee_micro_lamports) =
            calculate_priority_fee(rpc, tier, whirlpool_address).await?
        {
            let mut compute_unit_price = priority_fee_micro_lamports;
            let total_priority_fee_lamports =
                (units_consumed_safe as u64 * priority_fee_micro_lamports) / 1_000_000;

            if total_priority_fee_lamports > max_priority_fee_lamports {
                compute_unit_price =
                    (max_priority_fee_lamports * 1_000_000) / units_consumed_safe as u64;
            }

            display_priority_fee_details(
                compute_unit_price,
                units_consumed_safe,
                (units_consumed_safe as u64 * compute_unit_price) / 1_000_000,
            );

            let priority_fee_instruction =
                ComputeBudgetInstruction::set_compute_unit_price(compute_unit_price);
            compute_unit_instructions.push(priority_fee_instruction);
        }
    }

    Ok(compute_unit_instructions)
}

fn display_priority_fee_details(
    compute_unit_price: u64,
    units_consumed: u32,
    total_priority_fee_lamports: u64,
) {
    println!(
        "Priority Fee Details:\n\
        - Compute unit price: {} microlamports\n\
        - Estimated compute units: {}\n\
        - Total priority fee: {} lamports",
        compute_unit_price, units_consumed, total_priority_fee_lamports
    );
}

async fn calculate_priority_fee(
    rpc: &RpcClient,
    tier: PriorityFeeTier,
    whirlpool_address: &Pubkey,
) -> Result<Option<u64>, Box<dyn Error>> {
    let prioritization_fees = rpc
        .get_recent_prioritization_fees(&[*whirlpool_address])
        .await
        .unwrap();

    if prioritization_fees.is_empty() || matches!(tier, PriorityFeeTier::None) {
        return Ok(None);
    }
    let mut fees: Vec<u64> = prioritization_fees
        .iter()
        .map(|fee| fee.prioritization_fee)
        .collect();
    fees.sort_unstable();

    let fee = match tier {
        PriorityFeeTier::Low => fees.get(fees.len() / 4).cloned(),
        PriorityFeeTier::Medium => fees.get(fees.len() / 2).cloned(),
        PriorityFeeTier::High => fees.get((fees.len() * 4) / 5).cloned(),
        PriorityFeeTier::Turbo => fees.get((fees.len() * 99) / 100).cloned(),
        PriorityFeeTier::None => None,
    };

    Ok(fee)
}
