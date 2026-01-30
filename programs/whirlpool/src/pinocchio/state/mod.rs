pub use pinocchio::pubkey::Pubkey;

pub type COption<T> = ([u8; 4], T);
pub type BytesU16 = [u8; 2];
pub type BytesU32 = [u8; 4];
pub type BytesU64 = [u8; 8];
pub type BytesU128 = [u8; 16];
pub type BytesI128 = [u8; 16];
pub type BytesI32 = [u8; 4];
pub type ByteBool = u8;

pub mod token;
pub mod whirlpool;

pub trait WhirlpoolProgramAccount {
    const DISCRIMINATOR: [u8; 8];
}

pub trait TokenProgramAccount {
    const BASE_STATE_LEN: usize; // 82 for Mint, 165 for Account
    const IS_INITIALIZED_OFFSET: usize; // 45 for Mint, 108 for Account
    const ACCOUNT_TYPE: u8; // 1 for Mint, 2 for Account
}
