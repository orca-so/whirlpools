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
import type {
  AdaptiveFeeVariablesData,
  CommitSwapV2Params,
  SwapQuote,
  SwapV2Params,
  WhirlpoolContext,
  WhirlpoolData,
} from "../../src";
import {
  AccountName,
  ParsableWhirlpool,
  PoolUtil,
  WhirlpoolIx,
} from "../../src";
import { TICK_ARRAY_SIZE, WHIRLPOOL_IDL, getAccountSize } from "../../src";
import { convertIdlToCamelCase } from "@coral-xyz/anchor/dist/cjs/idl";
import { TransactionBuilder } from "@orca-so/common-sdk";
import { getProviderWalletKeypair } from "./utils";
import { useMaxCU } from "./init-utils";

type HasHiddenPubkey = {
  _pubkey: PublicKey;
};

export type ReturnData = {
  programId: PublicKey;
  data: Buffer;
};

export class SimulatedTransactionAccessor {
  constructor(
    private simResult: RpcResponseAndContext<SimulatedTransactionResponse>,
  ) {}

  isSuccessful(): boolean {
    return this.simResult.value.err === null;
  }

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
      const accountPubkey = (account as unknown as HasHiddenPubkey)._pubkey;

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
    assert.equal(sim0Account.data.length, expectedDataLen);
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

export async function verifyPrepareAndCommitSwapV2Equivalence(
  ctx: WhirlpoolContext,
  params: CommitSwapV2Params & SwapV2Params,
  swapQuote: SwapQuote,
) {
  function newTransactionBuilder() {
    return new TransactionBuilder(ctx.connection, ctx.wallet).addInstruction(
      useMaxCU(),
    );
  }

  const pool = await ctx.fetcher.getPool(params.whirlpool);
  assert.ok(pool);
  const stateSequence = getWhirlpoolStateSequence(pool);

  const swapIx = WhirlpoolIx.swapV2Ix(ctx.program, params);
  const prepareIx = WhirlpoolIx.prepareSwapV2Ix(ctx.program, params);
  const commitIx = WhirlpoolIx.commitSwapV2Ix(ctx.program, params);

  const swapV2TransactionBuilder = newTransactionBuilder();
  swapV2TransactionBuilder.addInstructions([swapIx]);

  const prepareSwapTransactionBuilder = newTransactionBuilder();
  prepareSwapTransactionBuilder.addInstructions([prepareIx]);

  const prepareAndCommitSwapTransactionBuilder = newTransactionBuilder();
  prepareAndCommitSwapTransactionBuilder.addInstructions([prepareIx, commitIx]);

  // check prepareSwapV2
  const prepareSimResult = await simulateTransaction(
    ctx.provider,
    prepareSwapTransactionBuilder,
  );

  const prepareSwapV2ReturnData = parsePrepareSwapV2ReturnData(
    prepareSimResult.returnData().data,
  );
  assert.ok(
    !!prepareSwapV2ReturnData && "quoteSuccess" in prepareSwapV2ReturnData,
  );
  const onChainSwapQuote = prepareSwapV2ReturnData.quoteSuccess;
  if (params.amountSpecifiedIsInput) {
    assert.ok(onChainSwapQuote.amount.eq(swapQuote.estimatedAmountIn));
    assert.ok(onChainSwapQuote.otherAmount.eq(swapQuote.estimatedAmountOut));
  } else {
    assert.ok(onChainSwapQuote.amount.eq(swapQuote.estimatedAmountOut));
    assert.ok(onChainSwapQuote.otherAmount.eq(swapQuote.estimatedAmountIn));
  }

  assert.ok(onChainSwapQuote.nextSqrtPrice.eq(swapQuote.estimatedEndSqrtPrice));
  assert.ok(onChainSwapQuote.nextTickIndex === swapQuote.estimatedEndTickIndex);

  const preparedSwapData = parsePreparedSwap(
    prepareSimResult.postWritableAccount(params.preparedSwap),
  );
  assert.ok(!!preparedSwapData);
  assert.ok(preparedSwapData.version === PREPARED_SWAP_LAYOUT_VERSION);
  assert.ok(preparedSwapData.state === PREPARED_SWAP_STATE_PREPARED);
  assert.ok(
    preparedSwapData.precondition.slot.toNumber() === prepareSimResult.slot(),
  );
  assert.ok(
    preparedSwapData.precondition.authority.equals(
      ctx.provider.wallet.publicKey,
    ),
  );
  assert.ok(preparedSwapData.precondition.whirlpool.equals(params.whirlpool));
  assert.ok(
    preparedSwapData.precondition.whirlpoolStateSequence === stateSequence,
  );
  assert.ok(preparedSwapData.precondition.amount.eq(params.amount));
  assert.ok(
    preparedSwapData.precondition.sqrtPriceLimit.eq(params.sqrtPriceLimit),
  );
  assert.ok(
    preparedSwapData.precondition.amountSpecifiedIsInput ===
      params.amountSpecifiedIsInput,
  );
  assert.ok(preparedSwapData.precondition.aToB === params.aToB);

  // check commitSwapV2
  const prepareAndCommitSimResult = await simulateTransaction(
    ctx.provider,
    prepareAndCommitSwapTransactionBuilder,
  );
  const swapV2SimResult = await simulateTransaction(
    ctx.provider,
    swapV2TransactionBuilder,
  );

  assert.ok(prepareAndCommitSimResult.isSuccessful());
  assert.ok(swapV2SimResult.isSuccessful());

  const preparedSwapDataAfterCommit = parsePreparedSwap(
    prepareAndCommitSimResult.postWritableAccount(params.preparedSwap),
  );
  assert.ok(!!preparedSwapDataAfterCommit);
  assert.equal(
    preparedSwapDataAfterCommit.version,
    PREPARED_SWAP_LAYOUT_VERSION,
  );
  assert.equal(
    preparedSwapDataAfterCommit.state,
    PREPARED_SWAP_STATE_COMMITTED,
  );

  // vs. swapV2 account check
  // whirlpool
  const prepareCommitWhirlpoolAccount =
    prepareAndCommitSimResult.postWritableAccount(params.whirlpool)!;
  const whirlpoolData = ParsableWhirlpool.parse(
    params.whirlpool,
    prepareCommitWhirlpoolAccount,
  );
  assert.ok(!!whirlpoolData);
  assert.ok(whirlpoolData.sqrtPrice.eq(swapQuote.estimatedEndSqrtPrice));
  assert.equal(whirlpoolData.tickCurrentIndex, swapQuote.estimatedEndTickIndex);
  assert.equal(getWhirlpoolStateSequence(whirlpoolData), stateSequence + 1);
  assertPostWritableAccountMatch(
    prepareAndCommitSimResult,
    swapV2SimResult,
    params.whirlpool,
    getAccountSize(AccountName.Whirlpool),
  );

  // tickarray
  const tickArrays = [
    swapQuote.tickArray0,
    swapQuote.tickArray1,
    swapQuote.tickArray2,
  ];
  for (const tickArray of tickArrays) {
    const tickArrayAccountInfo = await ctx.connection.getAccountInfo(tickArray);
    if (!tickArrayAccountInfo) continue;

    assert.ok(tickArrayAccountInfo.data.length > 0);
    assertPostWritableAccountMatch(
      prepareAndCommitSimResult,
      swapV2SimResult,
      tickArray,
      tickArrayAccountInfo.data.length,
    );
  }

  // oracle
  if (PoolUtil.isInitializedWithAdaptiveFee(whirlpoolData)) {
    assertPostWritableAccountMatch(
      prepareAndCommitSimResult,
      swapV2SimResult,
      params.oracle,
      getAccountSize(AccountName.Oracle),
    );
  }

  // token accounts
  const tokenAccounts = [
    params.tokenOwnerAccountA,
    params.tokenOwnerAccountB,
    pool.tokenVaultA,
    pool.tokenVaultB,
  ];
  for (const tokenAccount of tokenAccounts) {
    const tokenAccountAccountInfo =
      await ctx.connection.getAccountInfo(tokenAccount);
    if (!tokenAccountAccountInfo) continue;

    assert.ok(tokenAccountAccountInfo.data.length > 0);

    assertPostWritableAccountMatch(
      prepareAndCommitSimResult,
      swapV2SimResult,
      tokenAccount,
      tokenAccountAccountInfo.data.length,
    );
  }
}
