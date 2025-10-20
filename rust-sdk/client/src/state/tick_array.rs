use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::account_info::AccountInfo;

use crate::{
    DynamicTick, DynamicTickArray, DynamicTickData, FixedTickArray, Tick,
    DYNAMIC_TICK_ARRAY_DISCRIMINATOR, FIXED_TICK_ARRAY_DISCRIMINATOR,
};

#[derive(Clone, Debug, Eq, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "type"))]
pub enum TickArray {
    FixedTickArray(FixedTickArray),
    DynamicTickArray(DynamicTickArray),
}

impl TickArray {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, std::io::Error> {
        if bytes.len() < 8 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid account data length",
            ));
        }
        let discriminator = &bytes[0..8];
        match discriminator {
            FIXED_TICK_ARRAY_DISCRIMINATOR => {
                let tick_array = FixedTickArray::from_bytes(bytes)?;
                Ok(Self::FixedTickArray(tick_array))
            }
            DYNAMIC_TICK_ARRAY_DISCRIMINATOR => {
                let dynamic_tick_array = DynamicTickArray::from_bytes(bytes)?;
                Ok(Self::DynamicTickArray(dynamic_tick_array))
            }
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid account discriminator",
            )),
        }
    }
}

impl<'a> TryFrom<&AccountInfo<'a>> for TickArray {
    type Error = std::io::Error;

    fn try_from(account_info: &AccountInfo<'a>) -> Result<Self, Self::Error> {
        let data: &[u8] = &(*account_info.data).borrow();
        Self::from_bytes(data)
    }
}

impl From<TickArray> for FixedTickArray {
    fn from(val: TickArray) -> Self {
        match val {
            TickArray::FixedTickArray(tick_array) => tick_array,
            TickArray::DynamicTickArray(dynamic_tick_array) => dynamic_tick_array.into(),
        }
    }
}

impl From<TickArray> for DynamicTickArray {
    fn from(val: TickArray) -> Self {
        match val {
            TickArray::DynamicTickArray(dynamic_tick_array) => dynamic_tick_array,
            TickArray::FixedTickArray(tick_array) => tick_array.into(),
        }
    }
}

impl From<FixedTickArray> for DynamicTickArray {
    fn from(val: FixedTickArray) -> Self {
        DynamicTickArray {
            discriminator: DYNAMIC_TICK_ARRAY_DISCRIMINATOR.try_into().unwrap(),
            start_tick_index: val.start_tick_index,
            whirlpool: val.whirlpool,
            tick_bitmap: val
                .ticks
                .iter()
                .enumerate()
                .fold(0u128, |acc, (offset, tick)| {
                    if tick.initialized {
                        acc | (1u128 << offset)
                    } else {
                        acc
                    }
                }),
            ticks: val.ticks.map(|tick| tick.into()),
        }
    }
}

impl From<DynamicTickArray> for FixedTickArray {
    fn from(val: DynamicTickArray) -> Self {
        FixedTickArray {
            discriminator: FIXED_TICK_ARRAY_DISCRIMINATOR.try_into().unwrap(),
            start_tick_index: val.start_tick_index,
            whirlpool: val.whirlpool,
            ticks: val.ticks.map(|tick| tick.into()),
        }
    }
}

impl From<Tick> for DynamicTick {
    fn from(val: Tick) -> Self {
        match val.initialized {
            true => DynamicTick::Initialized(DynamicTickData {
                liquidity_net: val.liquidity_net,
                liquidity_gross: val.liquidity_gross,
                fee_growth_outside_a: val.fee_growth_outside_a,
                fee_growth_outside_b: val.fee_growth_outside_b,
                reward_growths_outside: val.reward_growths_outside,
            }),
            false => DynamicTick::Uninitialized,
        }
    }
}

impl From<DynamicTick> for Tick {
    fn from(val: DynamicTick) -> Self {
        match val {
            DynamicTick::Initialized(tick) => Tick {
                initialized: true,
                liquidity_net: tick.liquidity_net,
                liquidity_gross: tick.liquidity_gross,
                fee_growth_outside_a: tick.fee_growth_outside_a,
                fee_growth_outside_b: tick.fee_growth_outside_b,
                reward_growths_outside: tick.reward_growths_outside,
            },
            DynamicTick::Uninitialized => Tick {
                initialized: false,
                liquidity_net: 0,
                liquidity_gross: 0,
                fee_growth_outside_a: 0,
                fee_growth_outside_b: 0,
                reward_growths_outside: [0, 0, 0],
            },
        }
    }
}

#[cfg(feature = "fetch")]
pub fn fetch_tick_array(
    rpc: &solana_client::rpc_client::RpcClient,
    address: &solana_program::pubkey::Pubkey,
) -> Result<crate::DecodedAccount<TickArray>, std::io::Error> {
    let accounts = fetch_all_tick_array(rpc, &[*address])?;
    Ok(accounts[0].clone())
}

#[cfg(feature = "fetch")]
pub fn fetch_all_tick_array(
    rpc: &solana_client::rpc_client::RpcClient,
    addresses: &[solana_program::pubkey::Pubkey],
) -> Result<Vec<crate::shared::DecodedAccount<TickArray>>, std::io::Error> {
    let accounts = rpc
        .get_multiple_accounts(addresses)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let mut decoded_accounts: Vec<crate::shared::DecodedAccount<TickArray>> = Vec::new();
    for i in 0..addresses.len() {
        let address = addresses[i];
        let account = accounts[i].as_ref().ok_or(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Account not found: {}", address),
        ))?;
        let data = TickArray::from_bytes(&account.data)?;
        decoded_accounts.push(crate::shared::DecodedAccount {
            address,
            account: account.clone(),
            data,
        });
    }
    Ok(decoded_accounts)
}

#[cfg(feature = "fetch")]
pub fn fetch_maybe_tick_array(
    rpc: &solana_client::rpc_client::RpcClient,
    address: &solana_program::pubkey::Pubkey,
) -> Result<crate::shared::MaybeAccount<TickArray>, std::io::Error> {
    let accounts = fetch_all_maybe_tick_array(rpc, &[*address])?;
    Ok(accounts[0].clone())
}

#[cfg(feature = "fetch")]
pub fn fetch_all_maybe_tick_array(
    rpc: &solana_client::rpc_client::RpcClient,
    addresses: &[solana_program::pubkey::Pubkey],
) -> Result<Vec<crate::shared::MaybeAccount<TickArray>>, std::io::Error> {
    let accounts = rpc
        .get_multiple_accounts(addresses)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let mut decoded_accounts: Vec<crate::shared::MaybeAccount<TickArray>> = Vec::new();
    for i in 0..addresses.len() {
        let address = addresses[i];
        if let Some(account) = accounts[i].as_ref() {
            let data = TickArray::from_bytes(&account.data)?;
            decoded_accounts.push(crate::shared::MaybeAccount::Exists(
                crate::shared::DecodedAccount {
                    address,
                    account: account.clone(),
                    data,
                },
            ));
        } else {
            decoded_accounts.push(crate::shared::MaybeAccount::NotFound(address));
        }
    }
    Ok(decoded_accounts)
}

impl BorshSerialize for TickArray {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        match self {
            TickArray::FixedTickArray(tick_array) => tick_array.serialize(writer),
            TickArray::DynamicTickArray(dynamic_tick_array) => dynamic_tick_array.serialize(writer),
        }
    }
}

impl BorshDeserialize for TickArray {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        let mut buf = Vec::new();
        reader.read_to_end(&mut buf)?;
        Self::from_bytes(&buf)
    }
}

#[cfg(feature = "anchor")]
impl anchor_lang::AccountDeserialize for TickArray {
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
        Ok(Self::from_bytes(buf)?)
    }
}

#[cfg(feature = "anchor")]
impl anchor_lang::AccountSerialize for TickArray {
    fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> anchor_lang::Result<()> {
        match self {
            TickArray::FixedTickArray(tick_array) => tick_array.try_serialize(writer),
            TickArray::DynamicTickArray(dynamic_tick_array) => {
                dynamic_tick_array.try_serialize(writer)
            }
        }
    }
}

#[cfg(feature = "anchor")]
impl anchor_lang::Owner for TickArray {
    fn owner() -> solana_sdk::pubkey::Pubkey {
        crate::WHIRLPOOL_ID
    }
}

#[cfg(feature = "anchor-idl-build")]
impl anchor_lang::IdlBuild for TickArray {}

#[cfg(feature = "anchor-idl-build")]
impl anchor_lang::Discriminator for TickArray {
    const DISCRIMINATOR: [u8; 8] = [0; 8];
}

// For backwards compatibility with

impl TickArray {
    #[deprecated = "Use FixedTickArray::LEN instead or DynamicTickArray::MIN_LEN|MAX_LEN instead"]
    pub const LEN: usize = FixedTickArray::LEN;
}

#[cfg(test)]
mod from_fixed_tick_array_test {
    use super::*;

    #[test]
    fn test_from_fixed_tick_array() {
        let mut ticks: [Tick; 88] = std::array::from_fn(|_| Tick {
            initialized: false,
            liquidity_net: 0,
            liquidity_gross: 0,
            fee_growth_outside_a: 0,
            fee_growth_outside_b: 0,
            reward_growths_outside: [0, 0, 0],
        });

        ticks[1] = Tick {
            initialized: true,
            liquidity_net: 100,
            liquidity_gross: 100,
            fee_growth_outside_a: 300,
            fee_growth_outside_b: 400,
            reward_growths_outside: [500, 600, 700],
        };

        ticks[86] = Tick {
            initialized: true,
            liquidity_net: 200,
            liquidity_gross: 200,
            fee_growth_outside_a: 800,
            fee_growth_outside_b: 900,
            reward_growths_outside: [1000, 1100, 1200],
        };

        let fixed_tick_array = FixedTickArray {
            discriminator: FIXED_TICK_ARRAY_DISCRIMINATOR.try_into().unwrap(),
            start_tick_index: 88,
            whirlpool: solana_program::pubkey::Pubkey::new_unique(),
            ticks,
        };
        let dynamic_tick_array: DynamicTickArray = fixed_tick_array.clone().into();

        assert_eq!(dynamic_tick_array.start_tick_index, 88);
        assert_eq!(dynamic_tick_array.whirlpool, fixed_tick_array.whirlpool);
        assert_eq!(dynamic_tick_array.tick_bitmap, (1 << 1) | (1 << 86));
        for (i, tick) in dynamic_tick_array.ticks.iter().enumerate() {
            if i == 1 {
                assert_eq!(
                    tick,
                    &DynamicTick::Initialized(DynamicTickData {
                        liquidity_net: 100,
                        liquidity_gross: 100,
                        fee_growth_outside_a: 300,
                        fee_growth_outside_b: 400,
                        reward_growths_outside: [500, 600, 700],
                    })
                );
            } else if i == 86 {
                assert_eq!(
                    tick,
                    &DynamicTick::Initialized(DynamicTickData {
                        liquidity_net: 200,
                        liquidity_gross: 200,
                        fee_growth_outside_a: 800,
                        fee_growth_outside_b: 900,
                        reward_growths_outside: [1000, 1100, 1200],
                    })
                );
            } else {
                assert_eq!(tick, &DynamicTick::Uninitialized);
            }
        }
    }
}
