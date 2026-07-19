import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, sanitize, listFiles } from './util';
import { listDanjing, importDanjing, deleteDanjing, getDanjingFile, closeDb } from './db';
import { runConvert } from './convert';
import { enqueue, flush } from './queue';
import { FOLDERS, isFolderKey } from './types';
import { authRouter, requireAuth } from './auth';
import { annotationRouter, sweepExpiredLocks } from './annotation';

const app = express();
const PORT = Number(process.env.PORT ?? 2999);

// 上传：前端把文件原始字节作为 body 发送（非 multipart）
app.use('/api/datasets', express.raw({ type: '*/*', limit: '200mb' }));
// 所有 /api/datasets 需登录（登录态覆盖全站，避免匿名绕过锁机制删数据）
app.use('/api/datasets', requireAuth);

const send = (res: express.Response, code: number, data: unknown) =>
  res.status(code).json(data);

// GET /api/datasets?key=danjing|dizhen|qiepian  —— 列表
app.get('/api/datasets', (req, res) => {
  const key = req.query.key as string | undefined;
  if (!isFolderKey(key)) return send(res, 400, { error: 'invalid key' });
  const files = FOLDERS[key].useDb ? listDanjing() : listFiles(key);
  return send(res, 200, {
    key,
    label: FOLDERS[key].label,
    toXlsx: FOLDERS[key].toXlsx,
    files,
  });
});

// GET /api/datasets/:key/file?id=<id> | &name=<name>  —— 下载真实文件
app.get('/api/datasets/:key/file', (req, res) => {
  const key = req.params.key;
  if (!isFolderKey(key)) return send(res, 400, { error: 'invalid key' });
  let fileName: string | null = null;
  if (FOLDERS[key].useDb) {
    const idRaw = req.query.id as string | undefined;
    if (idRaw == null || !/^\d+$/.test(idRaw)) return send(res, 400, { error: 'invalid id' });
    const f = getDanjingFile(Number(idRaw));
    if (!f) return send(res, 404, { error: '记录不存在' });
    fileName = f;
  } else {
    fileName = (req.query.name as string | undefined) ?? null;
  }
  if (!fileName) return send(res, 400, { error: '缺少文件名' });
  // 防路径穿越：只允许裸文件名
  const safe = path.basename(fileName);
  if (!safe || safe !== fileName || safe.includes('..')) return send(res, 400, { error: '非法文件名' });
  const fp = path.join(DATA_DIR, key, safe);
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return send(res, 404, { error: '文件不存在' });
  return res.download(fp, safe); // 流式 + 自带 Content-Disposition
});

// POST /api/datasets/:key?filename=<原名>  body=原始文件字节
app.post('/api/datasets/:key', async (req, res) => {
  const key = req.params.key;
  if (!isFolderKey(key)) return send(res, 400, { error: 'invalid key' });
  const filename = (req.query.filename as string | undefined) || 'upload';
  const ext = filename.includes('.') ? (filename.split('.').pop() as string).toLowerCase() : '';
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf)) return send(res, 400, { error: '空请求体' });
  const friendlyName = sanitize(filename.replace(/\.[^.]+$/, ''));

  try {
    if (FOLDERS[key].useDb) {
      // 单井：必须提供修剪后非空的 project
      const project = String((req.query.project as string | undefined) ?? '').trim();
      if (!project) return send(res, 400, { error: '项目名称不能为空' });
      // 单井：xlsx 原样、xml → worker 转 xlsx → 入库 + 改名 <id>.xlsx
      const alreadyXlsx = ext === 'xlsx';
      const data: Buffer = alreadyXlsx ? buf : Buffer.from(await runConvert(Uint8Array.from(buf)));
      const { id, storedFile } = await enqueue(() => importDanjing(data, friendlyName, project));
      return send(res, 200, {
        ok: true,
        key,
        id,
        savedAs: storedFile,
        toXlsx: true,
        converted: !alreadyXlsx,
        project,
      });
    }
    // 地震/切片：原样落盘（同样走队列串行写）
    const outName = sanitize(filename);
    await enqueue(() => {
      const dir = path.join(DATA_DIR, key);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, outName), buf);
      return outName;
    });
    return send(res, 200, { ok: true, key, savedAs: outName, toXlsx: false });
  } catch (e) {
    return send(res, 500, { error: String(e) });
  }
});

// DELETE /api/datasets/:key?id=<id> | &name=<name>
app.delete('/api/datasets/:key', async (req, res) => {
  const key = req.params.key;
  if (!isFolderKey(key)) return send(res, 400, { error: 'invalid key' });
  try {
    if (FOLDERS[key].useDb) {
      const idRaw = req.query.id as string | undefined;
      if (idRaw == null || !/^\d+$/.test(idRaw)) return send(res, 400, { error: 'invalid id' });
      const deleted = await enqueue(() => deleteDanjing(Number(idRaw)));
      if (!deleted) return send(res, 404, { error: '记录不存在' });
      return send(res, 200, { ok: true, deletedFile: deleted });
    }
    const name = req.query.name as string | undefined;
    if (!name) return send(res, 400, { error: '缺少文件名' });
    const safe = path.basename(name);
    if (!safe || safe !== name || safe.includes('..')) return send(res, 400, { error: '非法文件名' });
    await enqueue(() => {
      const fp = path.join(DATA_DIR, key, safe);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) fs.unlinkSync(fp);
      return safe;
    });
    return send(res, 200, { ok: true, deletedFile: safe });
  } catch (e) {
    return send(res, 500, { error: String(e) });
  }
});

// ---- 认证 ----
app.use('/api/auth', authRouter());

// ---- 数据编辑（锁 + 状态机）---- 需登录
app.use('/api/annotation', requireAuth, annotationRouter());

// 过期锁巡检：每 60s 扫一次，status=2→1 并清锁
const sweepTimer = setInterval(() => {
  sweepExpiredLocks()
    .then((n) => {
      if (n > 0) console.log(`[annotation] 巡检清理 ${n} 个过期锁`);
    })
    .catch(() => {
      /* ignore */
    });
}, 60_000);

// 生产：可选静态托管前端产物（默认关，由 Nginx 托管；开发/单进程直连时设 SERVE_STATIC=true）
if (process.env.SERVE_STATIC === 'true') {
  const dist = path.resolve(process.cwd(), 'dist');
  app.use(express.static(dist));
  console.log(`[api] 静态托管已开启: ${dist}`);
}

const server = app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `[api] 端口 ${PORT} 已被占用。请释放该端口，或用 PORT=<其它端口> npm start 指定别的端口。`,
    );
  } else {
    console.error('[api] 监听异常:', e);
  }
  process.exit(1);
});

// 优雅关闭：SIGTERM/SIGINT（PM2 reload / 重启）→ 停 HTTP → 等队列排空 → 关库
const shutdown = async (sig: string) => {
  console.log(`[api] 收到 ${sig}，开始优雅关闭...`);
  clearInterval(sweepTimer);
  server.close(() => console.log('[api] HTTP 已关闭'));
  try {
    await flush();
    console.log('[api] 写入队列已排空');
  } catch {
    /* ignore */
  }
  try {
    closeDb();
    console.log('[api] SQLite 已关闭');
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
