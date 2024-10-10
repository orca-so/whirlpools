import { describe, it } from "mocha";
import type { Position, TickArray, Whirlpool } from "../../client/src";
import type {
  PositionFacade,
  TickArrayFacade,
  WhirlpoolFacade,
} from "../dist/nodejs/orca_whirlpools_core_js_bindings";

// Since these tests are only for type checking, nothing actually happens at runtime.

describe("WASM exported types match Kinobi types", () => {

  it("Whirlpool", () => {
    const fauxWhirlpool = {} as Whirlpool;
    fauxWhirlpool satisfies WhirlpoolFacade;
  });

  it("Position", () => {
    const fauxPosition = {} as Position;
    fauxPosition satisfies PositionFacade;
  });

  it("TickArray", () => {
    const fauxTickArray = {} as TickArray;
    fauxTickArray satisfies TickArrayFacade;
  });
});
