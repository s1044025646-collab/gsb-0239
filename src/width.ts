let segmenter: Intl.Segmenter;
try {
  segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
} catch {
  // Node 25 始终内置 Intl.Segmenter，此分支仅为类型完整。
  throw new Error('当前运行环境不支持 Intl.Segmenter，无法进行字素分割');
}

/** 将字符串切分为用户感知字符（字素簇），代理对/组合附标/ZWJ 表情不会被拆开。 */
export function graphemes(text: string): string[] {
  const result: string[] = [];
  for (const part of segmenter.segment(text)) {
    result.push(part.segment);
  }
  return result;
}
