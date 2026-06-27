import * as anchor from "@coral-xyz/anchor";
import * as assert from "assert";
import type {
  AccountInfo,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  VersionedTransaction,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type { AdaptiveFeeVariablesData, WhirlpoolData } from "../../src";
import { AccountName } from "../../src";
import { TICK_ARRAY_SIZE, WHIRLPOOL_IDL } from "../../src";
import { convertIdlToCamelCase } from "@coral-xyz/anchor/dist/cjs/idl";
import type { TransactionBuilder } from "@orca-so/common-sdk";
import { getProviderWalletKeypair } from "./utils";

export type ReturnData = {
  programId: PublicKey;
  data: Buffer;
};
export class SimulatedTransactionAccessor {
  constructor(
    private simResult: RpcResponseAndContext<SimulatedTransactionResponse>,
  ) {}

  slot(): number {
    return this.simResult.context.slot;
  }

  unitsConsumed(): number {
    return this.simResult.value.unitsConsumed!;
  }

  returnData(): ReturnData {
    const programId = new PublicKey(this.simResult.value.returnData!.programId);
    const data = Buffer.from(
      this.simResult.value.returnData!.data[0],
      "base64",
    );
    return { programId, data };
  }

  postWritableAccount(pubkey: PublicKey): AccountInfo<Buffer> | null {
    for (let account of this.simResult.value.accounts!) {
      // HACK: liteSVM based simulation only
      const accountPubkey = (account as any)["_pubkey"] as PublicKey;

      if (pubkey.equals(accountPubkey)) {
        return {
          executable: account!.executable,
          lamports: account!.lamports,
          owner: new PublicKey(account!.owner),
          data: Buffer.from(account!.data[0], "base64"),
        };
      }
    }
    return null;
  }
}

export function assertPostWritableAccountMatch(
  sim0: SimulatedTransactionAccessor,
  sim1: SimulatedTransactionAccessor,
  pubkey: PublicKey,
  expectedDataLen?: number,
) {
  const sim0Account = sim0.postWritableAccount(pubkey);
  const sim1Account = sim1.postWritableAccount(pubkey);
  assert.ok(!!sim0Account && !!sim1Account);

  if (expectedDataLen !== undefined) {
    assert.ok(sim0Account.data.length === expectedDataLen);
  }
  assert.ok(sim0Account.data.equals(sim1Account.data));
}

const WhirlpoolCoder = new anchor.BorshCoder(
  convertIdlToCamelCase(WHIRLPOOL_IDL),
);

function parseAnchorAccount(
  accountName: AccountName,
  accountData: AccountInfo<Buffer>,
) {
  const data = accountData.data;
  const discriminator =
    WhirlpoolCoder.accounts.accountDiscriminator(accountName);
  if (discriminator.compare(data.subarray(0, 8))) {
    console.error("incorrect account name during parsing");
    return null;
  }

  try {
    return WhirlpoolCoder.accounts.decode(accountName, data);
  } catch (_e) {
    console.error("unknown account name during parsing");
    return null;
  }
}

export const PREPARED_SWAP_LAYOUT_VERSION = 1;
export const PREPARED_SWAP_STATE_UNPREPARED = 0;
export const PREPARED_SWAP_STATE_PREPARED = 1;
export const PREPARED_SWAP_STATE_COMMITTED = 2;
export const MAX_PENDING_TICK_UPDATES_LEN = TICK_ARRAY_SIZE * 3;

export type InternalPreparedSwapData = {
  version: number;
  state: number;
  precondition: {
    slot: BN;
    authority: PublicKey;
    whirlpool: PublicKey;
    whirlpoolStateSequence: number;
    amount: BN;
    sqrtPriceLimit: BN;
    amountSpecifiedIsInput: boolean;
    aToB: boolean;
  };
  pendingUpdates: {
    pendingPostSwapUpdate: {
      amountA: BN;
      amountB: BN;
      lpFee: BN;
      nextLiquidity: BN;
      nextTickIndex: number;
      nextSqrtPrice: BN;
      nextFeeGrowthGlobal: BN;
      nextRewardGrowthGlobal: [BN, BN, BN];
      nextProtocolFee: BN;
      nextAdaptiveFeeVariablesIsSome: boolean;
      nextAdaptiveFeeVariables: AdaptiveFeeVariablesData;
    };
    pendingTickUpdatesLen: number;
    pendingTickUpdates: {
      arrayIndex: number;
      tickIndex: number;
      nextFeeGrowthOutsideA: BN;
      nextFeeGrowthOutsideB: BN;
    }[];
  };
};

export function parsePreparedSwap(
  accountData: AccountInfo<Buffer> | undefined | null,
): InternalPreparedSwapData | null {
  if (!accountData?.data) {
    return null;
  }

  try {
    return parseAnchorAccount(AccountName.PreparedSwap, accountData);
  } catch (e) {
    console.error(`error while parsing PreparedSwap: ${e}`);
    return null;
  }
}

export type PrepareSwapV2ReturnData =
  | PrepareSwapV2ReturnDataQuoteSuccess
  | PrepareSwapV2ReturnDataQuoteError;
export type PrepareSwapV2ReturnDataQuoteSuccess = {
  quoteSuccess: {
    amount: BN;
    otherAmount: BN;
    nextSqrtPrice: BN;
    nextTickIndex: number;
  };
};
export type PrepareSwapV2ReturnDataQuoteError = {
  quoteError: {
    errorCode: BN;
  };
};

export function parsePrepareSwapV2ReturnData(
  returnData: Buffer,
): PrepareSwapV2ReturnData | null {
  try {
    return WhirlpoolCoder.types.decode("prepareSwapV2ReturnData", returnData);
  } catch (e) {
    console.error("failed during parsing:", e);
    return null;
  }
}

export function getWhirlpoolStateSequence(
  whirlpoolData: WhirlpoolData,
): number {
  const extension = whirlpoolData.rewardInfos[1].extension;
  return new BN(extension.slice(2, 6), "le").toNumber();
}

export async function simulateTransaction(
  provider: anchor.AnchorProvider,
  tb: TransactionBuilder,
) {
  const tx = await tb.build();
  const vtx = tx.transaction as VersionedTransaction;
  vtx.sign([getProviderWalletKeypair(provider)]);
  return new SimulatedTransactionAccessor(
    await provider.connection.simulateTransaction(vtx),
  );
}
