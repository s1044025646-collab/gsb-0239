import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Storage } from '../src/storage.ts';
import { createApp, listen } from '../src/server.ts';

let server: Server;
let base: string;
let storage: Storage;
let dir: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'unitable-api-'));
  storage = new Storage(join(dir, 't.sqlite'));
  server = createApp(storage);
  const port = await listen(server, 0);
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

test('完整 API 流程：创建→保存→查单元格→导出→错误码', async () => {
  const created = await fetch(`${base}/api/tables`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      columns: [
        { key: 'name', title: '姓名', width: 8 },
        { key: 'age', title: '年龄', width: 4, align: 'right' },
      ],
      rows: [['王小明', '27']],
    }),
  }).then((r) => r.json() as Promise<{ id: string }>);
  assert.ok(created.id);

  const saved = await fetch(`${base}/api/tables/${created.id}/versions`, { method: 'POST' });
  assert.equal(saved.status, 201);

  const cell = await fetch(`${base}/api/tables/${created.id}/cells/0/name`).then((r) => r.json());
  assert.equal(cell.columnKey, 'name');
  assert.deepEqual(cell.lines.map((l: { text: string }) => l.text), ['王小明']);

  const exported = await fetch(`${base}/api/tables/${created.id}/export/1`);
  assert.equal(exported.headers.get('content-type'), 'text/plain; charset=utf-8');
  const text = await exported.text();
  assert.match(text, /王小明/);

  const bad = await fetch(`${base}/api/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ columns: [{ key: 'a', title: 'A', width: 1 }], rows: [['中']] }),
  });
  assert.equal(bad.status, 400);
  const body = (await bad.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'GRAPHEME_TOO_WIDE');

  const notFound = await fetch(`${base}/api/tables/nope`);
  assert.equal(notFound.status, 404);
});

test('列数不匹配返回 400 ROW_COLUMN_MISMATCH', async () => {
  const res = await fetch(`${base}/api/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      columns: [{ key: 'a', title: 'A', width: 3 }],
      rows: [['a', 'b']],
    }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'ROW_COLUMN_MISMATCH');
});
