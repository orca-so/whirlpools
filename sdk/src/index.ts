import Decimal from "decimal.js";

export * from "./context";
export * from "./impl/position-impl";
export * from "./ix";
export * from "./network/public";
export * from "./quotes/public";
export * from "./quotes/swap";
export * from "./types/public";
export * from "./types/public/anchor-types";
export * from "./utils/public";
export * from "./whirlpool-client";

// Global rules for Decimals
//  - 40 digits of precision for the largest number
//  - 20 digits of precision for the smallest number
//  - Always round towards 0 to mirror smart contract rules
Decimal.set({ precision: 40, toExpPos: 40, toExpNeg: -20, rounding: 1 });
