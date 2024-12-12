import type { Idl } from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import type { ParsableEntity } from "@orca-so/common-sdk";
import { staticImplements } from "@orca-so/common-sdk";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import * as WhirlpoolIDL from "../../artifacts/whirlpool.json";
import type {
  FeeTierData,
  PositionBundleData,
  PositionData,
  TickArrayData,
  TokenBadgeData,
  WhirlpoolData,
  WhirlpoolsConfigData,
  WhirlpoolsConfigExtensionData,
} from "../../types/public";
import { AccountName } from "../../types/public";

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

    try {
      return parseAnchorAccount(AccountName.TickArray, accountData);
    } catch (e) {
      console.error(`error while parsing TickArray: ${e}`);
      return null;
    }
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
