export enum MathErrorCode {
  MultiplicationOverflow = `MultiplicationOverflow`,
  MulDivOverflow = `MulDivOverflow`,
  MultiplicationShiftRightOverflow = `MultiplicationShiftRightOverflow`,
  DivideByZero = `DivideByZero`,
}

export enum TokenErrorCode {
  TokenMaxExceeded = `TokenMaxExceeded`,
  TokenMinSubceeded = `TokenMinSubceeded`,
}

export enum SwapErrorCode {
  InvalidDevFeePercentage = `InvalidDevFeePercentage`,
  InvalidSqrtPriceLimitDirection = `InvalidSqrtPriceLimitDirection`,
  SqrtPriceOutOfBounds = `SqrtPriceOutOfBounds`,
  ZeroTradableAmount = `ZeroTradableAmount`,
  AmountOutBelowMinimum = `AmountOutBelowMinimum`,
  AmountInAboveMaximum = `AmountInAboveMaximum`,
  TickArrayCrossingAboveMax = `TickArrayCrossingAboveMax`,
  TickArrayIndexNotInitialized = `TickArrayIndexNotInitialized`,
  TickArraySequenceInvalid = `TickArraySequenceInvalid`,
  AmountRemainingOverflow = `AmountRemainingOverflow`,
  AmountCalcOverflow = `AmountCalcOverflow`,
  TradeIsNotEnabled = `TradeIsNotEnabled`,
}

export type WhirlpoolsErrorCode =
  | TokenErrorCode
  | SwapErrorCode
  | MathErrorCode;

export class WhirlpoolsError extends Error {
  message: string;
  errorCode?: WhirlpoolsErrorCode;
  constructor(
    message: string,
    errorCode?: WhirlpoolsErrorCode,
    stack?: string,
  ) {
    super(message);
    this.message = message;
    this.errorCode = errorCode;
    this.stack = stack;
  }

  public static isWhirlpoolsErrorCode(
    e: unknown,
    code: WhirlpoolsErrorCode,
  ): boolean {
    return e instanceof WhirlpoolsError && e.errorCode === code;
  }
}
