// 按 fileId 拉取单井 xlsx → SheetJS 解析 → transformWellLog → WellLogData。
// ⚡ 必须用 apiFetch（带 cookie），否则 /api/datasets/danjing/file 401 跳登录。
// ⚡ 按 fileId 模块级缓存：重开同一文件即时返回，不重复下载/解析。

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiFetch } from '../services/http';
import { transformWellLog } from './transform';
import type { WellLogData } from './types';

const cache = new Map<number, WellLogData>();

export interface WellLogDataState {
  data: WellLogData | null;
  loading: boolean;
  error: string | null;
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
        if (cancelled) return;
        cache.set(fileId, well);
        setData(well);
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
