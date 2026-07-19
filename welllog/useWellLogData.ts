// 按 fileId 拉取单井 xlsx → SheetJS 解析 → transformWellLog → WellLogData。
// ⚡ 必须用 apiFetch（带 cookie），否则 /api/datasets/danjing/file 401 跳登录。
// ⚡ 按 fileId 模块级缓存：重开同一文件即时返回，不重复下载/解析。
// ⚡ 解析后收集微相/亚相/相名称，POST /facies-colors 登记并附 faciesColors 再渲染。

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch } from '../services/http';
import { resolveFaciesColors } from '../services/annotation';
import { collectFaciesNames } from './config';
import { transformWellLog } from './transform';
import type { WellLogData } from './types';

const cache = new Map<number, WellLogData>();

/** 保存成功后失效预览缓存，下次打开重新拉取/解析。 */
export function invalidateWellLogCache(fileId: number): void {
  cache.delete(fileId);
}

export interface WellLogDataState {
  data: WellLogData | null;
  loading: boolean;
  error: string | null;
}

/** 确保井数据携带已登记的 faciesColors（失败时附空表，渲染走安全灰）。 */
async function attachFaciesColors(well: WellLogData): Promise<WellLogData> {
  const names = collectFaciesNames(well);
  if (names.length === 0) {
    return { ...well, faciesColors: well.faciesColors ?? {} };
  }
  const res = await resolveFaciesColors(names);
  if (res.ok && res.colors) {
    return { ...well, faciesColors: { ...well.faciesColors, ...res.colors } };
  }
  // 网络/服务失败：仍可预览，沉积相用安全灰
  return { ...well, faciesColors: well.faciesColors ?? {} };
}

export function useWellLogData(fileId: number | null, name?: string): WellLogDataState {
  const [data, setData] = useState<WellLogData | null>(() =>
    fileId != null ? cache.get(fileId) ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(() => fileId != null && !cache.has(fileId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fileId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const cached = cache.get(fileId);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    (async () => {
      try {
        const res = await apiFetch(`/api/datasets/danjing/file?id=${fileId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheets: Record<string, unknown[][]> = {};
        for (const sn of wb.SheetNames) {
          sheets[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
            header: 1,
            raw: true,
            defval: null,
          }) as unknown[][];
        }
        const well = transformWellLog(sheets, name ?? String(fileId));
        const withColors = await attachFaciesColors(well);
        if (cancelled) return;
        cache.set(fileId, withColors);
        setData(withColors);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, name]);

  return { data, loading, error };
}
