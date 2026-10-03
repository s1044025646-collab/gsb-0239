import stringWidth from 'string-width';
import { TableError } from './errors.js';
import { graphemes } from './width.js';
import type {
  Align,
  ColumnDef,
  RenderedCell,
  RenderedLine,
  RenderResult,
  RowInput,
  TableInput,
} from './types.js';
import { WIDTH_RULE } from './types.js';

/**
 * 原始文本校验：
 * - 拒绝制表符（\t 及其他 Unicode 制表符）；
 * - 拒绝 ANSI/CSI 控制序列（ESC 与其他 C0/C1 控制符）；
 * - 仅保留 \n 作为显式换行；\r 单独出现也拒绝，避免隐藏光标/回车覆盖。
 */
export function validateRawText(value: unknown): asserts value is string | null | undefined {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') {
    throw new TableError('INVALID_DATA', '单元格内容必须是字符串、null 或 undefined');
  }
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n') continue;
    if (ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\b') {
      throw new TableError(
        'UNSUPPORTED_CHARACTER',
        `不支持的控制字符 U+${cp.toString(16).toUpperCase().padStart(4, '0')}，本题仅支持 \\n 显式换行`,
        { codepoint: cp },
      );
    }
    if (cp === 0x1b || cp === 0x85) {
      throw new TableError(
        'UNSUPPORTED_CHARACTER',
        cp === 0x1b
          ? '不允许 ANSI/CSI 转义序列（ESC），排版只处理纯文本'
          : '不允许 NEL(U+0085) 行分隔符，请使用 \\n',
        { codepoint: cp },
      );
    }
    if (cp < 0x20 || (cp >= 0x80 && cp <= 0x9f)) {
      throw new TableError(
        'UNSUPPORTED_CHARACTER',
        `不支持的控制字符 U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        { codepoint: cp },
      );
    }
  }
}

function validateColumns(columns: unknown): asserts columns is ColumnDef[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new TableError('EMPTY_COLUMNS', 'columns 必须是非空数组，至少定义一列');
  }
  const keys = new Set<string>();
  for (const col of columns) {
    if (!col || typeof col !== 'object' || typeof col.key !== 'string' || col.key.length === 0) {
      throw new TableError('INVALID_CONFIG', '每列必须包含非空字符串 key');
    }
    if (keys.has(col.key)) {
      throw new TableError('DUPLICATE_COLUMN_KEY', `列 key 重复: ${col.key}`, { key: col.key });
    }
    keys.add(col.key);
    if (typeof col.title !== 'string') {
      throw new TableError('INVALID_CONFIG', `列 ${col.key} 的 title 必须是字符串`);
    }
    validateRawText(col.title);
    if (!Number.isInteger(col.width) || col.width < 1) {
      throw new TableError(
        'INVALID_WIDTH',
        `列 ${col.key} 的 width 必须是 >= 1 的整数，收到: ${String(col.width)}`,
        { key: col.key, width: col.width },
      );
    }
    const align: unknown = col.align ?? 'left';
    if (align !== 'left' && align !== 'center' && align !== 'right') {
      throw new TableError('INVALID_ALIGN', `列 ${col.key} 的 align 非法: ${String(align)}`, {
        key: col.key,
        align,
      });
    }
  }
}

function validateRows(rows: unknown, columnCount: number): asserts rows is RowInput[] {
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    throw new TableError('INVALID_DATA', 'rows 必须是数组');
  }
  rows.forEach((row, r) => {
    if (!Array.isArray(row)) {
      throw new TableError('ROW_COLUMN_MISMATCH', `第 ${r} 行必须是数组`, { rowIndex: r });
    }
    if (row.length !== columnCount) {
      throw new TableError(
        'ROW_COLUMN_MISMATCH',
        `第 ${r} 行有 ${row.length} 列，但定义了 ${columnCount} 列`,
        { rowIndex: r, expected: columnCount, actual: row.length },
      );
    }
    row.forEach((cell) => validateRawText(cell));
  });
}

export function validateInput(input: unknown): TableInput {
  if (!input || typeof input !== 'object') {
    throw new TableError('BAD_REQUEST', '请求体必须是 JSON 对象');
  }
  const obj = input as TableInput;
  validateColumns(obj.columns);
  validateRows(obj.rows, obj.columns.length);
  return { columns: obj.columns, rows: obj.rows ?? [] };
}

/**
 * 显式换行规则（与渲染一致，供外部复用）：
 * 按 \n 切分为段落；空字符串 => 一个空段落；
 * 末尾 \n 产生一个显式空段落（保留），但不会再额外补行。
 */
export function splitParagraphs(text: string): string[] {
  if (text === '') return [''];
  const parts = text.split('\n');
  return parts;
}

function wrapGraphemeGreedy(paragraph: string, width: number): string[] {
  if (paragraph === '') return [''];
  const units = graphemes(paragraph);
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const g of units) {
    const w = stringWidth(g);
    if (w > width) {
      throw new TableError(
        'GRAPHEME_TOO_WIDE',
        `字素 ${g} 显示宽度为 ${w}，超过该列宽度 ${width}；不做截断或超宽输出`,
        { grapheme: g, graphemeWidth: w, columnWidth: width },
      );
    }
    if (currentWidth + w > width) {
      lines.push(current);
      current = g;
      currentWidth = w;
    } else {
      current += g;
      currentWidth += w;
    }
  }
  lines.push(current);
  return lines;
}

function alignLine(text: string, width: number, align: Align): RenderedLine {
  const contentWidth = stringWidth(text);
  const gap = width - contentWidth;
  let paddingLeft: number;
  let paddingRight: number;
  if (align === 'right') {
    paddingLeft = gap;
    paddingRight = 0;
  } else if (align === 'center') {
    // 奇数空格时左侧 floor、右侧 ceil，右边界始终整齐。
    paddingLeft = Math.floor(gap / 2);
    paddingRight = gap - paddingLeft;
  } else {
    paddingLeft = 0;
    paddingRight = gap;
  }
  return { text, width: contentWidth, paddingLeft, paddingRight };
}

function renderCell(value: string | null | undefined, col: ColumnDef): RenderedCell {
  const text = value ?? '';
  const align: Align = col.align ?? 'left';
  const fragments = splitParagraphs(text).flatMap((p) => wrapGraphemeGreedy(p, col.width));
  return {
    columnKey: col.key,
    lines: fragments.map((frag) => alignLine(frag, col.width, align)),
  };
}

const BORDER_TL = '+';
const BORDER_TR = '+';
const BORDER_BL = '+';
const BORDER_BR = '+';
const BORDER_H = '-';
const BORDER_V = '|';
const BORDER_CROSS = '+';

function horizontalRule(left: string, mid: string, right: string, columns: ColumnDef[]): string {
  return (
    left + columns.map((col) => BORDER_H.repeat(col.width + 2)).join(mid) + right
  );
}

function padRenderedLine(line: RenderedLine): string {
  return ' '.repeat(line.paddingLeft) + line.text + ' '.repeat(line.paddingRight);
}

function padCell(cell: RenderedCell, height: number): RenderedLine[] {
  const width = cell.lines[0].paddingLeft + cell.lines[0].width + cell.lines[0].paddingRight;
  const blank: RenderedLine = { text: '', width: 0, paddingLeft: 0, paddingRight: width };
  const lines = [...cell.lines];
  while (lines.length < height) lines.push(blank);
  return lines;
}

export function renderTable(input: unknown): RenderResult {
  const { columns, rowsRaw } = (() => {
    const v = validateInput(input);
    return { columns: v.columns, rowsRaw: v.rows ?? [] };
  })();

  const headerCells = columns.map((col) => renderCell(col.title, col));
  const headerHeight = Math.max(1, ...headerCells.map((c) => c.lines.length));

  const renderedRows = rowsRaw.map((row) =>
    row.map((value, i) => renderCell(value, columns[i])),
  );
  const rowHeights = renderedRows.map((cells) => Math.max(1, ...cells.map((c) => c.lines.length)));

  const totalWidth =
    1 + columns.reduce((sum, col) => sum + col.width + 2, 0) + (columns.length - 1) + 1;

  const topRule = horizontalRule(BORDER_TL, BORDER_CROSS, BORDER_TR, columns);
  const midRule = horizontalRule(BORDER_CROSS, BORDER_CROSS, BORDER_CROSS, columns);
  const bottomRule = horizontalRule(BORDER_BL, BORDER_CROSS, BORDER_BR, columns);

  const lines: string[] = [topRule];
  const paddedHeader = headerCells.map((cell) => padCell(cell, headerHeight));
  for (let h = 0; h < headerHeight; h++) {
    lines.push(BORDER_V + paddedHeader.map((cell) => ' ' + padRenderedLine(cell[h]) + ' ').join(BORDER_V) + BORDER_V);
  }
  lines.push(midRule);

  renderedRows.forEach((cells, r) => {
    const height = rowHeights[r];
    const padded = cells.map((cell) => padCell(cell, height));
    for (let h = 0; h < height; h++) {
      lines.push(
        BORDER_V + padded.map((cell) => ' ' + padRenderedLine(cell[h]) + ' ').join(BORDER_V) + BORDER_V,
      );
    }
  });
  lines.push(bottomRule);

  const text = lines.join('\n') + '\n';

  return {
    text,
    header: headerCells,
    rows: renderedRows,
    rowHeights,
    headerHeight,
    totalWidth,
    widthRule: WIDTH_RULE,
  };
}
