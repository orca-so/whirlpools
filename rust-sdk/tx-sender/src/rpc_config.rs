use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::hash::Hash;
use std::str::FromStr;
use std::time::Duration;

/// Chain identifier based on genesis hash
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainId(Hash);

impl ChainId {
    /// Create a new ChainId from a genesis hash
    pub fn from_genesis_hash(hash: Hash) -> Self {
        Self(hash)
    }

    /// Get the underlying hash
    pub fn hash(&self) -> Hash {
        self.0
    }

    /// Check if this is mainnet
    pub fn is_mainnet(&self) -> bool {
        // Mainnet genesis hash
        let mainnet_hash = Hash::from_str("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d").unwrap_or_default();
        self.0 == mainnet_hash
    }

    /// Check if this is devnet
    pub fn is_devnet(&self) -> bool {
        // Devnet genesis hash
        let devnet_hash = Hash::from_str("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG").unwrap_or_default();
        self.0 == devnet_hash
    }

    /// Check if this is Eclipse mainnet
    pub fn is_eclipse(&self) -> bool {
        // Eclipse mainnet genesis hash
        let eclipse_hash = Hash::from_str("EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s").unwrap_or_default();
        self.0 == eclipse_hash
    }

    /// Check if this is Eclipse testnet
    pub fn is_eclipse_testnet(&self) -> bool {
        // Eclipse testnet genesis hash
        let eclipse_testnet_hash = Hash::from_str("CX4huckiV9QNAkKNVKi5Tj8nxzBive5kQimd94viMKsU").unwrap_or_default();
        self.0 == eclipse_testnet_hash
    }

    /// Get the chain name as a string
    pub fn name(&self) -> &'static str {
        if self.is_mainnet() {
            "solana"
        } else if self.is_devnet() {
            "solana-devnet"
        } else if self.is_eclipse() {
            "eclipse"
        } else if self.is_eclipse_testnet() {
            "eclipse-testnet"
        } else {
            "unknown"
        }
    }
}

/// RPC configuration for connecting to Solana nodes
#[derive(Debug, Clone, PartialEq)]
pub struct RpcConfig {
    /// Full HTTP/HTTPS URL for Solana RPC endpoint
    pub url: String,
    
    /// Whether RPC supports getRecentPrioritizationFees endpoint
    pub supports_priority_fee_percentile: bool,
    
    /// Auto-detected chain ID from genesis hash
    pub chain_id: Option<ChainId>,
    
    /// Transaction timeout in milliseconds
    pub timeout: u64, // Store timeout as milliseconds
}

impl RpcConfig {
    /// Create a new RPC configuration with the given URL
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            supports_priority_fee_percentile: false,
            chain_id: None,
            timeout: 30_000,
        }
    }

    /// Async constructor with chain ID detection
    pub async fn with_chain_detection(url: impl Into<String>) -> Result<Self, String> {
        let url = url.into();
        let client = RpcClient::new(url.clone());
        let genesis_hash = client.get_genesis_hash().await.map_err(|e| {
            format!("Chain Detection Error: Failed to get genesis hash: {e}")
        })?;
        
        Ok(Self {
            url,
            supports_priority_fee_percentile: false,
            chain_id: Some(ChainId::from_genesis_hash(genesis_hash)),
            timeout: 30_000,
        })
    }

    /// Get the RPC client for this configuration
    pub fn client(&self) -> RpcClient {
        RpcClient::new_with_timeout(self.url.clone(), Duration::from_millis(self.timeout))
    }
    
    /// Get the chain name if available
    pub fn chain_name(&self) -> &'static str {
        match &self.chain_id {
            Some(chain_id) => chain_id.name(),
            None => "unknown",
        }
    }
}