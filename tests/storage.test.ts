import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../src/storage.ts';
import stringWidth from 'string-width';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'unitable-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('保存版本后重启，可导出与原结果逐字节一致的文本', () => {
  const dbPath = join(dir, 'tables.sqlite');
  const config = {
    columns: [
      { key: 'name', title: '姓名', width: 8 },
      { key: 'note', title: '备注', width: 10, align: 'center' },
    ],
    rows: [['王小明', '第一行\n第二行超长备注文字']],
  };

  const storage1 = new Storage(dbPath);
  const table = storage1.createTable(config);
  const version = storage1.saveVersion(table.id);
  const originalText = version.result.text;
  storage1.close();

  assert.ok(existsSync(dbPath));

  const storage2 = new Storage(dbPath);
  const restored = storage2.getVersion(table.id, 1);
  assert.equal(restored.result.text, originalText);
  assert.equal(restored.widthRule, version.widthRule);
  for (const line of restored.result.text.trimEnd().split('\n')) {
    assert.equal(stringWidth(line), restored.result.totalWidth);
  }
  storage2.close();

  assert.ok(readFileSync(dbPath).length > 0);
});

test('版本号自增，latest 指向最新版本', () => {
  const dbPath = join(dir, 'tables.sqlite');
  const storage = new Storage(dbPath);
  const table = storage.createTable({
    columns: [{ key: 'a', title: 'A', width: 4 }],
    rows: [['v1']],
  });
  storage.saveVersion(table.id);
  storage.updateTable(table.id, {
    columns: [{ key: 'a', title: 'A', width: 4 }],
    rows: [['v2xx']],
  });
  storage.saveVersion(table.id);
  const versions = storage.listVersions(table.id);
  assert.deepEqual(versions.map((v) => v.version), [1, 2]);
  const latest = storage.getVersion(table.id, 'latest');
  assert.match(latest.result.text, /v2xx/);
  storage.close();
});
