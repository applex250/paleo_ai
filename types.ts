
export enum JobStatus {
  PENDING = '等待中',
  RUNNING = '运行中',
  COMPLETED = '已完成',
  FAILED = '失败',
}

export interface Dataset {
  id: string;
  name: string;
  type: '单井数据' | '地震数据' | '切片数据';
  size: string;
  sampleCount: number;
  uploadedBy: string;
  date: string;
  status: '原始' | '已清洗' | '特征已提取';
}

export interface AnnotationTask {
  id: string;
  datasetName: string;
  annotator: string;
  progress: number;
  status: '进行中' | '待审核' | '已完成';
  type: '测井曲线标注' | '地震曲线标注' | '图像分割' | '分类标注';
}

export interface TrainingJob {
  id: string;
  name: string;
  modelType: string;
  dataset: string;
  epoch: number;
  maxEpoch: number;
  accuracy: number;
  loss: number;
  status: JobStatus;
  startTime: string;
}

export interface ModelVersion {
  id: string;
  version: string;
  name: string;
  f1Score: number;
  status: '开发中' | '预发布' | '已上线' | '已归档';
  deployed: boolean;
}

// 数据集分类（对应后端 data01 子文件夹）
export type DataType = '单井数据' | '地震数据' | '切片数据';

// 后端真实文件夹扫描得到的单个数据集文件（data01/<key>/ 下的一个文件）
export interface DatasetFile {
  id?: number; // 单井数据有数据库 id；文件扫描类没有
  filename: string; // 真实文件名（含扩展名，如 123.xlsx）
  name: string; // 显示名（去扩展名；单井来自数据库的友好名）
  ext: string; // 扩展名（xlsx / xml / ...）
  sizeText: string; // 可读大小
  date: string; // 文件修改日期 YYYY-MM-DD
  status: number; // 0原始 1未完成 2工作中 3已完成
  statusLabel?: string; // 中文标签（后端统一映射）
}

// 登录用户（前端镜像 server/auth.ts 的 AuthUser）
export interface AuthUser {
  id: number;
  username: string;
  displayName?: string;
}

// 标注状态枚举
export const ANNOTATION_STATUS = {
  RAW: 0,
  UNFINISHED: 1,
  WORKING: 2,
  DONE: 3,
} as const;

export const STATUS_LABEL: Record<number, string> = {
  0: '原始',
  1: '未完成',
  2: '工作中',
  3: '已完成',
};

// 状态徽章样式（DataManager 与 Annotation 共享，保证两页颜色一致）
export const STATUS_STYLE: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600', // 原始 - 灰
  1: 'bg-yellow-100 text-yellow-800', // 未完成 - 黄
  2: 'bg-blue-100 text-blue-800', // 工作中 - 蓝
  3: 'bg-green-100 text-green-800', // 已完成 - 绿
};
