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

// 单井数据集表（status INTEGER + 编辑锁字段 + 项目归属）
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
    lock_expire_at TEXT,
    project        TEXT
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

// 全局沉积微相标注规则（导入顺序由 sort_order 保证；成功导入时整体替换）
db.exec(`
  CREATE TABLE IF NOT EXISTS annotation_micro_phase_rules (
    sort_order INTEGER NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL
  );
`);

/**
 * 相名称 → 唯一 HEX 全局注册表（微相/亚相/相共用）。
 * name 规范化后唯一；hex 唯一；seq 为分配顺序，保证重启后同序号生成同色。
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS facies_color_registry (
    name TEXT PRIMARY KEY NOT NULL,
    hex  TEXT NOT NULL UNIQUE,
    seq  INTEGER NOT NULL UNIQUE
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
      lock_expire_at TEXT,
      project        TEXT
    );
    INSERT INTO danjing_dataset (id, name, format, size_bytes, created_at, stored_file, status)
      SELECT id, name, format, size_bytes, created_at, stored_file, 0 FROM danjing_dataset_old;
    DROP TABLE danjing_dataset_old;
  `);
};
migrateDatasetSchema();

// 可重入迁移：为存量库补 project 列；仅对缺失/空项目的历史记录随机写入 项目A/B/C
const LEGACY_PROJECT_LABELS = ['项目A', '项目B', '项目C'] as const;
const migrateProjectColumn = (): void => {
  const cols = db.prepare('PRAGMA table_info(danjing_dataset)').all() as Array<{ name: string }>;
  const hasProject = cols.some((c) => c.name === 'project');
  if (!hasProject) {
    console.log('[db] 迁移 danjing_dataset：添加 project 字段');
    db.exec(`ALTER TABLE danjing_dataset ADD COLUMN project TEXT`);
  }
  const emptyRows = db
    .prepare(
      `SELECT id FROM danjing_dataset WHERE project IS NULL OR TRIM(project) = ''`,
    )
    .all() as Array<{ id: number }>;
  if (emptyRows.length === 0) return;
  const update = db.prepare(`UPDATE danjing_dataset SET project = ? WHERE id = ?`);
  tx(() => {
    for (const row of emptyRows) {
      const label = LEGACY_PROJECT_LABELS[Math.floor(Math.random() * LEGACY_PROJECT_LABELS.length)];
      update.run(label, row.id);
    }
  });
  console.log(`[db] 已为 ${emptyRows.length} 条历史单井记录随机写入项目归属`);
};

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

// project 迁移依赖 tx，故在 tx 定义之后执行
migrateProjectColumn();

// 列表：直接查库（不扫文件夹、不解析大文件 → 毫秒级）
export const listDanjing = (): FileMeta[] => {
  const rows = db
    .prepare(
      `SELECT id, name, format, size_bytes AS sizeBytes, created_at AS createdAt,
              status, stored_file AS storedFile, project
       FROM danjing_dataset ORDER BY id DESC`,
    )
    .all() as Array<{
    id: number;
    name: string;
    sizeBytes: number;
    createdAt: string;
    status: number;
    storedFile: string;
    project: string | null;
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
    project: r.project ?? undefined,
  }));
};

// 按 id 查 stored_file（<id>.xlsx）
export const getDanjingFile = (id: number): string | null => {
  const row = db
    .prepare('SELECT stored_file AS f FROM danjing_dataset WHERE id = ?')
    .get(id) as { f?: string } | undefined;
  return row?.f ?? null;
};

// 导入：插库拿 id → 写 <id>.xlsx → 回写 stored_file（一个事务）；project 由调用方校验非空
export const importDanjing = (
  buf: Buffer,
  friendlyName: string,
  project: string,
): { id: number; storedFile: string } => {
  const createdAt = new Date().toISOString().slice(0, 10);
  const insert = db.prepare(
    `INSERT INTO danjing_dataset (name, format, size_bytes, created_at, stored_file, project)
     VALUES (?, 'xlsx', ?, ?, '', ?)`,
  );
  const updateFile = db.prepare(`UPDATE danjing_dataset SET stored_file = ? WHERE id = ?`);
  return tx(() => {
    const res = insert.run(friendlyName, buf.length, createdAt, project) as {
      lastInsertRowid: number | bigint;
    };
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
    `INSERT INTO danjing_dataset (name, format, size_bytes, created_at, stored_file, project)
     VALUES (?, 'xlsx', ?, ?, '', ?)`,
  );
  const updateFile = db.prepare(`UPDATE danjing_dataset SET stored_file = ? WHERE id = ?`);
  let n = 0;
  tx(() => {
    for (const f of files) {
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      const project =
        LEGACY_PROJECT_LABELS[Math.floor(Math.random() * LEGACY_PROJECT_LABELS.length)];
      const res = insert.run(
        f.replace(/\.[^.]+$/, ''),
        st.size,
        st.mtime.toISOString().slice(0, 10),
        project,
      ) as {
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

/** 按导入顺序返回全局沉积微相规则名称。 */
export const listMicroPhaseRules = (): string[] => {
  const rows = db
    .prepare(
      `SELECT name FROM annotation_micro_phase_rules ORDER BY sort_order ASC`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
};

// ---------------------------------------------------------------------------
// 沉积相颜色注册表（自有算法，不引用 GeoViz FACIES_COLORS）
// ---------------------------------------------------------------------------

/** 未能解析到注册色时前端使用的稳定安全灰（非区间下标依赖）。 */
export const SAFE_FACIES_COLOR = '#c8c8c8';

/** 规范化相名称：trim + Unicode NFC；空串视为无效。 */
export function normalizeFaciesName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFC')
    .trim();
}

/** 将 0–1 分量转为两位 HEX。 */
function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
}

/**
 * HSL → #rrggbb（小写）。
 * h: 0–360, s/l: 0–1。
 */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return `#${toHex2((rp + m) * 255)}${toHex2((gp + m) * 255)}${toHex2((bp + m) * 255)}`;
}

/**
 * 按持久化序号生成高区分度柔和色（自有算法）。
 * 黄金角散布色相 + 中饱和 + 偏亮；attempt 用于冲突时微调。
 */
export function generateFaciesHexFromSeq(seq: number, attempt = 0): string {
  const s = Math.max(0, Math.floor(seq));
  const a = Math.max(0, Math.floor(attempt));
  // 黄金角 ~137.508°，保证相邻序号色相拉开
  const hue = (s * 137.508 + a * 47.13) % 360;
  // 柔和：饱和 42%–62%，明度 68%–82%，随序号与 attempt 微变
  const sat = 0.42 + ((s + a * 3) % 6) * 0.04;
  const lit = 0.68 + ((s * 2 + a) % 5) * 0.03;
  return hslToHex(hue, sat, lit);
}

const selectFaciesByName = () =>
  db.prepare(`SELECT name, hex, seq FROM facies_color_registry WHERE name = ?`);
const selectFaciesHexExists = () =>
  db.prepare(`SELECT 1 AS ok FROM facies_color_registry WHERE hex = ? LIMIT 1`);
const selectMaxFaciesSeq = () =>
  db.prepare(`SELECT COALESCE(MAX(seq), -1) AS m FROM facies_color_registry`);
const insertFaciesColor = () =>
  db.prepare(`INSERT INTO facies_color_registry (name, hex, seq) VALUES (?, ?, ?)`);

/**
 * 在已开启事务内：确保规范化名称已登记并返回 HEX。
 * 已存在则复用；否则按下一序号生成并检查颜色冲突。
 */
function ensureFaciesColorInTx(normalizedName: string): string {
  const existing = selectFaciesByName().get(normalizedName) as
    | { name: string; hex: string; seq: number }
    | undefined;
  if (existing?.hex) return existing.hex;

  const maxRow = selectMaxFaciesSeq().get() as { m: number };
  let nextSeq = (maxRow?.m ?? -1) + 1;
  const hexCheck = selectFaciesHexExists();
  const ins = insertFaciesColor();

  // 最多尝试多组 (seq, attempt)，保证 hex 唯一
  for (let wave = 0; wave < 64; wave++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const hex = generateFaciesHexFromSeq(nextSeq, attempt);
      // 避开安全灰与过暗/过亮极端（生成器已控制，这里再挡冲突）
      if (hex === SAFE_FACIES_COLOR.toLowerCase()) continue;
      const clash = hexCheck.get(hex) as { ok?: number } | undefined;
      if (clash) continue;
      try {
        ins.run(normalizedName, hex, nextSeq);
        return hex;
      } catch (e) {
        // 并发/竞态下 name 或 hex 唯一冲突：重新读 name
        const again = selectFaciesByName().get(normalizedName) as
          | { hex?: string }
          | undefined;
        if (again?.hex) return again.hex;
        // hex 冲突则换 attempt / seq
      }
    }
    nextSeq += 1;
  }
  throw new Error(`无法为相名称分配唯一颜色: ${normalizedName}`);
}

/**
 * 批量确保名称已登记，返回「规范化名称 → HEX」映射。
 * 在同一事务内处理全部名称；空名跳过。
 */
export const ensureFaciesColors = (names: string[]): Record<string, string> => {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const n = normalizeFaciesName(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  if (unique.length === 0) return {};

  return tx(() => {
    const out: Record<string, string> = {};
    for (const n of unique) {
      out[n] = ensureFaciesColorInTx(n);
    }
    return out;
  });
};

/** 查询已登记映射（不创建）；仅返回库中已有项。 */
export const lookupFaciesColors = (names: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  const stmt = selectFaciesByName();
  for (const raw of names) {
    const n = normalizeFaciesName(raw);
    if (!n || n in out) continue;
    const row = stmt.get(n) as { hex?: string } | undefined;
    if (row?.hex) out[n] = row.hex;
  }
  return out;
};

/**
 * 原子替换全局沉积微相规则。
 * names 须已去重、保序、非空；调用方负责校验。
 * 同一事务内先为每条名称注册颜色，再替换规则列表。
 */
export const replaceMicroPhaseRules = (names: string[]): void => {
  if (names.length === 0) {
    throw new Error('沉积微相规则至少需要一项');
  }
  const del = db.prepare(`DELETE FROM annotation_micro_phase_rules`);
  const ins = db.prepare(
    `INSERT INTO annotation_micro_phase_rules (sort_order, name) VALUES (?, ?)`,
  );
  tx(() => {
    for (const raw of names) {
      const n = normalizeFaciesName(raw);
      if (n) ensureFaciesColorInTx(n);
    }
    del.run();
    for (let i = 0; i < names.length; i++) {
      ins.run(i, names[i]);
    }
  });
};

export const closeDb = (): void => {
  db.close();
};
