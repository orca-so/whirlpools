use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use anchor_spl::memo::Memo;

use crate::util::{parse_remaining_accounts, AccountsType, RemainingAccountsInfo};
use crate::{
    constants::transfer_memo,
    state::*,
    util::{v2::transfer_from_vault_to_owner_v2, verify_position_authority},
};

#[derive(Accounts)]
#[instruction(reward_index: u8)]
pub struct CollectRewardV2<'info> {
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    pub position_authority: Signer<'info>,

    #[account(mut, has_one = whirlpool)]
    pub position: Box<Account<'info, Position>>,
    #[account(
        constraint = position_token_account.mint == position.position_mint,
        constraint = position_token_account.amount == 1
    )]
    pub position_token_account: Box<Account<'info, token::TokenAccount>>,

    #[account(mut,
        constraint = reward_owner_account.mint == whirlpool.reward_infos[reward_index as usize].mint
    )]
    pub reward_owner_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = whirlpool.reward_infos[reward_index as usize].mint)]
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = whirlpool.reward_infos[reward_index as usize].vault)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = reward_mint.to_account_info().owner.clone())]
    pub reward_token_program: Interface<'info, TokenInterface>,
    pub memo_program: Program<'info, Memo>,

    // remaining accounts
    // - accounts for transfer hook program of reward_mint
}

/// Collects all harvestable tokens for a specified reward.
///
/// If the Whirlpool reward vault does not have enough tokens, the maximum number of available
/// tokens will be debited to the user. The unharvested amount remains tracked, and it can be
/// harvested in the future.
///
/// # Parameters
/// - `reward_index` - The reward to harvest. Acceptable values are 0, 1, and 2.
///
/// # Returns
/// - `Ok`: Reward tokens at the specified reward index have been successfully harvested
/// - `Err`: `RewardNotInitialized` if the specified reward has not been initialized
///          `InvalidRewardIndex` if the reward index is not 0, 1, or 2
pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CollectRewardV2<'info>>,
    reward_index: u8,
    remaining_accounts_info: Option<RemainingAccountsInfo>,
) -> Result<()> {
    let clock: Clock = Clock::get()?;

    verify_position_authority(
        &ctx.accounts.position_token_account,
        &ctx.accounts.position_authority,
    )?;

    // Process remaining accounts
    let remaining_accounts = parse_remaining_accounts(
        &ctx.remaining_accounts,
        &remaining_accounts_info,
        &[
            AccountsType::TransferHookReward,
        ],
    )?;

    let index = reward_index as usize;

    let position = &mut ctx.accounts.position;
    let (transfer_amount, updated_amount_owed) = calculate_collect_reward(
        position.reward_infos[index],
        ctx.accounts.reward_vault.amount,
    );

    position.update_reward_owed(index, updated_amount_owed);

    Ok(transfer_from_vault_to_owner_v2(
        &ctx.accounts.whirlpool,
        &ctx.accounts.reward_mint,
        &ctx.accounts.reward_vault,
        &ctx.accounts.reward_owner_account,
        &ctx.accounts.reward_token_program,
        &ctx.accounts.memo_program,
        &remaining_accounts.transfer_hook_reward,
        transfer_amount,
        transfer_memo::TRANSFER_MEMO_COLLECT_REWARD.as_bytes(),
        clock.epoch
        
    )?)
}

// TODO: refactor (remove (dup))
fn calculate_collect_reward(position_reward: PositionRewardInfo, vault_amount: u64) -> (u64, u64) {
    let amount_owed = position_reward.amount_owed;
    let (transfer_amount, updated_amount_owed) = if amount_owed > vault_amount {
        (vault_amount, amount_owed - vault_amount)
    } else {
        (amount_owed, 0)
    };

    (transfer_amount, updated_amount_owed)
}

#[cfg(test)]
mod unit_tests {
    use super::calculate_collect_reward;
    use crate::state::PositionRewardInfo;

    #[test]
    fn test_calculate_collect_reward_vault_insufficient_tokens() {
        let (transfer_amount, updated_amount_owed) =
            calculate_collect_reward(position_reward(10), 1);

        assert_eq!(transfer_amount, 1);
        assert_eq!(updated_amount_owed, 9);
    }

    #[test]
    fn test_calculate_collect_reward_vault_sufficient_tokens() {
        let (transfer_amount, updated_amount_owed) =
            calculate_collect_reward(position_reward(10), 10);

        assert_eq!(transfer_amount, 10);
        assert_eq!(updated_amount_owed, 0);
    }

    fn position_reward(amount_owed: u64) -> PositionRewardInfo {
        PositionRewardInfo {
            amount_owed,
            ..Default::default()
        }
    }
}
