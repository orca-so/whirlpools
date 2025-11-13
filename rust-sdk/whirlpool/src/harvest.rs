use std::{
    collections::HashSet,
    error::Error,
    time::{SystemTime, UNIX_EPOCH},
};

use orca_whirlpools_client::{
    get_position_address, get_tick_array_address, FixedTickArray, Position, TickArray, Whirlpool,
};
use orca_whirlpools_client::{
    CollectFeesV2, CollectFeesV2InstructionArgs, CollectRewardV2, CollectRewardV2InstructionArgs,
    UpdateFeesAndRewards,
};
use orca_whirlpools_core::{
    collect_fees_quote, collect_rewards_quote, get_tick_array_start_tick_index,
    get_tick_index_in_array, CollectFeesQuote, CollectRewardsQuote,
};
use solana_account::Account;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use spl_associated_token_account_interface::address::get_associated_token_address_with_program_id;

use crate::{
    token::{get_current_transfer_fee, prepare_token_accounts_instructions, TokenAccountStrategy},
    FUNDER,
};

// TODO: support transfer hooks

/// Represents the instructions and quotes for harvesting a position.
///
/// This struct contains the instructions required to harvest a position, along with detailed
/// information about the available fees and rewards to collect.
#[derive(Debug)]
pub struct HarvestPositionInstruction {
    /// A vector of `Instruction` objects required to execute the harvesting process.
    pub instructions: Vec<Instruction>,

    /// A vector of `Keypair` objects representing additional signers required for the instructions.
    pub additional_signers: Vec<Keypair>,

    /// Details of the fees available to collect from the position:
    /// - `fee_owed_a` - The amount of fees available to collect in token A.
    /// - `fee_owed_b` - The amount of fees available to collect in token B.
    pub fees_quote: CollectFeesQuote,

    /// Details of the rewards available to collect from the position:
    /// - `rewards` - An array containing up to three `CollectRewardQuote` entries, one for each reward token.
    ///   - Each entry includes `rewards_owed`, the amount of the respective reward token available to collect.
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
/// use orca_whirlpools::{
///     harvest_position_instructions, set_whirlpools_config_address, WhirlpoolsConfigInput,
/// };
/// use solana_client::nonblocking::rpc_client::RpcClient;
/// use solana_pubkey::Pubkey;
/// use std::str::FromStr;
/// use crate::utils::load_wallet;
///
/// #[tokio::main]
/// async fn main() {
///     set_whirlpools_config_address(WhirlpoolsConfigInput::SolanaDevnet).unwrap();
///     let rpc = RpcClient::new("https://api.devnet.solana.com".to_string());
///     let wallet = load_wallet();
///
///     let position_mint_address =
///         Pubkey::from_str("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K").unwrap();
///
///     let result = harvest_position_instructions(&rpc, position_mint_address, Some(wallet.pubkey()))
///         .await
///         .unwrap();
///
///     println!("Fees Quote: {:?}", result.fees_quote);
///     println!("Rewards Quote: {:?}", result.rewards_quote);
///     println!("Number of Instructions: {}", result.instructions.len());
/// }
/// ```
pub async fn harvest_position_instructions(
    rpc: &RpcClient,
    position_mint_address: Pubkey,
    authority: Option<Pubkey>,
) -> Result<HarvestPositionInstruction, Box<dyn Error>> {
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
    let lower_tick_array: FixedTickArray =
        TickArray::from_bytes(&lower_tick_array_info.data)?.into();
    let lower_tick = &lower_tick_array.ticks[get_tick_index_in_array(
        position.tick_lower_index,
        lower_tick_array_start_index,
        pool.tick_spacing,
    )? as usize];

    let upper_tick_array_info = tick_array_infos[1]
        .as_ref()
        .ok_or("Upper tick array info not found")?;
    let upper_tick_array: FixedTickArray =
        TickArray::from_bytes(&upper_tick_array_info.data)?.into();
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

    if fees_quote.fee_owed_a > 0 || fees_quote.fee_owed_b > 0 {
        required_mints.insert(TokenAccountStrategy::WithoutBalance(pool.token_mint_a));
        required_mints.insert(TokenAccountStrategy::WithoutBalance(pool.token_mint_b));
    }

    for (i, _) in reward_infos.iter().enumerate().take(3) {
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
                memo_program: spl_memo_interface::v3::ID,
            }
            .instruction(CollectFeesV2InstructionArgs {
                remaining_accounts_info: None,
            }),
        );
    }

    for (i, _) in reward_infos.iter().enumerate().take(3) {
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
                memo_program: spl_memo_interface::v3::ID,
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::error::Error;

    use orca_whirlpools_client::{get_position_address, Position};
    use serial_test::serial;
    use solana_client::nonblocking::rpc_client::RpcClient;
    use solana_keypair::{Keypair, Signer};
    use solana_program_pack::Pack;
    use solana_program_test::tokio;
    use solana_pubkey::Pubkey;
    use spl_token_2022_interface::{
        extension::StateWithExtensionsOwned, state::Account as TokenAccount2022,
        ID as TOKEN_2022_PROGRAM_ID,
    };
    use spl_token_interface::state::Account as TokenAccount;

    use rstest::rstest;

    use crate::{
        harvest_position_instructions, increase_liquidity_instructions, swap_instructions,
        tests::{
            setup_ata_te, setup_ata_with_amount, setup_mint_te, setup_mint_te_fee,
            setup_mint_with_decimals, setup_position, setup_whirlpool, RpcContext, SetupAtaConfig,
        },
        HarvestPositionInstruction, IncreaseLiquidityParam, SwapType,
    };

    async fn fetch_position(
        rpc: &solana_client::nonblocking::rpc_client::RpcClient,
        position_pubkey: Pubkey,
    ) -> Result<Position, Box<dyn Error>> {
        let account = rpc.get_account(&position_pubkey).await?;
        Ok(Position::from_bytes(&account.data)?)
    }

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

    async fn verify_harvest_position(
        ctx: &RpcContext,
        harvest_ix: &HarvestPositionInstruction,
        ata_a: Pubkey,
        ata_b: Pubkey,

        position_mint: Pubkey,
    ) -> Result<(), Box<dyn Error>> {
        let before_a = get_token_balance(&ctx.rpc, ata_a).await?;
        let before_b = get_token_balance(&ctx.rpc, ata_b).await?;

        let signers: Vec<&Keypair> = harvest_ix.additional_signers.iter().collect();
        ctx.send_transaction_with_signers(harvest_ix.instructions.clone(), signers)
            .await?;

        let after_a = get_token_balance(&ctx.rpc, ata_a).await?;
        let after_b = get_token_balance(&ctx.rpc, ata_b).await?;
        let gained_a = after_a.saturating_sub(before_a);
        let gained_b = after_b.saturating_sub(before_b);

        let fees_quote = &harvest_ix.fees_quote;
        assert!(
            gained_a >= fees_quote.fee_owed_a,
            "Less token A than expected from harvest. got={}, expected={}",
            gained_a,
            fees_quote.fee_owed_a
        );
        assert!(
            gained_b >= fees_quote.fee_owed_b,
            "Less token B than expected from harvest. got={}, expected={}",
            gained_b,
            fees_quote.fee_owed_b
        );

        let position_pubkey = get_position_address(&position_mint)?.0;
        let _position_data = fetch_position(&ctx.rpc, position_pubkey).await?;

        Ok(())
    }

    async fn setup_all_mints(
        ctx: &RpcContext,
    ) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let mint_a = setup_mint_with_decimals(ctx, 9).await?;
        let mint_b = setup_mint_with_decimals(ctx, 9).await?;
        let mint_te_a = setup_mint_te(ctx, &[]).await?;
        let mint_te_b = setup_mint_te(ctx, &[]).await?;
        let mint_te_fee = setup_mint_te_fee(ctx).await?;

        let mut out = HashMap::new();
        out.insert("A", mint_a);
        out.insert("B", mint_b);
        out.insert("TEA", mint_te_a);
        out.insert("TEB", mint_te_b);
        out.insert("TEFee", mint_te_fee);

        Ok(out)
    }

    async fn setup_all_atas(
        ctx: &RpcContext,
        minted: &HashMap<&str, Pubkey>,
    ) -> Result<HashMap<&'static str, Pubkey>, Box<dyn Error>> {
        let token_balance = 1_000_000_000;
        let user_ata_a =
            setup_ata_with_amount(ctx, *minted.get("A").unwrap(), token_balance).await?;
        let user_ata_b =
            setup_ata_with_amount(ctx, *minted.get("B").unwrap(), token_balance).await?;
        let user_ata_te_a = setup_ata_te(
            ctx,
            *minted.get("TEA").unwrap(),
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;
        let user_ata_te_b = setup_ata_te(
            ctx,
            *minted.get("TEB").unwrap(),
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;
        let user_ata_tefee = setup_ata_te(
            ctx,
            *minted.get("TEFee").unwrap(),
            Some(SetupAtaConfig {
                amount: Some(token_balance),
            }),
        )
        .await?;

        let mut out = HashMap::new();
        out.insert("A", user_ata_a);
        out.insert("B", user_ata_b);
        out.insert("TEA", user_ata_te_a);
        out.insert("TEB", user_ata_te_b);
        out.insert("TEFee", user_ata_tefee);

        Ok(out)
    }

    pub fn parse_pool_name(pool_name: &str) -> (&'static str, &'static str) {
        match pool_name {
            "A-B" => ("A", "B"),
            "A-TEA" => ("A", "TEA"),
            "TEA-TEB" => ("TEA", "TEB"),
            "A-TEFee" => ("A", "TEFee"),

            _ => panic!("Unknown pool name: {}", pool_name),
        }
    }

    #[rstest]
    #[case("A-B", "equally centered", -100, 100)]
    #[case("A-B", "one sided A", -100, -1)]
    #[case("A-B", "one sided B", 1, 100)]
    #[case("A-TEA", "equally centered", -100, 100)]
    #[case("A-TEA", "one sided A", -100, -1)]
    #[case("TEA-TEB", "equally centered", -100, 100)]
    #[case("TEA-TEB", "one sided A", -100, -1)]
    #[case("A-TEFee", "equally centered", -100, 100)]
    #[case("A-TEFee", "one sided A", -100, -1)]
    #[serial]
    fn test_harvest_position_with_swap(
        #[case] pool_name: &str,
        #[case] position_name: &str,
        #[case] lower_tick: i32,
        #[case] upper_tick: i32,
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let ctx = RpcContext::new().await;

            let minted = setup_all_mints(&ctx).await.unwrap();
            let user_atas = setup_all_atas(&ctx, &minted).await.unwrap();

            let (mint_a_key, mint_b_key) = parse_pool_name(pool_name);
            let _pubkey_a = minted.get(mint_a_key).unwrap();
            let _pubkey_b = minted.get(mint_b_key).unwrap();
            let (mint_a_key, mint_b_key) = parse_pool_name(pool_name);
            let pubkey_a = *minted.get(mint_a_key).unwrap();
            let pubkey_b = *minted.get(mint_b_key).unwrap();

            let swapped = pubkey_a > pubkey_b;

            let (final_a, final_b) = if pubkey_a < pubkey_b {
                (pubkey_a, pubkey_b)
            } else {
                (pubkey_b, pubkey_a)
            };

            let tick_spacing = 64;
            let pool_pubkey = setup_whirlpool(&ctx, final_a, final_b, tick_spacing)
                .await
                .unwrap();

            let position_mint =
                setup_position(&ctx, pool_pubkey, Some((lower_tick, upper_tick)), None)
                    .await
                    .unwrap();

            let inc_liq_ix = increase_liquidity_instructions(
                &ctx.rpc,
                position_mint,
                IncreaseLiquidityParam::Liquidity(50_000),
                Some(100),
                Some(ctx.signer.pubkey()),
            )
            .await
            .unwrap();
            // send
            ctx.send_transaction_with_signers(inc_liq_ix.instructions, vec![])
                .await
                .unwrap();

            let do_b_to_a = position_name.contains("one sided B");
            let swap_input_mint = if do_b_to_a { pubkey_b } else { pubkey_a };

            let swap_ix = swap_instructions(
                &ctx.rpc,
                pool_pubkey,
                10,
                swap_input_mint,
                SwapType::ExactIn,
                Some(100), // 1% slippage
                Some(ctx.signer.pubkey()),
            )
            .await
            .unwrap();
            ctx.send_transaction_with_signers(
                swap_ix.instructions,
                swap_ix.additional_signers.iter().collect(),
            )
            .await
            .unwrap();

            let harvest_ix =
                harvest_position_instructions(&ctx.rpc, position_mint, Some(ctx.signer.pubkey()))
                    .await
                    .unwrap();

            let ata_a = if swapped {
                user_atas.get(mint_b_key).unwrap()
            } else {
                user_atas.get(mint_a_key).unwrap()
            };
            let ata_b = if swapped {
                user_atas.get(mint_a_key).unwrap()
            } else {
                user_atas.get(mint_b_key).unwrap()
            };

            verify_harvest_position(&ctx, &harvest_ix, *ata_a, *ata_b, position_mint)
                .await
                .unwrap();
        });
    }
}
