// 端到端演示：建库 → 创建 → 导入 → 预览 → 改列宽 → 存版本 → 查单元格 → 导出
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });
const dbPath = resolve(dataDir, 'demo.sqlite');
rmSync(dbPath, { force: true });
rmSync(dbPath + '-wal', { force: true });
rmSync(dbPath + '-shm', { force: true });

const cli = resolve(root, 'dist', 'cli.js');
const run = (args) =>
  execFileSync(process.execPath, ['--experimental-sqlite', cli, ...args], {
    cwd: root,
    env: { ...process.env, TABLE_DB_PATH: dbPath },
    encoding: 'utf-8',
  });

const show = (title, args) => {
  console.log(`\n===== ${title} =====`);
  process.stdout.write(run(args));
};

show('1) 不落库直接渲染（默认列宽）', ['render', 'samples/demo.json']);
show('2) 收窄列宽后的重排结果', ['render', 'samples/demo-narrow.json']);

const created = JSON.parse(run(['create', 'samples/demo.json']));
console.log('\n===== 3) 已创建表格 id =====');
console.log(created.id);

run(['import', created.id, 'samples/rows.json']);
show('4) 导入新数据后的预览', ['preview', created.id]);

const saved = JSON.parse(run(['save', created.id]));
console.log('\n===== 5) 已保存版本 =====', 'v' + saved.version, '宽度规则:', saved.widthRule);

console.log('\n===== 6) 单元格 0/name 的分行与显示宽度 =====');
process.stdout.write(run(['cell', created.id, '0', 'name']));

const outFile = resolve(dataDir, 'demo-export.txt');
run(['export', created.id, '--version', '1', '--out', 'data/demo-export.txt']);
console.log('\n===== 7) 已导出 UTF-8 文本 =====', outFile);
console.log('（模拟重启：版本文本直接来自 SQLite 中的保存结果）');
process.stdout.write(readFileSync(outFile, 'utf-8'));
writeFileSync(resolve(dataDir, '.gitkeep'), '');
