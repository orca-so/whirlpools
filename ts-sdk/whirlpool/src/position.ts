import type { Position, PositionBundle } from "@orca-so/whirlpools-client";
import {
  fetchAllMaybePosition,
  fetchAllMaybePositionBundle,
  fetchAllPosition,
  getBundledPositionAddress,
  getPositionAddress,
  getPositionBundleAddress,
} from "@orca-so/whirlpools-client";
import { getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type {
  Account,
  Address,
  GetMultipleAccountsApi,
  GetTokenAccountsByOwnerApi,
  Rpc,
} from "@solana/web3.js";
import { getBase58Encoder } from "@solana/web3.js";

/**
 * Represents a Position Bundle account including its associated positions.
 */
export type HydratedPositionBundle = Account<PositionBundle> & {
  positions: Account<Position>[];
};

/**
 * Represents either a Position or Position Bundle account.
 */
export type PositionOrBundle = Account<Position> | HydratedPositionBundle;

/**
 * Represents a decoded Position or Position Bundle account.
 * Includes the token program address associated with the position.
 */
export type PositionData = PositionOrBundle & {
  /** The token program associated with the position (either TOKEN_PROGRAM_ADDRESS or TOKEN_2022_PROGRAM_ADDRESS). */
  tokenProgram: Address;
};

function getPositionInBundleAddresses(
  positionBundles: PositionBundle,
): Promise<Address>[] {
  const buffer = Buffer.from(positionBundles.positionBitmap);
  const positions: Promise<Address>[] = [];
  for (let i = 0; i < 256; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    if (buffer[byteIndex] & (1 << bitIndex)) {
      positions.push(
        getBundledPositionAddress(positionBundles.positionBundleMint, i).then(
          (x) => x[0],
        ),
      );
    }
  }
  return positions;
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

  const positionBundleAddresses = await Promise.all(
    potentialTokens.map((x) =>
      getPositionBundleAddress(x.mint).then((x) => x[0]),
    ),
  );

  // FIXME: need to batch if more than 100 position bundles?
  const [positions, positionBundles] = await Promise.all([
    fetchAllMaybePosition(rpc, positionAddresses),
    fetchAllMaybePositionBundle(rpc, positionBundleAddresses),
  ]);

  const bundledPositionAddresses = await Promise.all(
    positionBundles
      .filter((x) => x.exists)
      .flatMap((x) => getPositionInBundleAddresses(x.data)),
  );

  const bundledPositions = await fetchAllPosition(
    rpc,
    bundledPositionAddresses,
  );
  const bundledPositionMap = bundledPositions.reduce((acc, x) => {
    const current = acc.get(x.data.positionMint) ?? [];
    return acc.set(x.data.positionMint, [...current, x]);
  }, new Map<Address, Account<Position>[]>());

  const positionsOrBundles: PositionData[] = [];

  for (let i = 0; i < potentialTokens.length; i++) {
    const position = positions[i];
    const positionBundle = positionBundles[i];
    const token = potentialTokens[i];

    if (position.exists) {
      positionsOrBundles.push({
        ...position,
        tokenProgram: token.owner,
      });
    }

    // FIXME: Should this fetch positions inside the bundle?
    if (positionBundle.exists) {
      const positions =
        bundledPositionMap.get(positionBundle.data.positionBundleMint) ?? [];
      positionsOrBundles.push({
        ...positionBundle,
        positions,
        tokenProgram: token.owner,
      });
    }
  }

  return positionsOrBundles;
}
