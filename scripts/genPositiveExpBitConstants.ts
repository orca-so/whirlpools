import Decimal from "decimal.js";
Decimal.set({ toExpPos: 100, toExpNeg: -100, precision: 100 })

const b = new Decimal(1.0001);

const targetBitShift = 64;
const resolution = Decimal.pow(2, targetBitShift);

const results = [];
for (let j = 0; j < 19; j++) {
  // Calculate target price
  const index = Decimal.pow(2, j);
  console.log("index", index);
  const rawPrice = b.pow(index.div(2));
  const targetPrice = rawPrice.mul(Decimal.pow(2, 96)).floor();
  console.log("targetPrice", targetPrice);
}
