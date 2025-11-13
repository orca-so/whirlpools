use std::error::Error;

use orca_whirlpools_client::{get_position_address, Position, Whirlpool};
use serial_test::serial;
use solana_keypair::Signer;
use solana_program_pack::Pack;
use solana_program_test::tokio::{self};
use solana_pubkey::Pubkey;
use spl_token_2022_interface::state::Account;

use crate::{
    close_position_instructions, create_concentrated_liquidity_pool_instructions,
    create_splash_pool_instructions, decrease_liquidity_instructions,
    harvest_position_instructions, increase_liquidity_instructions,
    open_full_range_position_instructions_with_params, swap_instructions,
    tests::{setup_ata_with_amount, setup_mint_with_decimals, RpcContext},
    DecreaseLiquidityParam, IncreaseLiquidityParam, OpenPositionParams, SwapQuote, SwapType,
    SPLASH_POOL_TICK_SPACING,
};

struct TestContext {
    ctx: RpcContext,
    mint_a: Pubkey,
    mint_b: Pubkey,
    ata_a: Pubkey,
    ata_b: Pubkey,
}

impl TestContext {
    pub async fn new() -> Result<Self, Box<dyn Error>> {
        let ctx = RpcContext::new().await;
        let mint_a = setup_mint_with_decimals(&ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(&ctx, 9).await?;
        let ata_a = setup_ata_with_amount(&ctx, mint_a, 500_000_000_000).await?;
        let ata_b = setup_ata_with_amount(&ctx, mint_b, 500_000_000_000).await?;
        Ok(Self {
            ctx,
            mint_a,
            mint_b,
            ata_a,
            ata_b,
        })
    }

    pub async fn init_splash_pool(&self) -> Result<Pubkey, Box<dyn Error>> {
        let splash_pool = create_splash_pool_instructions(
            &self.ctx.rpc,
            self.mint_a,
            self.mint_b,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                splash_pool.instructions,
                splash_pool.additional_signers.iter().collect(),
            )
            .await?;

        let whirlpool_info = &self.ctx.rpc.get_account(&splash_pool.pool_address).await?;
        let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
        assert_eq!(whirlpool.token_mint_a, self.mint_a);
        assert_eq!(whirlpool.token_mint_b, self.mint_b);
        assert_eq!(whirlpool.tick_spacing, SPLASH_POOL_TICK_SPACING);

        Ok(splash_pool.pool_address)
    }

    pub async fn init_concentrated_liquidity_pool(&self) -> Result<Pubkey, Box<dyn Error>> {
        let cl_pool = create_concentrated_liquidity_pool_instructions(
            &self.ctx.rpc,
            self.mint_a,
            self.mint_b,
            128,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                cl_pool.instructions,
                cl_pool.additional_signers.iter().collect(),
            )
            .await?;

        let whirlpool_info = &self.ctx.rpc.get_account(&cl_pool.pool_address).await?;
        let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
        assert_eq!(whirlpool.token_mint_a, self.mint_a);
        assert_eq!(whirlpool.token_mint_b, self.mint_b);
        assert_eq!(whirlpool.tick_spacing, 128);

        Ok(cl_pool.pool_address)
    }

    pub async fn open_position(&self, pool: Pubkey) -> Result<Pubkey, Box<dyn Error>> {
        let infos_before = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&infos_before[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&infos_before[1].as_ref().unwrap().data)?;

        let position = open_full_range_position_instructions_with_params(
            &self.ctx.rpc,
            pool,
            IncreaseLiquidityParam::Liquidity(1000000000),
            None,
            Some(self.ctx.signer.pubkey()),
            OpenPositionParams {
                with_token_metadata_extension: false,
            },
        )
        .await?;

        self.ctx
            .send_transaction_with_signers(
                position.instructions,
                position.additional_signers.iter().collect(),
            )
            .await?;

        let position_address = get_position_address(&position.position_mint)?.0;
        let infos_after = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b, position_address])
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

    pub async fn increase_liquidity(&self, position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
        let position_address = get_position_address(&position_mint)?.0;
        let infos_before = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b, position_address])
            .await?;
        let token_a_before = Account::unpack(&infos_before[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&infos_before[1].as_ref().unwrap().data)?;
        let position_before = Position::from_bytes(&infos_before[2].as_ref().unwrap().data)?;

        let increase_liquidity = increase_liquidity_instructions(
            &self.ctx.rpc,
            position_mint,
            IncreaseLiquidityParam::Liquidity(1000000000),
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                increase_liquidity.instructions,
                increase_liquidity.additional_signers.iter().collect(),
            )
            .await?;

        let infos_after = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b, position_address])
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

    pub async fn decrease_liquidity(&self, position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
        let position_address = get_position_address(&position_mint)?.0;
        let infos_before = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b, position_address])
            .await?;
        let token_a_before = Account::unpack(&infos_before[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&infos_before[1].as_ref().unwrap().data)?;
        let position_before = Position::from_bytes(&infos_before[2].as_ref().unwrap().data)?;

        let decrease_liquidity = decrease_liquidity_instructions(
            &self.ctx.rpc,
            position_mint,
            DecreaseLiquidityParam::Liquidity(10000),
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                decrease_liquidity.instructions,
                decrease_liquidity.additional_signers.iter().collect(),
            )
            .await?;

        let infos_after = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b, position_address])
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

    pub async fn harvest_position(&self, position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
        let before_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

        let harvest_position = harvest_position_instructions(
            &self.ctx.rpc,
            position_mint,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                harvest_position.instructions,
                harvest_position.additional_signers.iter().collect(),
            )
            .await?;

        let after_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
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

    pub async fn close_position(&self, position_mint: Pubkey) -> Result<(), Box<dyn Error>> {
        let before_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

        let close_position = close_position_instructions(
            &self.ctx.rpc,
            position_mint,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                close_position.instructions,
                close_position.additional_signers.iter().collect(),
            )
            .await?;

        let position_address = get_position_address(&position_mint)?.0;
        let after_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b, position_address])
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

    pub async fn swap_a_exact_in(&self, pool: Pubkey) -> Result<(), Box<dyn Error>> {
        let before_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

        let swap = swap_instructions(
            &self.ctx.rpc,
            pool,
            100000,
            self.mint_a,
            SwapType::ExactIn,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                swap.instructions,
                swap.additional_signers.iter().collect(),
            )
            .await?;

        let after_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
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

    pub async fn swap_a_exact_out(&self, pool: Pubkey) -> Result<(), Box<dyn Error>> {
        let before_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

        let swap = swap_instructions(
            &self.ctx.rpc,
            pool,
            100000,
            self.mint_a,
            SwapType::ExactOut,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                swap.instructions,
                swap.additional_signers.iter().collect(),
            )
            .await?;

        let after_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
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

    pub async fn swap_b_exact_in(&self, pool: Pubkey) -> Result<(), Box<dyn Error>> {
        let before_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

        let swap = swap_instructions(
            &self.ctx.rpc,
            pool,
            100,
            self.mint_b,
            SwapType::ExactIn,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                swap.instructions,
                swap.additional_signers.iter().collect(),
            )
            .await?;

        let after_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
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

    pub async fn swap_b_exact_out(&self, pool: Pubkey) -> Result<(), Box<dyn Error>> {
        let before_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
        let token_a_before = Account::unpack(&before_infos[0].as_ref().unwrap().data)?;
        let token_b_before = Account::unpack(&before_infos[1].as_ref().unwrap().data)?;

        let swap = swap_instructions(
            &self.ctx.rpc,
            pool,
            100,
            self.mint_b,
            SwapType::ExactOut,
            None,
            Some(self.ctx.signer.pubkey()),
        )
        .await?;
        self.ctx
            .send_transaction_with_signers(
                swap.instructions,
                swap.additional_signers.iter().collect(),
            )
            .await?;

        let after_infos = &self
            .ctx
            .rpc
            .get_multiple_accounts(&[self.ata_a, self.ata_b])
            .await?;
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
}

#[tokio::test]
#[serial]
async fn test_splash_pool() {
    let ctx = TestContext::new().await.unwrap();
    let pool = ctx.init_splash_pool().await.unwrap();
    let position_mint = ctx.open_position(pool).await.unwrap();
    Box::pin(ctx.swap_a_exact_in(pool)).await.unwrap();
    Box::pin(ctx.increase_liquidity(position_mint))
        .await
        .unwrap();
    Box::pin(ctx.swap_a_exact_out(pool)).await.unwrap();
    Box::pin(ctx.harvest_position(position_mint)).await.unwrap();
    Box::pin(ctx.swap_b_exact_in(pool)).await.unwrap();
    Box::pin(ctx.decrease_liquidity(position_mint))
        .await
        .unwrap();
    Box::pin(ctx.swap_b_exact_out(pool)).await.unwrap();
    Box::pin(ctx.close_position(position_mint)).await.unwrap();
}

#[tokio::test]
#[serial]
async fn test_concentrated_liquidity_pool() {
    let ctx = TestContext::new().await.unwrap();
    let pool = ctx.init_concentrated_liquidity_pool().await.unwrap();
    let position_mint = ctx.open_position(pool).await.unwrap();
    Box::pin(ctx.swap_a_exact_in(pool)).await.unwrap();
    Box::pin(ctx.increase_liquidity(position_mint))
        .await
        .unwrap();
    Box::pin(ctx.swap_a_exact_out(pool)).await.unwrap();
    Box::pin(ctx.harvest_position(position_mint)).await.unwrap();
    Box::pin(ctx.swap_b_exact_in(pool)).await.unwrap();
    Box::pin(ctx.decrease_liquidity(position_mint))
        .await
        .unwrap();
    Box::pin(ctx.swap_b_exact_out(pool)).await.unwrap();
    Box::pin(ctx.close_position(position_mint)).await.unwrap();
}
