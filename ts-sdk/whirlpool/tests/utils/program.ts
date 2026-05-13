import {
  fetchAllMaybeTickArray,
  fetchWhirlpool,
  getBundledPositionAddress,
  getFeeTierAddress,
  getIncreaseLiquidityV2Instruction,
  getInitializeConfigInstruction,
  getInitializeDynamicTickArrayInstruction,
  getInitializeFeeTierInstruction,
  getInitializePoolV2Instruction,
  getInitializePositionBundleInstruction,
  getOpenBundledPositionInstruction,
  getOpenPositionInstruction,
  getOpenPositionWithTokenExtensionsInstruction,
  getPositionAddress,
  getPositionBundleAddress,
  getTickArrayAddress,
  getTokenBadgeAddress,
  getWhirlpoolAddress,
} from "@orca-so/whirlpools-client";
import {
  _POSITION_BUNDLE_SIZE,
  getInitializableTickIndex,
  getTickArrayStartTickIndex,
  increaseLiquidityQuote,
  tickIndexToSqrtPrice,
} from "@orca-so/whirlpools-core";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { address, type Address, type Instruction } from "@solana/kit";
import type { WhirlpoolDeployment } from "../../src/config";
import { SPLASH_POOL_TICK_SPACING } from "../../src/config";
import { LOCALNET_ADMIN_KEYPAIR_0 } from "./admin";
import { getNextKeypair } from "./keypair";
import {
  rpc,
  sendTransaction,
  signer,
  TEST_WHIRLPOOL_DEPLOYMENT,
} from "./mockRpc";

export async function setupConfigAndFeeTiers(
  programId: Address = TEST_WHIRLPOOL_DEPLOYMENT.programId,
): Promise<Address> {
  const admin = LOCALNET_ADMIN_KEYPAIR_0;
  const keypair = getNextKeypair();
  const instructions: Instruction[] = [];

  instructions.push(
    getInitializeConfigInstruction(
      {
        config: keypair,
        funder: admin,
        feeAuthority: signer.address,
        collectProtocolFeesAuthority: signer.address,
        rewardEmissionsSuperAuthority: signer.address,
        defaultProtocolFeeRate: 100,
      },
      { programAddress: programId },
    ),
  );

  const tempDeployment = {
    programId,
    configAddress: keypair.address,
  };

  const defaultFeeTierPda = await getFeeTierAddress(128, tempDeployment);
  instructions.push(
    getInitializeFeeTierInstruction(
      {
        config: keypair.address,
        feeTier: defaultFeeTierPda[0],
        funder: signer,
        feeAuthority: signer,
        tickSpacing: 128,
        defaultFeeRate: 1000,
      },
      { programAddress: programId },
    ),
  );

  const concentratedFeeTierPda = await getFeeTierAddress(64, tempDeployment);
  instructions.push(
    getInitializeFeeTierInstruction(
      {
        config: keypair.address,
        feeTier: concentratedFeeTierPda[0],
        funder: signer,
        feeAuthority: signer,
        tickSpacing: 64,
        defaultFeeRate: 300,
      },
      { programAddress: programId },
    ),
  );

  const splashFeeTierPda = await getFeeTierAddress(
    SPLASH_POOL_TICK_SPACING,
    tempDeployment,
  );
  instructions.push(
    getInitializeFeeTierInstruction(
      {
        config: keypair.address,
        feeTier: splashFeeTierPda[0],
        funder: signer,
        feeAuthority: signer,
        tickSpacing: SPLASH_POOL_TICK_SPACING,
        defaultFeeRate: 1000,
      },
      { programAddress: programId },
    ),
  );

  await sendTransaction(instructions);
  return keypair.address;
}

export async function setupWhirlpool(
  tokenA: Address,
  tokenB: Address,
  tickSpacing: number,
  config: {
    initialSqrtPrice?: bigint;
    whirlpoolDeployment?: WhirlpoolDeployment;
  } = {},
): Promise<Address> {
  const deployment = config.whirlpoolDeployment ?? TEST_WHIRLPOOL_DEPLOYMENT;
  const feeTierAddress = await getFeeTierAddress(tickSpacing, deployment);
  const whirlpoolAddress = await getWhirlpoolAddress(
    tokenA,
    tokenB,
    tickSpacing,
    deployment,
  );
  const vaultA = getNextKeypair();
  const vaultB = getNextKeypair();
  const badgeA = await getTokenBadgeAddress(tokenA, deployment);
  const badgeB = await getTokenBadgeAddress(tokenB, deployment);
  const mintA = await fetchMint(rpc, tokenA);
  const mintB = await fetchMint(rpc, tokenB);
  const programA = mintA.programAddress;
  const programB = mintB.programAddress;

  const sqrtPrice = config.initialSqrtPrice ?? tickIndexToSqrtPrice(0);

  const instructions: Instruction[] = [];

  instructions.push(
    getInitializePoolV2Instruction(
      {
        whirlpool: whirlpoolAddress[0],
        feeTier: feeTierAddress[0],
        tokenMintA: tokenA,
        tokenMintB: tokenB,
        tickSpacing,
        whirlpoolsConfig: deployment.configAddress,
        funder: signer,
        tokenVaultA: vaultA,
        tokenVaultB: vaultB,
        tokenBadgeA: badgeA[0],
        tokenBadgeB: badgeB[0],
        tokenProgramA: programA,
        tokenProgramB: programB,
        initialSqrtPrice: sqrtPrice,
      },
      { programAddress: deployment.programId },
    ),
  );

  await sendTransaction(instructions);
  return whirlpoolAddress[0];
}

export async function setupPosition(
  whirlpool: Address,
  config: {
    tickLower?: number;
    tickUpper?: number;
    liquidity?: bigint;
    whirlpoolDeployment?: WhirlpoolDeployment;
  } = {},
): Promise<Address> {
  const deployment = config.whirlpoolDeployment ?? TEST_WHIRLPOOL_DEPLOYMENT;
  const positionMint = getNextKeypair();
  const whirlpoolAccount = await fetchWhirlpool(rpc, whirlpool);
  const tickLower = config.tickLower ?? -100;
  const tickUpper = config.tickUpper ?? 100;

  const initializableLowerTickIndex = getInitializableTickIndex(
    tickLower,
    whirlpoolAccount.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    tickUpper,
    whirlpoolAccount.data.tickSpacing,
    true,
  );

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    initializableLowerTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    initializableUpperTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );

  const [
    positionAddress,
    positionTokenAccount,
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ] = await Promise.all([
    getPositionAddress(positionMint.address, deployment.programId),
    findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }).then((x) => x[0]),
    getTickArrayAddress(
      whirlpool,
      lowerTickArrayIndex,
      deployment.programId,
    ).then((x) => x[0]),
    getTickArrayAddress(
      whirlpool,
      upperTickArrayIndex,
      deployment.programId,
    ).then((x) => x[0]),
  ]);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const instructions: Instruction[] = [];

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: whirlpool,
          funder: signer,
          tickArray: lowerTickArrayAddress,
          startTickIndex: lowerTickArrayIndex,
          idempotent: false,
        },
        { programAddress: deployment.programId },
      ),
    );
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: whirlpool,
          funder: signer,
          tickArray: upperTickArrayAddress,
          startTickIndex: upperTickArrayIndex,
          idempotent: false,
        },
        { programAddress: deployment.programId },
      ),
    );
  }

  instructions.push(
    getOpenPositionInstruction(
      {
        funder: signer,
        owner: signer.address,
        position: positionAddress[0],
        positionMint: positionMint,
        positionTokenAccount: positionTokenAccount,
        whirlpool: whirlpool,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        tickLowerIndex: initializableLowerTickIndex,
        tickUpperIndex: initializableUpperTickIndex,
        positionBump: positionAddress[1],
      },
      { programAddress: deployment.programId },
    ),
  );

  if (config.liquidity) {
    const tokenMintA = await fetchMint(rpc, whirlpoolAccount.data.tokenMintA);
    const tokenOwnerAccountA = await findAssociatedTokenPda({
      owner: signer.address,
      mint: whirlpoolAccount.data.tokenMintA,
      tokenProgram: tokenMintA.programAddress,
    }).then((x) => x[0]);

    const tokenMintB = await fetchMint(rpc, whirlpoolAccount.data.tokenMintB);
    const tokenOwnerAccountB = await findAssociatedTokenPda({
      owner: signer.address,
      mint: whirlpoolAccount.data.tokenMintB,
      tokenProgram: tokenMintB.programAddress,
    }).then((x) => x[0]);

    const quote = increaseLiquidityQuote(
      config.liquidity,
      100,
      whirlpoolAccount.data.sqrtPrice,
      initializableLowerTickIndex,
      initializableUpperTickIndex,
    );

    instructions.push(
      getIncreaseLiquidityV2Instruction(
        {
          whirlpool: whirlpool,
          positionAuthority: signer,
          position: positionAddress[0],
          positionTokenAccount,
          tokenOwnerAccountA: tokenOwnerAccountA,
          tokenOwnerAccountB: tokenOwnerAccountB,
          tokenVaultA: whirlpoolAccount.data.tokenVaultA,
          tokenVaultB: whirlpoolAccount.data.tokenVaultB,
          tokenMintA: whirlpoolAccount.data.tokenMintA,
          tokenMintB: whirlpoolAccount.data.tokenMintB,
          tokenProgramA: tokenMintA.programAddress,
          tokenProgramB: tokenMintB.programAddress,
          tickArrayLower: lowerTickArrayAddress,
          tickArrayUpper: upperTickArrayAddress,
          liquidityAmount: quote.liquidityDelta,
          tokenMaxA: quote.tokenMaxA,
          tokenMaxB: quote.tokenMaxB,
          memoProgram: MEMO_PROGRAM_ADDRESS,
          remainingAccountsInfo: null,
        },
        { programAddress: deployment.programId },
      ),
    );
  }

  await sendTransaction(instructions);

  return positionMint.address;
}

export async function setupTEPosition(
  whirlpool: Address,
  config: {
    tickLower?: number;
    tickUpper?: number;
    liquidity?: bigint;
    whirlpoolDeployment?: WhirlpoolDeployment;
  } = {},
): Promise<Address> {
  const deployment = config.whirlpoolDeployment ?? TEST_WHIRLPOOL_DEPLOYMENT;
  const metadataUpdateAuth = address(
    "3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr",
  );
  const positionMint = getNextKeypair();
  const whirlpoolAccount = await fetchWhirlpool(rpc, whirlpool);
  const tickLower = config.tickLower ?? -100;
  const tickUpper = config.tickUpper ?? 100;

  const initializableLowerTickIndex = getInitializableTickIndex(
    tickLower,
    whirlpoolAccount.data.tickSpacing,
    false,
  );
  const initializableUpperTickIndex = getInitializableTickIndex(
    tickUpper,
    whirlpoolAccount.data.tickSpacing,
    true,
  );

  const lowerTickArrayIndex = getTickArrayStartTickIndex(
    initializableLowerTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );
  const upperTickArrayIndex = getTickArrayStartTickIndex(
    initializableUpperTickIndex,
    whirlpoolAccount.data.tickSpacing,
  );

  const [
    positionAddress,
    positionTokenAccount,
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ] = await Promise.all([
    getPositionAddress(positionMint.address, deployment.programId),
    findAssociatedTokenPda({
      owner: signer.address,
      mint: positionMint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }).then((x) => x[0]),
    getTickArrayAddress(
      whirlpool,
      lowerTickArrayIndex,
      deployment.programId,
    ).then((x) => x[0]),
    getTickArrayAddress(
      whirlpool,
      upperTickArrayIndex,
      deployment.programId,
    ).then((x) => x[0]),
  ]);

  const [lowerTickArray, upperTickArray] = await fetchAllMaybeTickArray(rpc, [
    lowerTickArrayAddress,
    upperTickArrayAddress,
  ]);

  const instructions: Instruction[] = [];

  if (!lowerTickArray.exists) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: whirlpool,
          funder: signer,
          tickArray: lowerTickArrayAddress,
          startTickIndex: lowerTickArrayIndex,
          idempotent: false,
        },
        { programAddress: deployment.programId },
      ),
    );
  }

  if (!upperTickArray.exists && lowerTickArrayIndex !== upperTickArrayIndex) {
    instructions.push(
      getInitializeDynamicTickArrayInstruction(
        {
          whirlpool: whirlpool,
          funder: signer,
          tickArray: upperTickArrayAddress,
          startTickIndex: upperTickArrayIndex,
          idempotent: false,
        },
        { programAddress: deployment.programId },
      ),
    );
  }

  instructions.push(
    getOpenPositionWithTokenExtensionsInstruction(
      {
        funder: signer,
        owner: signer.address,
        position: positionAddress[0],
        positionMint: positionMint,
        positionTokenAccount: positionTokenAccount,
        whirlpool: whirlpool,
        token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        metadataUpdateAuth: metadataUpdateAuth,
        tickLowerIndex: initializableLowerTickIndex,
        tickUpperIndex: initializableUpperTickIndex,
        withTokenMetadataExtension: true,
      },
      { programAddress: deployment.programId },
    ),
  );

  if (config.liquidity) {
    const tokenMintA = await fetchMint(rpc, whirlpoolAccount.data.tokenMintA);
    const tokenOwnerAccountA = await findAssociatedTokenPda({
      owner: signer.address,
      mint: whirlpoolAccount.data.tokenMintA,
      tokenProgram: tokenMintA.programAddress,
    }).then((x) => x[0]);

    const tokenMintB = await fetchMint(rpc, whirlpoolAccount.data.tokenMintB);
    const tokenOwnerAccountB = await findAssociatedTokenPda({
      owner: signer.address,
      mint: whirlpoolAccount.data.tokenMintB,
      tokenProgram: tokenMintB.programAddress,
    }).then((x) => x[0]);

    const quote = increaseLiquidityQuote(
      config.liquidity,
      100,
      whirlpoolAccount.data.sqrtPrice,
      initializableLowerTickIndex,
      initializableUpperTickIndex,
    );

    instructions.push(
      getIncreaseLiquidityV2Instruction(
        {
          whirlpool: whirlpool,
          positionAuthority: signer,
          position: positionAddress[0],
          positionTokenAccount,
          tokenOwnerAccountA: tokenOwnerAccountA,
          tokenOwnerAccountB: tokenOwnerAccountB,
          tokenVaultA: whirlpoolAccount.data.tokenVaultA,
          tokenVaultB: whirlpoolAccount.data.tokenVaultB,
          tokenMintA: whirlpoolAccount.data.tokenMintA,
          tokenMintB: whirlpoolAccount.data.tokenMintB,
          tokenProgramA: tokenMintA.programAddress,
          tokenProgramB: tokenMintB.programAddress,
          tickArrayLower: lowerTickArrayAddress,
          tickArrayUpper: upperTickArrayAddress,
          liquidityAmount: quote.liquidityDelta,
          tokenMaxA: quote.tokenMaxA,
          tokenMaxB: quote.tokenMaxB,
          memoProgram: MEMO_PROGRAM_ADDRESS,
          remainingAccountsInfo: null,
        },
        { programAddress: deployment.programId },
      ),
    );
  }

  await sendTransaction(instructions);

  return positionMint.address;
}

export async function setupPositionBundle(
  whirlpool: Address,
  config: { tickLower: number; tickUpper: number; liquidity?: bigint }[] = [],
  options: { whirlpoolDeployment?: WhirlpoolDeployment } = {},
): Promise<Address> {
  const deployment = options.whirlpoolDeployment ?? TEST_WHIRLPOOL_DEPLOYMENT;
  if (config.length > _POSITION_BUNDLE_SIZE()) {
    throw new Error(
      `Cannot open more than ${_POSITION_BUNDLE_SIZE()} bundled positions`,
    );
  }

  const whirlpoolAccount = await fetchWhirlpool(rpc, whirlpool);
  const positionBundleMint = getNextKeypair();
  const positionBundleAddress = await getPositionBundleAddress(
    positionBundleMint.address,
    deployment.programId,
  );
  const positionBundleTokenAccount = await findAssociatedTokenPda({
    owner: signer.address,
    mint: positionBundleMint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  }).then((x) => x[0]);

  const instructions: Instruction[] = [
    getInitializePositionBundleInstruction(
      {
        positionBundle: positionBundleAddress[0],
        positionBundleMint: positionBundleMint,
        positionBundleTokenAccount,
        positionBundleOwner: signer.address,
        funder: signer,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      },
      { programAddress: deployment.programId },
    ),
  ];

  const initializedTickArrays = new Set<string>();

  for (let bundleIndex = 0; bundleIndex < config.length; bundleIndex++) {
    const { tickLower, tickUpper, liquidity } = config[bundleIndex];

    const tickLowerIndex = getInitializableTickIndex(
      tickLower,
      whirlpoolAccount.data.tickSpacing,
      false,
    );
    const tickUpperIndex = getInitializableTickIndex(
      tickUpper,
      whirlpoolAccount.data.tickSpacing,
      true,
    );

    const lowerTickArrayStartIndex = getTickArrayStartTickIndex(
      tickLowerIndex,
      whirlpoolAccount.data.tickSpacing,
    );
    const upperTickArrayStartIndex = getTickArrayStartTickIndex(
      tickUpperIndex,
      whirlpoolAccount.data.tickSpacing,
    );

    const lowerTickArrayAddress = await getTickArrayAddress(
      whirlpool,
      lowerTickArrayStartIndex,
      deployment.programId,
    ).then((x) => x[0]);
    const upperTickArrayAddress = await getTickArrayAddress(
      whirlpool,
      upperTickArrayStartIndex,
      deployment.programId,
    ).then((x) => x[0]);

    // Initialize tick arrays if needed
    if (!initializedTickArrays.has(lowerTickArrayAddress)) {
      const [lowerTickArray] = await fetchAllMaybeTickArray(rpc, [
        lowerTickArrayAddress,
      ]);
      if (!lowerTickArray.exists) {
        instructions.push(
          getInitializeDynamicTickArrayInstruction(
            {
              whirlpool,
              funder: signer,
              tickArray: lowerTickArrayAddress,
              startTickIndex: lowerTickArrayStartIndex,
              idempotent: false,
            },
            { programAddress: deployment.programId },
          ),
        );
      }
      initializedTickArrays.add(lowerTickArrayAddress);
    }

    if (!initializedTickArrays.has(upperTickArrayAddress)) {
      const [upperTickArray] = await fetchAllMaybeTickArray(rpc, [
        upperTickArrayAddress,
      ]);
      if (!upperTickArray.exists) {
        instructions.push(
          getInitializeDynamicTickArrayInstruction(
            {
              whirlpool,
              funder: signer,
              tickArray: upperTickArrayAddress,
              startTickIndex: upperTickArrayStartIndex,
              idempotent: false,
            },
            { programAddress: deployment.programId },
          ),
        );
      }
      initializedTickArrays.add(upperTickArrayAddress);
    }

    const bundledPositionAddress = await getBundledPositionAddress(
      positionBundleMint.address,
      bundleIndex,
      deployment.programId,
    ).then((x) => x[0]);

    instructions.push(
      getOpenBundledPositionInstruction(
        {
          bundledPosition: bundledPositionAddress,
          positionBundle: positionBundleAddress[0],
          positionBundleTokenAccount,
          positionBundleAuthority: signer,
          whirlpool,
          funder: signer,
          bundleIndex,
          tickLowerIndex,
          tickUpperIndex,
        },
        { programAddress: deployment.programId },
      ),
    );

    if (liquidity != null && liquidity > 0n) {
      const tokenMintA = await fetchMint(rpc, whirlpoolAccount.data.tokenMintA);
      const tokenMintB = await fetchMint(rpc, whirlpoolAccount.data.tokenMintB);
      const tokenOwnerAccountA = await findAssociatedTokenPda({
        owner: signer.address,
        mint: whirlpoolAccount.data.tokenMintA,
        tokenProgram: tokenMintA.programAddress,
      }).then((x) => x[0]);
      const tokenOwnerAccountB = await findAssociatedTokenPda({
        owner: signer.address,
        mint: whirlpoolAccount.data.tokenMintB,
        tokenProgram: tokenMintB.programAddress,
      }).then((x) => x[0]);

      const quote = increaseLiquidityQuote(
        liquidity,
        100,
        whirlpoolAccount.data.sqrtPrice,
        tickLowerIndex,
        tickUpperIndex,
      );

      instructions.push(
        getIncreaseLiquidityV2Instruction(
          {
            whirlpool,
            positionAuthority: signer,
            position: bundledPositionAddress,
            positionTokenAccount: positionBundleTokenAccount,
            tokenOwnerAccountA,
            tokenOwnerAccountB,
            tokenVaultA: whirlpoolAccount.data.tokenVaultA,
            tokenVaultB: whirlpoolAccount.data.tokenVaultB,
            tokenMintA: whirlpoolAccount.data.tokenMintA,
            tokenMintB: whirlpoolAccount.data.tokenMintB,
            tokenProgramA: tokenMintA.programAddress,
            tokenProgramB: tokenMintB.programAddress,
            tickArrayLower: lowerTickArrayAddress,
            tickArrayUpper: upperTickArrayAddress,
            liquidityAmount: quote.liquidityDelta,
            tokenMaxA: quote.tokenMaxA,
            tokenMaxB: quote.tokenMaxB,
            memoProgram: MEMO_PROGRAM_ADDRESS,
            remainingAccountsInfo: null,
          },
          { programAddress: deployment.programId },
        ),
      );
    }
  }

  await sendTransaction(instructions);

  return positionBundleMint.address;
}
