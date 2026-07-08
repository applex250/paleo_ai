// 数据编辑 API：lock / save / finish / heartbeat
// 统一 .catch 兜底：网络错误返回 { ok:false, error }，调用方不必 try/catch。
import { apiFetch } from './http';

const base = (id: number): string => `/api/annotation/${id}`;

interface ApiResult {
  ok?: boolean;
  error?: string;
  status?: number;
  statusLabel?: string;
  renew?: boolean;
}

const safe = (p: Promise<ApiResult>): Promise<ApiResult> =>
  p.catch((): ApiResult => ({ ok: false, error: '网络错误，请重试' }));

// 加锁（进入编辑）：status→2
export const lockAnnotation = (id: number): Promise<ApiResult> =>
  safe(apiFetch(base(id) + '/lock', { method: 'POST' }).then((r) => r.json()));

// 手动保存（body=文件字节，占位期不传 content）：不改 status/锁
export const saveAnnotation = (id: number, content?: Uint8Array): Promise<ApiResult> => {
  const init: RequestInit = { method: 'POST' };
  if (content) init.body = content as unknown as BodyInit;
  return safe(apiFetch(base(id) + '/save', init).then((r) => r.json()));
};

// 完成：status→3，释放锁
export const finishAnnotation = (id: number, content?: Uint8Array): Promise<ApiResult> => {
  const init: RequestInit = { method: 'POST' };
  if (content) init.body = content as unknown as BodyInit;
  return safe(apiFetch(base(id) + '/finish', init).then((r) => r.json()));
};

// 退出编辑：保存内容 + 释放锁 + status:2→1（与巡检"失锁→1"一致，区别于 finish 的 →3）
export const exitAnnotation = (id: number, content?: Uint8Array): Promise<ApiResult> => {
  const init: RequestInit = { method: 'POST' };
  if (content) init.body = content as unknown as BodyInit;
  return safe(apiFetch(base(id) + '/exit', init).then((r) => r.json()));
};

// 心跳：active=true 续期锁，content(base64) 非空才写文件；不改 status
export const heartbeatAnnotation = (
  id: number,
  active: boolean,
  content?: string,
): Promise<ApiResult> =>
  safe(
    apiFetch(base(id) + '/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, content }),
    }).then((r) => r.json()),
  );
