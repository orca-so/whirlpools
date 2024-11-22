use std::{
    collections::HashSet,
    error::Error,
    time::{SystemTime, UNIX_EPOCH},
};

use orca_whirlpools_client::{
    get_position_address, get_tick_array_address, Position, TickArray, Whirlpool,
};
use orca_whirlpools_client::{
    ClosePosition, ClosePositionWithTokenExtensions, CollectFeesV2, CollectFeesV2InstructionArgs,
    CollectRewardV2, CollectRewardV2InstructionArgs, DecreaseLiquidityV2,
    DecreaseLiquidityV2InstructionArgs,
};
use orca_whirlpools_core::{
    collect_fees_quote, collect_rewards_quote, decrease_liquidity_quote,
    decrease_liquidity_quote_a, decrease_liquidity_quote_b, get_tick_array_start_tick_index,
    get_tick_index_in_array, CollectFeesQuote, CollectRewardsQuote, DecreaseLiquidityQuote,
};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{account::Account, instruction::Instruction, pubkey::Pubkey, signature::Keypair};
use spl_associated_token_account::get_associated_token_address_with_program_id;

use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER, SLIPPAGE_TOLERANCE_BPS,
};

// TODO: support transfer hooks

/// Represents the parameters for decreasing liquidity in a pool.
///
/// You must specify only one of the parameters (`TokenA`, `TokenB`, or `Liquidity`).
/// Based on the provided value, the SDK computes the other two parameters.
#[derive(Debug, Clone)]
pub enum DecreaseLiquidityParam {
    /// Specifies the amount of Token A to withdraw.
    TokenA(u64),
    /// Specifies the amount of Token B to withdraw.
    TokenB(u64),
    /// Specifies the amount of liquidity to decrease.
    Liquidity(u128),
}

/// Represents the instructions and quote for decreasing liquidity in a position.
#[derive(Debug)]
pub struct DecreaseLiquidityInstruction {
    /// The quote details for decreasing liquidity, including:
    /// - The liquidity delta.
    /// - Estimated amounts of Token A and Token B to withdraw.
    /// - Minimum token amounts based on the specified slippage tolerance.
    pub quote: DecreaseLiquidityQuote,

    /// A vector of Solana instructions required to execute the decrease liquidity operation.
    pub instructions: Vec<Instruction>,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,
}

/// Generates instructions to decrease liquidity from an existing position.
///
/// This function computes the necessary quote and creates Solana instructions to reduce liquidity
/// from an existing pool position, specified by the position's mint address.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching necessary accounts and pool data.
/// * `position_mint_address` - The public key of the NFT mint address representing the pool position.
/// * `param` - A variant of `DecreaseLiquidityParam` specifying the liquidity reduction method (by Token A, Token B, or liquidity amount).
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `authority` - An optional public key of the account authorizing the liquidity removal. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `DecreaseLiquidityInstruction` on success:
///
/// * `quote` - The computed quote for decreasing liquidity, including liquidity delta, token estimates, and minimum tokens.
/// * `instructions` - A vector of `Instruction` objects required to execute the decrease liquidity operation.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
///
/// # Errors
///
/// This function will return an error if:
/// - The `authority` account is invalid or missing.
/// - The position or token mint accounts are not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::{
///     decrease_liquidity_instructions, WhirlpoolsConfigInput, set_whirlpools_config_address, DecreaseLiquidityParam
/// };
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let position_mint_address = Pubkey::from_str("POSITION_NFT_MINT_ADDRESS").unwrap();
/// let param = DecreaseLiquidityParam::Liquidity(500_000);
/// let slippage_tolerance_bps = Some(100);
///
/// let result = decrease_liquidity_instructions(
///     &rpc,
///     position_mint_address,
///     param,
///     slippage_tolerance_bps,
///     None, // SET GLOBAL FUNDER
/// ).unwrap();
///
/// println!("Liquidity Decrease Quote: {:?}", result.quote);
/// println!("Number of Instructions: {}", result.instructions.len());
/// ```
pub async fn decrease_liquidity_instructions(
    rpc: &RpcClient,
    position_mint_address: Pubkey,
    param: DecreaseLiquidityParam,
    slippage_tolerance_bps: Option<u16>,
    authority: Option<Pubkey>,
) -> Result<DecreaseLiquidityInstruction, Box<dyn Error>> {
    let slippage_tolerance_bps =
        slippage_tolerance_bps.unwrap_or(*SLIPPAGE_TOLERANCE_BPS.try_lock()?);
    let authority = authority.unwrap_or(*FUNDER.try_lock()?);
    if authority == Pubkey::default() {
        return Err("Authority must be provided".into());
    }

    let position_address = get_position_address(&position_mint_address)?.0;
    let position_info = rpc.get_account(&position_address).await?;
    let position = Position::from_bytes(&position_info.data)?;

    let pool_info = rpc.get_account(&position.whirlpool).await?;
    let pool = Whirlpool::from_bytes(&pool_info.data)?;

    let mint_infos = rpc
        .get_multiple_accounts(&[pool.token_mint_a, pool.token_mint_b, position_mint_address])
        .await?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or("Token B mint info not found")?;
    let position_mint_info = mint_infos[2]
        .as_ref()
        .ok_or("Position mint info not found")?;

    let current_epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let quote = match param {
        DecreaseLiquidityParam::TokenA(amount) => decrease_liquidity_quote_a(
            amount,
            slippage_tolerance_bps,
            pool.sqrt_price,
            position.tick_lower_index,
            position.tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        ),
        DecreaseLiquidityParam::TokenB(amount) => decrease_liquidity_quote_b(
            amount,
            slippage_tolerance_bps,
            pool.sqrt_price,
            position.tick_lower_index,
            position.tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        ),
        DecreaseLiquidityParam::Liquidity(amount) => decrease_liquidity_quote(
            amount,
            slippage_tolerance_bps,
            pool.sqrt_price,
            position.tick_lower_index,
            position.tick_upper_index,
            transfer_fee_a,
            transfer_fee_b,
        ),
    }?;

    let mut instructions: Vec<Instruction> = Vec::new();

    let lower_tick_array_start_index =
        get_tick_array_start_tick_index(position.tick_lower_index, pool.tick_spacing);
    let upper_tick_array_start_index =
        get_tick_array_start_tick_index(position.tick_upper_index, pool.tick_spacing);

    let position_token_account_address = get_associated_token_address_with_program_id(
        &authority,
        &position_mint_address,
        &position_mint_info.owner,
    );
    let lower_tick_array_address =
        get_tick_array_address(&position.whirlpool, lower_tick_array_start_index)?.0;
    let upper_tick_array_address =
        get_tick_array_address(&position.whirlpool, upper_tick_array_start_index)?.0;

    let token_accounts = prepare_token_accounts_instructions(
        rpc,
        authority,
        vec![
            TokenAccountStrategy::WithoutBalance(pool.token_mint_a),
            TokenAccountStrategy::WithoutBalance(pool.token_mint_b),
        ],
    )
    .await?;

    instructions.extend(token_accounts.create_instructions);

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&pool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&pool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    instructions.push(
        DecreaseLiquidityV2 {
            whirlpool: position.whirlpool,
            token_program_a: mint_a_info.owner,
            token_program_b: mint_b_info.owner,
            memo_program: spl_memo::ID,
            position_authority: authority,
            position: position_address,
            position_token_account: position_token_account_address,
            token_mint_a: pool.token_mint_a,
            token_mint_b: pool.token_mint_b,
            token_owner_account_a: *token_owner_account_a,
            token_owner_account_b: *token_owner_account_b,
            token_vault_a: pool.token_vault_a,
            token_vault_b: pool.token_vault_b,
            tick_array_lower: lower_tick_array_address,
            tick_array_upper: upper_tick_array_address,
        }
        .instruction(DecreaseLiquidityV2InstructionArgs {
            liquidity_amount: quote.liquidity_delta,
            token_min_a: quote.token_min_a,
            token_min_b: quote.token_min_b,
            remaining_accounts_info: None,
        }),
    );

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(DecreaseLiquidityInstruction {
        quote,
        instructions,
        additional_signers: token_accounts.additional_signers,
    })
}

/// Represents the instructions and quotes for closing a liquidity position.
///
/// This struct contains the instructions required to close a position, along with detailed
/// information about the liquidity decrease, available fees to collect, and available rewards to collect.
#[derive(Debug)]
pub struct ClosePositionInstruction {
    /// A vector of `Instruction` objects required to execute the position closure.
    pub instructions: Vec<Instruction>,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,

    /// The computed quote for decreasing liquidity, including liquidity delta, token estimates, and minimum tokens.
    pub quote: DecreaseLiquidityQuote,

    /// Details of the fees available to collect from the position:
    /// - `fee_owed_a` - The amount of fees available to collect in token A.
    /// - `fee_owed_b` - The amount of fees available to collect in token B.
    pub fees_quote: CollectFeesQuote,

    /// Details of the rewards available to collect from the position:
    /// - `rewards` - An array containing up to three `CollectRewardQuote` entries, one for each reward token.
    ///   - Each entry includes `rewards_owed`, the amount of the respective reward token available to collect.
    pub rewards_quote: CollectRewardsQuote,
}

/// Generates instructions to close a liquidity position.
///
/// This function collects all fees and rewards, removes any remaining liquidity, and closes
/// the position. It returns the necessary instructions, quotes for fees and rewards, and the
/// liquidity quote for the closed position.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching accounts and pool data.
/// * `position_mint_address` - The public key of the NFT mint address representing the position to be closed.
/// * `slippage_tolerance_bps` - An optional slippage tolerance in basis points. Defaults to the global slippage tolerance if not provided.
/// * `authority` - An optional public key of the account authorizing the transaction. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `ClosePositionInstruction` on success:
///
/// * `instructions` - A vector of `Instruction` objects required to execute the position closure.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
/// * `quote` - The computed quote for decreasing liquidity, including liquidity delta, token estimates, and minimum tokens.
/// * `fees_quote` - Details of the fees available to collect from the position:
///   - `fee_owed_a` - The amount of fees available to collect in token A.
///   - `fee_owed_b` - The amount of fees available to collect in token B.
/// * `rewards_quote` - Details of the rewards available to collect from the position:
///   - `rewards` - An array containing up to three `CollectRewardQuote` entries, one for each reward token.
///     - Each entry includes `rewards_owed`, the amount of the respective reward token available to collect.
///
/// # Errors
///
/// This function will return an error if:
/// - The `authority` account is invalid or missing.
/// - The position, token mint, or reward accounts are not found or have invalid data.
/// - Any RPC request to the blockchain fails.
///
/// # Example
///
/// ```rust
/// use solana_client::rpc_client::RpcClient;
/// use solana_sdk::pubkey::Pubkey;
/// use orca_whirlpools::{
///     close_position_instructions, WhirlpoolsConfigInput, set_whirlpools_config_address
/// };
/// use std::str::FromStr;
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let position_mint_address = Pubkey::from_str("POSITION_NFT_MINT_ADDRESS").unwrap();
/// let slippage_tolerance_bps = Some(100);
///
/// let result = close_position_instructions(
///     &rpc,
///     position_mint_address,
///     slippage_tolerance_bps,
///     None, // SET GLOBAL FUNDER
/// ).unwrap();
///
/// println!("Instructions: {:?}", result.instructions);
/// println!("Fees Quote: {:?}", result.fees_quote);
/// println!("Rewards Quote: {:?}", result.rewards_quote);
/// println!("Liquidity Decrease Quote: {:?}", result.quote);
/// ```
pub async fn close_position_instructions(
    rpc: &RpcClient,
    position_mint_address: Pubkey,
    slippage_tolerance_bps: Option<u16>,
    authority: Option<Pubkey>,
) -> Result<ClosePositionInstruction, Box<dyn Error>> {
    let slippage_tolerance_bps =
        slippage_tolerance_bps.unwrap_or(*SLIPPAGE_TOLERANCE_BPS.try_lock()?);
    let authority = authority.unwrap_or(*FUNDER.try_lock()?);
    if authority == Pubkey::default() {
        return Err("Authority must be provided".into());
    }

    let position_address = get_position_address(&position_mint_address)?.0;
    let position_info = rpc.get_account(&position_address).await?;
    let position = Position::from_bytes(&position_info.data)?;

    let pool_info = rpc.get_account(&position.whirlpool).await?;
    let pool = Whirlpool::from_bytes(&pool_info.data)?;

    let mint_infos = rpc
        .get_multiple_accounts(&[
            pool.token_mint_a,
            pool.token_mint_b,
            position_mint_address,
            pool.reward_infos[0].mint,
            pool.reward_infos[1].mint,
            pool.reward_infos[2].mint,
        ])
        .await?;

    let mint_a_info = mint_infos[0]
        .as_ref()
        .ok_or("Token A mint info not found")?;
    let mint_b_info = mint_infos[1]
        .as_ref()
        .ok_or("Token B mint info not found")?;
    let position_mint_info = mint_infos[2]
        .as_ref()
        .ok_or("Position mint info not found")?;

    let reward_infos: Vec<Option<Account>> = pool
        .reward_infos
        .iter()
        .enumerate()
        .map(|(i, x)| {
            if x.mint == Pubkey::default() {
                None
            } else {
                mint_infos[i + 3].clone()
            }
        })
        .collect();

    let current_epoch = rpc.get_epoch_info().await?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

    let quote = decrease_liquidity_quote(
        position.liquidity,
        slippage_tolerance_bps,
        pool.sqrt_price,
        position.tick_lower_index,
        position.tick_upper_index,
        transfer_fee_a,
        transfer_fee_b,
    )?;

    let lower_tick_array_start_index =
        get_tick_array_start_tick_index(position.tick_lower_index, pool.tick_spacing);
    let upper_tick_array_start_index =
        get_tick_array_start_tick_index(position.tick_upper_index, pool.tick_spacing);

    let position_token_account_address = get_associated_token_address_with_program_id(
        &authority,
        &position_mint_address,
        &position_mint_info.owner,
    );
    let lower_tick_array_address =
        get_tick_array_address(&position.whirlpool, lower_tick_array_start_index)?.0;
    let upper_tick_array_address =
        get_tick_array_address(&position.whirlpool, upper_tick_array_start_index)?.0;

    let tick_array_infos = rpc
        .get_multiple_accounts(&[lower_tick_array_address, upper_tick_array_address])
        .await?;

    let lower_tick_array_info = tick_array_infos[0]
        .as_ref()
        .ok_or("Lower tick array info not found")?;
    let lower_tick_array = TickArray::from_bytes(&lower_tick_array_info.data)?;
    let lower_tick = &lower_tick_array.ticks[get_tick_index_in_array(
        position.tick_lower_index,
        lower_tick_array_start_index,
        pool.tick_spacing,
    )? as usize];

    let upper_tick_array_info = tick_array_infos[1]
        .as_ref()
        .ok_or("Upper tick array info not found")?;
    let upper_tick_array = TickArray::from_bytes(&upper_tick_array_info.data)?;
    let upper_tick = &upper_tick_array.ticks[get_tick_index_in_array(
        position.tick_upper_index,
        upper_tick_array_start_index,
        pool.tick_spacing,
    )? as usize];

    let fees_quote = collect_fees_quote(
        pool.clone().into(),
        position.clone().into(),
        lower_tick.clone().into(),
        upper_tick.clone().into(),
        transfer_fee_a,
        transfer_fee_b,
    )?;

    let unix_timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let rewards_quote = collect_rewards_quote(
        pool.clone().into(),
        position.clone().into(),
        lower_tick.clone().into(),
        upper_tick.clone().into(),
        unix_timestamp,
        get_current_transfer_fee(reward_infos[0].as_ref(), current_epoch),
        get_current_transfer_fee(reward_infos[1].as_ref(), current_epoch),
        get_current_transfer_fee(reward_infos[2].as_ref(), current_epoch),
    )?;

    let mut required_mints: HashSet<TokenAccountStrategy> = HashSet::new();

    if quote.liquidity_delta > 0 || fees_quote.fee_owed_a > 0 || fees_quote.fee_owed_b > 0 {
        required_mints.insert(TokenAccountStrategy::WithoutBalance(pool.token_mint_a));
        required_mints.insert(TokenAccountStrategy::WithoutBalance(pool.token_mint_b));
    }

    for i in 0..3 {
        if rewards_quote.rewards[i].rewards_owed > 0 {
            required_mints.insert(TokenAccountStrategy::WithoutBalance(
                pool.reward_infos[i].mint,
            ));
        }
    }

    let token_accounts =
        prepare_token_accounts_instructions(rpc, authority, required_mints.into_iter().collect())
            .await?;

    let mut instructions: Vec<Instruction> = Vec::new();
    instructions.extend(token_accounts.create_instructions);

    let token_owner_account_a = token_accounts
        .token_account_addresses
        .get(&pool.token_mint_a)
        .ok_or("Token A owner account not found")?;
    let token_owner_account_b = token_accounts
        .token_account_addresses
        .get(&pool.token_mint_b)
        .ok_or("Token B owner account not found")?;

    if quote.liquidity_delta > 0 {
        instructions.push(
            DecreaseLiquidityV2 {
                whirlpool: position.whirlpool,
                token_program_a: mint_a_info.owner,
                token_program_b: mint_b_info.owner,
                memo_program: spl_memo::ID,
                position_authority: authority,
                position: position_address,
                position_token_account: position_token_account_address,
                token_mint_a: pool.token_mint_a,
                token_mint_b: pool.token_mint_b,
                token_owner_account_a: *token_owner_account_a,
                token_owner_account_b: *token_owner_account_b,
                token_vault_a: pool.token_vault_a,
                token_vault_b: pool.token_vault_b,
                tick_array_lower: lower_tick_array_address,
                tick_array_upper: upper_tick_array_address,
            }
            .instruction(DecreaseLiquidityV2InstructionArgs {
                liquidity_amount: quote.liquidity_delta,
                token_min_a: quote.token_min_a,
                token_min_b: quote.token_min_b,
                remaining_accounts_info: None,
            }),
        );
    }

    if fees_quote.fee_owed_a > 0 || fees_quote.fee_owed_b > 0 {
        instructions.push(
            CollectFeesV2 {
                whirlpool: position.whirlpool,
                position_authority: authority,
                position: position_address,
                position_token_account: position_token_account_address,
                token_owner_account_a: *token_owner_account_a,
                token_owner_account_b: *token_owner_account_b,
                token_vault_a: pool.token_vault_a,
                token_vault_b: pool.token_vault_b,
                token_mint_a: pool.token_mint_a,
                token_mint_b: pool.token_mint_b,
                token_program_a: mint_a_info.owner,
                token_program_b: mint_b_info.owner,
                memo_program: spl_memo::ID,
            }
            .instruction(CollectFeesV2InstructionArgs {
                remaining_accounts_info: None,
            }),
        );
    }

    for i in 0..3 {
        if rewards_quote.rewards[i].rewards_owed == 0 {
            continue;
        }
        let reward_info = reward_infos[i]
            .as_ref()
            .ok_or("Reward mint info not found")?;
        let reward_owner = token_accounts
            .token_account_addresses
            .get(&pool.reward_infos[i].mint)
            .ok_or("Reward owner account not found")?;
        instructions.push(
            CollectRewardV2 {
                whirlpool: position.whirlpool,
                position_authority: authority,
                position: position_address,
                position_token_account: position_token_account_address,
                reward_owner_account: *reward_owner,
                reward_vault: pool.reward_infos[i].vault,
                reward_mint: pool.reward_infos[i].mint,
                reward_token_program: reward_info.owner,
                memo_program: spl_memo::ID,
            }
            .instruction(CollectRewardV2InstructionArgs {
                reward_index: i as u8,
                remaining_accounts_info: None,
            }),
        );
    }

    match position_mint_info.owner {
        spl_token::ID => {
            instructions.push(
                ClosePosition {
                    position_authority: authority,
                    position: position_address,
                    position_token_account: position_token_account_address,
                    position_mint: position_mint_address,
                    receiver: authority,
                    token_program: spl_token::ID,
                }
                .instruction(),
            );
        }
        spl_token_2022::ID => {
            instructions.push(
                ClosePositionWithTokenExtensions {
                    position_authority: authority,
                    position: position_address,
                    position_token_account: position_token_account_address,
                    position_mint: position_mint_address,
                    receiver: authority,
                    token2022_program: spl_token_2022::ID,
                }
                .instruction(),
            );
        }
        _ => {
            return Err("Unsupported token program".into());
        }
    }

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(ClosePositionInstruction {
        instructions,
        additional_signers: token_accounts.additional_signers,
        quote,
        fees_quote,
        rewards_quote,
    })
}
