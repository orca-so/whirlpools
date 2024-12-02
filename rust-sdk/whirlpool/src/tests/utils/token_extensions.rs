use std::error::Error;

use solana_sdk::{
    pubkey::Pubkey,
    signer::Signer,
};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use spl_token_2022::{
    extension::ExtensionType,
    instruction::{initialize_mint2, mint_to},
    ID as TOKEN_2022_PROGRAM_ID,
};

use super::rpc::RpcContext;

#[derive(Default)]
pub struct SetupAtaConfig {
    pub amount: Option<u64>,
}

#[derive(Default, Clone)]
pub struct SetupMintConfig {
    pub decimals: Option<u8>,
    pub extensions: Option<Vec<ExtensionType>>,
}

// Sets up a Token-2022 mint with optional extensions
pub async fn setup_mint_te(
    ctx: &RpcContext,
    config: Option<SetupMintConfig>,
) -> Result<Pubkey, Box<dyn Error>> {
    let config = config.unwrap_or_default();
    
    let mint = if let Some(extensions) = &config.extensions {
        ctx.create_token_2022_mint(extensions).await?
    } else {
        ctx.create_token_2022_mint(&[]).await?
    };
    
    Ok(mint)
}

// Creates a Token-2022 mint with transfer fee configuration
pub async fn setup_mint_te_fee(
    ctx: &RpcContext,
    config: Option<SetupMintConfig>,
) -> Result<Pubkey, Box<dyn Error>> {
    let mut config = config.unwrap_or_default();
    
    let extensions = config.extensions.get_or_insert_with(Vec::new);
    extensions.push(ExtensionType::TransferFeeConfig);
    
    let mint = setup_mint_te(ctx, Some(config)).await?;
    
    Ok(mint)
}

// Sets up an associated token account for Token-2022 tokens
pub async fn setup_ata_te(
    ctx: &RpcContext,
    mint: Pubkey,
    config: Option<SetupAtaConfig>,
) -> Result<Pubkey, Box<dyn Error>> {
    let config = config.unwrap_or_default();
    let ata = get_associated_token_address_with_program_id(
        &ctx.signer.pubkey(),
        &mint,
        &TOKEN_2022_PROGRAM_ID,
    );

    let mut instructions = vec![
        create_associated_token_account_idempotent(
            &ctx.signer.pubkey(),
            &ctx.signer.pubkey(),
            &mint,
            &TOKEN_2022_PROGRAM_ID,
        ),
    ];

    if let Some(amount) = config.amount {
        instructions.push(
            mint_to(
                &TOKEN_2022_PROGRAM_ID,
                &mint,
                &ata,
                &ctx.signer.pubkey(),
                &[],
                amount,
            )?,
        );
    }

    ctx.send_transaction(instructions).await?;
    Ok(ata)
}
