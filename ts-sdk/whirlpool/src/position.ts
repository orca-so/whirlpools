import type { Position, PositionBundle} from "@orca-so/whirlpools-client";
import { getPositionAddress, getPositionBundleDecoder, getPositionDecoder, WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client";
import { getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type { Account, AccountInfoWithBase64EncodedData, Address, GetMultipleAccountsApi, GetTokenAccountsByOwnerApi, Rpc } from "@solana/web3.js";
import { getBase58Encoder, getBase64Encoder } from "@solana/web3.js";

type PositionOrBundle = Account<Position | PositionBundle>;
type PositionData = PositionOrBundle & {
  tokenProgram: Address;
}

function decodePositionOrBundle(account: AccountInfoWithBase64EncodedData): Position | PositionBundle {
  const data = getBase64Encoder().encode(account.data[0]);

  try {
    return getPositionDecoder().decode(data);
  } catch { }

  try {
    return getPositionBundleDecoder().decode(data);
  } catch { }

  throw new Error("Could not decode position or bundle dat");
}

export async function fetchPositions(rpc: Rpc<GetTokenAccountsByOwnerApi & GetMultipleAccountsApi>, owner: Address): Promise<PositionData[]> {
  const [
    tokenAccounts,
    token2022Accounts,
  ] = await Promise.all([
    rpc.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ADDRESS }).send(),
    rpc.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ADDRESS }).send(),
  ]);

  const encoder = getBase58Encoder();
  const decoder = getTokenDecoder();

  const potentialTokens = [...tokenAccounts.value, ...token2022Accounts.value]
    .map(x => ({
      ...decoder.decode(encoder.encode(x.account.data)),
      owner: x.account.owner,
    }))
    .filter(x => x.amount === 1n);

  const positionAddresses = await Promise.all(
    potentialTokens.map(x => getPositionAddress(x.mint).then(x => x[0]))
  );

  // FIXME: need to batch if more than 100 positions?
  const positionOrBundleAccounts = await rpc.getMultipleAccounts(positionAddresses).send();

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
