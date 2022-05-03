import Decimal from "decimal.js";
Decimal.set({ precision: 40, rounding: 4 });

const x64 = new Decimal(2).pow(64);

const number = new Decimal(1).mul(x64);
console.log(`number - ${number}`);

const exp = new Decimal(1.0001).sqrt().pow(1).mul(x64);
console.log(`exp - ${exp.toFixed(0, 1)}`);

const log = new Decimal(18445821805675392311)
  .div(x64)
  .log(new Decimal(1.0001).sqrt());
console.log(`log - ${log.toString()}`);
