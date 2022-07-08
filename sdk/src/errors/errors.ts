export enum MathErrorCode {
  MultiplicationOverflow,
  MulDivOverflow,
  MultiplicationShiftRightOverflow,
  DivideByZero,
}

export enum TokenErrorCode {
  TokenMaxExceeded,
  TokenMinSubceeded,
}

export enum SwapErrorCode {
  InvalidSqrtPriceLimitDirection,
  SqrtPriceOutOfBounds,
  ZeroTradableAmount,
  AmountOutBelowMinimum,
  AmountInAboveMaximum,
  TickArrayCrossingAboveMax,
  TickArrayIndexNotInitialized,
  TickArraySequenceInvalid,
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
