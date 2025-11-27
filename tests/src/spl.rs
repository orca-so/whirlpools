use anchor_client::solana_sdk::{account::Account, program_pack::Pack};
use litesvm::LiteSVM;
use solana_pubkey::Pubkey;
use spl_associated_token_account::get_associated_token_address;
use spl_token::{
    state::{Account as TokenAccount, AccountState, Mint as SplMint},
    ID as TOKEN_PROGRAM_ID,
};
use spl_token_2022::state::{
    Account as TokenAccount2022, AccountState as TokenAccountState2022, Mint as SplMint2022,
};
use spl_token_2022::ID as TOKEN_2022_PROGRAM_ID;

pub fn get_token_program_id_for_mint(svm: &mut LiteSVM, mint: &Pubkey) -> Pubkey {
    let account_data = svm.get_account(mint).unwrap();

    account_data.owner
}

pub fn setup_mint_account(
    svm: &mut LiteSVM,
    mint: &Pubkey,
    mint_authority: &Pubkey,
    supply: u64,
    decimals: u8,
) {
    let mint_account = SplMint {
        mint_authority: Some(*mint_authority).into(),
        supply: supply * 10u64.pow(decimals as u32),
        decimals,
        is_initialized: true,
        freeze_authority: Some(*mint_authority).into(),
    };

    let mut mint_acc_bytes = [0u8; SplMint::LEN];
    let rent = svm.minimum_balance_for_rent_exemption(SplMint::LEN);
    SplMint::pack(mint_account, &mut mint_acc_bytes).unwrap();

    let lamports = rent;

    svm.set_account(
        *mint,
        Account {
            lamports,
            data: mint_acc_bytes.to_vec(),
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn setup_mint_account_2022(
    svm: &mut LiteSVM,
    mint: &Pubkey,
    mint_authority: &Pubkey,
    supply: u64,
    decimals: u8,
) {
    let mint_account = SplMint2022 {
        mint_authority: Some(*mint_authority).into(),
        supply: supply * 10u64.pow(decimals as u32),
        decimals,
        is_initialized: true,
        freeze_authority: Some(*mint_authority).into(),
    };

    let mut mint_acc_bytes = [0u8; SplMint2022::LEN];
    let rent = svm.minimum_balance_for_rent_exemption(SplMint2022::LEN);
    SplMint2022::pack(mint_account, &mut mint_acc_bytes).unwrap();

    let lamports = rent;

    svm.set_account(
        *mint,
        Account {
            lamports,
            data: mint_acc_bytes.to_vec(),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn fetch_mint_account(svm: &mut LiteSVM, mint_account: &Pubkey) -> SplMint {
    let info = svm.get_account(mint_account).unwrap();
    SplMint::unpack(&info.data[..SplMint::LEN]).unwrap()
}

pub fn fetch_mint_account_2022(svm: &mut LiteSVM, mint_account: &Pubkey) -> SplMint2022 {
    let info = svm.get_account(mint_account).unwrap();
    SplMint2022::unpack(&info.data[..SplMint2022::LEN]).unwrap()
}

/// Sets the state of an SPL Token Account in a given address.
pub fn setup_token_account(
    svm: &mut LiteSVM,
    pubkey: Option<&Pubkey>,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
    is_native: Option<u64>,
) {
    let mint_account = fetch_mint_account(svm, mint);

    let token_account = TokenAccount {
        mint: *mint,
        owner: *owner,
        amount: amount * 10u64.pow(mint_account.decimals as u32),
        delegate: None.into(),
        state: AccountState::Initialized,
        is_native: is_native.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    };

    let mut token_acc_bytes = [0u8; TokenAccount::LEN];
    let rent = svm.minimum_balance_for_rent_exemption(TokenAccount::LEN);
    TokenAccount::pack(token_account, &mut token_acc_bytes).unwrap();

    let mut lamports = rent;
    if is_native.is_some() {
        // adjust lamport balance when dealing with WSol
        lamports += amount * 10u64.pow(mint_account.decimals as u32);
    }

    let token_account_pubkey: Pubkey;

    if pubkey.is_some() {
        token_account_pubkey = *pubkey.unwrap();
    } else {
        token_account_pubkey = get_associated_token_address(owner, mint);
    }

    svm.set_account(
        token_account_pubkey,
        Account {
            lamports,
            data: token_acc_bytes.to_vec(),
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn setup_token_account_2022(
    svm: &mut LiteSVM,
    pubkey: Option<&Pubkey>,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
    is_native: Option<u64>,
) {
    let mint_account = fetch_mint_account_2022(svm, mint);

    let token_account = TokenAccount2022 {
        mint: *mint,
        owner: *owner,
        amount: amount * 10u64.pow(mint_account.decimals as u32),
        delegate: None.into(),
        state: TokenAccountState2022::Initialized,
        is_native: is_native.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    };

    let mut token_acc_bytes = [0u8; TokenAccount2022::LEN];
    let rent = svm.minimum_balance_for_rent_exemption(TokenAccount2022::LEN);
    TokenAccount2022::pack(token_account, &mut token_acc_bytes).unwrap();

    let mut lamports = rent;
    if is_native.is_some() {
        // adjust lamport balance when dealing with WSol
        lamports += amount * 10u64.pow(mint_account.decimals as u32);
    }

    let token_account_pubkey: Pubkey;

    if pubkey.is_some() {
        token_account_pubkey = *pubkey.unwrap();
    } else {
        token_account_pubkey = get_associated_token_address(owner, mint);
    }

    svm.set_account(
        token_account_pubkey,
        Account {
            lamports,
            data: token_acc_bytes.to_vec(),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn fetch_token_account(svm: &mut LiteSVM, token_account: &Pubkey) -> TokenAccount {
    let info = svm.get_account(token_account).unwrap();
    TokenAccount::unpack(&info.data[..TokenAccount::LEN]).unwrap()
}

pub fn fetch_token_account_2022(svm: &mut LiteSVM, token_account: &Pubkey) -> TokenAccount2022 {
    let info = svm.get_account(token_account).unwrap();
    TokenAccount2022::unpack(&info.data[..TokenAccount2022::LEN]).unwrap()
}

pub fn get_token_account_balance(svm: &mut LiteSVM, token_account: &Pubkey) -> u64 {
    let token_account = fetch_token_account(svm, &token_account);
    let mint_account = fetch_mint_account(svm, &token_account.mint);
    token_account.amount / 10u64.pow(mint_account.decimals as u32)
}

pub fn get_token_account_balance_2022(svm: &mut LiteSVM, token_account: &Pubkey) -> u64 {
    let token_account = fetch_token_account_2022(svm, &token_account);
    let mint_account = fetch_mint_account_2022(svm, &token_account.mint);
    token_account.amount / 10u64.pow(mint_account.decimals as u32)
}

pub fn get_token_balance(svm: &mut LiteSVM, mint: &Pubkey, owner: &Pubkey) -> u64 {
    let token_account = get_associated_token_address(owner, mint);
    get_token_account_balance(svm, &token_account)
}

pub fn get_token_balance_2022(svm: &mut LiteSVM, mint: &Pubkey, owner: &Pubkey) -> u64 {
    let token_account = get_associated_token_address(owner, mint);
    get_token_account_balance_2022(svm, &token_account)
}
