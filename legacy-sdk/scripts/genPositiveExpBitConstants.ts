import Decimal from "decimal.js";
Decimal.set({ toExpPos: 100, toExpNeg: -100, precision: 100 });

const b = new Decimal(1.0001);

for (let j = 0; j < 19; j++) {
  // Calculate target price
  const index = Decimal.pow(2, j);
  console.info("index", index);
  const rawPrice = b.pow(index.div(2));
  const targetPrice = rawPrice.mul(Decimal.pow(2, 96)).floor();
  console.info("targetPrice", targetPrice);
}
