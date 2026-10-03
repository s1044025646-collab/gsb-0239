import stringWidth from "string-width";
import { fail } from "./errors.js";

/**
 * 宽度口径（统一、确定）：
 * - 使用 string-width（unicode-width 规则集）计算终端显示列宽；
 * - East Asian Ambiguous（模糊宽度）一律按窄字符（1 列）处理；
 * - emoji 变体序列 / ZWJ 序列按字素簇整体计量，不拆分代理对、组合附标、ZWJ。
 */
export const WIDTH_RULE = "string-width@8 (unicode-width); ambiguous=narrow";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** 把字符串切分为字素簇（grapheme cluster），不拆代理对/组合附标/ZWJ 表情。 */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(text)) out.push(seg.segment);
  return out;
}

/** 计算字素簇/字符串的终端显示列宽。 */
export function displayWidth(text: string): number {
  return stringWidth(text, { ambiguousIsNarrow: true });
}

/**
 * 校验原始文本：拒绝制表符、ANSI 转义序列及其他控制字符。
 * 唯一允许的控制字符是换行符 \n（显式换行）。
 */
export function validateText(raw: string, where: string): void {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = raw[i];
    if (ch === "\t") {
      fail("UNSUPPORTED_TAB", `${where}：不支持制表符 \\t（第 ${i} 个码元），请使用显式空格或换行`);
    }
    if (code === 0x1b) {
      fail("UNSUPPORTED_ANSI", `${where}：不支持 ANSI/终端转义序列（ESC，第 ${i} 个码元）`);
    }
    const isC0 = code <= 0x1f && ch !== "\n";
    const isDel = code === 0x7f;
    const isC1 = code >= 0x80 && code <= 0x9f;
    if (isC0 || isDel || isC1) {
      fail(
        "UNSUPPORTED_CONTROL_CHAR",
        `${where}：不支持控制字符 U+${code.toString(16).toUpperCase().padStart(4, "0")}（第 ${i} 个码元）`,
      );
    }
  }
}
