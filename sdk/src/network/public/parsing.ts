import { AccountInfo, MintInfo, MintLayout, u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  WhirlpoolsConfigData,
  WhirlpoolData,
  PositionData,
  TickArrayData,
  AccountName,
  FeeTierData,
} from "../../types/public";
import { BorshAccountsCoder, Idl } from "@project-serum/anchor";
import * as WhirlpoolIDL from "../../artifacts/whirlpool.json";
import { TokenUtil } from "@orca-so/common-sdk";

/**
 * Static abstract class definition to parse entities.
 * @category Parsables
 */
export interface ParsableEntity<T> {
  /**
   * Parse account data
   *
   * @param accountData Buffer data for the entity
   * @returns Parsed entity
   */
  parse: (accountData: Buffer | undefined | null) => T | null;
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<WhirlpoolsConfigData>>()
export class ParsableWhirlpoolsConfig {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): WhirlpoolsConfigData | null {
    if (!data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.WhirlpoolsConfig, data);
    } catch (e) {
      console.error(`error while parsing WhirlpoolsConfig: ${e}`);
      return null;
    }
  }
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<WhirlpoolData>>()
export class ParsableWhirlpool {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): WhirlpoolData | null {
    if (!data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Whirlpool, data);
    } catch (e) {
      console.error(`error while parsing Whirlpool: ${e}`);
      return null;
    }
  }
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<PositionData>>()
export class ParsablePosition {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): PositionData | null {
    if (!data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.Position, data);
    } catch (e) {
      console.error(`error while parsing Position: ${e}`);
      return null;
    }
  }
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<TickArrayData>>()
export class ParsableTickArray {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): TickArrayData | null {
    if (!data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.TickArray, data);
    } catch (e) {
      console.error(`error while parsing TickArray: ${e}`);
      return null;
    }
  }
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<FeeTierData>>()
export class ParsableFeeTier {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): FeeTierData | null {
    if (!data) {
      return null;
    }

    try {
      return parseAnchorAccount(AccountName.FeeTier, data);
    } catch (e) {
      console.error(`error while parsing FeeTier: ${e}`);
      return null;
    }
  }
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<AccountInfo>>()
export class ParsableTokenInfo {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): AccountInfo | null {
    if (!data) {
      return null;
    }

    try {
      return TokenUtil.deserializeTokenAccount(data);
    } catch (e) {
      console.error(`error while parsing TokenAccount: ${e}`);
      return null;
    }
  }
}

/**
 * @category Parsables
 */
@staticImplements<ParsableEntity<MintInfo>>()
export class ParsableMintInfo {
  private constructor() {}

  public static parse(data: Buffer | undefined | null): MintInfo | null {
    if (!data) {
      return null;
    }

    try {
      const buffer = MintLayout.decode(data);
      const mintInfo: MintInfo = {
        mintAuthority:
          buffer.mintAuthorityOption === 0 ? null : new PublicKey(buffer.mintAuthority),
        supply: u64.fromBuffer(buffer.supply),
        decimals: buffer.decimals,
        isInitialized: buffer.isInitialized !== 0,
        freezeAuthority:
          buffer.freezeAuthority === 0 ? null : new PublicKey(buffer.freezeAuthority),
      };

      return mintInfo;
    } catch (e) {
      console.error(`error while parsing MintInfo: ${e}`);
      return null;
    }
  }
}

/**
 * Class decorator to define an interface with static methods
 * Reference: https://github.com/Microsoft/TypeScript/issues/13462#issuecomment-295685298
 */
function staticImplements<T>() {
  return <U extends T>(constructor: U) => {
    constructor;
  };
}

const WhirlpoolCoder = new BorshAccountsCoder(WhirlpoolIDL as Idl);

function parseAnchorAccount(accountName: AccountName, data: Buffer) {
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
