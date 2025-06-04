import type { Idl } from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import type { ParsableEntity } from "@orca-so/common-sdk";
import { staticImplements } from "@orca-so/common-sdk";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import * as WhirlpoolIDL from "../../artifacts/whirlpool.json";
import type {
  FeeTierData,
  LockConfigData,
  PositionBundleData,
  PositionData,
  TickArrayData,
  DynamicTickArrayData,
  TokenBadgeData,
  WhirlpoolData,
  WhirlpoolsConfigData,
  WhirlpoolsConfigExtensionData,
  AdaptiveFeeTierData,
  OracleData,
} from "../../types/public";
import { AccountName, toTick } from "../../types/public";

/**
 * @category Network
 */
@staticImplements<ParsableEntity<WhirlpoolsConfigData>>()
export class ParsableWhirlpoolsConfig {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): WhirlpoolsConfigData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.WhirlpoolsConfig, accountData);
    } catch (e) {
      console.error(`error while parsing WhirlpoolsConfig: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<WhirlpoolData>>()
export class ParsableWhirlpool {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): WhirlpoolData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Whirlpool, accountData);
    } catch (e) {
      console.error(`error while parsing Whirlpool: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<PositionData>>()
export class ParsablePosition {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): PositionData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Position, accountData);
    } catch (e) {
      console.error(`error while parsing Position: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<TickArrayData>>()
export class ParsableTickArray {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): TickArrayData | null {
    if (!accountData?.data) {
      return null;
    }

    const discriminator = accountData.data.subarray(0, 8);
    if (
      discriminator.equals(
        BorshAccountsCoder.accountDiscriminator(AccountName.DynamicTickArray),
      )
    ) {
      try {
        const tickArray = parseAnchorAccount(
          AccountName.DynamicTickArray,
          accountData,
        ) as DynamicTickArrayData;
        const ticks = tickArray.ticks.map(toTick);
        return {
          whirlpool: tickArray.whirlpool,
          startTickIndex: tickArray.startTickIndex,
          ticks,
        };
      } catch (e) {
        console.error(`error while parsing DynamicTickArray: ${e}`);
        return null;
      }
    }

    if (
      discriminator.equals(
        BorshAccountsCoder.accountDiscriminator(AccountName.TickArray),
      )
    ) {
      try {
        return parseAnchorAccount(AccountName.TickArray, accountData);
      } catch (e) {
        console.error(`error while parsing TickArray: ${e}`);
        return null;
      }
    }

    console.error(`unknown discriminator during parsing: ${discriminator}`);
    return null;
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<FeeTierData>>()
export class ParsableFeeTier {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): FeeTierData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.FeeTier, accountData);
    } catch (e) {
      console.error(`error while parsing FeeTier: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<PositionBundleData>>()
export class ParsablePositionBundle {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): PositionBundleData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.PositionBundle, accountData);
    } catch (e) {
      console.error(`error while parsing PositionBundle: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<WhirlpoolsConfigExtensionData>>()
export class ParsableWhirlpoolsConfigExtension {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): WhirlpoolsConfigExtensionData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(
        AccountName.WhirlpoolsConfigExtension,
        accountData,
      );
    } catch (e) {
      console.error(`error while parsing WhirlpoolsConfigExtension: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<TokenBadgeData>>()
export class ParsableTokenBadge {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): TokenBadgeData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.TokenBadge, accountData);
    } catch (e) {
      console.error(`error while parsing TokenBadge: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<LockConfigData>>()
export class ParsableLockConfig {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): LockConfigData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.LockConfig, accountData);
    } catch (e) {
      console.error(`error while parsing LockConfig: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<AdaptiveFeeTierData>>()
export class ParsableAdaptiveFeeTier {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): AdaptiveFeeTierData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.AdaptiveFeeTier, accountData);
    } catch (e) {
      console.error(`error while parsing AdaptiveFeeTier: ${e}`);
      return null;
    }
  }
}

/**
 * @category Network
 */
@staticImplements<ParsableEntity<OracleData>>()
export class ParsableOracle {
  public static parse(
    address: PublicKey,
    accountData: AccountInfo<Buffer> | undefined | null,
  ): OracleData | null {
    if (!accountData?.data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Oracle, accountData);
    } catch (e) {
      console.error(`error while parsing Oracle: ${e}`);
      return null;
    }
  }
}

const WhirlpoolCoder = new BorshAccountsCoder(WhirlpoolIDL as Idl);

function parseAnchorAccount(
  accountName: AccountName,
  accountData: AccountInfo<Buffer>,
) {
  const data = accountData.data;
  const discriminator = BorshAccountsCoder.accountDiscriminator(accountName);
  if (discriminator.compare(data.slice(0, 8))) {
    console.error("incorrect account name during parsing");
    return null;
  }

  try {
    return WhirlpoolCoder.decode(accountName, data);
  } catch (_e) {
    console.error("unknown account name during parsing");
    return null;
  }
}
