use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::hash::Hash;
use std::time::Duration;

const MAINNET_HASH: &str = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_HASH: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const ECLIPSE_HASH: &str = "EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s";
const ECLIPSE_TESTNET_HASH: &str = "CX4huckiV9QNAkKNVKi5Tj8nxzBive5kQimd94viMKsU";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainId {
    Mainnet,
    Devnet,
    Eclipse,
    EclipseTestnet,
    Unknown(Hash),
}

impl ChainId {
    pub fn is_mainnet(&self) -> bool {
        matches!(self, Self::Mainnet)
    }
}

impl From<Hash> for ChainId {
    fn from(hash: Hash) -> Self {
        // Convert hash to string once for comparison
        let hash_str = hash.to_string();
        // Compare with string constants directly
        if hash_str == MAINNET_HASH {
            return Self::Mainnet;
        } else if hash_str == DEVNET_HASH {
            return Self::Devnet;
        } else if hash_str == ECLIPSE_HASH {
            return Self::Eclipse;
        } else if hash_str == ECLIPSE_TESTNET_HASH {
            return Self::EclipseTestnet;
        }
        Self::Unknown(hash)
    }
}

/// RPC configuration for connecting to Solana nodes
#[derive(Debug, Clone, PartialEq)]
pub struct RpcConfig {
    pub url: String,
    pub supports_priority_fee_percentile: bool,
    pub chain_id: Option<ChainId>,
}

impl RpcConfig {
    pub async fn new(url: impl Into<String>) -> Result<Self, String> {
        let url = url.into();
        let client = RpcClient::new(url.clone());
        let genesis_hash = client
            .get_genesis_hash()
            .await
            .map_err(|e| format!("Chain Detection Error: Failed to get genesis hash: {e}"))?;

        Ok(Self {
            url,
            supports_priority_fee_percentile: false,
            chain_id: Some(ChainId::from(genesis_hash)),
        })
    }

    pub fn client(&self) -> RpcClient {
        RpcClient::new_with_timeout(self.url.clone(), Duration::from_millis(90_000))
    }

    /// Check if the RPC is connected to Solana mainnet
    pub fn is_mainnet(&self) -> bool {
        self.chain_id
            .as_ref()
            .map_or(false, |chain_id| chain_id.is_mainnet())
    }
}
