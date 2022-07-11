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
  InvalidSqrtPriceLimitDirection = `InvalidSqrtPriceLimitDirection`,
  SqrtPriceOutOfBounds = `SqrtPriceOutOfBounds`,
  ZeroTradableAmount = `ZeroTradableAmount`,
  AmountOutBelowMinimum = `AmountOutBelowMinimum`,
  AmountInAboveMaximum = `AmountInAboveMaximum`,
  TickArrayCrossingAboveMax = `TickArrayCrossingAboveMax`,
  TickArrayIndexNotInitialized = `TickArrayIndexNotInitialized`,
  TickArraySequenceInvalid = `TickArraySequenceInvalid`,
}

export type WhirlpoolsErrorCode = TokenErrorCode | SwapErrorCode | MathErrorCode;

export class WhirlpoolsError extends Error {
  message: string;
  errorCode?: WhirlpoolsErrorCode;
  constructor(message: string, errorCode?: WhirlpoolsErrorCode) {
    super(message);
    this.message = message;
    this.errorCode = errorCode;
  }

  public static isWhirlpoolsErrorCode(e: any, code: WhirlpoolsErrorCode): boolean {
    return e instanceof WhirlpoolsError && e.errorCode === code;
  }
}
