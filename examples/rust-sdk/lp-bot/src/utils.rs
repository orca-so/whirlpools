use clap::ValueEnum;
use orca_whirlpools_client::{Position, Whirlpool};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::{
    message::Message, program_pack::Pack, pubkey::Pubkey, signature::Signature, signer::Signer,
    transaction::Transaction,
};
use spl_token_2022::state::Mint;
use std::future::Future;
use tokio::time::sleep;
use tokio::time::Duration;

const MAX_RETRIES: usize = 3;
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(100);

// pub async fn display_wallet_balances(
//     rpc: &RpcClient,
//     token_a_address: &Pubkey,
//     token_b_address: &Pubkey,
// ) -> Result<(), Box<dyn std::error::Error>> {
//     let token_a_balance = fetch_token_balance(rpc, token_a_address).await?;
//     let token_b_balance = fetch_token_balance(rpc, token_b_address).await?;

//     println!(
//         "Wallet Balances: \n\
//         - Token A ({:?}): {} \n\
//         - Token B ({:?}): {}",
//         token_a_address, token_a_balance, token_b_address, token_b_balance
//     );

//     Ok(())
// }

// async fn fetch_token_balance(
//     rpc: &RpcClient,
//     token_address: &Pubkey,
// ) -> Result<String, Box<dyn std::error::Error>> {
//     retry_async(
//         || async {
//             let balance = rpc.get_token_account_balance(token_address).await?;
//             Ok(balance.ui_amount_string)
//         },
//         MAX_RETRIES,
//         INITIAL_RETRY_DELAY,
//         "fetch token balance",
//     )
//     .await
// }

pub async fn fetch_position(
    rpc: &RpcClient,
    position_address: &Pubkey,
) -> Result<Position, Box<dyn std::error::Error>> {
    retry_async(
        || async {
            let position_account = rpc.get_account(position_address).await?;
            let position = Position::from_bytes(&position_account.data)?;
            Ok(position)
        },
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        "fetch position",
    )
    .await
}

pub async fn fetch_whirlpool(
    rpc: &RpcClient,
    whirlpool_address: &Pubkey,
) -> Result<Whirlpool, Box<dyn std::error::Error>> {
    retry_async(
        || async {
            let whirlpool_account = rpc.get_account(whirlpool_address).await?;
            let whirlpool = Whirlpool::from_bytes(&whirlpool_account.data)?;
            Ok(whirlpool)
        },
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        "fetch whirlpool",
    )
    .await
}

pub async fn fetch_mint(
    rpc: &RpcClient,
    mint_address: &Pubkey,
) -> Result<Mint, Box<dyn std::error::Error>> {
    retry_async(
        || async {
            let mint_account = rpc.get_account(mint_address).await?;
            let mint = Mint::unpack(&mint_account.data)?;
            Ok(mint)
        },
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        "fetch mint",
    )
    .await
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
    instructions: Vec<solana_sdk::instruction::Instruction>,
    additional_signers: Vec<&dyn Signer>,
    tier: PriorityFeeTier,
    max_priority_fee: u64,
) -> Result<Signature, Box<dyn std::error::Error>> {
    retry_async(
        || async {
            let mut all_instructions = vec![];

            if let Some(priority_fee_instruction) = get_priority_fee_instruction(
                rpc,
                &instructions,
                wallet,
                &additional_signers,
                tier,
                max_priority_fee,
            )
            .await?
            {
                all_instructions.push(priority_fee_instruction);
            }

            all_instructions.extend(instructions.clone());

            let recent_blockhash = rpc.get_latest_blockhash().await?;
            let message = Message::new(&all_instructions, Some(&wallet.pubkey()));
            let mut all_signers = vec![wallet];
            all_signers.extend(additional_signers.clone());

            let transaction = Transaction::new(&all_signers, message, recent_blockhash);
            let signature = rpc.send_and_confirm_transaction(&transaction).await?;
            Ok(signature)
        },
        MAX_RETRIES,
        INITIAL_RETRY_DELAY,
        "send transaction",
    )
    .await
}

async fn get_priority_fee_instruction(
    rpc: &RpcClient,
    instructions: &[solana_sdk::instruction::Instruction],
    wallet: &dyn Signer,
    additional_signers: &[&dyn Signer],
    tier: PriorityFeeTier,
    max_priority_fee_lamports: u64,
) -> Result<Option<solana_sdk::instruction::Instruction>, Box<dyn std::error::Error>> {
    if let Some(priority_fee_micro_lamports) = calculate_priority_fee(rpc, tier).await? {
        let recent_blockhash = rpc.get_latest_blockhash().await?;
        let message = Message::new(instructions, Some(&wallet.pubkey()));
        let mut signers = vec![wallet];
        signers.extend(additional_signers);

        let transaction = Transaction::new(&signers, message, recent_blockhash);
        let simulated_transaction = rpc.simulate_transaction(&transaction).await.unwrap();

        if let Some(units_consumed) = simulated_transaction.value.units_consumed {
            let mut compute_unit_price = priority_fee_micro_lamports;
            let total_priority_fee_lamports =
                (units_consumed as u64 * priority_fee_micro_lamports) / 1_000_000;

            if total_priority_fee_lamports > max_priority_fee_lamports {
                compute_unit_price = (max_priority_fee_lamports * 1_000_000) / units_consumed;
            }

            print_priority_fee_details(
                compute_unit_price,
                units_consumed,
                (units_consumed as u64 * compute_unit_price) / 1_000_000,
            );

            return Ok(Some(create_priority_fee_instruction(compute_unit_price)));
        }
    }

    Ok(None)
}

fn print_priority_fee_details(
    compute_unit_price: u64,
    units_consumed: u64,
    total_priority_fee_lamports: u64,
) {
    println!(
        "Priority Fee Details:\n\
        - Compute Unit Price: {} microlamports\n\
        - Compute Units Consumed: {}\n\
        - Total Priority Fee: {} lamports\n",
        compute_unit_price, units_consumed, total_priority_fee_lamports
    );
}

async fn calculate_priority_fee(
    rpc: &RpcClient,
    tier: PriorityFeeTier,
) -> Result<Option<u64>, Box<dyn std::error::Error>> {
    let prioritization_fees = rpc.get_recent_prioritization_fees(&[]).await.unwrap();

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
        PriorityFeeTier::High => fees.get((fees.len() * 3) / 4).cloned(),
        PriorityFeeTier::Turbo => fees.get((fees.len() * 95) / 100).cloned(),
        PriorityFeeTier::None => None,
    };

    Ok(fee)
}

fn create_priority_fee_instruction(unit_price: u64) -> solana_sdk::instruction::Instruction {
    ComputeBudgetInstruction::set_compute_unit_price(unit_price)
}

async fn retry_async<'a, F, Fut, T, E>(
    mut operation: F,
    max_retries: usize,
    delay: Duration,
    description: &str,
) -> Result<T, E>
where
    F: FnMut() -> Fut + 'a,
    Fut: Future<Output = Result<T, E>> + 'a,
    E: std::fmt::Debug,
{
    let mut attempts = 0;
    let mut current_delay = delay;

    while attempts < max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(err) if attempts < max_retries - 1 => {
                attempts += 1;
                eprintln!(
                    "[Retry {}/{}] Failed to {}. Error: {:?}. Retrying in {:?}...",
                    attempts, max_retries, description, err, current_delay
                );
                sleep(current_delay).await;
                current_delay *= 2;
            }
            Err(err) => {
                eprintln!(
                    "[Failed] {} failed after {} attempts. Error: {:?}",
                    description,
                    attempts + 1,
                    err
                );
                return Err(err);
            }
        }
    }

    unreachable!("Exceeded max retries but did not return error");
}
