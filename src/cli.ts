#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Storage } from './storage.js';
import { renderTable, validateInput } from './layout.js';
import { TableError } from './errors.js';
import { createApp, listen } from './server.js';

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(a.slice(2), next);
          i++;
        } else {
          flags.set(a.slice(2), true);
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf-8'));
  } catch (err) {
    throw new TableError(
      'BAD_REQUEST',
      `无法读取或解析文件 ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const DB_PATH = process.env.TABLE_DB_PATH ?? resolve('data/tables.sqlite');

function writeOut(text: string, out: string | boolean | undefined): void {
  if (typeof out === 'string') {
    writeFileSync(resolve(out), text, 'utf-8');
    console.error(`已写入 ${out}（${Buffer.byteLength(text, 'utf-8')} 字节 UTF-8）`);
  } else {
    process.stdout.write(text);
  }
}

async function main(): Promise<void> {
  const { positionals: args, flags } = parseArgs(process.argv.slice(2));
  const command = args[0] ?? 'help';

  if (command === 'help' || flags.has('help')) {
    printUsage();
    return;
  }

  switch (command) {
    case 'render': {
      const input = validateInput(readJsonFile(requireArg(args, 1, 'render <input.json>')));
      const result = renderTable(input);
      writeOut(result.text, flags.get('out'));
      break;
    }
    case 'serve': {
      const port = Number(flags.get('port') ?? process.env.PORT ?? 0);
      const storage = new Storage(DB_PATH);
      const server = createApp(storage);
      const actual = await listen(server, Number.isInteger(port) ? port : 0);
      console.log(`http://127.0.0.1:${actual}`);
      break;
    }
    case 'create': {
      const input = validateInput(readJsonFile(requireArg(args, 1, 'create <input.json>')));
      const storage = new Storage(DB_PATH);
      const table = storage.createTable(input);
      console.log(JSON.stringify(table, null, 2));
      storage.close();
      break;
    }
    case 'import': {
      const id = requireArg(args, 1, 'import <tableId> <rows.json>');
      const rows = (readJsonFile(requireArg(args, 2, 'import <tableId> <rows.json>')) as { rows?: unknown })
        .rows;
      const storage = new Storage(DB_PATH);
      const current = storage.getTable(id).config;
      const merged = validateInput({ columns: current.columns, rows });
      console.log(JSON.stringify(storage.updateTable(id, merged), null, 2));
      storage.close();
      break;
    }
    case 'preview': {
      const id = requireArg(args, 1, 'preview <tableId>');
      const storage = new Storage(DB_PATH);
      const version = flags.get('version');
      const text = version
        ? storage.getVersion(id, version === 'latest' ? 'latest' : Number(version)).result.text
        : renderTable(storage.getTable(id).config).text;
      writeOut(text, flags.get('out'));
      storage.close();
      break;
    }
    case 'cell': {
      const id = requireArg(args, 1, 'cell <tableId> <rowIndex> <columnKeyOrIndex>');
      const rowIndex = Number(requireArg(args, 2, 'cell <tableId> <rowIndex> <columnKeyOrIndex>'));
      const colRef = requireArg(args, 3, 'cell <tableId> <rowIndex> <columnKeyOrIndex>');
      if (!Number.isInteger(rowIndex) || rowIndex < 0) {
        throw new TableError('BAD_REQUEST', 'rowIndex 必须是非负整数');
      }
      const storage = new Storage(DB_PATH);
      const version = flags.get('version');
      const config = storage.getTable(id).config;
      const result = version
        ? storage.getVersion(id, version === 'latest' ? 'latest' : Number(version)).result
        : renderTable(config);
      const colIndex = /^\d+$/.test(colRef)
        ? Number(colRef)
        : config.columns.findIndex((c) => c.key === colRef);
      if (colIndex < 0 || colIndex >= config.columns.length) {
        throw new TableError('NOT_FOUND', `列不存在: ${colRef}`);
      }
      if (rowIndex >= result.rows.length) {
        throw new TableError('NOT_FOUND', `行不存在: ${rowIndex}`);
      }
      const cell = result.rows[rowIndex][colIndex];
      console.log(
        JSON.stringify(
          {
            rowIndex,
            columnKey: config.columns[colIndex].key,
            columnWidth: config.columns[colIndex].width,
            align: config.columns[colIndex].align ?? 'left',
            height: cell.lines.length,
            lines: cell.lines,
          },
          null,
          2,
        ),
      );
      storage.close();
      break;
    }
    case 'save': {
      const id = requireArg(args, 1, 'save <tableId>');
      const storage = new Storage(DB_PATH);
      console.log(JSON.stringify(storage.saveVersion(id), null, 2));
      storage.close();
      break;
    }
    case 'versions': {
      const id = requireArg(args, 1, 'versions <tableId>');
      const storage = new Storage(DB_PATH);
      console.log(JSON.stringify({ versions: storage.listVersions(id) }, null, 2));
      storage.close();
      break;
    }
    case 'export': {
      const id = requireArg(args, 1, 'export <tableId> [--version v]');
      const storage = new Storage(DB_PATH);
      const version = flags.get('version');
      const text = version
        ? storage.getVersion(id, version === 'latest' ? 'latest' : Number(version)).result.text
        : renderTable(storage.getTable(id).config).text;
      writeOut(text, flags.get('out'));
      storage.close();
      break;
    }
    default:
      throw new TableError('BAD_REQUEST', `未知命令: ${command}`);
  }
}

function requireArg(args: string[], index: number, usage: string): string {
  const value = args[index];
  if (value === undefined) {
    throw new TableError('BAD_REQUEST', `缺少参数。用法: uni-table ${usage}`);
  }
  return value;
}

function printUsage(): void {
  process.stdout.write(`uni-table — Unicode 定宽文本表格排版服务

用法:
  uni-table render <input.json> [--out out.txt]     临时渲染，不落库
  uni-table create <input.json>                     创建表格配置+数据，打印 id
  uni-table import <tableId> <rows.json>            替换导入行数据 ({"rows": [...]})
  uni-table preview <tableId> [--version v|latest]  预览文本
  uni-table cell <tableId> <rowIndex> <colKey|index> [--version v]
                                                    查看单元格分行与显示宽度
  uni-table save <tableId>                          用当前数据渲染并保存不可变版本
  uni-table versions <tableId>                      列出已保存版本
  uni-table export <tableId> [--version v|latest] [--out out.txt]
                                                    导出 UTF-8 文本
  uni-table serve [--port 0]                        启动 HTTP API（0=自动空闲端口）

环境变量:
  TABLE_DB_PATH   SQLite 路径（默认 ./data/tables.sqlite）
  PORT            服务端口（serve 默认自动选择空闲端口）
`);
}

main().catch((err: unknown) => {
  if (err instanceof TableError) {
    console.error(`错误 [${err.code}] ${err.message}`);
    if (err.details !== undefined) console.error(JSON.stringify(err.details));
  } else {
    console.error(err);
  }
  process.exit(1);
});
