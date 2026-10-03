import { test } from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import { renderTable } from '../src/layout.ts';
import { TableError } from '../src/errors.ts';
import type { TableInput } from '../src/types.ts';

function allOutputLines(result: ReturnType<typeof renderTable>): string[] {
  const text = result.text.endsWith('\n') ? result.text.slice(0, -1) : result.text;
  return text.split('\n');
}

test('人工短表格：边框、左对齐与换行位置', () => {
  const result = renderTable({
    columns: [
      { key: 'a', title: 'A', width: 5 },
      { key: 'b', title: 'B', width: 3 },
    ],
    rows: [['hello', 'x']],
  });
  const expected = [
    '+-------+-----+',
    '| A     | B   |',
    '+-------+-----+',
    '| hello | x   |',
    '+-------+-----+',
  ].join('\n') + '\n';
  assert.equal(result.text, expected);
  assert.equal(result.totalWidth, stringWidth(expected.split('\n')[0]));
});

test('三种对齐与居中奇数空格', () => {
  const result = renderTable({
    columns: [
      { key: 'l', title: 'L', width: 5, align: 'left' },
      { key: 'c', title: 'C', width: 5, align: 'center' },
      { key: 'r', title: 'R', width: 5, align: 'right' },
    ],
    rows: [['ab', 'ab', 'ab']],
  });
  const dataLine = allOutputLines(result)[3];
  assert.equal(dataLine, '| ab    |  ab   |    ab |');
  const center = result.rows[0][1].lines[0];
  assert.equal(center.paddingLeft, 1);
  assert.equal(center.paddingRight, 2);
});

test('中日韩宽字符按显示列换行，每条输出行总宽一致', () => {
  const result = renderTable({
    columns: [{ key: 'k', title: '中文', width: 4, align: 'left' }],
    rows: [['你好世界你']],
  });
  assert.deepEqual(
    result.rows[0][0].lines.map((l) => l.text),
    ['你好', '世界', '你'],
  );
  for (const line of allOutputLines(result)) {
    assert.equal(stringWidth(line), result.totalWidth);
  }
});

test('组合重音字素不被拆开', () => {
  const result = renderTable({
    columns: [{ key: 'k', title: 'e', width: 3 }],
    rows: [['é\u0301x']], // é + 组合重音 + x，按字素簇为 é(2显示列) + x(1)
  });
  const cell = result.rows[0][0];
  assert.deepEqual(cell.lines.map((l) => l.text), ['é\u0301x']);
});

test('ZWJ 表情字素簇整体处理', () => {
  const family = '👨‍👩‍👧'; // 零宽连接的家庭表情，宽度为 2
  const result = renderTable({
    columns: [{ key: 'k', title: 'emoji', width: 4 }],
    rows: [[family + family]],
  });
  assert.deepEqual(result.rows[0][0].lines.map((l) => l.text), [family + family]);
  // 收窄到 2 列时每个字素簇各占一行，不被拆开
  const narrow = renderTable({
    columns: [{ key: 'k', title: 'emoji', width: 2 }],
    rows: [[family + family]],
  });
  assert.deepEqual(narrow.rows[0][0].lines.map((l) => l.text), [family, family]);
});

test('超长英文词按字素安全断开', () => {
  const result = renderTable({
    columns: [{ key: 'k', title: 'w', width: 3 }],
    rows: [['abcdefg']],
  });
  assert.deepEqual(result.rows[0][0].lines.map((l) => l.text), ['abc', 'def', 'g']);
});

test('完整字素超过列宽时报错 GRAPHEME_TOO_WIDE，不截断', () => {
  assert.throws(
    () =>
      renderTable({
        columns: [{ key: 'k', title: 'w', width: 1 }],
        rows: [['中']],
      }),
    (err: unknown) => err instanceof TableError && err.code === 'GRAPHEME_TOO_WIDE',
  );
});

test('空表（只有表头）正常渲染', () => {
  const result = renderTable({
    columns: [{ key: 'k', title: 'K', width: 3 }],
    rows: [],
  });
  assert.equal(result.text, '+-----+\n| K   |\n+-----+\n+-----+\n');
  assert.deepEqual(result.rowHeights, []);
});

test('空单元格与空行：空单元格=1 个空片段', () => {
  const result = renderTable({
    columns: [
      { key: 'a', title: 'A', width: 4 },
      { key: 'b', title: 'B', width: 4 },
    ],
    rows: [['', null]],
  });
  assert.deepEqual(result.rows[0][0].lines.map((l) => l.text), ['']);
  assert.deepEqual(result.rows[0][1].lines.map((l) => l.text), ['']);
  const lines = allOutputLines(result);
  assert.equal(lines[3], '|      |      |');
});

test('显式换行、显式空行与尾部换行保留；同行补齐到一致高度', () => {
  const result = renderTable({
    columns: [
      { key: 'a', title: 'A', width: 4 },
      { key: 'b', title: 'B', width: 4 },
    ],
    rows: [['a\nb\n', 'z']],
  });
  assert.deepEqual(result.rows[0][0].lines.map((l) => l.text), ['a', 'b', '']);
  assert.equal(result.rowHeights[0], 3);
  // 第二列 1 个内容行 + 2 个补齐空行
  assert.equal(result.rows[0][1].lines.length, 1);
  const lines = allOutputLines(result);
  assert.deepEqual(lines.slice(3, 6), [
    '| a    | z    |',
    '| b    |      |',
    '|      |      |',
  ]);
});

test('列数不匹配报错', () => {
  assert.throws(
    () =>
      renderTable({
        columns: [
          { key: 'a', title: 'A', width: 2 },
          { key: 'b', title: 'B', width: 2 },
        ],
        rows: [['only']],
      }),
    (err: unknown) => err instanceof TableError && err.code === 'ROW_COLUMN_MISMATCH',
  );
});

test('非法宽度与非法对齐报错', () => {
  const base = (over: Record<string, unknown>): TableInput => ({
    columns: [{ key: 'a', title: 'A', width: 2, ...over }],
  });
  assert.throws(
    () => renderTable(base({ width: 0 })),
    (e: unknown) => e instanceof TableError && e.code === 'INVALID_WIDTH',
  );
  assert.throws(
    () => renderTable(base({ width: 2.5 })),
    (e: unknown) => e instanceof TableError && e.code === 'INVALID_WIDTH',
  );
  assert.throws(
    () => renderTable(base({ align: 'middle' })),
    (e: unknown) => e instanceof TableError && e.code === 'INVALID_ALIGN',
  );
});

test('制表符与 ANSI 转义被拒绝', () => {
  const mk = (cell: string) =>
    renderTable({ columns: [{ key: 'a', title: 'A', width: 10 }], rows: [[cell]] });
  assert.throws(
    () => mk('a\tb'),
    (e: unknown) => e instanceof TableError && e.code === 'UNSUPPORTED_CHARACTER',
  );
  assert.throws(
    () => mk('\x1b[31mred\x1b[0m'),
    (e: unknown) => e instanceof TableError && e.code === 'UNSUPPORTED_CHARACTER',
  );
  assert.throws(
    () => mk('a\rb'),
    (e: unknown) => e instanceof TableError && e.code === 'UNSUPPORTED_CHARACTER',
  );
});

test('每条输出行显示宽度全部相等（混排压力用例）', () => {
  const result = renderTable({
    columns: [
      { key: 'a', title: '姓名/Name', width: 10 },
      { key: 'b', title: '备注 note', width: 12, align: 'center' },
      { key: 'c', title: '数', width: 6, align: 'right' },
    ],
    rows: [
      ['王小明 Alice 非常长的英文名', '多行\n备注文本第二行', '1234567'],
      ['é\u0301moji👨‍👩‍👧', '', '1'],
    ],
  });
  for (const line of allOutputLines(result)) {
    assert.equal(stringWidth(line), result.totalWidth, `行宽不一致: ${JSON.stringify(line)}`);
  }
});

test('重复列 key 报错', () => {
  assert.throws(
    () =>
      renderTable({
        columns: [
          { key: 'k', title: 'A', width: 2 },
          { key: 'k', title: 'B', width: 2 },
        ],
      }),
    (e: unknown) => e instanceof TableError && e.code === 'DUPLICATE_COLUMN_KEY',
  );
});
