import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TableError } from './errors.js';
import { renderTable } from './layout.js';
import type { RenderResult, TableInput } from './types.js';
import { WIDTH_RULE } from './types.js';

export interface StoredTable {
  id: string;
  config: TableInput;
  createdAt: string;
  updatedAt: string;
}

export interface StoredVersion {
  id: string;
  tableId: string;
  version: number;
  widthRule: string;
  layoutParams: { align?: unknown } & Record<string, unknown>;
  result: RenderResult;
  createdAt: string;
}

export class Storage {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        width_rule TEXT NOT NULL,
        layout_params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(table_id, version)
      );
    `);
  }

  createTable(config: TableInput): StoredTable {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO tables (id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(id, JSON.stringify(config), now, now);
    return { id, config, createdAt: now, updatedAt: now };
  }

  getTable(id: string): StoredTable {
    const row = this.db.prepare('SELECT * FROM tables WHERE id = ?').get(id) as
      | {
          id: string;
          config_json: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      throw new TableError('NOT_FOUND', `表格不存在: ${id}`, { id });
    }
    return {
      id: row.id,
      config: JSON.parse(row.config_json) as TableInput,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateTable(id: string, config: TableInput): StoredTable {
    this.getTable(id);
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE tables SET config_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(config), now, id);
    return { id, config, createdAt: this.getTable(id).createdAt, updatedAt: now };
  }

  /** 基于原始数据重新渲染，并保存一个不可变版本。 */
  saveVersion(tableId: string): StoredVersion {
    const stored = this.getTable(tableId);
    const nextVersionRow = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM versions WHERE table_id = ?')
      .get(tableId) as { next: number };
    const version = nextVersionRow.next;
    const result = renderTable(stored.config);
    const layoutParams = {
      columns: stored.config.columns.map((c) => ({
        key: c.key,
        width: c.width,
        align: c.align ?? 'left',
      })),
      wrapStrategy: 'deterministic-greedy-by-grapheme-cluster',
      ambiguousWidth: 'narrow(1)',
    };
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO versions
         (id, table_id, version, width_rule, layout_params_json, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        tableId,
        version,
        WIDTH_RULE,
        JSON.stringify(layoutParams),
        JSON.stringify(result),
        now,
      );
    return {
      id,
      tableId,
      version,
      widthRule: WIDTH_RULE,
      layoutParams,
      result,
      createdAt: now,
    };
  }

  getVersion(tableId: string, version: number | 'latest'): StoredVersion {
    this.getTable(tableId);
    const row =
      version === 'latest'
        ? (this.db
            .prepare('SELECT * FROM versions WHERE table_id = ? ORDER BY version DESC LIMIT 1')
            .get(tableId) as VersionRow | undefined)
        : (this.db
            .prepare('SELECT * FROM versions WHERE table_id = ? AND version = ?')
            .get(tableId, version) as VersionRow | undefined);
    if (!row) {
      throw new TableError('NOT_FOUND', `版本不存在: 表格 ${tableId} 版本 ${String(version)}`, {
        tableId,
        version,
      });
    }
    return hydrateVersion(row);
  }

  listVersions(tableId: string): { version: number; createdAt: string }[] {
    this.getTable(tableId);
    const rows = this.db
      .prepare('SELECT version, created_at FROM versions WHERE table_id = ? ORDER BY version')
      .all(tableId) as { version: number; created_at: string }[];
    return rows.map((r) => ({ version: r.version, createdAt: r.created_at }));
  }

  close(): void {
    this.db.close();
  }
}

interface VersionRow {
  id: string;
  table_id: string;
  version: number;
  width_rule: string;
  layout_params_json: string;
  result_json: string;
  created_at: string;
}

function hydrateVersion(row: VersionRow): StoredVersion {
  return {
    id: row.id,
    tableId: row.table_id,
    version: row.version,
    widthRule: row.width_rule,
    layoutParams: JSON.parse(row.layout_params_json),
    result: JSON.parse(row.result_json) as RenderResult,
    createdAt: row.created_at,
  };
}
