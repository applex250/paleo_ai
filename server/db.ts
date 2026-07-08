import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, formatBytes } from './util';
import type { FileMeta } from './types';

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.resolve(DATA_DIR, 'metadata.db');
export const db = new DatabaseSync(DB_PATH);

// 性能调优（面向 300-400 人并发）：
//  WAL：读写不互锁；synchronous=NORMAL：WAL 下安全且快；cache_size：64MB 页缓存；temp 进内存。
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -64000;
  PRAGMA temp_store = MEMORY;
`);

// 标注状态：0原始 1未完成 2工作中 3已完成
export const STATUS_LABEL: Record<number, string> = {
  0: '原始',
  1: '未完成',
  2: '工作中',
  3: '已完成',
};

// 单井数据集表（status INTEGER + 编辑锁字段）
db.exec(`
  CREATE TABLE IF NOT EXISTS danjing_dataset (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    format         TEXT,
    size_bytes     INTEGER,
    created_at     TEXT NOT NULL,
    stored_file    TEXT NOT NULL,
    status         INTEGER NOT NULL DEFAULT 0,
    locked_by      TEXT,
    lock_expire_at TEXT
  );
`);

// 用户表（最小登录系统）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    created_at    TEXT NOT NULL
  );
`);

// 会话表
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
`);

// 一次性迁移：把旧表（status TEXT '原始'）重建为新结构（status INTEGER + 锁字段）
const migrateDatasetSchema = (): void => {
  const cols = db.prepare('PRAGMA table_info(danjing_dataset)').all() as Array<{
    name: string;
    type: string;
  }>;
  const statusCol = cols.find((c) => c.name === 'status');
  if (!statusCol) return;
  if (statusCol.type.toUpperCase() === 'INTEGER') return; // 已是新结构
  console.log('[db] 迁移 danjing_dataset：status TEXT→INTEGER + 锁字段');
  db.exec(`
    ALTER TABLE danjing_dataset RENAME TO danjing_dataset_old;
    CREATE TABLE danjing_dataset (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      format         TEXT,
      size_bytes     INTEGER,
      created_at     TEXT NOT NULL,
      stored_file    TEXT NOT NULL,
      status         INTEGER NOT NULL DEFAULT 0,
      locked_by      TEXT,
      lock_expire_at TEXT
    );
    INSERT INTO danjing_dataset (id, name, format, size_bytes, created_at, stored_file, status)
      SELECT id, name, format, size_bytes, created_at, stored_file, 0 FROM danjing_dataset_old;
    DROP TABLE danjing_dataset_old;
  `);
};
migrateDatasetSchema();

// 事务辅助
const tx = <T>(fn: () => T): T => {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

// 列表：直接查库（不扫文件夹、不解析大文件 → 毫秒级）
export const listDanjing = (): FileMeta[] => {
  const rows = db
    .prepare(
      `SELECT id, name, format, size_bytes AS sizeBytes, created_at AS createdAt,
              status, stored_file AS storedFile
       FROM danjing_dataset ORDER BY id DESC`,
    )
    .all() as Array<{
    id: number;
    name: string;
    sizeBytes: number;
    createdAt: string;
    status: number;
    storedFile: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    filename: r.storedFile,
    name: r.name,
    ext: 'xlsx',
    sizeText: formatBytes(r.sizeBytes || 0),
    date: r.createdAt,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status] ?? '原始',
  }));
};

// 按 id 查 stored_file（<id>.xlsx）
export const getDanjingFile = (id: number): string | null => {
  const row = db
    .prepare('SELECT stored_file AS f FROM danjing_dataset WHERE id = ?')
    .get(id) as { f?: string } | undefined;
  return row?.f ?? null;
};

// 导入：插库拿 id → 写 <id>.xlsx → 回写 stored_file（一个事务）
export const importDanjing = (buf: Buffer, friendlyName: string): { id: number; storedFile: string } => {
  const createdAt = new Date().toISOString().slice(0, 10);
  const insert = db.prepare(
    `INSERT INTO danjing_dataset (name, format, size_bytes, created_at, stored_file) VALUES (?, 'xlsx', ?, ?, '')`,
  );
  const updateFile = db.prepare(`UPDATE danjing_dataset SET stored_file = ? WHERE id = ?`);
  return tx(() => {
    const res = insert.run(friendlyName, buf.length, createdAt) as { lastInsertRowid: number | bigint };
    const id = Number(res.lastInsertRowid);
    const storedFile = `${id}.xlsx`;
    fs.writeFileSync(path.join(DATA_DIR, 'danjing', storedFile), buf);
    updateFile.run(storedFile, id);
    return { id, storedFile };
  });
};

// 删除：按 id 删库记录 + 对应文件（先删记录，避免孤儿记录）
export const deleteDanjing = (id: number): string | null => {
  const file = getDanjingFile(id);
  if (!file) return null;
  db.prepare('DELETE FROM danjing_dataset WHERE id = ?').run(id);
  try {
    fs.unlinkSync(path.join(DATA_DIR, 'danjing', path.basename(file)));
  } catch {
    /* 文件已不在则忽略 */
  }
  return path.basename(file);
};

// 一次性迁移：库为空时把 danjing 现有 xlsx 登记并改名为 <id>.xlsx
const migrateDanjingIfNeeded = (): number => {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM danjing_dataset`).get() as { c: number };
  if (row.c > 0) return 0; // 已有数据，不重复迁移
  const dir = path.join(DATA_DIR, 'danjing');
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.') && /\.xlsx$/i.test(f));
  if (!files.length) return 0;
  const insert = db.prepare(
    `INSERT INTO danjing_dataset (name, format, size_bytes, created_at, stored_file) VALUES (?, 'xlsx', ?, ?, '')`,
  );
  const updateFile = db.prepare(`UPDATE danjing_dataset SET stored_file = ? WHERE id = ?`);
  let n = 0;
  tx(() => {
    for (const f of files) {
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      const res = insert.run(f.replace(/\.[^.]+$/, ''), st.size, st.mtime.toISOString().slice(0, 10)) as {
        lastInsertRowid: number | bigint;
      };
      const id = Number(res.lastInsertRowid);
      const storedFile = `${id}.xlsx`;
      fs.renameSync(fp, path.join(dir, storedFile));
      updateFile.run(storedFile, id);
      n++;
    }
  });
  return n;
};

const migratedCount = migrateDanjingIfNeeded();
if (migratedCount > 0) {
  console.log(`[db] 已把 danjing 现有 ${migratedCount} 个 xlsx 登记进 SQLite 并改名为 <id>.xlsx`);
}

export const closeDb = (): void => {
  db.close();
};
