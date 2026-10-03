export type Align = 'left' | 'center' | 'right';

export interface ColumnDef {
  /** 程序内唯一标识，同时作为行数据数组之外的稳定键名。 */
  key: string;
  /** 表头文本，与数据单元格走同一套校验与排版规则。 */
  title: string;
  /** 终端显示列宽（以显示列为单位，非字符数/码点数）。 */
  width: number;
  align?: Align;
}

/** 一行数据：数组顺序必须与 columns 完全一致；null/undefined 表示空单元格。 */
export type RowInput = (string | null | undefined)[];

export interface TableInput {
  columns: ColumnDef[];
  rows?: RowInput[];
}

export interface RenderedLine {
  /** 去掉对齐填充后的本行原始文本（换行片段）。 */
  text: string;
  /** 片段自身显示宽度。 */
  width: number;
  /** 左对齐填充空格数。 */
  paddingLeft: number;
  /** 右对齐填充空格数（居中奇数空格落在右侧）。 */
  paddingRight: number;
}

export interface RenderedCell {
  columnKey: string;
  /** 该单元格占用的全部输出行，已含显式空行。 */
  lines: RenderedLine[];
}

export interface RenderResult {
  /** 完整 ASCII 表格文本，末尾恰好一个换行。 */
  text: string;
  /** 表头单元格分行结果。 */
  header: RenderedCell[];
  /** 每个数据行的单元格分行结果。 */
  rows: RenderedCell[][];
  /** 每个数据行（逻辑行）补齐后的统一高度。 */
  rowHeights: number[];
  /** 表头补齐后的高度。 */
  headerHeight: number;
  /** 每条输出行的显示宽度，全部相等。 */
  totalWidth: number;
  widthRule: string;
}

export const WIDTH_RULE =
  'unicode-display-width:string-width@7; EastAsianWidth ambiguous=narrow(1); emoji=2; ZWJ序列按字素簇整体计算';
