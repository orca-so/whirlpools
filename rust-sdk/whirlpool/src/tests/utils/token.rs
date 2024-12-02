use std::error::Error;
use std::collections::HashMap;

use solana_sdk::{
    instruction::Instruction,
    program_pack::Pack,
    pubkey::Pubkey,
    signer::{Signer, keypair::Keypair},
    system_instruction::{create_account, create_account_with_seed, transfer},
    hash::hashv,
};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::{create_associated_token_account, create_associated_token_account_idempotent},
};
use spl_token::{
    instruction::{initialize_mint2, mint_to, sync_native, initialize_account3, close_account},
    native_mint,
    state::{Account as TokenAccount, Mint as SplMint},
    ID as TOKEN_PROGRAM_ID,
};
use spl_token_2022::ID as TOKEN_2022_PROGRAM_ID;

use crate::{
    NATIVE_MINT_WRAPPING_STRATEGY,
    NativeMintWrappingStrategy,
};

use super::rpc::RpcContext;

// Sets up an associated token account (ATA) with optional amount
pub async fn setup_ata(ctx: &RpcContext, mint: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    setup_ata_with_amount(ctx, mint, 0).await
}

// Sets up an ATA and mints tokens if amount is specified
pub async fn setup_ata_with_amount(
    ctx: &RpcContext,
    mint: Pubkey,
    amount: u64,
) -> Result<Pubkey, Box<dyn Error>> {
    let ata = get_associated_token_address_with_program_id(
        &ctx.signer.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    );

    let mut instructions = vec![create_associated_token_account_idempotent(
        &ctx.signer.pubkey(),
        &ctx.signer.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    )];

    if amount > 0 {
        if mint.eq(&native_mint::ID) {
            instructions.push(transfer(&ctx.signer.pubkey(), &ata, amount));
            instructions.push(sync_native(&TOKEN_PROGRAM_ID, &ata)?);
        } else {
            instructions.push(mint_to(
                &TOKEN_PROGRAM_ID,
                &mint,
                &ata,
                &ctx.signer.pubkey(),
                &[],
                amount,
            )?);
        }
    }

    ctx.send_transaction(instructions).await?;

    Ok(ata)
}

// Sets up a mint with default decimals
pub async fn setup_mint(ctx: &RpcContext) -> Result<Pubkey, Box<dyn Error>> {
    setup_mint_with_decimals(ctx, 9).await
}

// Sets up a mint with specified decimals
pub async fn setup_mint_with_decimals(
    ctx: &RpcContext,
    decimals: u8,
) -> Result<Pubkey, Box<dyn Error>> {
    let keypair = ctx.get_next_keypair();

    let instructions = vec![
        create_account(
            &ctx.signer.pubkey(),
            &keypair.pubkey(),
            1_000_000_000,
            SplMint::LEN as u64,
            &TOKEN_PROGRAM_ID,
        ),
        initialize_mint2(
            &TOKEN_PROGRAM_ID,
            &keypair.pubkey(),
            &ctx.signer.pubkey(),
            None,
            decimals,
        )?,
    ];

    ctx.send_transaction_with_signers(instructions, vec![keypair])
        .await?;

    Ok(keypair.pubkey())
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TokenAccountStrategy {
    WithoutBalance(Pubkey),
    WithBalance(Pubkey, u64),
}

pub struct TokenAccountInstructions {
    pub create_instructions: Vec<Instruction>,
    pub cleanup_instructions: Vec<Instruction>,
    pub token_account_addresses: HashMap<Pubkey, Pubkey>,
    pub additional_signers: Vec<Keypair>,
}

// Prepares instructions for creating token accounts based on strategies
pub async fn prepare_token_accounts_instructions(
    rpc: &RpcContext,
    owner: Pubkey,
    specs: Vec<TokenAccountStrategy>,
) -> Result<TokenAccountInstructions, Box<dyn Error>> {
    let mut create_instructions = Vec::new();
    let mut cleanup_instructions = Vec::new();
    let mut token_account_addresses = HashMap::new();
    let mut additional_signers = Vec::new();

    let native_mint_index = specs.iter().position(|x| match x {
        TokenAccountStrategy::WithoutBalance(mint) => *mint == native_mint::ID,
        TokenAccountStrategy::WithBalance(mint, _) => *mint == native_mint::ID,
    });
    let has_native_mint = native_mint_index.is_some();

    // Skip native mint if wrapping strategy is not 'none' or 'ata'
    let use_native_mint_ata = *NATIVE_MINT_WRAPPING_STRATEGY.lock().unwrap() == NativeMintWrappingStrategy::Ata
        || *NATIVE_MINT_WRAPPING_STRATEGY.lock().unwrap() == NativeMintWrappingStrategy::None;

    for (i, spec) in specs.iter().enumerate() {
        let mint = match spec {
            TokenAccountStrategy::WithoutBalance(mint) => *mint,
            TokenAccountStrategy::WithBalance(mint, _) => *mint,
        };

        if native_mint_index == Some(i) && !use_native_mint_ata {
            continue;
        }

        // Get mint account info
        let mint_account = rpc.rpc.get_account(&mint).await?;
        let is_token_2022 = mint_account.owner == TOKEN_2022_PROGRAM_ID;

        // Create ATA instruction using appropriate token program
        let ata = if is_token_2022 {
            get_associated_token_address_with_program_id(
                &owner,
                &mint,
                &TOKEN_2022_PROGRAM_ID,
            )
        } else {
            get_associated_token_address_with_program_id(
                &owner,
                &mint,
                &TOKEN_PROGRAM_ID,
            )
        };

        create_instructions.push(
            create_associated_token_account(
                &owner,
                &owner,
                &mint,
                &mint_account.owner,
            ),
        );

        token_account_addresses.insert(mint, ata);
    }

    // Handle native SOL wrapping strategy
    if has_native_mint {
        match *NATIVE_MINT_WRAPPING_STRATEGY.lock().unwrap() {
            NativeMintWrappingStrategy::Keypair => {
                let keypair = Keypair::new();
                let mut lamports = rpc.rpc.get_minimum_balance_for_rent_exemption(TokenAccount::LEN).await?;

                if let Some(TokenAccountStrategy::WithBalance(_, balance)) = specs.get(native_mint_index.unwrap()) {
                    lamports += balance;
                }

                create_instructions.push(
                    create_account(
                        &owner,
                        &keypair.pubkey(),
                        lamports,
                        TokenAccount::LEN as u64,
                        &TOKEN_PROGRAM_ID,
                    ),
                );

                create_instructions.push(
                    initialize_account3(
                        &TOKEN_PROGRAM_ID,
                        &keypair.pubkey(),
                        &native_mint::ID,
                        &owner,
                    )?,
                );

                cleanup_instructions.push(
                    close_account(
                        &TOKEN_PROGRAM_ID,
                        &keypair.pubkey(),
                        &owner,
                        &owner,
                        &[],
                    )?,
                );

                token_account_addresses.insert(native_mint::ID, keypair.pubkey());
                additional_signers.push(keypair);
            },
            NativeMintWrappingStrategy::Seed => {
                let mut lamports = rpc.rpc.get_minimum_balance_for_rent_exemption(TokenAccount::LEN).await?;

                if let Some(TokenAccountStrategy::WithBalance(_, balance)) = specs.get(native_mint_index.unwrap()) {
                    lamports += balance;
                }

                let seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_millis()
                    .to_string();

                let pubkey = Pubkey::new_from_array(
                    hashv(&[
                        owner.to_bytes().as_ref(),
                        seed.as_bytes(),
                        TOKEN_PROGRAM_ID.to_bytes().as_ref(),
                    ]).to_bytes(),
                );

                create_instructions.push(
                    create_account_with_seed(
                        &owner,
                        &pubkey,
                        &owner,
                        &seed,
                        lamports,
                        TokenAccount::LEN as u64,
                        &TOKEN_PROGRAM_ID,
                    ),
                );

                create_instructions.push(
                    initialize_account3(
                        &TOKEN_PROGRAM_ID,
                        &pubkey,
                        &native_mint::ID,
                        &owner,
                    )?,
                );

                cleanup_instructions.push(
                    close_account(
                        &TOKEN_PROGRAM_ID,
                        &pubkey,
                        &owner,
                        &owner,
                        &[],
                    )?,
                );

                token_account_addresses.insert(native_mint::ID, pubkey);
            },
            NativeMintWrappingStrategy::Ata => {
                if let Some(TokenAccountStrategy::WithBalance(_, balance)) = specs.get(native_mint_index.unwrap()) {
                    let ata = token_account_addresses.get(&native_mint::ID).unwrap();
                    create_instructions.push(
                        transfer(
                            &owner,
                            ata,
                            *balance,
                        ),
                    );
                    create_instructions.push(
                        sync_native(
                            &TOKEN_PROGRAM_ID,
                            ata,
                        )?,
                    );
                }
            },
            NativeMintWrappingStrategy::None => {},
        }
    }

    Ok(TokenAccountInstructions {
        create_instructions,
        cleanup_instructions,
        token_account_addresses,
        additional_signers,
    })
}
