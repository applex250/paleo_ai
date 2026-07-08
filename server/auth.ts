// 最小登录系统：scrypt 密码 + 服务端 session（httpOnly cookie）+ requireAuth 中间件
// 零新依赖，仅用 node:crypto + node:sqlite（db）。
import express, { Router, type Request, Response, NextFunction } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

// 扩展 Express 的 Request，注入当前登录用户
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export interface AuthUser {
  id: number;
  username: string;
  displayName?: string;
}

const KEY_LEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const COOKIE_NAME = 'sid';

const isoNow = (): string => new Date().toISOString();
const isoPlus = (ms: number): string => new Date(Date.now() + ms).toISOString();

// ---------- 密码哈希（scrypt，格式 salt:hash） ----------
export const hashPassword = (pw: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
};

export const verifyPassword = (pw: string, stored: string): boolean => {
  const sep = stored.indexOf(':');
  if (sep < 0) return false;
  const salt = stored.slice(0, sep);
  const key = stored.slice(sep + 1);
  const buf = scryptSync(pw, salt, KEY_LEN);
  const storedBuf = Buffer.from(key, 'hex');
  if (buf.length !== storedBuf.length) return false;
  return timingSafeEqual(buf, storedBuf);
};

// ---------- 用户表访问 ----------
const findUserByName = (
  username: string,
): { id: number; username: string; passwordHash: string; displayName?: string } | null => {
  const row = db
    .prepare(
      'SELECT id, username, password_hash AS passwordHash, display_name AS displayName FROM users WHERE username = ?',
    )
    .get(username) as
    | { id: number; username: string; passwordHash: string; displayName?: string }
    | undefined;
  return row ?? null;
};

// ---------- 会话表访问 ----------
export const createSession = (userId: number): string => {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, userId, isoNow(), isoPlus(SESSION_TTL_MS));
  return token;
};

export const getSession = (token: string): AuthUser | null => {
  const row = db
    .prepare(
      `SELECT s.user_id AS uid, s.expires_at AS exp,
              u.username AS uname, u.display_name AS dname
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as { uid: number; exp: string; uname: string; dname?: string } | undefined;
  if (!row) return null;
  if (new Date(row.exp).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.uid, username: row.uname, displayName: row.dname };
};

export const deleteSession = (token: string): void => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
};

// ---------- cookie ----------
const parseCookies = (h?: string): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
};

export const readSessionToken = (req: Request): string | null => {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] ?? null;
};

const setSessionCookie = (res: Response, token: string): void => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`,
  );
};

const clearSessionCookie = (res: Response): void => {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
};

// ---------- 中间件 ----------
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = readSessionToken(req);
  const user = token ? getSession(token) : null;
  if (!user) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  req.user = user;
  next();
};

// ---------- 预置用户 ----------
// SEED_USER 格式：user1:pass1[:displayName],user2:pass2...
// 表为空时才建（已有用户则跳过，不会重复建/改密）
export const seedUsers = (): void => {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (row.c > 0) return;
  const seedRaw = (process.env.SEED_USER ?? 'admin:changeme123').trim();
  const entries = seedRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const stmt = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
  );
  const now = isoNow();
  const made: string[] = [];
  for (const e of entries) {
    const parts = e.split(':');
    const username = parts[0]?.trim();
    if (!username) continue;
    const pass = parts[1] ?? 'changeme123';
    const displayName = parts[2]?.trim() || username;
    stmt.run(username, hashPassword(pass), displayName, now);
    made.push(username);
  }
  if (made.length === 0) {
    stmt.run('admin', hashPassword('changeme123'), 'admin', now);
    made.push('admin');
    console.log('[auth] 已创建默认用户 admin（密码 changeme123），请尽快修改！');
  } else {
    console.log(`[auth] 已创建预置用户：${made.join(', ')}（可用 SEED_USER 环境变量配置）`);
  }
};
seedUsers();

// ---------- 路由 ----------
export const authRouter = (): Router => {
  const r = Router();
  r.use(express.json());

  // POST /api/auth/login  { username, password }
  r.post('/login', (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return res.status(400).json({ error: '缺少用户名或密码' });
    }
    const u = findUserByName(String(username));
    if (!u || !verifyPassword(String(password), u.passwordHash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = createSession(u.id);
    setSessionCookie(res, token);
    return res.json({ user: { id: u.id, username: u.username, displayName: u.displayName } });
  });

  // POST /api/auth/logout
  r.post('/logout', (req, res) => {
    const token = readSessionToken(req);
    if (token) deleteSession(token);
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  // GET /api/auth/me  （需登录）
  r.get('/me', requireAuth, (req, res) => {
    return res.json({ user: req.user });
  });

  return r;
};
