import fs from 'node:fs';
import path from 'node:path';
import type { FileMeta, FolderKey } from './types';

// 数据存储根目录（项目下 data01/）
export const DATA_DIR = path.resolve(process.cwd(), 'data01');

// 字节数 → 可读大小
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

// 文件名清洗：去掉非法字符（防注入/防异常文件名）
export const sanitize = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';

// 解析我们导出格式的 XML（<dataset><field>value</field>...</dataset>）为行
export const parseDatasetXml = (xml: string): Record<string, string>[] => {
  const rows: Record<string, string>[] = [];
  const blockRe = /<dataset>([\s\S]*?)<\/dataset>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml))) {
    const row: Record<string, string> = {};
    const tagRe = /<(\w+)>([^<]*)<\/\1>/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(m[1]))) row[t[1]] = t[2].trim();
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
};

// 文件夹扫描（用于 dizhen / qiepian，无数据库）
export const listFiles = (key: FolderKey): FileMeta[] => {
  const dir = path.join(DATA_DIR, key);
  fs.mkdirSync(dir, { recursive: true });
  const out: FileMeta[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.')) continue;
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (!st.isFile()) continue;
    const ext = f.includes('.') ? (f.split('.').pop() as string).toLowerCase() : '';
    out.push({
      filename: f,
      name: f.replace(/\.[^.]+$/, ''),
      ext,
      sizeText: formatBytes(st.size),
      date: st.mtime.toISOString().slice(0, 10),
      status: 0,
      statusLabel: '原始',
    });
  }
  return out;
};
