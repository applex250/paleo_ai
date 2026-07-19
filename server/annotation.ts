// 数据编辑锁 + 四级状态机 + 自动续期/巡检
// 状态机铁律：1↔2 由锁驱动（持锁=2，失锁=1）；0 不可逆；3 由 finish 产生。
// 所有写操作（含巡检）走 enqueue 串行化，状态与锁在同一 enqueue 任务内变更。
// 区间增量：POST /:id/intervals → 持锁队列内 Worker 读写 <id>.xlsx（JSON-only，幂等）。
// 沉积微相规则：GET/POST /micro-phase-rules（全局列表，成功导入原子替换）。
// 相颜色：POST /facies-colors（批量确保注册并返回名称→HEX；登录保护）。
import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type Request, Response } from 'express';
import * as XLSX from 'xlsx';
import {
  db,
  STATUS_LABEL,
  listMicroPhaseRules,
  replaceMicroPhaseRules,
  ensureFaciesColors,
  normalizeFaciesName,
} from './db';
import { DATA_DIR } from './util';
import { enqueue } from './queue';
import { runIntervalSave, type IntervalOpIn, type OpResult } from './intervalSave';

const LOCK_TTL_MS = 10 * 60 * 1000; // 锁有效期 10 分钟
const isoPlus = (ms: number): string => new Date(Date.now() + ms).toISOString();
const isoNow = (): string => new Date().toISOString();

const validateId = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

/** 路径仅由数字 id 派生，禁止外部路径片段。 */
const danjingXlsxPath = (id: number): string => path.join(DATA_DIR, 'danjing', `${id}.xlsx`);

// 路由结果：用 ok 布尔判别，便于 TS 在 .then 里正确收窄
type RouteResult =
  | { ok: true; renew?: boolean; status?: number; statusLabel?: string; results?: OpResult[] }
  | { ok: false; code: number; error: string; results?: OpResult[] };

const KINDS = new Set(['lithology', 'microPhase']);

/** 严格校验批量 JSON payload；拒绝二进制/非对象字段。支持 create/delete 增量。 */
function parseIntervalPayload(body: unknown):
  | { ok: true; wellName: string; operations: IntervalOpIn[] }
  | { ok: false; error: string } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const o = body as Record<string, unknown>;
  // 拒绝疑似二进制字段
  for (const banned of ['content', 'file', 'buffer', 'base64', 'xlsx', 'data']) {
    if (banned in o) return { ok: false, error: `不允许字段: ${banned}（仅接受 JSON 区间增量）` };
  }
  const wellName = typeof o.wellName === 'string' ? o.wellName.trim() : '';
  if (!Array.isArray(o.operations)) {
    return { ok: false, error: 'operations 必须是数组' };
  }
  if (o.operations.length === 0) {
    return { ok: false, error: 'operations 不能为空' };
  }
  if (o.operations.length > 500) {
    return { ok: false, error: '单次 operations 过多（最多 500）' };
  }
  const operations: IntervalOpIn[] = [];
  for (let i = 0; i < o.operations.length; i++) {
    const item = o.operations[i];
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `operations[${i}] 必须是对象` };
    }
    const op = item as Record<string, unknown>;
    const operationId = typeof op.operationId === 'string' ? op.operationId.trim() : '';
    if (!operationId || operationId.length > 128) {
      return { ok: false, error: `operations[${i}].operationId 无效` };
    }
    const kind = op.kind;
    if (kind !== 'lithology' && kind !== 'microPhase') {
      return { ok: false, error: `operations[${i}].kind 必须是 lithology 或 microPhase` };
    }
    const top = op.top;
    const bottom = op.bottom;
    if (typeof top !== 'number' || typeof bottom !== 'number' || !Number.isFinite(top) || !Number.isFinite(bottom)) {
      return { ok: false, error: `operations[${i}].top/bottom 必须是有限数字` };
    }
    if (top >= bottom) {
      return { ok: false, error: `operations[${i}] 顶深必须小于底深` };
    }
    const name = typeof op.name === 'string' ? op.name.trim() : '';
    if (!name || name.length > 200) {
      return { ok: false, error: `operations[${i}].name 无效` };
    }
    if (!KINDS.has(kind)) {
      return { ok: false, error: `operations[${i}].kind 非法` };
    }
    let action: 'create' | 'delete' = 'create';
    if (op.action != null) {
      if (op.action !== 'create' && op.action !== 'delete') {
        return { ok: false, error: `operations[${i}].action 必须是 create 或 delete` };
      }
      action = op.action;
    }
    let target: IntervalOpIn['target'];
    if (op.target != null) {
      if (typeof op.target !== 'object' || Array.isArray(op.target)) {
        return { ok: false, error: `operations[${i}].target 必须是对象` };
      }
      const t = op.target as Record<string, unknown>;
      const sheet = typeof t.sheet === 'string' ? t.sheet.trim() : undefined;
      const row = typeof t.row === 'number' && Number.isFinite(t.row) ? t.row : undefined;
      const originOperationId =
        typeof t.originOperationId === 'string' ? t.originOperationId.trim() : undefined;
      if (sheet != null && sheet.length > 200) {
        return { ok: false, error: `operations[${i}].target.sheet 过长` };
      }
      if (originOperationId != null && originOperationId.length > 128) {
        return { ok: false, error: `operations[${i}].target.originOperationId 无效` };
      }
      if (action === 'delete' && sheet == null && row == null && !originOperationId) {
        // 允许无 target（Worker 按顶底深/名称唯一匹配）
        target = undefined;
      } else {
        target = {};
        if (sheet) target.sheet = sheet;
        if (row != null) target.row = row;
        if (originOperationId) target.originOperationId = originOperationId;
      }
    }
    operations.push({ operationId, action, kind, top, bottom, name, target });
  }
  return { ok: true, wellName, operations };
}

// 写单井数据文件（覆盖 <id>.xlsx）
const writeDatasetFile = (id: number, buf: Buffer): void => {
  const fp = path.join(DATA_DIR, 'danjing', `${id}.xlsx`);
  fs.writeFileSync(fp, buf);
};

// 锁归属判定（在 enqueue 任务内调用，保证与后续 UPDATE 串行）
// 'ok' 持锁且未过期 | 'other' 被他人持锁且未过期 | 'none' 无锁/已过期 | 'missing' 记录不存在
type LockState = 'ok' | 'other' | 'none' | 'missing';
const lockState = (id: number, username: string): LockState => {
  const row = db
    .prepare('SELECT locked_by AS by, lock_expire_at AS exp FROM danjing_dataset WHERE id = ?')
    .get(id) as { by?: string; exp?: string } | undefined;
  if (!row) return 'missing';
  if (!row.by || !row.exp) return 'none';
  if (new Date(row.exp).getTime() < Date.now()) return 'none'; // 已过期
  if (row.by !== username) return 'other';
  return 'ok';
};

const lockErr = (state: LockState): RouteResult | null => {
  if (state === 'missing') return { ok: false, code: 404, error: '记录不存在' };
  if (state === 'other') return { ok: false, code: 423, error: '该数据正在被他人编辑' };
  if (state === 'none')
    return { ok: false, code: 423, error: '编辑权限已失效（锁已过期），请重新进入编辑' };
  return null;
};

const fail = (code: number, error: string): RouteResult => ({ ok: false, code, error });

/**
 * 解析单井标注规则 XLSX：
 * - 仅第一个工作表
 * - A1 修剪后必须严格等于「沉积微相」
 * - 只读第一列 A2 起；字符串化、trim、跳过空值、按首次出现保序去重
 * - 至少保留一项
 */
export function parseMicroPhaseRulesXlsx(
  buf: Buffer,
): { ok: true; names: string[] } | { ok: false; error: string } {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, error: '空请求体或无效内容' };
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buf, { type: 'buffer' });
  } catch {
    return { ok: false, error: '无法解析 XLSX 文件' };
  }
  if (!workbook.SheetNames?.length) {
    return { ok: false, error: '工作簿为空' };
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return { ok: false, error: '无法读取第一个工作表' };
  }
  // header:1 → 二维数组；raw:false → 单元格字符串化
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];
  const a1 = rows.length > 0 ? String(rows[0]?.[0] ?? '').trim() : '';
  if (a1 !== '沉积微相') {
    return { ok: false, error: '表头 A1 必须为「沉积微相」' };
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    // 仅第一列；忽略其他列
    const cell = rows[i]?.[0];
    const s = cell == null || cell === '' ? '' : String(cell).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    names.push(s);
  }
  if (names.length === 0) {
    return { ok: false, error: '沉积微相名称列表为空，至少需要一项' };
  }
  return { ok: true, names };
}

const FACIES_COLORS_MAX_NAMES = 2000;
const FACIES_NAME_MAX_LEN = 200;

/**
 * 严格校验 POST /facies-colors 的 JSON 体：{ names: string[] }。
 * 拒绝非对象、非数组、非字符串项、过长名称/过多项。
 */
export function parseFaciesColorsPayload(
  body: unknown,
): { ok: true; names: string[] } | { ok: false; error: string } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const o = body as Record<string, unknown>;
  for (const banned of ['content', 'file', 'buffer', 'base64', 'xlsx', 'data']) {
    if (banned in o) return { ok: false, error: `不允许字段: ${banned}` };
  }
  if (!('names' in o)) {
    return { ok: false, error: '缺少 names 字段' };
  }
  if (!Array.isArray(o.names)) {
    return { ok: false, error: 'names 必须是字符串数组' };
  }
  if (o.names.length > FACIES_COLORS_MAX_NAMES) {
    return { ok: false, error: `names 过多（最多 ${FACIES_COLORS_MAX_NAMES}）` };
  }
  const names: string[] = [];
  for (let i = 0; i < o.names.length; i++) {
    const item = o.names[i];
    if (typeof item !== 'string') {
      return { ok: false, error: `names[${i}] 必须是字符串` };
    }
    const n = normalizeFaciesName(item);
    if (!n) {
      return { ok: false, error: `names[${i}] 不能为空` };
    }
    if (n.length > FACIES_NAME_MAX_LEN) {
      return { ok: false, error: `names[${i}] 过长（最多 ${FACIES_NAME_MAX_LEN} 字符）` };
    }
    names.push(n);
  }
  return { ok: true, names };
}

export const annotationRouter = (): Router => {
  const r = Router();
  // save/finish 走原始字节（与 datasets 一致）；lock/heartbeat 走 JSON
  const rawBody = express.raw({ type: '*/*', limit: '200mb' });
  const jsonBody = express.json();
  const jsonBodyBig = express.json({ limit: '200mb' });

  // GET /api/annotation/micro-phase-rules —— 按导入顺序返回全局沉积微相规则
  r.get('/micro-phase-rules', (_req: Request, res: Response) => {
    try {
      const names = listMicroPhaseRules();
      return res.json({ ok: true, names });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/annotation/micro-phase-rules?filename=xxx.xlsx body=原始字节
  // 解析后原子替换历史规则并持久化（同事务内先注册颜色）
  r.post('/micro-phase-rules', rawBody, (req: Request, res: Response) => {
    const filename = String((req.query.filename as string | undefined) ?? '');
    if (!/\.xlsx$/i.test(filename)) {
      return res.status(400).json({ ok: false, error: '仅支持 .xlsx 文件' });
    }
    const buf = req.body as Buffer;
    const parsed = parseMicroPhaseRulesXlsx(buf);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    try {
      replaceMicroPhaseRules(parsed.names);
      return res.json({ ok: true, names: parsed.names, count: parsed.names.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/annotation/facies-colors  body={ names: string[] }
  // 批量确保相名称已登记，返回名称→HEX 映射（requireAuth 由 index 挂载）
  r.post('/facies-colors', jsonBody, (req: Request, res: Response) => {
    const parsed = parseFaciesColorsPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    try {
      const colors = ensureFaciesColors(parsed.names);
      return res.json({ ok: true, colors });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/annotation/:id/lock  —— 加锁，status→2
  r.post('/:id/lock', jsonBody, (req: Request, res: Response) => {
    const id = validateId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'invalid id' });
    const username = req.user!.username;
    enqueue<RouteResult>(() => {
      const row = db
        .prepare('SELECT locked_by AS by, lock_expire_at AS exp FROM danjing_dataset WHERE id = ?')
        .get(id) as { by?: string; exp?: string } | undefined;
      if (!row) return fail(404, '记录不存在');
      const expired = !row.exp || new Date(row.exp).getTime() < Date.now();
      // 有有效锁就拒绝（不区分是否同账号）→ 保证同一时刻只有一个编辑页打开。
      // 同一账号在另一 PC/标签页已打开编辑时，本端也进不去，需等对方退出/完成或锁过期（巡检）。
      if (row.by && !expired) {
        return fail(423, '该数据正在被编辑中（可能是您在另一设备/页面打开了编辑）');
      }
      db.prepare(
        'UPDATE danjing_dataset SET status = 2, locked_by = ?, lock_expire_at = ? WHERE id = ?',
      ).run(username, isoPlus(LOCK_TTL_MS), id);
      return { ok: true };
    })
      .then((result) => {
        if (result.ok) return res.json({ ok: true, status: 2, statusLabel: STATUS_LABEL[2] });
        return res.status(result.code).json({ error: result.error });
      })
      .catch((e) => res.status(500).json({ error: String(e) }));
  });

  // POST /api/annotation/:id/save  body=原始字节 —— 手动保存（不改 status/锁）
  r.post('/:id/save', rawBody, (req: Request, res: Response) => {
    const id = validateId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'invalid id' });
    const username = req.user!.username;
    const buf = req.body as Buffer;
    enqueue<RouteResult>(() => {
      const err = lockErr(lockState(id, username));
      if (err) return err;
      if (Buffer.isBuffer(buf) && buf.length > 0) writeDatasetFile(id, buf);
      return { ok: true };
    })
      .then((result) => {
        if (result.ok) return res.json({ ok: true });
        return res.status(result.code).json({ error: result.error });
      })
      .catch((e) => res.status(500).json({ error: String(e) }));
  });

  // POST /api/annotation/:id/finish  body=原始字节 —— 完成，status→3，释放锁
  r.post('/:id/finish', rawBody, (req: Request, res: Response) => {
    const id = validateId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'invalid id' });
    const username = req.user!.username;
    const buf = req.body as Buffer;
    enqueue<RouteResult>(() => {
      const err = lockErr(lockState(id, username));
      if (err) return err;
      if (Buffer.isBuffer(buf) && buf.length > 0) writeDatasetFile(id, buf);
      db.prepare(
        'UPDATE danjing_dataset SET status = 3, locked_by = NULL, lock_expire_at = NULL WHERE id = ?',
      ).run(id);
      return { ok: true };
    })
      .then((result) => {
        if (result.ok) return res.json({ ok: true, status: 3, statusLabel: STATUS_LABEL[3] });
        return res.status(result.code).json({ error: result.error });
      })
      .catch((e) => res.status(500).json({ error: String(e) }));
  });

  // POST /api/annotation/:id/heartbeat  body={active, content?} —— 续期/仅保存（不改 status）
  r.post('/:id/heartbeat', jsonBodyBig, (req: Request, res: Response) => {
    const id = validateId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'invalid id' });
    const username = req.user!.username;
    const { active, content } = (req.body ?? {}) as { active?: boolean; content?: string };
    enqueue<RouteResult>(() => {
      const err = lockErr(lockState(id, username));
      if (err) return err;
      if (active) {
        db.prepare('UPDATE danjing_dataset SET lock_expire_at = ? WHERE id = ?').run(
          isoPlus(LOCK_TTL_MS),
          id,
        );
      }
      if (typeof content === 'string' && content.length > 0) {
        writeDatasetFile(id, Buffer.from(content, 'base64'));
      }
      return { ok: true, renew: !!active };
    })
      .then((result) => {
        if (result.ok) return res.json({ ok: true, renew: result.renew });
        return res.status(result.code).json({ error: result.error });
      })
      .catch((e) => res.status(500).json({ error: String(e) }));
  });

  // POST /api/annotation/:id/exit  body=可选字节 —— 退出编辑：保存内容 + 释放锁 + status:2→1
  // （与巡检"失锁→1"一致；区别于 finish 的 status→3 终态）
  r.post('/:id/exit', rawBody, (req: Request, res: Response) => {
    const id = validateId(req.params.id);
    if (id == null) return res.status(400).json({ error: 'invalid id' });
    const username = req.user!.username;
    const buf = req.body as Buffer;
    enqueue<RouteResult>(() => {
      const err = lockErr(lockState(id, username));
      if (err) return err;
      if (Buffer.isBuffer(buf) && buf.length > 0) writeDatasetFile(id, buf);
      db.prepare(
        `UPDATE danjing_dataset
         SET status = CASE WHEN status = 2 THEN 1 ELSE status END,
             locked_by = NULL,
             lock_expire_at = NULL
         WHERE id = ?`,
      ).run(id);
      const row = db.prepare('SELECT status FROM danjing_dataset WHERE id = ?').get(id) as
        | { status: number }
        | undefined;
      const status = row?.status ?? 1;
      return { ok: true, status, statusLabel: STATUS_LABEL[status] };
    })
      .then((result) => {
        if (result.ok) {
          return res.json({ ok: true, status: result.status, statusLabel: result.statusLabel });
        }
        return res.status(result.code).json({ error: result.error });
      })
      .catch((e) => res.status(500).json({ error: String(e) }));
  });

  // POST /api/annotation/:id/intervals  body={ wellName, operations[] } —— JSON-only 增量写 xlsx
  // 持锁 + enqueue 串行；Worker Thread 读写 DATA_DIR/danjing/<id>.xlsx；operationId 幂等。
  r.post('/:id/intervals', jsonBody, (req: Request, res: Response) => {
    const id = validateId(req.params.id);
    if (id == null) return res.status(400).json({ ok: false, error: 'invalid id' });
    const username = req.user!.username;
    const parsed = parseIntervalPayload(req.body);
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

    const filePath = danjingXlsxPath(id);

    enqueue<RouteResult>(async () => {
      const err = lockErr(lockState(id, username));
      if (err) return err;
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return fail(404, 'xlsx 文件不存在');
      }
      const out = await runIntervalSave(filePath, parsed.wellName, parsed.operations);
      if (!out.ok) return fail(500, out.error);
      return { ok: true, results: out.results };
    })
      .then((result) => {
        if (result.ok) return res.json({ ok: true, results: result.results ?? [] });
        return res.status(result.code).json({ ok: false, error: result.error, results: result.results });
      })
      .catch((e) => res.status(500).json({ ok: false, error: String(e) }));
  });

  return r;
};

// 巡检：扫过期锁，status=2→1，清锁字段。由 index.ts 的 setInterval 每 60s 调一次。
export const sweepExpiredLocks = (): Promise<number> =>
  enqueue<number>(() => {
    const result = db
      .prepare(
        `UPDATE danjing_dataset
         SET status = CASE WHEN status = 2 THEN 1 ELSE status END,
             locked_by = NULL,
             lock_expire_at = NULL
         WHERE lock_expire_at IS NOT NULL AND lock_expire_at < ?`,
      )
      .run(isoNow());
    return (result as { changes: number }).changes;
  });
