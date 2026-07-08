// 后端共享类型与配置

export interface FileMeta {
  id?: number; // 单井数据有数据库 id；文件扫描类没有
  filename: string;
  name: string;
  ext: string;
  sizeText: string;
  date: string;
  status: number; // 0原始 1未完成 2工作中 3已完成
  statusLabel?: string; // 中文标签（后端统一映射）
}

// 标注状态枚举（与前端共享语义）
export const ANNOTATION_STATUS = {
  RAW: 0, // 原始
  UNFINISHED: 1, // 未完成
  WORKING: 2, // 工作中
  DONE: 3, // 已完成
} as const;

// 三类数据 → 存储目录 key
export const FOLDERS = {
  danjing: { label: '单井数据', toXlsx: true, useDb: true },
  dizhen: { label: '地震数据', toXlsx: false, useDb: false },
  qiepian: { label: '切片数据', toXlsx: false, useDb: false },
} as const;

export type FolderKey = keyof typeof FOLDERS;

export const isFolderKey = (k: string | null | undefined): k is FolderKey =>
  !!k && k in FOLDERS;
