/** 统一错误码，便于 API 与 CLI 精确处理。 */
export type ErrorCode =
  | 'INVALID_CONFIG'
  | 'EMPTY_COLUMNS'
  | 'DUPLICATE_COLUMN_KEY'
  | 'INVALID_WIDTH'
  | 'INVALID_ALIGN'
  | 'ROW_COLUMN_MISMATCH'
  | 'UNSUPPORTED_CHARACTER'
  | 'GRAPHEME_TOO_WIDE'
  | 'INVALID_DATA'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'VERSION_MISMATCH';

export class TableError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'TableError';
    this.code = code;
    this.details = details;
  }
}
