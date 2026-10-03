import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Storage } from './storage.js';
import { renderTable, validateInput } from './layout.js';
import { TableError } from './errors.js';
import type { RenderedCell } from './types.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new TableError('BAD_REQUEST', '请求体超过 8 MiB 限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new TableError('BAD_REQUEST', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createApp(storage: Storage): Server {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, storage);
    } catch (err) {
      if (err instanceof TableError) {
        sendJson(res, err.code === 'NOT_FOUND' ? 404 : 400, {
          error: { code: err.code, message: err.message, details: err.details ?? null },
        });
      } else {
        sendJson(res, 500, {
          error: {
            code: 'INTERNAL',
            message: err instanceof Error ? err.message : '未知内部错误',
          },
        });
      }
    }
  });
  return server;
}

async function route(req: IncomingMessage, res: ServerResponse, storage: Storage): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  // 健康检查
  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  // 临时渲染（不落库）
  if (method === 'POST' && path === '/api/render') {
    const body = await readJson(req);
    const input = validateInput(body);
    sendJson(res, 200, renderTable(input));
    return;
  }

  const tableMatch = path.match(/^\/api\/tables\/([^/]+)(?:\/(.+))?$/);
  if (tableMatch) {
    const id = decodeURIComponent(tableMatch[1]);
    const sub = tableMatch[2] ?? '';

    if (method === 'GET' && sub === '') {
      sendJson(res, 200, storage.getTable(id));
      return;
    }
    if (method === 'PUT' && sub === '') {
      const body = await readJson(req);
      const input = validateInput(body);
      sendJson(res, 200, storage.updateTable(id, input));
      return;
    }
    if (method === 'POST' && sub === 'import') {
      const body = (await readJson(req)) as { rows?: unknown };
      if (!Array.isArray(body.rows)) {
        throw new TableError('INVALID_DATA', '导入体必须包含 rows 数组');
      }
      const current = storage.getTable(id).config;
      const merged = validateInput({ columns: current.columns, rows: body.rows });
      sendJson(res, 200, storage.updateTable(id, merged));
      return;
    }
    if (method === 'POST' && sub === 'preview') {
      const stored = storage.getTable(id);
      sendJson(res, 200, renderTable(stored.config));
      return;
    }
    if (method === 'POST' && sub === 'versions') {
      sendJson(res, 201, storage.saveVersion(id));
      return;
    }
    if (method === 'GET' && sub === 'versions') {
      sendJson(res, 200, { versions: storage.listVersions(id) });
      return;
    }
    const verMatch = sub.match(/^versions\/(latest|\d+)$/);
    if (method === 'GET' && verMatch) {
      const v = verMatch[1] === 'latest' ? 'latest' : Number(verMatch[1]);
      sendJson(res, 200, storage.getVersion(id, v));
      return;
    }
    const exportMatch = sub.match(/^export(?:\/(latest|\d+))?$/);
    if (method === 'GET' && exportMatch) {
      const v = !exportMatch[1]
        ? null
        : exportMatch[1] === 'latest'
          ? 'latest'
          : Number(exportMatch[1]);
      const text =
        v === null
          ? renderTable(storage.getTable(id).config).text
          : storage.getVersion(id, v).result.text;
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="table-${id}.txt"`,
      });
      res.end(text);
      return;
    }
    const cellMatch = sub.match(/^cells\/(\d+)\/([^/]+)$/);
    if (method === 'GET' && cellMatch) {
      const rowIndex = Number(cellMatch[1]);
      const colRef = decodeURIComponent(cellMatch[2]);
      const verParam = url.searchParams.get('version');
      const result = verParam
        ? storage.getVersion(id, verParam === 'latest' ? 'latest' : Number(verParam)).result
        : renderTable(storage.getTable(id).config);
      const columns = storage.getTable(id).config.columns;
      const colIndex = /^\d+$/.test(colRef)
        ? Number(colRef)
        : columns.findIndex((c) => c.key === colRef);
      if (colIndex < 0 || colIndex >= columns.length) {
        throw new TableError('NOT_FOUND', `列不存在: ${colRef}`, { column: colRef });
      }
      if (rowIndex < 0 || rowIndex >= result.rows.length) {
        throw new TableError('NOT_FOUND', `行不存在: ${rowIndex}`, { rowIndex });
      }
      const cell: RenderedCell = result.rows[rowIndex][colIndex];
      sendJson(res, 200, {
        rowIndex,
        columnKey: columns[colIndex].key,
        columnWidth: columns[colIndex].width,
        align: columns[colIndex].align ?? 'left',
        lines: cell.lines,
        height: cell.lines.length,
      });
      return;
    }
  }

  if (method === 'POST' && path === '/api/tables') {
    const body = await readJson(req);
    const input = validateInput(body);
    sendJson(res, 201, storage.createTable(input));
    return;
  }

  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `无此路由: ${method} ${path}` } });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function main(): Promise<void> {
  const dbPath = process.env.TABLE_DB_PATH ?? 'data/tables.sqlite';
  const requestedPort = Number(process.env.PORT ?? process.argv[2] ?? 0);
  const storage = new Storage(dbPath);
  const server = createApp(storage);
  const actualPort = await listen(server, Number.isInteger(requestedPort) ? requestedPort : 0);
  console.log(`Unicode 定宽表格服务已启动: http://127.0.0.1:${actualPort}`);
  console.log(`SQLite 数据文件: ${dbPath}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
