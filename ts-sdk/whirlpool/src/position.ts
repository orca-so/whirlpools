import type { Position, PositionBundle } from "@orca-so/whirlpools-client";
import {
  getPositionAddress,
  getPositionBundleDecoder,
  getPositionDecoder,
  WHIRLPOOL_PROGRAM_ADDRESS,
} from "@orca-so/whirlpools-client";
import { getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type {
  Account,
  AccountInfoWithBase64EncodedData,
  Address,
  GetMultipleAccountsApi,
  GetTokenAccountsByOwnerApi,
  Rpc,
} from "@solana/web3.js";
import { getBase58Encoder, getBase64Encoder } from "@solana/web3.js";

/**
 * Represents either a Position or Position Bundle account.
 */
export type PositionOrBundle = Account<Position | PositionBundle>;

/**
 * Represents a decoded Position or Position Bundle account.
 * Includes the token program address associated with the position.
 */
export type PositionData = PositionOrBundle & {
  /** The token program associated with the position (either TOKEN_PROGRAM_ADDRESS or TOKEN_2022_PROGRAM_ADDRESS). */
  tokenProgram: Address;
};

function decodePositionOrBundle(
  account: AccountInfoWithBase64EncodedData,
): Position | PositionBundle {
  const data = getBase64Encoder().encode(account.data[0]);

  try {
    return getPositionDecoder().decode(data);
  } catch {}

  try {
    return getPositionBundleDecoder().decode(data);
  } catch {}

  throw new Error("Could not decode position or bundle dat");
}

/**
 * Fetches all positions owned by a given wallet in the Orca Whirlpools.
 * It looks for token accounts owned by the wallet using both the TOKEN_PROGRAM_ADDRESS and TOKEN_2022_PROGRAM_ADDRESS.
 * For token accounts holding exactly 1 token (indicating a position or bundle), it fetches the corresponding position addresses,
 * decodes the accounts, and returns an array of position or bundle data.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client used to fetch token accounts and multiple accounts.
 * @param {Address} owner - The wallet address whose positions you want to fetch.
 * @returns {Promise<PositionData[]>} - A promise that resolves to an array of decoded position data for the given owner.
 *
 * @example
 * import { fetchPositions } from '@orca-so/whirlpools';
 * import { generateKeyPairSigner, createSolanaRpc, devnet } from '@solana/web3.js';
 * 
 * const devnetRpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
 * const wallet = await generateKeyPairSigner();
 * await devnetRpc.requestAirdrop(wallet.address, lamports(1000000000n)).send();
 * 
 * const positions = await fetchPositions(devnetRpc, wallet.address);
 */
export async function fetchPositions(
  rpc: Rpc<GetTokenAccountsByOwnerApi & GetMultipleAccountsApi>,
  owner: Address,
): Promise<PositionData[]> {
  const [tokenAccounts, token2022Accounts] = await Promise.all([
    rpc
      .getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ADDRESS })
      .send(),
    rpc
      .getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ADDRESS })
      .send(),
  ]);

  const encoder = getBase58Encoder();
  const decoder = getTokenDecoder();

  const potentialTokens = [...tokenAccounts.value, ...token2022Accounts.value]
    .map((x) => ({
      ...decoder.decode(encoder.encode(x.account.data)),
      owner: x.account.owner,
    }))
    .filter((x) => x.amount === 1n);

  const positionAddresses = await Promise.all(
    potentialTokens.map((x) => getPositionAddress(x.mint).then((x) => x[0])),
  );

  // FIXME: need to batch if more than 100 positions?
  const positionOrBundleAccounts = await rpc
    .getMultipleAccounts(positionAddresses)
    .send();

  const positionOrBundles: PositionData[] = [];

  for (let i = 0; i < positionOrBundleAccounts.value.length; i++) {
    const positionAddress = positionAddresses[i];
    const positionData = positionOrBundleAccounts.value[i];
    if (positionData == null) {
      continue;
    }
    const positionOrBundle = decodePositionOrBundle(positionData);
    const token = potentialTokens[i];

    if (positionOrBundle == null) {
      continue;
    }

    positionOrBundles.push({
      ...positionData,
      address: positionAddress,
      data: positionOrBundle,
      programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
      tokenProgram: token.owner,
    });
  }

  return positionOrBundles;
}
