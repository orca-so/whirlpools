use std::{error::Error, iter::zip};

use orca_whirlpools_client::{
    get_oracle_address, get_tick_array_address, AccountsType, RemainingAccountsInfo,
    RemainingAccountsSlice, SwapV2, SwapV2InstructionArgs, TickArray, Whirlpool,
};
use orca_whirlpools_core::{
    get_tick_array_start_tick_index, swap_quote_by_input_token, swap_quote_by_output_token,
    ExactInSwapQuote, ExactOutSwapQuote, TickArrayFacade, TickFacade, TICK_ARRAY_SIZE,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    instruction::AccountMeta, instruction::Instruction, pubkey::Pubkey, signature::Keypair,
};

use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER, SLIPPAGE_TOLERANCE_BPS,
};

// TODO: transfer hooks

/// Represents the type of a swap operation.
///
/// This enum is used to specify whether the swap is an exact input or exact output type.
#[derive(Debug, Clone, PartialEq)]
pub enum SwapType {
    /// Indicates a swap where the input token amount is specified.
    ExactIn,

    /// Indicates a swap where the output token amount is specified.
    ExactOut,
}

/// Represents the quote for a swap operation.
///
/// This enum contains the details of the swap quote based on the type of swap.
#[derive(Debug, Clone)]
pub enum SwapQuote {
    /// The quote for a swap with a specified input token amount.
    ExactIn(ExactInSwapQuote),

    /// The quote for a swap with a specified output token amount.
    ExactOut(ExactOutSwapQuote),
}

/// Represents the instructions and quote for executing a token swap.
///
/// This struct contains the instructions required to perform the swap, along with the computed
/// quote and any additional signers required.
#[derive(Debug)]
pub struct SwapInstructions {
    /// A vector of Solana `Instruction` objects required to execute the swap.
    pub instructions: Vec<Instruction>,

    /// A `SwapQuote` representing the details of the swap.
    pub quote: SwapQuote,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,
}

fn uninitialized_tick_array(start_tick_index: i32) -> TickArrayFacade {
    TickArrayFacade {
        start_tick_index,
        ticks: [TickFacade::default(); TICK_ARRAY_SIZE],
    }
}

async fn fetch_tick_arrays_or_default(
    rpc: &RpcClient,
    whirlpool_address: Pubkey,
    whirlpool: &Whirlpool,
) -> Result<[(Pubkey, TickArrayFacade); 5], Box<dyn Error>> {
    let tick_array_start_index =
        get_tick_array_start_tick_index(whirlpool.tick_current_index, whirlpool.tick_spacing);
    let offset = whirlpool.tick_spacing as i32 * TICK_ARRAY_SIZE as i32;

    let tick_array_indexes = [
        tick_array_start_index,
        tick_array_start_index + offset,
        tick_array_start_index + offset * 2,
        tick_array_start_index - offset,
        tick_array_start_index - offset * 2,
    ];

    let tick_array_addresses: Vec<Pubkey> = tick_array_indexes
        .iter()
        .map(|&x| get_tick_array_address(&whirlpool_address, x).map(|y| y.0))
        .collect::<Result<Vec<Pubkey>, _>>()?;

    let tick_array_infos = rpc.get_multiple_accounts(&tick_array_addresses).await?;

    let maybe_tick_arrays: Vec<Option<TickArrayFacade>> = tick_array_infos
        .iter()
        .map(|x| x.as_ref().and_then(|y| TickArray::from_bytes(&y.data).ok()))
        .map(|x| x.map(|y| y.into()))
        .collect();

    let tick_arrays: Vec<TickArrayFacade> = maybe_tick_arrays
        .iter()
        .enumerate()
        .map(|(i, x)| x.unwrap_or(uninitialized_tick_array(tick_array_indexes[i])))
        .collect::<Vec<TickArrayFacade>>();

    let result: [(Pubkey, TickArrayFacade); 5] = zip(tick_array_addresses, tick_arrays)
        .collect::<Vec<(Pubkey, TickArrayFacade)>>()
        .try_into()
        .map_err(|_| "Failed to convert tick arrays to array".to_string())?;

    Ok(result)
}

/// Generates the instructions necessary to execute a token swap.
///
/// This function generates instructions for executing swaps, supporting both exact input and exact output scenarios.
/// It calculates the necessary accounts, tick arrays, and swap quote using the provided parameters.
///
/// # Arguments
///
/// * `rpc` - A reference to the Solana RPC client for fetching accounts and interacting with the blockchain.
/// * `whirlpool_address` - The public key of the Whirlpool against which the swap will be executed.
/// * `amount` - The token amount specified for the swap. For `SwapType::ExactIn`, this is the input token amount.
///              For `SwapType::ExactOut`, this is the output token amount.
/// * `specified_mint` - The public key of the token mint being swapped.
/// * `swap_type` - The type of swap (`SwapType::ExactIn` or `SwapType::ExactOut`).
/// * `slippage_tolerance_bps` - An optional slippage tolerance, in basis points (BPS). Defaults to the global setting if not provided.
/// * `signer` - An optional public key of the wallet or account executing the swap. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `SwapInstructions` on success:
/// * `instructions` - A vector of `Instruction` objects required to execute the swap.
/// * `quote` - A `SwapQuote` providing the computed details of the swap.
/// * `additional_signers` - A vector of `Keypair` objects representing any additional signers required for the instructions.
///
/// # Errors
///
/// Returns an error if:
/// - The signer is invalid or missing.
/// - The Whirlpool or token mint accounts are not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use crate::utils::load_wallet;
/// use orca_whirlpools::{
///     set_whirlpools_config_address, swap_instructions, SwapType, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use std::str::FromStr;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let wallet = load_wallet();
///     let whirlpool_address =
///         Pubkey::from_str("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt").unwrap();
///     let mint_address = Pubkey::from_str("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k").unwrap();
///     let input_amount = 1_000_000;
///
///     let result = swap_instructions(
///         &rpc,
///         whirlpool_address,
///         input_amount,
///         mint_address,
///         SwapType::ExactIn,
///         Some(100),
///         Some(wallet.pubkey()),
///     )
///     .await
///     .unwrap();
///
///     println!("Quote estimated token out: {:?}", result.quote);
///     println!("Number of Instructions: {}", result.instructions.len());
/// }
/// ```
pub async fn swap_instructions(
    rpc: &RpcClient,
    whirlpool_address: Pubkey,
    amount: u64,
    specified_mint: Pubkey,
    swap_type: SwapType,
    slippage_tolerance_bps: Option<u16>,
    signer: Option<Pubkey>,
) -> Result<SwapInstructions, Box<dyn Error>> {
    let slippage_tolerance_bps =
        slippage_tolerance_bps.unwrap_or(*SLIPPAGE_TOLERANCE_BPS.try_lock()?);
    let signer = signer.unwrap_or(*FUNDER.try_lock()?);
    if signer == Pubkey::default() {
        return Err("Signer must be provided".into());
    }

    let whirlpool_info = rpc.get_account(&whirlpool_address).await?;
    let whirlpool = Whirlpool::from_bytes(&whirlpool_info.data)?;
    let specified_input = swap_type == SwapType::ExactIn;
    let specified_token_a = specified_mint == whirlpool.token_mint_a;
    let a_to_b = specified_token_a == specified_input;

    let tick_arrays = fetch_tick_arrays_or_default(rpc, whirlpool_address, &whirlpool).await?;

    let mint_infos = rpc
        .get_multiple_accounts(&[whirlpool.token_mint_a, whirlpool.token_mint_b])
        .await?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or(format!("Mint a not found: {}", whirlpool.token_mint_a))?;

    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or(format!("Mint b not found: {}", whirlpool.token_mint_b))?;

    let oracle_address = get_oracle_address(&whirlpool_address)?.0;

    let current_epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let quote = match swap_type {
        SwapType::ExactIn => SwapQuote::ExactIn(swap_quote_by_input_token(
            amount,
            specified_token_a,
            slippage_tolerance_bps,
            whirlpool.clone().into(),
            tick_arrays.map(|x| x.1).into(),
            transfer_fee_a,
            transfer_fee_b,
        )?),
        SwapType::ExactOut => SwapQuote::ExactOut(swap_quote_by_output_token(
            amount,
            specified_token_a,
            slippage_tolerance_bps,
            whirlpool.clone().into(),
            tick_arrays.map(|x| x.1).into(),
            transfer_fee_a,
            transfer_fee_b,
        )?),
    };

    let max_in_amount = match quote {
        SwapQuote::ExactIn(quote) => quote.token_in,
        SwapQuote::ExactOut(quote) => quote.token_max_in,
    };
    let token_a_spec = if a_to_b {
        TokenAccountStrategy::WithBalance(whirlpool.token_mint_a, max_in_amount)
    } else {
        TokenAccountStrategy::WithoutBalance(whirlpool.token_mint_a)
    };
    let token_b_spec = if a_to_b {
        TokenAccountStrategy::WithoutBalance(whirlpool.token_mint_b)
    } else {
        TokenAccountStrategy::WithBalance(whirlpool.token_mint_b, max_in_amount)
    };

    let mut instructions: Vec<Instruction> = Vec::new();

    let token_accounts =
        prepare_token_accounts_instructions(rpc, signer, vec![token_a_spec, token_b_spec]).await?;

    instructions.extend(token_accounts.create_instructions);

    let other_amount_threshold = match quote {
        SwapQuote::ExactIn(quote) => quote.token_min_out,
        SwapQuote::ExactOut(quote) => quote.token_max_in,
    };

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&whirlpool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&whirlpool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    let swap_instruction = SwapV2 {
        token_program_a: mint_a_info.owner,
        token_program_b: mint_b_info.owner,
        memo_program: spl_memo::ID,
        token_authority: signer,
        whirlpool: whirlpool_address,
        token_mint_a: whirlpool.token_mint_a,
        token_mint_b: whirlpool.token_mint_b,
        token_owner_account_a: *token_owner_account_a,
        token_vault_a: whirlpool.token_vault_a,
        token_owner_account_b: *token_owner_account_b,
        token_vault_b: whirlpool.token_vault_b,
        tick_array0: tick_arrays[0].0,
        tick_array1: tick_arrays[1].0,
        tick_array2: tick_arrays[2].0,
        oracle: oracle_address,
    }
    .instruction_with_remaining_accounts(
        SwapV2InstructionArgs {
            amount,
            other_amount_threshold,
            sqrt_price_limit: 0,
            amount_specified_is_input: specified_input,
            a_to_b,
            remaining_accounts_info: Some(RemainingAccountsInfo {
                slices: vec![RemainingAccountsSlice {
                    accounts_type: AccountsType::SupplementalTickArrays,
                    length: 2,
                }],
            }),
        },
        &[
            AccountMeta::new(tick_arrays[3].0, false),
            AccountMeta::new(tick_arrays[4].0, false),
        ],
    );

    instructions.push(swap_instruction);
    instructions.extend(token_accounts.cleanup_instructions);

    Ok(SwapInstructions {
        instructions,
        quote,
        additional_signers: token_accounts.additional_signers,
    })
}

#[cfg(test)]
mod tests {
    use serial_test::serial;
    use solana_client::nonblocking::rpc_client::RpcClient;
    use solana_sdk::{program_pack::Pack, pubkey::Pubkey, signer::Signer};
    use spl_token::state::Account as TokenAccount;
    use spl_token_2022::state::Account as TokenAccount2022;
    use spl_token_2022::{extension::StateWithExtensionsOwned, ID as TOKEN_2022_PROGRAM_ID};
    use std::error::Error;

    use crate::{
        create_concentrated_liquidity_pool_instructions, create_splash_pool_instructions,
        increase_liquidity_instructions, open_full_range_position_instructions, swap_instructions,
        tests::{setup_ata_with_amount, setup_mint_with_decimals, RpcContext},
        IncreaseLiquidityParam, SwapQuote, SwapType,
    };

    struct SwapTestContext {
        pub ctx: RpcContext,

        pub mint_a: Pubkey,
        pub mint_b: Pubkey,
        pub ata_a: Pubkey,
        pub ata_b: Pubkey,
    }

    impl SwapTestContext {
        pub async fn new() -> Result<Self, Box<dyn Error>> {
            let ctx = RpcContext::new().await;

            let mint_a = setup_mint_with_decimals(&ctx, 9).await?;
            let mint_b = setup_mint_with_decimals(&ctx, 9).await?;

            let ata_a = setup_ata_with_amount(&ctx, mint_a, 1_000_000_000).await?;
            let ata_b = setup_ata_with_amount(&ctx, mint_b, 1_000_000_000).await?;

            Ok(Self {
                ctx,
                mint_a,
                mint_b,
                ata_a,
                ata_b,
            })
        }

        async fn get_token_balance(&self, address: Pubkey) -> Result<u64, Box<dyn Error>> {
            let account_data = self.ctx.rpc.get_account(&address).await?;
            if account_data.owner == TOKEN_2022_PROGRAM_ID {
                let parsed =
                    StateWithExtensionsOwned::<TokenAccount2022>::unpack(account_data.data)?;
                Ok(parsed.base.amount)
            } else {
                let parsed = TokenAccount::unpack(&account_data.data)?;
                Ok(parsed.amount)
            }
        }

        pub async fn init_pool(&self, is_splash: bool) -> Result<Pubkey, Box<dyn Error>> {
            if is_splash {
                let pool = create_splash_pool_instructions(
                    &self.ctx.rpc,
                    self.mint_a,
                    self.mint_b,
                    None,
                    Some(self.ctx.signer.pubkey()),
                )
                .await?;
                self.ctx
                    .send_transaction_with_signers(
                        pool.instructions,
                        pool.additional_signers.iter().collect(),
                    )
                    .await?;
                Ok(pool.pool_address)
            } else {
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
                Ok(cl_pool.pool_address)
            }
        }

        pub async fn open_position_with_liquidity(
            &self,
            pool_pubkey: Pubkey,
        ) -> Result<Pubkey, Box<dyn Error>> {
            let position = open_full_range_position_instructions(
                &self.ctx.rpc,
                pool_pubkey,
                IncreaseLiquidityParam::Liquidity(50_000_000),
                None,
                Some(self.ctx.signer.pubkey()),
            )
            .await?;
            self.ctx
                .send_transaction_with_signers(
                    position.instructions,
                    position.additional_signers.iter().collect(),
                )
                .await?;

            Ok(position.position_mint)
        }

        pub async fn do_swap(
            &self,
            pool_pubkey: Pubkey,
            a_to_b: bool,
            swap_type: SwapType,
            amount: u64,
        ) -> Result<(), Box<dyn Error>> {
            let specified_mint = if a_to_b { self.mint_a } else { self.mint_b };

            let before_a = self.get_token_balance(self.ata_a).await?;
            let before_b = self.get_token_balance(self.ata_b).await?;

            let swap_ix = swap_instructions(
                &self.ctx.rpc,
                pool_pubkey,
                amount,
                specified_mint,
                swap_type.clone(),
                Some(100), // 1% slippage
                Some(self.ctx.signer.pubkey()),
            )
            .await?;

            self.ctx
                .send_transaction_with_signers(
                    swap_ix.instructions,
                    swap_ix.additional_signers.iter().collect(),
                )
                .await?;

            let after_a = self.get_token_balance(self.ata_a).await?;
            let after_b = self.get_token_balance(self.ata_b).await?;

            let used_a = before_a.saturating_sub(after_a);
            let used_b = before_b.saturating_sub(after_b);
            let gained_a = after_a.saturating_sub(before_a);
            let gained_b = after_b.saturating_sub(before_b);

            match swap_ix.quote {
                SwapQuote::ExactIn(q) => {
                    if a_to_b {
                        // used A, gained B
                        assert_eq!(used_a, q.token_in, "Used A mismatch");
                        assert_eq!(gained_b, q.token_est_out, "Gained B mismatch");
                    } else {
                        // used B, gained A
                        assert_eq!(used_b, q.token_in, "Used B mismatch");
                        assert_eq!(gained_a, q.token_est_out, "Gained A mismatch");
                    }
                }
                SwapQuote::ExactOut(q) => {
                    if a_to_b {
                        // gained B, used A
                        assert_eq!(gained_b, q.token_out, "Gained B mismatch");
                        assert_eq!(used_a, q.token_est_in, "Used A mismatch");
                    } else {
                        // gained A, used B
                        assert_eq!(gained_a, q.token_out, "Gained A mismatch");
                        assert_eq!(used_b, q.token_est_in, "Used B mismatch");
                    }
                }
            }
            println!(
                "swap result => a_to_b={}, used_a={}, used_b={}, gained_a={}, gained_b={}",
                a_to_b, used_a, used_b, gained_a, gained_b
            );

            Ok(())
        }
    }

    #[tokio::test]
    async fn test_swap_for_multiple_pools() -> Result<(), Box<dyn Error>> {
        let stx = SwapTestContext::new().await?;

        let ctx = &stx.ctx;

        let mint_a = setup_mint_with_decimals(&ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(&ctx, 9).await?;
        let ata_a = setup_ata_with_amount(&ctx, mint_a, 500_000_000).await?;
        let ata_b = setup_ata_with_amount(&ctx, mint_b, 500_000_000).await?;

        let pool = create_concentrated_liquidity_pool_instructions(
            &ctx.rpc,
            mint_a,
            mint_b,
            128,
            None,
            Some(ctx.signer.pubkey()),
        )
        .await?;
        ctx.send_transaction_with_signers(
            pool.instructions,
            pool.additional_signers.iter().collect(),
        )
        .await?;

        let pool_pubkey = pool.pool_address;

        let position = open_full_range_position_instructions(
            &ctx.rpc,
            pool_pubkey,
            IncreaseLiquidityParam::Liquidity(50_000_000),
            None,
            Some(ctx.signer.pubkey()),
        )
        .await?;
        ctx.send_transaction_with_signers(
            position.instructions,
            position.additional_signers.iter().collect(),
        )
        .await?;

        let swap_ix = swap_instructions(
            &ctx.rpc,
            pool_pubkey,
            10_000,
            mint_a,
            SwapType::ExactIn,
            Some(100),
            Some(ctx.signer.pubkey()),
        )
        .await?;
        let before_a = stx.get_token_balance(ata_a).await?;
        let before_b = stx.get_token_balance(ata_b).await?;

        ctx.send_transaction_with_signers(
            swap_ix.instructions,
            swap_ix.additional_signers.iter().collect(),
        )
        .await?;

        let after_a = stx.get_token_balance(ata_a).await?;
        let after_b = stx.get_token_balance(ata_b).await?;
        let used_a = before_a.saturating_sub(after_a);
        let gained_b = after_b.saturating_sub(before_b);

        if let SwapQuote::ExactIn(q) = swap_ix.quote {
            assert_eq!(used_a, q.token_in, "Used A mismatch");
            assert_eq!(gained_b, q.token_est_out, "Gained B mismatch");
        } else {
            panic!("Expected ExactIn quote");
        }

        Ok(())
    }
}
