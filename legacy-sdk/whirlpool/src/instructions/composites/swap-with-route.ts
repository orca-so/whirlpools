import type {
  Percentage,
  ResolvedTokenAddressInstruction,
} from "@orca-so/common-sdk";
import {
  AddressUtil,
  EMPTY_INSTRUCTION,
  TokenUtil,
  TransactionBuilder,
  ZERO,
} from "@orca-so/common-sdk";
import type { Account } from "@solana/spl-token";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type {
  AtaAccountInfo,
  SubTradeRoute,
  TradeRoute,
  WhirlpoolContext,
} from "../..";
import { PDAUtil, SwapUtils, twoHopSwapQuoteFromSwapQuotes } from "../..";
import type { WhirlpoolAccountFetchOptions } from "../../network/public/fetcher";
import { PREFER_CACHE } from "../../network/public/fetcher";
import { adjustForSlippage } from "../../utils/position-util";
import { contextOptionsToBuilderOptions } from "../../utils/txn-utils";
import { swapIx } from "../swap-ix";
import { twoHopSwapIx } from "../two-hop-swap-ix";

export type SwapFromRouteParams = {
  route: TradeRoute;
  slippage: Percentage;
  wallet: PublicKey;
  resolvedAtaAccounts: AtaAccountInfo[] | null;
};

export async function getSwapFromRoute(
  ctx: WhirlpoolContext,
  params: SwapFromRouteParams,
  opts: WhirlpoolAccountFetchOptions = PREFER_CACHE,
  txBuilder: TransactionBuilder = new TransactionBuilder(
    ctx.connection,
    ctx.wallet,
    contextOptionsToBuilderOptions(ctx.opts),
  ),
) {
  const { route, wallet, resolvedAtaAccounts, slippage } = params;
  const requiredAtas = new Set<string>();
  const requiredIntermediateAtas = new Set<string>();
  const requiredTickArrays = [];
  let hasNativeMint = false;
  let nativeMintAmount = new BN(0);

  function addOrNative(mint: string, amount: BN) {
    if (mint === NATIVE_MINT.toBase58()) {
      hasNativeMint = true;
      nativeMintAmount = nativeMintAmount.add(amount);
    } else {
      requiredAtas.add(mint);
    }
  }
  for (let i = 0; i < route.subRoutes.length; i++) {
    const routeFragment = route.subRoutes[i];
    const slippageAdjustedRoute = adjustQuoteForSlippage(
      routeFragment,
      slippage,
    );
    if (slippageAdjustedRoute.hopQuotes.length == 1) {
      const { quote, mintA, mintB } = slippageAdjustedRoute.hopQuotes[0];

      requiredTickArrays.push(
        ...[quote.tickArray0, quote.tickArray1, quote.tickArray2],
      );

      const inputAmount = quote.amountSpecifiedIsInput
        ? quote.amount
        : quote.otherAmountThreshold;
      addOrNative(mintA.toString(), quote.aToB ? inputAmount : ZERO);
      addOrNative(mintB.toString(), !quote.aToB ? inputAmount : ZERO);
    } else if (slippageAdjustedRoute.hopQuotes.length == 2) {
      const {
        quote: quoteOne,
        mintA: mintOneA,
        mintB: mintOneB,
      } = slippageAdjustedRoute.hopQuotes[0];
      const {
        quote: quoteTwo,
        mintA: mintTwoA,
        mintB: mintTwoB,
      } = slippageAdjustedRoute.hopQuotes[1];
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteOne, quoteTwo);

      requiredTickArrays.push(
        ...[
          twoHopQuote.tickArrayOne0,
          twoHopQuote.tickArrayOne1,
          twoHopQuote.tickArrayOne2,
          twoHopQuote.tickArrayTwo0,
          twoHopQuote.tickArrayTwo1,
          twoHopQuote.tickArrayTwo2,
        ],
      );

      const inputAmount = quoteOne.amountSpecifiedIsInput
        ? quoteOne.estimatedAmountIn
        : quoteOne.otherAmountThreshold;
      addOrNative(mintOneA.toString(), quoteOne.aToB ? inputAmount : ZERO);
      addOrNative(mintOneB.toString(), !quoteOne.aToB ? inputAmount : ZERO);
      addOrNative(mintTwoA.toString(), ZERO);
      addOrNative(mintTwoB.toString(), ZERO);
      requiredIntermediateAtas.add(
        quoteOne.aToB ? mintOneB.toString() : mintOneA.toString(),
      );
    }
  }

  // No need to check if TickArrays are initialized after SparseSwap implementation

  // Handle non-native mints only first
  requiredAtas.delete(NATIVE_MINT.toBase58());

  const ataInstructionMap = await cachedResolveOrCreateNonNativeATAs(
    wallet,
    requiredAtas,
    requiredIntermediateAtas,
    (keys) => {
      // TODO: if atas are not up to date, there might be failures, not sure if there's
      // any good way, other than to re-fetch each time?
      if (resolvedAtaAccounts != null) {
        return Promise.resolve(
          keys.map((key) =>
            resolvedAtaAccounts.find(
              (ata) => ata.address?.toBase58() === key.toBase58(),
            ),
          ) as Account[],
        );
      } else {
        return ctx.fetcher
          .getTokenInfos(keys, opts)
          .then((result) => Array.from(result.values()));
      }
    },
    undefined, // use default
    ctx.accountResolverOpts.allowPDAOwnerAddress,
  );

  const ataIxes = Object.values(ataInstructionMap);

  if (hasNativeMint) {
    const solIx = TokenUtil.createWrappedNativeAccountInstruction(
      wallet,
      nativeMintAmount,
      await ctx.fetcher.getAccountRentExempt(),
      undefined, // use default
      undefined, // use default
      ctx.accountResolverOpts.createWrappedSolAccountMethod,
    );
    txBuilder.addInstruction(solIx);
    ataInstructionMap[NATIVE_MINT.toBase58()] = solIx;
  }

  txBuilder.addInstructions(ataIxes);

  // Slippage adjustment
  const slippageAdjustedQuotes = route.subRoutes.map((quote) =>
    adjustQuoteForSlippage(quote, slippage),
  );

  for (let i = 0; i < slippageAdjustedQuotes.length; i++) {
    const routeFragment = slippageAdjustedQuotes[i];
    if (routeFragment.hopQuotes.length == 1) {
      const { quote, whirlpool, mintA, mintB, vaultA, vaultB } =
        routeFragment.hopQuotes[0];
      const [wp, tokenVaultA, tokenVaultB] = AddressUtil.toPubKeys([
        whirlpool,
        vaultA,
        vaultB,
      ]);
      const accA = ataInstructionMap[mintA.toString()].address;
      const accB = ataInstructionMap[mintB.toString()].address;
      const oraclePda = PDAUtil.getOracle(ctx.program.programId, wp);
      txBuilder.addInstruction(
        swapIx(ctx.program, {
          whirlpool: wp,
          tokenOwnerAccountA: accA,
          tokenOwnerAccountB: accB,
          tokenVaultA,
          tokenVaultB,
          oracle: oraclePda.publicKey,
          tokenAuthority: wallet,
          ...quote,
        }),
      );
    } else if (routeFragment.hopQuotes.length == 2) {
      const {
        quote: quoteOne,
        whirlpool: whirlpoolOne,
        mintA: mintOneA,
        mintB: mintOneB,
        vaultA: vaultOneA,
        vaultB: vaultOneB,
      } = routeFragment.hopQuotes[0];
      const {
        quote: quoteTwo,
        whirlpool: whirlpoolTwo,
        mintA: mintTwoA,
        mintB: mintTwoB,
        vaultA: vaultTwoA,
        vaultB: vaultTwoB,
      } = routeFragment.hopQuotes[1];

      const [
        wpOne,
        wpTwo,
        tokenVaultOneA,
        tokenVaultOneB,
        tokenVaultTwoA,
        tokenVaultTwoB,
      ] = AddressUtil.toPubKeys([
        whirlpoolOne,
        whirlpoolTwo,
        vaultOneA,
        vaultOneB,
        vaultTwoA,
        vaultTwoB,
      ]);
      const twoHopQuote = twoHopSwapQuoteFromSwapQuotes(quoteOne, quoteTwo);

      const oracleOne = PDAUtil.getOracle(
        ctx.program.programId,
        wpOne,
      ).publicKey;
      const oracleTwo = PDAUtil.getOracle(
        ctx.program.programId,
        wpTwo,
      ).publicKey;

      const tokenOwnerAccountOneA =
        ataInstructionMap[mintOneA.toString()].address;
      const tokenOwnerAccountOneB =
        ataInstructionMap[mintOneB.toString()].address;
      const tokenOwnerAccountTwoA =
        ataInstructionMap[mintTwoA.toString()].address;
      const tokenOwnerAccountTwoB =
        ataInstructionMap[mintTwoB.toString()].address;
      txBuilder.addInstruction(
        twoHopSwapIx(ctx.program, {
          ...twoHopQuote,
          whirlpoolOne: wpOne,
          whirlpoolTwo: wpTwo,
          tokenOwnerAccountOneA,
          tokenOwnerAccountOneB,
          tokenOwnerAccountTwoA,
          tokenOwnerAccountTwoB,
          tokenVaultOneA,
          tokenVaultOneB,
          tokenVaultTwoA,
          tokenVaultTwoB,
          oracleOne,
          oracleTwo,
          tokenAuthority: wallet,
        }),
      );
    }
  }
  return txBuilder;
}

function adjustQuoteForSlippage(
  quote: SubTradeRoute,
  slippage: Percentage,
): SubTradeRoute {
  const { hopQuotes } = quote;
  if (hopQuotes.length === 1) {
    return {
      ...quote,
      hopQuotes: [
        {
          ...hopQuotes[0],
          quote: {
            ...hopQuotes[0].quote,
            ...SwapUtils.calculateSwapAmountsFromQuote(
              hopQuotes[0].quote.amount,
              hopQuotes[0].quote.estimatedAmountIn,
              hopQuotes[0].quote.estimatedAmountOut,
              slippage,
              hopQuotes[0].quote.amountSpecifiedIsInput,
            ),
          },
        },
      ],
    };
  } else if (quote.hopQuotes.length === 2) {
    const swapQuoteOne = quote.hopQuotes[0];
    const swapQuoteTwo = quote.hopQuotes[1];
    const amountSpecifiedIsInput = swapQuoteOne.quote.amountSpecifiedIsInput;

    let updatedQuote = {
      ...quote,
    };

    if (amountSpecifiedIsInput) {
      updatedQuote.hopQuotes = [
        updatedQuote.hopQuotes[0],
        {
          ...swapQuoteTwo,
          quote: {
            ...swapQuoteTwo.quote,
            otherAmountThreshold: adjustForSlippage(
              swapQuoteTwo.quote.estimatedAmountOut,
              slippage,
              false,
            ),
          },
        },
      ];
    } else {
      updatedQuote.hopQuotes = [
        {
          ...swapQuoteOne,
          quote: {
            ...swapQuoteOne.quote,
            otherAmountThreshold: adjustForSlippage(
              swapQuoteOne.quote.estimatedAmountIn,
              slippage,
              true,
            ),
          },
        },
        updatedQuote.hopQuotes[1],
      ];
    }
    return updatedQuote;
  }

  return quote;
}

/**
 * Internal duplicate of resolveOrCreateAta
 * This could be ported over to common-sdk?
 *
 * IMPORTANT: wrappedSolAmountIn should only be used for input/source token that
 *            could be SOL. This is because when SOL is the output, it is the end
 *            destination, and thus does not need to be wrapped with an amount.
 *
 * @param ownerAddress The user's public key
 * @param tokenMint Token mint address
 * @param intermediateTokenMints Any mints from the tokenMint set that are intermediates in a two-hop swap
 * @param getTokenAccounts Function to get token accounts
 * @param payer Payer that would pay the rent for the creation of the ATAs
 * @param allowPDAOwnerAddress Optional. Allow PDA to be used as the ATA owner address
 * @returns
 */
async function cachedResolveOrCreateNonNativeATAs(
  ownerAddress: PublicKey,
  tokenMints: Set<string>,
  intermediateTokenMints: Set<string>,
  getTokenAccounts: (
    keys: PublicKey[],
  ) => Promise<Array<AtaAccountInfo | null>>,
  payer = ownerAddress,
  allowPDAOwnerAddress: boolean = false,
): Promise<{ [tokenMint: string]: ResolvedTokenAddressInstruction }> {
  const instructionMap: {
    [tokenMint: string]: ResolvedTokenAddressInstruction;
  } = {};
  const tokenMintArray = Array.from(tokenMints).map((tm) => new PublicKey(tm));
  const tokenAtas = tokenMintArray.map((tm) =>
    getAssociatedTokenAddressSync(tm, ownerAddress, allowPDAOwnerAddress),
  );
  const tokenAccounts = await getTokenAccounts(tokenAtas);
  tokenAccounts.forEach((tokenAccount, index) => {
    const ataAddress = tokenAtas[index]!;
    let resolvedInstruction;
    if (tokenAccount) {
      // ATA whose owner has been changed is abnormal entity.
      // To prevent to send swap/withdraw/collect output to the ATA, an error should be thrown.
      if (!tokenAccount.owner.equals(ownerAddress)) {
        throw new Error(
          `ATA with change of ownership detected: ${ataAddress.toBase58()}`,
        );
      }

      resolvedInstruction = { address: ataAddress, ...EMPTY_INSTRUCTION };
    } else {
      const tokenMint = tokenMintArray[index];
      const createAtaInstructions = [
        createAssociatedTokenAccountInstruction(
          payer,
          ataAddress,
          ownerAddress,
          tokenMint,
        ),
      ];

      let cleanupInstructions: TransactionInstruction[] = [];
      if (intermediateTokenMints.has(tokenMint.toBase58())) {
        cleanupInstructions = [
          createCloseAccountInstruction(ataAddress, ownerAddress, ownerAddress),
        ];
      }

      resolvedInstruction = {
        address: ataAddress,
        instructions: createAtaInstructions,
        cleanupInstructions: cleanupInstructions,
        signers: [],
      };
    }
    // WhirlpoolRouter does not handle TokenExtension, so token program is always standard TokenProgram.
    instructionMap[tokenMintArray[index].toBase58()] = {
      tokenProgram: TOKEN_PROGRAM_ID,
      ...resolvedInstruction,
    };
  });

  return instructionMap;
}
