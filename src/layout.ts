import { fail } from "./errors.js";
import type { Align, ColumnDef, LaidCell, LayoutResult, TableInput } from "./types.js";
import { displayWidth, graphemes, validateText, WIDTH_RULE } from "./unicode.js";

const PAD = " ";

/** 贪心换行：按显示宽度把一条“内容行”（不含 \n）切成若干逻辑行。 */
function wrapLine(text: string, width: number, where: string): string[] {
  if (text === "") return [""];
  const clusters = graphemes(text);
  const out: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const cluster of clusters) {
    const w = displayWidth(cluster);
    if (w > width) {
      fail(
        "GLYPHE_TOO_WIDE",
        `${where}：字素 ${JSON.stringify(cluster)} 显示宽度 ${w} 超过列宽 ${width}`,
      );
    }
    if (currentWidth + w > width) {
      out.push(current);
      current = cluster;
      currentWidth = w;
    } else {
      current += cluster;
      currentWidth += w;
    }
  }
  out.push(current);
  return out;
}

/**
 * 按对齐方式把已换行的逻辑行填充到列宽。
 * 居中且两侧空格数不等时，多出来的 1 个空格放在左侧（视觉居中口径）。
 */
function padLine(line: string, width: number, align: Align): string {
  const w = displayWidth(line);
  const gap = width - w;
  if (gap <= 0) return line;
  if (align === "left") return line + PAD.repeat(gap);
  if (align === "right") return PAD.repeat(gap) + line;
  const right = Math.floor(gap / 2);
  const left = gap - right;
  return PAD.repeat(left) + line + PAD.repeat(right);
}

/** 排版单个单元格：校验 -> 显式换行 -> 贪心折行 -> 对齐填充。 */
export function layoutCell(raw: string, width: number, align: Align, where: string): LaidCell {
  validateText(raw, where);
  const sourceLines = raw.split("\n");
  const sourceLineWidths = sourceLines.map(displayWidth);
  const wrapped = sourceLines.flatMap((line) => wrapLine(line, width, where));
  const lines = wrapped.map((line) => padLine(line, width, align));
  return {
    raw,
    lines,
    lineWidths: lines.map(displayWidth),
    height: lines.length,
    sourceLineWidths,
  };
}

/** 校验列定义并补全默认值。 */
function normalizeColumns(columns: ColumnDef[]): Required<ColumnDef>[] {
  if (!Array.isArray(columns) || columns.length === 0) {
    fail("SCHEMA_VIOLATION", "columns 必须是非空数组");
  }
  const seen = new Set<string>();
  return columns.map((col, i) => {
    const where = `第 ${i + 1} 列`;
    if (typeof col !== "object" || col === null) fail("SCHEMA_VIOLATION", `${where}：定义无效`);
    if (typeof col.key !== "string" || col.key.trim() === "") {
      fail("SCHEMA_VIOLATION", `${where}：key 必须是非空字符串`);
    }
    if (seen.has(col.key)) fail("SCHEMA_VIOLATION", `${where}：key "${col.key}" 重复`);
    seen.add(col.key);
    if (!Number.isInteger(col.width) || col.width < 1) {
      fail("INVALID_WIDTH", `${where}（${col.key}）：width 必须是 >=1 的整数，实际为 ${String(col.width)}`);
    }
    const align: Align = col.align ?? "left";
    if (align !== "left" && align !== "center" && align !== "right") {
      fail("SCHEMA_VIOLATION", `${where}：align 必须是 left | center | right`);
    }
    return { key: col.key, width: col.width, align };
  });
}

function checkRow(row: unknown, count: number, label: string): string[] {
  if (!Array.isArray(row)) fail("SCHEMA_VIOLATION", `${label} 必须是数组`);
  if (row.length !== count) {
    fail(
      "COLUMN_COUNT_MISMATCH",
      `${label}：单元格数量 ${row.length} 与列数 ${count} 不一致`,
    );
  }
  return row.map((cell, i) => {
    if (typeof cell !== "string") {
      fail("SCHEMA_VIOLATION", `${label} 第 ${i + 1} 个单元格：必须是字符串（空值请用 ""）`);
    }
    return cell as string;
  });
}

function blankCell(width: number, align: Align): LaidCell {
  return layoutCell("", width, align, "空单元格");
}

/** 横向边框，如 +----+--------+ */
function horizontalBorder(cols: Required<ColumnDef>[], left: string, mid: string, right: string): string {
  return left + cols.map((c) => "-".repeat(c.width + 2)).join(mid) + right;
}

/** 把一组已排版单元格（高度统一）渲染为若干 "| x | y |" 行。 */
function renderCells(cells: LaidCell[], targetHeight: number): string[] {
  const result: string[] = [];
  for (let h = 0; h < targetHeight; h++) {
    const pieces = cells.map((cell, i) => {
      const line = cell.lines[h];
      return line === undefined ? " ".repeat((cells[i] ? widthOf(cells[i]!) : 0) + 2) : ` ${line} `;
    });
    result.push("|" + pieces.join("|") + "|");
  }
  return result;
}

function widthOf(cell: LaidCell): number {
  return cell.lineWidths[0] ?? 0;
}

/** 主入口：输入表格定义，返回分行/对齐/边框全部就绪的结果。 */
export function layoutTable(input: TableInput): LayoutResult {
  if (typeof input !== "object" || input === null) fail("SCHEMA_VIOLATION", "表格数据无效");
  const cols = normalizeColumns(input.columns);
  const count = cols.length;

  const headerRaw = checkRow(input.header ?? cols.map((c) => c.key), count, "表头");
  if (!Array.isArray(input.rows)) fail("SCHEMA_VIOLATION", "rows 必须是数组（无数据时传 []）");
  const rowsRaw = input.rows.map((row, i) => checkRow(row, count, `第 ${i + 1} 行数据`));

  const header = headerRaw.map((raw, i) => layoutCell(raw, cols[i]!.width, cols[i]!.align, `表头第 ${i + 1} 列`));
  const headerHeight = Math.max(...header.map((c) => c.height));
  // 表头同样补齐到统一高度（空表头单元格也占满高度）。
  for (let i = 0; i < header.length; i++) {
    const cell = header[i]!;
    const width = cols[i]!.width;
    while (cell.height < headerHeight) {
      cell.lines.push(padLine("", width, cols[i]!.align));
      cell.lineWidths.push(width);
      cell.height++;
    }
  }

  const rows: LaidCell[][] = rowsRaw.map((row) =>
    row.map((raw, i) => layoutCell(raw, cols[i]!.width, cols[i]!.align, `数据第 ${i + 1} 列`)),
  );
  const rowHeights = rows.map((row) => Math.max(1, ...row.map((c) => c.height)));

  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < count; i++) {
      const cell = rows[r]![i]!;
      const target = rowHeights[r]!;
      const width = cols[i]!.width;
      while (cell.height < target) {
        cell.lines.push(padLine("", width, cols[i]!.align));
        cell.height++;
        cell.lineWidths.push(width);
      }
    }
  }

  const totalWidth = cols.reduce((sum, c) => sum + c.width + 2, 0) + 1;

  const top = horizontalBorder(cols, "+", "-", "+");
  const headerSep = horizontalBorder(cols, "+", "=", "+");
  const rowSep = horizontalBorder(cols, "+", "-", "+");
  const bottom = horizontalBorder(cols, "+", "-", "+");

  const body: string[] = [top, ...renderCells(header, headerHeight), headerSep];
  rows.forEach((row, r) => {
    body.push(...renderCells(row, rowHeights[r]!));
    body.push(r === rows.length - 1 ? bottom : rowSep);
  });
  if (rows.length === 0) {
    // 无数据行：表头下直接闭合，仍保留可读边框。
    body[body.length - 1] = bottom;
  }
  const text = body.join("\n") + "\n";

  return {
    widthRule: WIDTH_RULE,
    columns: cols,
    header,
    rows,
    rowHeights,
    headerHeight,
    totalWidth,
    text,
  };
}

export { blankCell };
