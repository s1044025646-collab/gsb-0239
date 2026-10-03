/** 统一业务错误：携带稳定错误码，便于 API 与 CLI 区分处理。 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export type ErrorCode =
  | "INVALID_JSON"
  | "SCHEMA_VIOLATION"
  | "INVALID_WIDTH"
  | "COLUMN_COUNT_MISMATCH"
  | "UNSUPPORTED_CONTROL_CHAR"
  | "UNSUPPORTED_TAB"
  | "UNSUPPORTED_ANSI"
  | "GLYPHE_TOO_WIDE"
  | "NOT_FOUND"
  | "BAD_REQUEST";

export function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}
