use orca_whirlpools_client::{Position, Whirlpool};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    message::Message, program_pack::Pack, pubkey::Pubkey, signature::Signature, signer::Signer,
    transaction::Transaction,
};
use spl_token_2022::state::Mint;

pub async fn fetch_position(
    rpc: &RpcClient,
    position_address: &Pubkey,
) -> Result<Position, Box<dyn std::error::Error>> {
    let position_account = rpc.get_account(position_address).await?;
    let position = Position::from_bytes(&position_account.data)?;
    Ok(position)
}

pub async fn fetch_whirlpool(
    rpc: &RpcClient,
    whirlpool_address: &Pubkey,
) -> Result<Whirlpool, Box<dyn std::error::Error>> {
    let whirlpool_account = rpc.get_account(whirlpool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_account.data)?;
    Ok(whirlpool)
}

pub async fn fetch_mint(
    rpc: &RpcClient,
    mint_address: &Pubkey,
) -> Result<Mint, Box<dyn std::error::Error>> {
    let mint_account = rpc.get_account(mint_address).await?;
    let mint = Mint::unpack(&mint_account.data)?;
    Ok(mint)
}

pub async fn send_transaction(
    rpc: &RpcClient,
    wallet: &dyn Signer,
    instructions: Vec<solana_sdk::instruction::Instruction>,
    additional_signers: Vec<&dyn Signer>,
) -> Result<Signature, Box<dyn std::error::Error>> {
    let recent_blockhash = rpc.get_latest_blockhash().await?;
    let message = Message::new(&instructions, Some(&wallet.pubkey()));
    let mut all_signers = vec![wallet];
    all_signers.extend(additional_signers);

    let transaction = Transaction::new(&all_signers, message, recent_blockhash);
    let signature = rpc.send_and_confirm_transaction(&transaction).await?;
    Ok(signature)
}
