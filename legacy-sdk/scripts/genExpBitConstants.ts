import Decimal from "decimal.js";
Decimal.set({ precision: 40, rounding: 4 });

/**
 * This script is to generate the magic numbers & unit tests needed for the exponent function
 * in Whirlpools.
 *
 * Explanation on what magic numbers are:
 * https://www.notion.so/orcaso/Fixed-Point-Arithmetic-in-Whirlpools-63f9817a852b4029a6eb15dc755c7baf#5df2cfe5d62b4b0aa7e58f5f381c2d55
 */

const x64 = new Decimal(2).pow(64);
const b = new Decimal("1.0001");
// Qm.n = Q32.64
const n = 64;

console.info(
  `Printing bit constants for whirlpool exponent of base ${b.toDecimalPlaces(
    4,
  )}`,
);
console.info(``);
console.info(`1.0001 x64 const - ${b.mul(x64).toFixed(0, 1)}`);
console.info(``);

console.info(`With a maximum tick of +/-443636, we'll need 19 bit constants:`);

for (let j = 0; j <= 18; j++) {
  const power = new Decimal(2).pow(j - 1);
  const sqrtBPower = b.pow(power);
  const iSqrtBPower = new Decimal(1).div(sqrtBPower).mul(x64);
  console.info(`${iSqrtBPower.toFixed(0, 1)}`);
}

const genUnitTestCases = (cases: number[]) => {
  console.info(`tick | positive index result | negative index result`);
  for (const tick of cases) {
    const jsResult = new Decimal(b)
      .pow(tick)
      .sqrt()
      .mul(new Decimal(2).pow(n))
      .toFixed(0, 1);
    const njsResult = new Decimal(b)
      .pow(-tick)
      .sqrt()
      .mul(new Decimal(2).pow(n))
      .toFixed(0, 1);

    console.info(tick + " - " + jsResult + " , " + njsResult);
  }
};

let bitGroup = [
  0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384,
  32768, 65536, 131072, 262144, 524288,
];
let randGroup = [2493, 23750, 395, 129, 39502, 395730, 245847, 120821].sort(
  (n1, n2) => n1 - n2,
);

console.info(" ");
console.info("Printing unit test cases for binary fraction bit cases:");
genUnitTestCases(bitGroup);
console.info(" ");
console.info("Printing unit test cases for random values:");
genUnitTestCases(randGroup);
