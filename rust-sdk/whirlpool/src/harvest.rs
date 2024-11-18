use std::{
    error::Error,
    time::{SystemTime, UNIX_EPOCH},
};

use orca_whirlpools_client::{
    get_position_address, get_tick_array_address, Position, TickArray, Whirlpool,
};
use orca_whirlpools_client::{
    CollectFeesV2, CollectFeesV2InstructionArgs, CollectRewardV2, CollectRewardV2InstructionArgs,
    UpdateFeesAndRewards,
};
use orca_whirlpools_core::{
    collect_fees_quote, collect_rewards_quote, get_tick_array_start_tick_index,
    get_tick_index_in_array, CollectFeesQuote, CollectRewardsQuote,
};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{account::Account, instruction::Instruction, pubkey::Pubkey, signature::Keypair};
use spl_associated_token_account::get_associated_token_address_with_program_id;

use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER,
};

// TODO: support transfer hooks

/// Represents the instructions and quotes for harvesting a position.
///
/// This struct contains the instructions required to harvest a position, along with detailed
/// information about the available fees and rewards to collect.
///
/// # Fields
///
/// * `instructions` - A vector of `Instruction` objects required to execute the harvesting process.
/// * `additional_signers` - A vector of `Keypair` objects representing additional signers required for the instructions.
/// * `fees_quote` - Details of the fees available to collect from the position:
///   - `fee_owed_a` - The amount of fees available to collect in token A.
///   - `fee_owed_b` - The amount of fees available to collect in token B.
/// * `rewards_quote` - Details of the rewards available to collect from the position:
///   - `rewards` - An array containing up to three `CollectRewardQuote` entries, one for each reward token.
///     - Each entry includes `rewards_owed`, the amount of the respective reward token available to collect.
#[derive(Debug)]
pub struct HarvestPositionInstruction {
    pub instructions: Vec<Instruction>,
    pub additional_signers: Vec<Keypair>,
    pub fees_quote: CollectFeesQuote,
    pub rewards_quote: CollectRewardsQuote,
}

/// Generates instructions to harvest a position.
///
/// Harvesting a position involves collecting any accumulated fees and rewards
/// from the position. The position remains open, and liquidity is not removed.
///
/// # Arguments
///
/// * `rpc` - A reference to a Solana RPC client for fetching accounts and pool data.
/// * `position_mint_address` - The public key of the NFT mint address representing the pool position.
/// * `authority` - An optional public key of the account authorizing the harvesting process. Defaults to the global funder if not provided.
///
/// # Returns
///
/// A `Result` containing `HarvestPositionInstruction` on success:
///
/// * `fees_quote` - A breakdown of the fees owed to the position owner, including the amounts for Token A and Token B.
/// * `rewards_quote` - A breakdown of the rewards owed, including up to three reward tokens.
/// * `instructions` - A vector of `Instruction` objects required to execute the harvesting process.
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
/// use solana_sdk::{pubkey::Pubkey, signer::{keypair::Keypair, Signer}};
/// use orca_whirlpools_sdk::{
///     harvest_position_instructions, WhirlpoolsConfigInput, set_whirlpools_config_address
/// };
///
/// set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
/// let rpc = RpcClient::new("https://api.devnet.solana.com");
///
/// let position_mint_address = Pubkey::from_str("POSITION_NFT_MINT_PUBKEY").unwrap();;
///
/// let result = harvest_position_instructions(
///     &rpc,
///     position_mint_address,
///     None, // USE GLOBAL FUNDER
/// ).unwrap();
///
/// println!("Fees Quote: {:?}", result.fees_quote);
/// println!("Rewards Quote: {:?}", result.rewards_quote);
/// println!("Number of Instructions: {}", result.instructions.len());
/// ```
pub fn harvest_position_instructions(
    rpc: &RpcClient,
    position_mint_address: Pubkey,
    authority: Option<Pubkey>,
) -> Result<HarvestPositionInstruction, Box<dyn Error>> {
    let authority = authority.unwrap_or(*FUNDER.try_lock()?);
    if authority == Pubkey::default() {
        return Err("Authority must be provided".into());
    }

    let position_address = get_position_address(&position_mint_address)?.0;
    let position_info = rpc.get_account(&position_address)?;
    let position = Position::from_bytes(&position_info.data)?;

    let pool_info = rpc.get_account(&position.whirlpool)?;
    let pool = Whirlpool::from_bytes(&pool_info.data)?;

    let mint_infos = rpc.get_multiple_accounts(&[
        pool.token_mint_a,
        pool.token_mint_b,
        position_mint_address,
        pool.reward_infos[0].mint,
        pool.reward_infos[1].mint,
        pool.reward_infos[2].mint,
    ])?;

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

    let current_epoch = rpc.get_epoch_info()?.epoch;
    let transfer_fee_a = get_current_transfer_fee(Some(mint_a_info), current_epoch);
    let transfer_fee_b = get_current_transfer_fee(Some(mint_b_info), current_epoch);

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

    let tick_array_infos =
        rpc.get_multiple_accounts(&[lower_tick_array_address, upper_tick_array_address])?;

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

    let mut required_mints: Vec<TokenAccountStrategy> = Vec::new();

    if fees_quote.fee_owed_a > 0 || fees_quote.fee_owed_b > 0 {
        required_mints.push(TokenAccountStrategy::WithoutBalance(pool.token_mint_a));
        required_mints.push(TokenAccountStrategy::WithoutBalance(pool.token_mint_b));
    }

    for i in 0..3 {
        if rewards_quote.rewards[i].rewards_owed > 0 {
            required_mints.push(TokenAccountStrategy::WithoutBalance(
                pool.reward_infos[i].mint,
            ));
        }
    }

    let token_accounts = prepare_token_accounts_instructions(rpc, authority, required_mints)?;

    let mut instructions: Vec<Instruction> = Vec::new();
    instructions.extend(token_accounts.create_instructions);

    if position.liquidity > 0 {
        instructions.push(
            UpdateFeesAndRewards {
                whirlpool: position.whirlpool,
                position: position_address,
                tick_array_lower: lower_tick_array_address,
                tick_array_upper: upper_tick_array_address,
            }
            .instruction(),
        );
    }

    if fees_quote.fee_owed_a > 0 || fees_quote.fee_owed_b > 0 {
        let token_owner_account_a = token_accounts
            .token_account_addresses
            .get(&pool.token_mint_a)
            .ok_or("Token A owner account not found")?;
        let token_owner_account_b = token_accounts
            .token_account_addresses
            .get(&pool.token_mint_b)
            .ok_or("Token B owner account not found")?;

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

    instructions.extend(token_accounts.cleanup_instructions);

    Ok(HarvestPositionInstruction {
        instructions,
        additional_signers: token_accounts.additional_signers,
        fees_quote,
        rewards_quote,
    })
}
