use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::hash::Hash;
use std::str::FromStr;
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
    /// Get the underlying hash
    pub fn hash(&self) -> Hash {
        match self {
            Self::Mainnet => Hash::from_str(MAINNET_HASH).unwrap_or_default(),
            Self::Devnet => Hash::from_str(DEVNET_HASH).unwrap_or_default(),
            Self::Eclipse => Hash::from_str(ECLIPSE_HASH).unwrap_or_default(),
            Self::EclipseTestnet => Hash::from_str(ECLIPSE_TESTNET_HASH).unwrap_or_default(),
            Self::Unknown(hash) => *hash,
        }
    }
    pub fn is_mainnet(&self) -> bool {
        matches!(self, Self::Mainnet)
    }
    pub fn is_devnet(&self) -> bool {
        matches!(self, Self::Devnet)
    }
    pub fn is_eclipse(&self) -> bool {
        matches!(self, Self::Eclipse)
    }
    pub fn is_eclipse_testnet(&self) -> bool {
        matches!(self, Self::EclipseTestnet)
    }
    pub fn name(&self) -> &'static str {
        match self {
            Self::Mainnet => "solana",
            Self::Devnet => "solana-devnet",
            Self::Eclipse => "eclipse",
            Self::EclipseTestnet => "eclipse-testnet",
            Self::Unknown(_) => "unknown",
        }
    }
}

impl From<Hash> for ChainId {
    fn from(hash: Hash) -> Self {
        // Mainnet genesis hash
        let mainnet_hash = Hash::from_str(MAINNET_HASH).unwrap_or_default();
        let devnet_hash = Hash::from_str(DEVNET_HASH).unwrap_or_default();
        let eclipse_hash = Hash::from_str(ECLIPSE_HASH).unwrap_or_default();
        let eclipse_testnet_hash = Hash::from_str(ECLIPSE_TESTNET_HASH).unwrap_or_default();
        if hash == mainnet_hash {
            return Self::Mainnet;
        } else if hash == devnet_hash {
            return Self::Devnet;
        } else if hash == eclipse_hash {
            return Self::Eclipse;
        } else if hash == eclipse_testnet_hash {
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
    pub timeout: u64, 
}

impl RpcConfig {
    pub async fn new(url: impl Into<String>) -> Result<Self, String> {
        let url = url.into();
        let client = RpcClient::new(url.clone());
        let genesis_hash = client.get_genesis_hash().await.map_err(|e| {
            format!("Chain Detection Error: Failed to get genesis hash: {e}")
        })?;
        
        Ok(Self {
            url,
            supports_priority_fee_percentile: false,
            chain_id: Some(ChainId::from(genesis_hash)),
            timeout: 30_000,
        })
    }

    pub fn client(&self) -> RpcClient {
        RpcClient::new_with_timeout(self.url.clone(), Duration::from_millis(self.timeout))
    }
    
    pub fn chain_name(&self) -> &'static str {
        match &self.chain_id {
            Some(chain_id) => chain_id.name(),
            None => "unknown",
        }
    }

    /// Check if the RPC is connected to Solana mainnet
    pub fn is_mainnet(&self) -> bool {
        self.chain_id.as_ref().map_or(false, |chain_id| chain_id.is_mainnet())
    }
}