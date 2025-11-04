use std::{
    error::Error,
    iter::zip,
    time::{SystemTime, UNIX_EPOCH},
};

use orca_whirlpools_client::{
    get_oracle_address, get_tick_array_address, AccountsType, Oracle, RemainingAccountsInfo,
    RemainingAccountsSlice, SwapV2, SwapV2InstructionArgs, TickArray, Whirlpool,
};
use orca_whirlpools_core::{
    get_tick_array_start_tick_index, swap_quote_by_input_token, swap_quote_by_output_token,
    ExactInSwapQuote, ExactOutSwapQuote, TickArrayFacade, TickFacade, TICK_ARRAY_SIZE,
};
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_rpc_client::nonblocking::rpc_client::RpcClient;

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

    /// The timestamp when the trade was enabled.
    pub trade_enable_timestamp: u64,

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

async fn fetch_oracle(
    rpc: &RpcClient,
    oracle_address: Pubkey,
    whirlpool: &Whirlpool,
) -> Result<Option<Oracle>, Box<dyn Error>> {
    // no need to fetch oracle for non-adaptive fee whirlpools
    if whirlpool.tick_spacing == u16::from_le_bytes(whirlpool.fee_tier_index_seed) {
        return Ok(None);
    }
    let oracle_info = rpc.get_account(&oracle_address).await?;
    Ok(Some(Oracle::from_bytes(&oracle_info.data)?))
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
///   For `SwapType::ExactOut`, this is the output token amount.
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
/// use solana_rpc_client::nonblocking::rpc_client::RpcClient;
/// use solana_pubkey::Pubkey;
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
    let oracle = fetch_oracle(rpc, oracle_address, &whirlpool).await?;

    let current_epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let trade_enable_timestamp = oracle
        .as_ref()
        .map(|x| x.trade_enable_timestamp)
        .unwrap_or(0);

    let quote = match swap_type {
        SwapType::ExactIn => SwapQuote::ExactIn(swap_quote_by_input_token(
            amount,
            specified_token_a,
            slippage_tolerance_bps,
            whirlpool.clone().into(),
            oracle.map(|oracle| oracle.into()),
            tick_arrays.map(|x| x.1).into(),
            timestamp,
            transfer_fee_a,
            transfer_fee_b,
        )?),
        SwapType::ExactOut => SwapQuote::ExactOut(swap_quote_by_output_token(
            amount,
            specified_token_a,
            slippage_tolerance_bps,
            whirlpool.clone().into(),
            oracle.map(|oracle| oracle.into()),
            tick_arrays.map(|x| x.1).into(),
            timestamp,
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
        memo_program: spl_memo_interface::v3::ID,
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
        trade_enable_timestamp,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::error::Error;

    use rstest::rstest;
    use serial_test::serial;
    use solana_keypair::{Keypair, Signer};
    use solana_program_pack::Pack;
    use solana_program_test::tokio;
    use solana_pubkey::Pubkey;
    use solana_rpc_client::nonblocking::rpc_client::RpcClient;
    use spl_token_2022_interface::{
        extension::StateWithExtensionsOwned, state::Account as TokenAccount2022,
        ID as TOKEN_2022_PROGRAM_ID,
    };
    use spl_token_interface::state::Account as TokenAccount;

    use crate::{
        increase_liquidity_instructions, swap_instructions,
        tests::{
            setup_ata_te, setup_ata_with_amount, setup_mint_te, setup_mint_te_fee,
            setup_mint_with_decimals, setup_position, setup_whirlpool, RpcContext, SetupAtaConfig,
        },
        IncreaseLiquidityParam, SwapInstructions, SwapQuote, SwapType,
    };

    async fn get_token_balance(rpc: &RpcClient, address: Pubkey) -> Result<u64, Box<dyn Error>> {
        let account_data = rpc.get_account(&address).await?;
        if account_data.owner == TOKEN_2022_PROGRAM_ID {
            let parsed = StateWithExtensionsOwned::<TokenAccount2022>::unpack(account_data.data)?;
            Ok(parsed.base.amount)
        } else {
            let parsed = TokenAccount::unpack(&account_data.data)?;
            Ok(parsed.amount)
        }
    }

    async fn setup_all_mints(
        ctx: &RpcContext,
    ) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let mint_a = setup_mint_with_decimals(ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(ctx, 9).await?;
        let mint_te_a = setup_mint_te(ctx, &[]).await?;
        let mint_te_b = setup_mint_te(ctx, &[]).await?;
        let mint_tefee = setup_mint_te_fee(ctx).await?;

        let mut out = HashMap::new();
        out.insert("A", mint_a);
        out.insert("B", mint_b);
        out.insert("TEA", mint_te_a);
        out.insert("TEB", mint_te_b);
        out.insert("TEFee", mint_tefee);
        Ok(out)
    }

    async fn setup_all_atas(
        ctx: &RpcContext,
        minted: &HashMap<&str, Pubkey>,
    ) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        // Give each user ATA a large balance
        let token_balance = 1_000_000_000;

        let ata_a = setup_ata_with_amount(ctx, minted["A"], token_balance).await?;
        let ata_b = setup_ata_with_amount(ctx, minted["B"], token_balance).await?;
        let ata_te_a = setup_ata_te(
            ctx,
            minted["TEA"],
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;
        let ata_te_b = setup_ata_te(
            ctx,
            minted["TEB"],
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;
        let ata_tefee = setup_ata_te(
            ctx,
            minted["TEFee"],
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;

        let mut out = HashMap::new();
        out.insert("A", ata_a);
        out.insert("B", ata_b);
        out.insert("TEA", ata_te_a);
        out.insert("TEB", ata_te_b);
        out.insert("TEFee", ata_tefee);
        Ok(out)
    }

    fn parse_pool_name(pool: &str) -> (&'static str, &'static str) {
        match pool {
            "A-B" => ("A", "B"),
            "A-TEA" => ("A", "TEA"),
            "TEA-TEB" => ("TEA", "TEB"),
            "A-TEFee" => ("A", "TEFee"),
            _ => panic!("Unknown pool combo: {}", pool),
        }
    }

    async fn verify_swap(
        ctx: &RpcContext,
        swap_ix: &SwapInstructions,
        user_ata_for_final_a: Pubkey,
        user_ata_for_final_b: Pubkey,
        a_to_b: bool,
    ) -> Result<(), Box<dyn Error>> {
        let before_a = get_token_balance(&ctx.rpc, user_ata_for_final_a).await?;
        let before_b = get_token_balance(&ctx.rpc, user_ata_for_final_b).await?;

        // do swap
        let signers: Vec<&Keypair> = swap_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(swap_ix.instructions.clone(), signers)
            .await?;

        let after_a = get_token_balance(&ctx.rpc, user_ata_for_final_a).await?;
        let after_b = get_token_balance(&ctx.rpc, user_ata_for_final_b).await?;

        let used_a = before_a.saturating_sub(after_a);
        let used_b = before_b.saturating_sub(after_b);
        let gained_a = after_a.saturating_sub(before_a);
        let gained_b = after_b.saturating_sub(before_b);

        match &swap_ix.quote {
            SwapQuote::ExactIn(q) => {
                if a_to_b {
                    assert_eq!(used_a, q.token_in, "Used A mismatch");
                    assert_eq!(gained_b, q.token_est_out, "Gained B mismatch");
                } else {
                    assert_eq!(used_b, q.token_in, "Used B mismatch");
                    assert_eq!(gained_a, q.token_est_out, "Gained A mismatch");
                }
            }
            SwapQuote::ExactOut(q) => {
                if a_to_b {
                    assert_eq!(gained_b, q.token_out, "Gained B mismatch");
                    assert_eq!(used_a, q.token_est_in, "Used A mismatch");
                } else {
                    assert_eq!(gained_a, q.token_out, "Gained A mismatch");
                    assert_eq!(used_b, q.token_est_in, "Used B mismatch");
                }
            }
        }
        Ok(())
    }

    #[rstest]
    #[case("A-B", true, SwapType::ExactIn, 1000)]
    #[case("A-B", true, SwapType::ExactOut, 500)]
    #[case("A-B", false, SwapType::ExactIn, 200)]
    #[case("A-B", false, SwapType::ExactOut, 100)]
    #[case("A-TEA", true, SwapType::ExactIn, 1000)]
    #[case("A-TEA", true, SwapType::ExactOut, 500)]
    #[case("A-TEA", false, SwapType::ExactIn, 200)]
    #[case("A-TEA", false, SwapType::ExactOut, 100)]
    #[case("TEA-TEB", true, SwapType::ExactIn, 1000)]
    #[case("TEA-TEB", true, SwapType::ExactOut, 500)]
    #[case("TEA-TEB", false, SwapType::ExactIn, 200)]
    #[case("TEA-TEB", false, SwapType::ExactOut, 100)]
    #[case("A-TEFee", true, SwapType::ExactIn, 1000)]
    #[case("A-TEFee", true, SwapType::ExactOut, 500)]
    #[case("A-TEFee", false, SwapType::ExactIn, 200)]
    #[case("A-TEFee", false, SwapType::ExactOut, 100)]
    #[serial]
    fn test_swap_scenarios(
        #[case] pool_name: &str,
        #[case] a_to_b: bool,
        #[case] swap_type: SwapType,
        #[case] amount: u64,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let ctx = RpcContext::new().await;

            let minted = setup_all_mints(&ctx).await.unwrap();
            let user_atas = setup_all_atas(&ctx, &minted).await.unwrap();

            let (mkey_a, mkey_b) = parse_pool_name(pool_name);
            let pubkey_a = minted[mkey_a];
            let pubkey_b = minted[mkey_b];

            let tick_spacing = 64;
            let (final_a, final_b) = if pubkey_a < pubkey_b {
                (pubkey_a, pubkey_b)
            } else {
                (pubkey_b, pubkey_a)
            };

            let pool_pubkey = setup_whirlpool(&ctx, final_a, final_b, tick_spacing)
                .await
                .unwrap();

            let position_mint = setup_position(
                &ctx,
                pool_pubkey,
                Some((-192, 192)), // aligned to spacing=64
                None,
            )
            .await
            .unwrap();

            let liq_ix = increase_liquidity_instructions(
                &ctx.rpc,
                position_mint,
                IncreaseLiquidityParam::Liquidity(1_000_000),
                Some(100), // 1% slippage
                Some(ctx.signer.pubkey()),
            )
            .await
            .unwrap();
            ctx.send_transaction_with_signers(
                liq_ix.instructions,
                liq_ix.additional_signers.iter().collect(),
            )
            .await
            .unwrap();

            let user_ata_for_final_a = if final_a == pubkey_a {
                user_atas[mkey_a]
            } else {
                user_atas[mkey_b]
            };
            let user_ata_for_final_b = if final_b == pubkey_b {
                user_atas[mkey_b]
            } else {
                user_atas[mkey_a]
            };

            let token_for_this_call = match swap_type {
                SwapType::ExactIn => {
                    if a_to_b {
                        final_a
                    } else {
                        final_b
                    }
                }
                SwapType::ExactOut => {
                    if a_to_b {
                        final_b
                    } else {
                        final_a
                    }
                }
            };

            let swap_ix = swap_instructions(
                &ctx.rpc,
                pool_pubkey,
                amount,
                token_for_this_call,
                swap_type.clone(),
                Some(100), // slippage
                Some(ctx.signer.pubkey()),
            )
            .await
            .unwrap();

            verify_swap(
                &ctx,
                &swap_ix,
                user_ata_for_final_a,
                user_ata_for_final_b,
                a_to_b,
            )
            .await
            .unwrap();
        });
    }
}
