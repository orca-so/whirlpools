import { AccountsCoder, Coder, Idl } from "@project-serum/anchor";
import { WhirlpoolConfigAccount } from "../..";
import {
  AccountName,
  PositionData,
  TickArrayData,
  WhirlpoolData,
} from "../../types/public/anchor-types";
import * as WhirlpoolIDL from "../../artifacts/whirlpool.json";

const WhirlpoolCoder = new Coder(WhirlpoolIDL as Idl);

export function parseWhirlpoolsConfig(data: Buffer): WhirlpoolConfigAccount | null {
  return parse(AccountName.WhirlpoolsConfig, data);
}

export function parseWhirlpool(data: Buffer): WhirlpoolData | null {
  return parse(AccountName.Whirlpool, data);
}

export function parsePosition(data: Buffer): PositionData | null {
  return parse(AccountName.Position, data);
}

export function parseTickArray(data: Buffer): TickArrayData | null {
  return parse(AccountName.TickArray, data);
}

function parse(accountName: AccountName, data: Buffer) {
  const discriminator = AccountsCoder.accountDiscriminator(accountName);
  if (discriminator.compare(data.slice(0, 8))) {
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
