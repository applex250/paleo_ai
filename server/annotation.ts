// 数据编辑锁 + 四级状态机 + 自动续期/巡检
// 状态机铁律：1↔2 由锁驱动（持锁=2，失锁=1）；0 不可逆；3 由 finish 产生。
// 所有写操作（含巡检）走 enqueue 串行化，状态与锁在同一 enqueue 任务内变更。
import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type Request, Response } from 'express';
import { db, STATUS_LABEL } from './db';
import { DATA_DIR } from './util';
import { enqueue } from './queue';

const LOCK_TTL_MS = 10 * 60 * 1000; // 锁有效期 10 分钟
const isoPlus = (ms: number): string => new Date(Date.now() + ms).toISOString();
const isoNow = (): string => new Date().toISOString();

const validateId = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

// 路由结果：用 ok 布尔判别，便于 TS 在 .then 里正确收窄
type RouteResult = { ok: true; renew?: boolean; status?: number; statusLabel?: string } | { ok: false; code: number; error: string };

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

export const annotationRouter = (): Router => {
  const r = Router();
  // save/finish 走原始字节（与 datasets 一致）；lock/heartbeat 走 JSON
  const rawBody = express.raw({ type: '*/*', limit: '200mb' });
  const jsonBody = express.json();
  const jsonBodyBig = express.json({ limit: '200mb' });

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
      // 被他人持锁且未过期 → 拒绝
      if (row.by && row.by !== username && !expired) {
        return fail(423, '该数据正在被他人编辑');
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
