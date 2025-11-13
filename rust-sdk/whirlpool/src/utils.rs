use solana_account::Account;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_pubkey::Pubkey;

const DEFAULT_CHUNK_SIZE: usize = 100;

pub(crate) async fn batch_get_multiple_accounts(
    rpc_client: &RpcClient,
    pubkeys: &[Pubkey],
    chunk_size: Option<usize>,
) -> Result<Vec<Option<Account>>, Box<dyn std::error::Error>> {
    let mut results = vec![];

    for chunk in pubkeys.chunks(
        chunk_size
            .unwrap_or(DEFAULT_CHUNK_SIZE)
            .clamp(1, DEFAULT_CHUNK_SIZE),
    ) {
        let accounts = rpc_client.get_multiple_accounts(chunk).await?;
        results.extend(accounts);
    }

    Ok(results)
}
