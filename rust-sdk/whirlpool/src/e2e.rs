use std::error::Error;

use futures::executor::block_on;
use lazy_static::lazy_static;
use orca_whirlpools_client::{get_position_address, Position, Whirlpool};
use serial_test::serial;
use solana_sdk::{program_pack::Pack, pubkey::Pubkey, signer::Signer};
use spl_token_2022::state::Account;

use crate::{
    close_position_instructions, create_concentrated_liquidity_pool_instructions,
    create_splash_pool_instructions, decrease_liquidity_instructions,
    harvest_position_instructions, increase_liquidity_instructions,
    open_full_range_position_instructions, swap_instructions,
    tests::{
        send_transaction_with_signers, setup_ata_with_amount, setup_mint_with_decimals, RPC, SIGNER,
    },
    DecreaseLiquidityParam, IncreaseLiquidityParam, SwapQuote, SwapType, SPLASH_POOL_TICK_SPACING,
};

lazy_static! {
    static ref MINT_A: Pubkey = block_on(setup_mint_with_decimals(9)).unwrap();
    static ref MINT_B: Pubkey = block_on(setup_mint_with_decimals(6)).unwrap();
    static ref ATA_A: Pubkey = block_on(setup_ata_with_amount(*MINT_A, 500_000_000_000)).unwrap();
    static ref ATA_B: Pubkey = block_on(setup_ata_with_amount(*MINT_B, 500_000_000_000)).unwrap();
}

async fn init_splash_pool() -> Result<Pubkey, Box<dyn Error>> {
    let splash_pool =
        create_splash_pool_instructions(&RPC, *MINT_A, *MINT_B, None, Some(SIGNER.pubkey()))
            .await?;
    send_transaction_with_signers(
        splash_pool.instructions,
        splash_pool.additional_signers.iter().collect(),
    )
    .await?;

    let whirlpool_info = RPC.get_account(&splash_pool.pool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    assert_eq!(whirlpool.token_mint_a, *MINT_A);
    assert_eq!(whirlpool.token_mint_b, *MINT_B);
    assert_eq!(whirlpool.tick_spacing, SPLASH_POOL_TICK_SPACING);

    Ok(splash_pool.pool_address)
}

async fn init_concentrated_liquidity_pool() -> Result<Pubkey, Box<dyn Error>> {
    let cl_pool = create_concentrated_liquidity_pool_instructions(
        &RPC,
        *MINT_A,
        *MINT_B,
        128,
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(
        cl_pool.instructions,
        cl_pool.additional_signers.iter().collect(),
    )
    .await?;

    let whirlpool_info = RPC.get_account(&cl_pool.pool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    assert_eq!(whirlpool.token_mint_a, *MINT_A);
    assert_eq!(whirlpool.token_mint_b, *MINT_B);
    assert_eq!(whirlpool.tick_spacing, 128);

    Ok(cl_pool.pool_address)
}

async fn open_position(pool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    let infos_before = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&infos_before[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&infos_before[1].as_ref().unwrap().data)?;

    let position = open_full_range_position_instructions(
        &RPC,
        pool,
        IncreaseLiquidityParam::Liquidity(1000000000),
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;

    send_transaction_with_signers(
        position.instructions,
        position.additional_signers.iter().collect(),
    )
    .await?;

    let position_address = get_position_address(&position.position_mint)?.0;
    let infos_after = RPC
        .get_multiple_accounts(&[*ATA_A, *ATA_B, position_address])
        .await?;
    let token_a_after = Account::unpack(&infos_after[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&infos_after[1].as_ref().unwrap().data)?;
    let position_after = Position::from_bytes(&infos_after[2].as_ref().unwrap().data)?;

    assert_eq!(position.quote.liquidity_delta, position_after.liquidity);
    assert_eq!(
        token_a_before.amount - token_a_after.amount,
        position.quote.token_est_a,
    );
    assert_eq!(
        token_b_before.amount - token_b_after.amount,
        position.quote.token_est_b,
    );

    Ok(position.position_mint)
}

async fn increase_liquidity(position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
    let position_address = get_position_address(&position_mint)?.0;
    let infos_before = RPC
        .get_multiple_accounts(&[*ATA_A, *ATA_B, position_address])
        .await?;
    let token_a_before = Account::unpack(&infos_before[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&infos_before[1].as_ref().unwrap().data)?;
    let position_before = Position::from_bytes(&infos_before[2].as_ref().unwrap().data)?;

    let increase_liquidity = increase_liquidity_instructions(
        &RPC,
        position_mint,
        IncreaseLiquidityParam::Liquidity(1000000000),
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(
        increase_liquidity.instructions,
        increase_liquidity.additional_signers.iter().collect(),
    )
    .await?;

    let infos_after = RPC
        .get_multiple_accounts(&[*ATA_A, *ATA_B, position_address])
        .await?;
    let token_a_after = Account::unpack(&infos_after[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&infos_after[1].as_ref().unwrap().data)?;
    let position_after = Position::from_bytes(&infos_after[2].as_ref().unwrap().data)?;

    assert_eq!(
        position_after.liquidity - position_before.liquidity,
        increase_liquidity.quote.liquidity_delta
    );
    assert_eq!(
        token_a_before.amount - token_a_after.amount,
        increase_liquidity.quote.token_est_a,
    );
    assert_eq!(
        token_b_before.amount - token_b_after.amount,
        increase_liquidity.quote.token_est_b,
    );
    Ok(())
}

async fn decrease_liquidity(position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
    let position_address = get_position_address(&position_mint)?.0;
    let infos_before = RPC
        .get_multiple_accounts(&[*ATA_A, *ATA_B, position_address])
        .await?;
    let token_a_before = Account::unpack(&infos_before[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&infos_before[1].as_ref().unwrap().data)?;
    let position_before = Position::from_bytes(&infos_before[2].as_ref().unwrap().data)?;

    let decrease_liquidity = decrease_liquidity_instructions(
        &RPC,
        position_mint,
        DecreaseLiquidityParam::Liquidity(10000),
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(
        decrease_liquidity.instructions,
        decrease_liquidity.additional_signers.iter().collect(),
    )
    .await?;

    let infos_after = RPC
        .get_multiple_accounts(&[*ATA_A, *ATA_B, position_address])
        .await?;
    let token_a_after = Account::unpack(&infos_after[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&infos_after[1].as_ref().unwrap().data)?;
    let position_after = Position::from_bytes(&infos_after[2].as_ref().unwrap().data)?;

    assert_eq!(
        position_before.liquidity - position_after.liquidity,
        decrease_liquidity.quote.liquidity_delta
    );
    assert_eq!(
        token_a_after.amount - token_a_before.amount,
        decrease_liquidity.quote.token_est_a,
    );
    assert_eq!(
        token_b_after.amount - token_b_before.amount,
        decrease_liquidity.quote.token_est_b,
    );
    Ok(())
}

async fn harvest_position(position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
    let before_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

    let harvest_position =
        harvest_position_instructions(&RPC, position_mint, Some(SIGNER.pubkey())).await?;
    send_transaction_with_signers(
        harvest_position.instructions,
        harvest_position.additional_signers.iter().collect(),
    )
    .await?;

    let after_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_after = Account::unpack(&after_infos[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&after_infos[1].as_ref().unwrap().data)?;

    assert_eq!(
        token_a_after.amount - token_a_before.amount,
        harvest_position.fees_quote.fee_owed_a,
    );
    assert_eq!(
        token_b_after.amount - token_b_before.amount,
        harvest_position.fees_quote.fee_owed_b,
    );
    Ok(())
}

async fn close_position(position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
    let before_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

    let close_position =
        close_position_instructions(&RPC, position_mint, None, Some(SIGNER.pubkey())).await?;
    send_transaction_with_signers(
        close_position.instructions,
        close_position.additional_signers.iter().collect(),
    )
    .await?;

    let position_address = get_position_address(&position_mint)?.0;
    let after_infos = RPC
        .get_multiple_accounts(&[*ATA_A, *ATA_B, position_address])
        .await?;
    let token_a_after = Account::unpack(&after_infos[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&after_infos[1].as_ref().unwrap().data)?;

    assert!(after_infos[2].is_none());
    assert_eq!(
        token_a_after.amount - token_a_before.amount,
        close_position.quote.token_est_a + close_position.fees_quote.fee_owed_a,
    );
    assert_eq!(
        token_b_after.amount - token_b_before.amount,
        close_position.quote.token_est_b + close_position.fees_quote.fee_owed_b,
    );
    Ok(())
}

async fn swap_a_exact_in(pool: Pubkey) -> Result<(), Box<dyn Error>> {
    let before_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

    let swap = swap_instructions(
        &RPC,
        pool,
        100000,
        *MINT_A,
        SwapType::ExactIn,
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(swap.instructions, swap.additional_signers.iter().collect())
        .await?;

    let after_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_after = Account::unpack(&after_infos[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&after_infos[1].as_ref().unwrap().data)?;

    if let SwapQuote::ExactIn(quote) = swap.quote {
        assert_eq!(token_a_before.amount - token_a_after.amount, quote.token_in,);
        assert_eq!(
            token_b_after.amount - token_b_before.amount,
            quote.token_est_out,
        );
    } else {
        return Err("Swap quote is not ExactIn".into());
    }

    Ok(())
}

async fn swap_a_exact_out(pool: Pubkey) -> Result<(), Box<dyn Error>> {
    let before_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

    let swap = swap_instructions(
        &RPC,
        pool,
        100000,
        *MINT_A,
        SwapType::ExactOut,
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(swap.instructions, swap.additional_signers.iter().collect())
        .await?;

    let after_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_after = Account::unpack(&after_infos[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&after_infos[1].as_ref().unwrap().data)?;

    if let SwapQuote::ExactOut(quote) = swap.quote {
        assert_eq!(
            token_a_after.amount - token_a_before.amount,
            quote.token_out,
        );
        assert_eq!(
            token_b_before.amount - token_b_after.amount,
            quote.token_est_in,
        );
    } else {
        return Err("Swap quote is not ExactOut".into());
    }

    Ok(())
}

async fn swap_b_exact_in(pool: Pubkey) -> Result<(), Box<dyn Error>> {
    let before_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

    let swap = swap_instructions(
        &RPC,
        pool,
        100,
        *MINT_B,
        SwapType::ExactIn,
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(swap.instructions, swap.additional_signers.iter().collect())
        .await?;

    let after_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_after = Account::unpack(&after_infos[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&after_infos[1].as_ref().unwrap().data)?;

    if let SwapQuote::ExactIn(quote) = swap.quote {
        assert_eq!(
            token_a_after.amount - token_a_before.amount,
            quote.token_est_out,
        );
        assert_eq!(token_b_before.amount - token_b_after.amount, quote.token_in,);
    } else {
        return Err("Swap quote is not ExactIn".into());
    }

    Ok(())
}

async fn swap_b_exact_out(pool: Pubkey) -> Result<(), Box<dyn Error>> {
    let before_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
    let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

    let swap = swap_instructions(
        &RPC,
        pool,
        100,
        *MINT_B,
        SwapType::ExactOut,
        None,
        Some(SIGNER.pubkey()),
    )
    .await?;
    send_transaction_with_signers(swap.instructions, swap.additional_signers.iter().collect())
        .await?;

    let after_infos = RPC.get_multiple_accounts(&[*ATA_A, *ATA_B]).await?;
    let token_a_after = Account::unpack(&after_infos[0].as_ref().unwrap().data)?;
    let token_b_after = Account::unpack(&after_infos[1].as_ref().unwrap().data)?;

    if let SwapQuote::ExactOut(quote) = swap.quote {
        assert_eq!(
            token_a_before.amount - token_a_after.amount,
            quote.token_est_in,
        );
        assert_eq!(
            token_b_after.amount - token_b_before.amount,
            quote.token_out,
        );
    } else {
        return Err("Swap quote is not ExactOut".into());
    }
    Ok(())
}

#[test]
#[serial]
fn test_splash_pool() {
    block_on(async {
        let pool = init_splash_pool().await.unwrap();
        let position_mint = open_position(pool).await.unwrap();
        swap_a_exact_in(pool).await.unwrap();
        increase_liquidity(position_mint).await.unwrap();
        swap_a_exact_out(pool).await.unwrap();
        harvest_position(position_mint).await.unwrap();
        swap_b_exact_in(pool).await.unwrap();
        decrease_liquidity(position_mint).await.unwrap();
        swap_b_exact_out(pool).await.unwrap();
        close_position(position_mint).await.unwrap();
    });
}

#[test]
#[serial]
fn test_concentrated_liquidity_pool() {
    block_on(async {
        let pool = init_concentrated_liquidity_pool().await.unwrap();
        let position_mint = open_position(pool).await.unwrap();
        swap_a_exact_in(pool).await.unwrap();
        increase_liquidity(position_mint).await.unwrap();
        swap_a_exact_out(pool).await.unwrap();
        harvest_position(position_mint).await.unwrap();
        swap_b_exact_in(pool).await.unwrap();
        decrease_liquidity(position_mint).await.unwrap();
        swap_b_exact_out(pool).await.unwrap();
        close_position(position_mint).await.unwrap();
    });
}
