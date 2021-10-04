import { BN } from "@project-serum/anchor";
import Decimal from "decimal.js";

export function toX64_BN(num: BN): BN {
  return num.mul(new BN(2).pow(new BN(64)));
}

export function toX64_Decimal(num: Decimal): Decimal {
  return num.mul(Decimal.pow(2, 64));
}

export function toX64(num: Decimal): BN {
  return new BN(num.mul(Decimal.pow(2, 64)).floor().toFixed());
}

export function fromX64(num: BN): Decimal {
  return new Decimal(num.toString()).mul(Decimal.pow(2, -64));
}

export function fromX64_Decimal(num: Decimal): Decimal {
  return num.mul(Decimal.pow(2, -64));
}

export function fromX64_BN(num: BN): BN {
  return num.div(new BN(2).pow(new BN(64)));
}
