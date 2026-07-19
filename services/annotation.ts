// 数据编辑 API：lock / save / finish / heartbeat / intervals / micro-phase-rules / facies-colors
// 统一 .catch 兜底：网络错误返回 { ok:false, error }，调用方不必 try/catch。
// 区间保存仅传 JSON 增量，绝不上传 XLSX / base64。
// 规则导入：POST 原始 XLSX 字节到服务端解析并持久化。
// 相颜色：POST 名称数组，服务端确保注册并返回名称→HEX。
import { apiFetch } from './http';

const base = (id: number): string => `/api/annotation/${id}`;

interface ApiResult {
  ok?: boolean;
  error?: string;
  status?: number;
  statusLabel?: string;
  renew?: boolean;
}

export interface MicroPhaseRulesResult extends ApiResult {
  names?: string[];
  count?: number;
}

export interface FaciesColorsResult extends ApiResult {
  /** 规范化名称 → #rrggbb */
  colors?: Record<string, string>;
}

export interface IntervalOpPayload {
  operationId: string;
  action: 'create' | 'delete';
  kind: 'lithology' | 'microPhase';
  top: number;
  bottom: number;
  name: string;
  /** delete 时：原 XLSX 行 或 已保存 create 的 originOperationId。 */
  target?: {
    sheet?: string;
    row?: number;
    originOperationId?: string;
  };
}

export interface IntervalSaveResult {
  operationId: string;
  status: 'applied' | 'duplicate' | 'error';
  error?: string;
}

export interface IntervalSaveApiResult extends ApiResult {
  results?: IntervalSaveResult[];
}

const safe = <T extends ApiResult>(p: Promise<T>): Promise<T> =>
  p.catch((): T => ({ ok: false, error: '网络错误，请重试' }) as T);

// 加锁（进入编辑）：status→2
export const lockAnnotation = (id: number): Promise<ApiResult> =>
  safe(apiFetch(base(id) + '/lock', { method: 'POST' }).then((r) => r.json()));

// 手动保存（body=文件字节，遗留接口；区间编辑请用 saveAnnotationIntervals）
export const saveAnnotation = (id: number, content?: Uint8Array): Promise<ApiResult> => {
  const init: RequestInit = { method: 'POST' };
  if (content) init.body = content as unknown as BodyInit;
  return safe(apiFetch(base(id) + '/save', init).then((r) => r.json()));
};

/** 增量保存区间：仅 JSON，无 XLSX。 */
export const saveAnnotationIntervals = (
  id: number,
  wellName: string,
  operations: IntervalOpPayload[],
): Promise<IntervalSaveApiResult> =>
  safe(
    apiFetch(base(id) + '/intervals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wellName, operations }),
    }).then(async (r) => {
      const data = (await r.json()) as IntervalSaveApiResult;
      if (!r.ok && data.ok !== false) {
        return { ok: false, error: data.error || `HTTP ${r.status}`, results: data.results };
      }
      return data;
    }),
  );

// 完成：status→3，释放锁（区间编辑路径不传文件体）
export const finishAnnotation = (id: number, content?: Uint8Array): Promise<ApiResult> => {
  const init: RequestInit = { method: 'POST' };
  if (content) init.body = content as unknown as BodyInit;
  return safe(apiFetch(base(id) + '/finish', init).then((r) => r.json()));
};

// 退出编辑：可选字节保存 + 释放锁 + status:2→1
export const exitAnnotation = (id: number, content?: Uint8Array): Promise<ApiResult> => {
  const init: RequestInit = { method: 'POST' };
  if (content) init.body = content as unknown as BodyInit;
  return safe(apiFetch(base(id) + '/exit', init).then((r) => r.json()));
};

// 心跳：active=true 续期锁；区间编辑不再附带 base64 content
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

/** 获取全局沉积微相规则（按导入顺序）。 */
export const fetchMicroPhaseRules = (): Promise<MicroPhaseRulesResult> =>
  safe(
    apiFetch('/api/annotation/micro-phase-rules').then(async (r) => {
      const data = (await r.json()) as MicroPhaseRulesResult;
      if (!r.ok && data.ok !== false) {
        return { ok: false, error: data.error || `HTTP ${r.status}`, names: data.names };
      }
      return data;
    }),
  );

/**
 * 上传单井标注规则 XLSX；服务端解析并原子替换。
 * 仅接受 .xlsx；失败时 error 为服务端信息。
 */
export const importMicroPhaseRules = (file: File): Promise<MicroPhaseRulesResult> => {
  if (!/\.xlsx$/i.test(file.name)) {
    return Promise.resolve({ ok: false, error: '仅支持 .xlsx 文件' });
  }
  const qs = new URLSearchParams({ filename: file.name });
  return safe(
    apiFetch(`/api/annotation/micro-phase-rules?${qs.toString()}`, {
      method: 'POST',
      body: file,
    }).then(async (r) => {
      const data = (await r.json()) as MicroPhaseRulesResult;
      if (!r.ok && data.ok !== false) {
        return { ok: false, error: data.error || `HTTP ${r.status}`, names: data.names };
      }
      return data;
    }),
  );
};

/**
 * 批量确保沉积相名称已登记并返回名称→HEX 映射。
 * 空数组直接成功返回 {}；失败时 ok:false。
 */
export const resolveFaciesColors = (names: string[]): Promise<FaciesColorsResult> => {
  const list = Array.isArray(names) ? names : [];
  if (list.length === 0) {
    return Promise.resolve({ ok: true, colors: {} });
  }
  return safe(
    apiFetch('/api/annotation/facies-colors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: list }),
    }).then(async (r) => {
      const data = (await r.json()) as FaciesColorsResult;
      if (!r.ok && data.ok !== false) {
        return { ok: false, error: data.error || `HTTP ${r.status}`, colors: data.colors };
      }
      return data;
    }),
  );
};
