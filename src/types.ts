/**
 * 公共数据模型与类型定义。
 */

/** 列内对齐方式。 */
export type Align = "left" | "center" | "right";

/** 列定义。 */
export interface ColumnDef {
  /** 列标识，需在同一表格内唯一。 */
  key: string;
  /** 显示宽度（终端列数，整数 >=1）。 */
  width: number;
  /** 对齐方式，默认 left。 */
  align?: Align;
}

/** 表格输入：列定义、表头、行数据。 */
export interface TableInput {
  /** 表名（仅用于展示与检索）。 */
  name?: string;
  columns: ColumnDef[];
  /** 表头单元格，数量必须与列数一致；省略时使用列 key 作为表头。 */
  header?: string[];
  /** 数据行，每行单元格数量必须与列数一致。允许 0 行。 */
  rows: string[][];
}

/** 单个单元格排版后的结果。 */
export interface LaidCell {
  /** 原始文本（未做任何伪装性修改）。 */
  raw: string;
  /** 换行后每个逻辑行的文本（已按对齐方式填充到列宽）。 */
  lines: string[];
  /** 每个逻辑行的终端显示宽度（均等于列宽）。 */
  lineWidths: number[];
  /** 单元格占用的逻辑行数（= 该行统一行高）。 */
  height: number;
  /** 换行前每个“内容行”（显式换行切分）的显示宽度列表。 */
  sourceLineWidths: number[];
}

/** 一次排版的完整结果。 */
export interface LayoutResult {
  widthRule: string;
  columns: Required<ColumnDef>[];
  header: LaidCell[];
  rows: LaidCell[][];
  /** 数据区每一行补齐后的统一行高。 */
  rowHeights: number[];
  /** 表头行高。 */
  headerHeight: number;
  /** 整条输出中每一行的显示宽度（应全部相同）。 */
  totalWidth: number;
  /** 带 ASCII 边框的完整文本（以 \n 结尾）。 */
  text: string;
}
