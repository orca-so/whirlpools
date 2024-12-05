use orca_whirlpools_core::TransferFee;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::account::Account as SolanaAccount;
use solana_sdk::hash::hashv;
use solana_sdk::program_error::ProgramError;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::system_instruction::create_account_with_seed;
use solana_sdk::{instruction::Instruction, pubkey::Pubkey, system_instruction};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id, instruction::create_associated_token_account,
};
use spl_token::instruction::{close_account, initialize_account3, sync_native};
use spl_token::solana_program::program_pack::Pack;
use spl_token::{native_mint, ID as TOKEN_PROGRAM_ID};
use spl_token_2022::extension::transfer_fee::TransferFeeConfig;
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use spl_token_2022::state::{Account, Mint};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, error::Error};
use spl_token_2022::ID as TOKEN_2022_PROGRAM_ID;

use crate::{NativeMintWrappingStrategy, NATIVE_MINT_WRAPPING_STRATEGY};

#[derive(Debug, PartialEq, Eq, Hash)]
pub(crate) enum TokenAccountStrategy {
    WithoutBalance(Pubkey),
    WithBalance(Pubkey, u64),
}

#[derive(Debug)]
pub(crate) struct TokenAccountInstructions {
    pub create_instructions: Vec<Instruction>,
    pub cleanup_instructions: Vec<Instruction>,
    pub token_account_addresses: HashMap<Pubkey, Pubkey>,
    pub additional_signers: Vec<Keypair>,
}

pub(crate) async fn prepare_token_accounts_instructions(
    rpc: &RpcClient,
    owner: Pubkey,
    spec: Vec<TokenAccountStrategy>,
) -> Result<TokenAccountInstructions, Box<dyn Error>> {
    let mint_addresses: Vec<Pubkey> = spec
        .iter()
        .map(|x| match x {
            TokenAccountStrategy::WithoutBalance(mint) => *mint,
            TokenAccountStrategy::WithBalance(mint, _) => *mint,
        })
        .collect();
    let native_mint_wrapping_strategy = *NATIVE_MINT_WRAPPING_STRATEGY.try_lock()?;
    let native_mint_index = mint_addresses
        .iter()
        .position(|&x| x == spl_token::native_mint::ID);
    let has_native_mint = native_mint_index.is_some();

    let maybe_mint_account_infos = rpc.get_multiple_accounts(&mint_addresses).await?;
    let mint_account_infos: Vec<&SolanaAccount> = maybe_mint_account_infos
        .iter()
        .map(|x| x.as_ref().ok_or(ProgramError::UninitializedAccount))
        .collect::<Result<Vec<&SolanaAccount>, ProgramError>>()?;

    let ata_addresses: Vec<Pubkey> = mint_account_infos
        .iter()
        .enumerate()
        .map(|(i, x)| {
            get_associated_token_address_with_program_id(&owner, &mint_addresses[i], &x.owner)
        })
        .collect();

    let ata_account_infos = rpc.get_multiple_accounts(&ata_addresses).await?;

    let mut token_account_addresses: HashMap<Pubkey, Pubkey> = HashMap::new();
    let mut create_instructions: Vec<Instruction> = Vec::new();
    let mut cleanup_instructions: Vec<Instruction> = Vec::new();
    let mut additional_signers: Vec<Keypair> = Vec::new();

    let use_native_mint_ata = native_mint_wrapping_strategy == NativeMintWrappingStrategy::Ata
        || native_mint_wrapping_strategy == NativeMintWrappingStrategy::None;
    for i in 0..mint_addresses.len() {
        let mint_address = mint_addresses[i];
        let ata_address = ata_addresses[i];
        token_account_addresses.insert(mint_address, ata_address);

        if native_mint_index == Some(i) && !use_native_mint_ata {
            continue;
        }

        if ata_account_infos[i].is_some() {
            continue;
        }

        create_instructions.push(create_associated_token_account(
            &owner,
            &ata_address,
            &mint_address,
            &mint_account_infos[i].owner,
        ));
    }

    for i in 0..mint_addresses.len() {
        if native_mint_index == Some(i)
            && native_mint_wrapping_strategy != NativeMintWrappingStrategy::None
        {
            continue;
        }

        let existing_balance = if let Some(account_info) = &ata_account_infos[i] {
            Account::unpack(&account_info.data)?.amount
        } else {
            0
        };

        let required_balance = if let TokenAccountStrategy::WithBalance(_, balance) = spec[i] {
            balance
        } else {
            0
        };

        if existing_balance < required_balance {
            return Err(format!("Insufficient balance for mint {}", mint_addresses[i]).into());
        }
    }

    if has_native_mint && native_mint_wrapping_strategy == NativeMintWrappingStrategy::Keypair {
        let keypair = Keypair::new();
        let mut lamports = rpc
            .get_minimum_balance_for_rent_exemption(Account::LEN)
            .await?;

        if let TokenAccountStrategy::WithBalance(_, balance) = spec[native_mint_index.unwrap_or(0)]
        {
            lamports += balance;
        }

        create_instructions.push(system_instruction::create_account(
            &owner,
            &keypair.pubkey(),
            lamports,
            Account::LEN as u64,
            &TOKEN_PROGRAM_ID,
        ));

        create_instructions.push(initialize_account3(
            &TOKEN_PROGRAM_ID,
            &keypair.pubkey(),
            &native_mint::ID,
            &owner,
        )?);

        cleanup_instructions.push(close_account(
            &TOKEN_PROGRAM_ID,
            &keypair.pubkey(),
            &owner,
            &owner,
            &[],
        )?);

        token_account_addresses.insert(native_mint::ID, keypair.pubkey());
        additional_signers.push(keypair);
    }

    if has_native_mint && native_mint_wrapping_strategy == NativeMintWrappingStrategy::Seed {
        let mut lamports = rpc
            .get_minimum_balance_for_rent_exemption(Account::LEN)
            .await?;

        if let TokenAccountStrategy::WithBalance(_, balance) = spec[native_mint_index.unwrap_or(0)]
        {
            lamports += balance;
        }

        // Generating secure seed takes longer and is not really needed here.
        // With date, it should only create collisions if the same owner
        // creates multiple accounts at exactly the same time (in ms)
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_millis()
            .to_string();
        let pubkey = Pubkey::new_from_array(
            hashv(&[
                owner.to_bytes().as_ref(),
                seed.as_bytes(),
                TOKEN_PROGRAM_ID.to_bytes().as_ref(),
            ])
            .to_bytes(),
        );

        create_instructions.push(create_account_with_seed(
            &owner,
            &pubkey,
            &owner,
            &seed,
            lamports,
            Account::LEN as u64,
            &TOKEN_PROGRAM_ID,
        ));

        create_instructions.push(initialize_account3(
            &TOKEN_PROGRAM_ID,
            &pubkey,
            &native_mint::ID,
            &owner,
        )?);

        cleanup_instructions.push(close_account(
            &TOKEN_PROGRAM_ID,
            &pubkey,
            &owner,
            &owner,
            &[],
        )?);

        token_account_addresses.insert(native_mint::ID, pubkey);
    }

    if has_native_mint && native_mint_wrapping_strategy == NativeMintWrappingStrategy::Ata {
        let account_info = &ata_account_infos[native_mint_index.unwrap_or(0)];

        let existing_balance: u64 = if let Some(account_info) = account_info {
            Account::unpack(&account_info.data)?.amount
        } else {
            0
        };

        let required_balance = if let TokenAccountStrategy::WithBalance(_, balance) =
            spec[native_mint_index.unwrap_or(0)]
        {
            balance
        } else {
            0
        };

        if existing_balance < required_balance {
            create_instructions.push(system_instruction::transfer(
                &owner,
                &token_account_addresses[&native_mint::ID],
                required_balance - existing_balance,
            ));
            create_instructions.push(sync_native(
                &TOKEN_PROGRAM_ID,
                &token_account_addresses[&native_mint::ID],
            )?);
        }

        // If the ATA did not exist before, we close it at the end of the transaction.
        if account_info.is_none() {
            cleanup_instructions.push(close_account(
                &TOKEN_PROGRAM_ID,
                &token_account_addresses[&native_mint::ID],
                &owner,
                &owner,
                &[],
            )?);
        }
    }

    Ok(TokenAccountInstructions {
        create_instructions,
        cleanup_instructions,
        token_account_addresses,
        additional_signers,
    })
}

pub(crate) fn get_current_transfer_fee(
    mint_account_info: Option<&SolanaAccount>,
    current_epoch: u64,
) -> Option<TransferFee> {
    let token_mint_data = &mint_account_info?.data;
    println!("Token mint data length: {}, {:?}", token_mint_data.len(), token_mint_data);
    
    let token_mint_unpacked = StateWithExtensions::<Mint>::unpack(token_mint_data).ok()?;
    println!("Successfully unpacked token mint data");
    
    if let Ok(transfer_fee_config) = token_mint_unpacked.get_extension::<TransferFeeConfig>() {
        println!("Found transfer fee config extension");
        let fee = transfer_fee_config.get_epoch_fee(current_epoch);
            
        return Some(TransferFee {
            fee_bps: fee.transfer_fee_basis_points.into(),
            max_fee: fee.maximum_fee.into(),
        });
    }

    None
}

/// Orders two mint addresses by their canonical byte order.
///
/// This function compares two Solana `Pubkey` values and returns an array where the first element
/// is the smaller key in canonical byte order, and the second element is the larger key.
///
/// # Arguments
///
/// * `mint1` - The first mint address to compare.
/// * `mint2` - The second mint address to compare.
///
/// # Returns
///
/// An array `[Pubkey, Pubkey]` where the first element is the smaller mint address and the second is the larger.
///
/// # Example
///
/// ```rust
/// use solana_program::pubkey::Pubkey;
/// use orca_whirlpools_sdk::order_mints;
/// use std::str::FromStr;
///
/// let mint1 = Pubkey::from_str("MintAddress1").unwrap();
/// let mint2 = Pubkey::from_str("MintAddress2").unwrap();
///
/// let ordered_mints = order_mints(mint1, mint2);
/// println!("Ordered mints: {:?}", ordered_mints);
/// ```
pub fn order_mints(mint1: Pubkey, mint2: Pubkey) -> [Pubkey; 2] {
    if mint1.lt(&mint2) {
        [mint1, mint2]
    } else {
        [mint2, mint1]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use solana_program::program_option::COption;
    use spl_token_2022::extension::ExtensionType;
    use crate::tests::{RpcContext, setup_mint_te, setup_mint_te_fee};
    use serial_test::serial;

    #[test]
    fn test_order_mints() {
        let mint1 = Pubkey::from_str("Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa").unwrap();
        let mint2 = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap();

        let [mint_a, mint_b] = order_mints(mint1, mint2);
        assert_eq!(mint_a, mint1);
        assert_eq!(mint_b, mint2);

        let [mint_c, mint_d] = order_mints(mint2, mint1);
        assert_eq!(mint_c, mint1);
        assert_eq!(mint_d, mint2);
    }

    #[tokio::test]
    #[serial]
    async fn test_token_2022_extensions() {
        let ctx = RpcContext::new().await;

        // Create Token-2022 mint with transfer fee
        let mint_te = setup_mint_te_fee(&ctx).await.unwrap();
        let mint_account = ctx.rpc.get_account(&mint_te).await.unwrap();

        // Test transfer fee at epoch 0
        let older = get_current_transfer_fee(Some(&mint_account), 0).unwrap();
        assert_eq!(older.fee_bps, 100);  // 1%
        assert_eq!(older.max_fee, 1_000_000_000);  // 1 token

        // Test transfer fee at epoch 2
        let newer = get_current_transfer_fee(Some(&mint_account), 2).unwrap();
        assert_eq!(newer.fee_bps, 150);  // 1.5%
        assert_eq!(newer.max_fee, 1_000_000_000);  // 1 token

        // Test with no fee
        let no_fee_result = get_current_transfer_fee(None, 0);
        assert!(no_fee_result.is_none());
    }

    #[tokio::test]
    #[serial]
    async fn test_token_2022_account() {
        let ctx = RpcContext::new().await;
        
        // Create basic Token-2022 mint (without transfer fee)
        let mint = setup_mint_te(&ctx, &[]).await.unwrap();
        let mint_account = ctx.rpc.get_account(&mint).await.unwrap();
        
        // Verify account data
        assert_eq!(mint_account.data.len(), 82);  
        assert_eq!(mint_account.owner, TOKEN_2022_PROGRAM_ID);
    }

    #[tokio::test]
    #[serial]
    async fn test_token_2022_with_transfer_fee() {
        let ctx = RpcContext::new().await;
        
        // Create Token-2022 mint with transfer fee
        let mint = setup_mint_te_fee(&ctx).await.unwrap();
        
        // Verify account data
        let account = ctx.rpc.get_account(&mint).await.unwrap();
        assert!(account.data.len() > 82);  // Size is larger due to extension
        assert_eq!(account.owner, TOKEN_2022_PROGRAM_ID);
    }

    #[tokio::test]
    #[serial]
    async fn test_no_tokens() {
        let ctx = RpcContext::new().await;
        let result = prepare_token_accounts_instructions(&ctx.rpc, ctx.signer.pubkey(), vec![])
            .await
            .unwrap();

        assert_eq!(result.create_instructions.len(), 0);
        assert_eq!(result.cleanup_instructions.len(), 0);
        assert_eq!(result.token_account_addresses.len(), 0);
    }

    #[tokio::test]
    #[serial]
    async fn test_native_mint_wrapping_none() {
        let ctx = RpcContext::new().await;
        crate::set_native_mint_wrapping_strategy(NativeMintWrappingStrategy::None).unwrap();

        let result = prepare_token_accounts_instructions(
            &ctx.rpc,
            ctx.signer.pubkey(),
            vec![TokenAccountStrategy::WithoutBalance(native_mint::ID)],
        )
        .await
        .unwrap();

        assert_eq!(result.create_instructions.len(), 1); // Create ATA
        assert_eq!(result.cleanup_instructions.len(), 0);
        assert_eq!(result.token_account_addresses.len(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn test_native_mint_wrapping_ata() {
        let ctx = RpcContext::new().await;
        crate::set_native_mint_wrapping_strategy(NativeMintWrappingStrategy::Ata).unwrap();
    
        let result = prepare_token_accounts_instructions(
            &ctx.rpc,
            ctx.signer.pubkey(),
            vec![TokenAccountStrategy::WithBalance(
                native_mint::ID,
                1_000_000,
            )],
        )
        .await
        .unwrap();
    
        assert_eq!(result.create_instructions.len(), 3); // Create ATA + transfer + sync_native
        assert_eq!(result.token_account_addresses.len(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn test_native_mint_wrapping_keypair() {
        let ctx = RpcContext::new().await;
        crate::set_native_mint_wrapping_strategy(NativeMintWrappingStrategy::Keypair).unwrap();

        let result = prepare_token_accounts_instructions(
            &ctx.rpc,
            ctx.signer.pubkey(),
            vec![TokenAccountStrategy::WithBalance(
                native_mint::ID,
                1_000_000,
            )],
        )
        .await
        .unwrap();

        assert_eq!(result.create_instructions.len(), 2); // create + initialize
        assert_eq!(result.cleanup_instructions.len(), 1); // close
        assert_eq!(result.token_account_addresses.len(), 1);
        assert_eq!(result.additional_signers.len(), 1);
    }
}
