
export enum JobStatus {
  PENDING = '等待中',
  RUNNING = '运行中',
  COMPLETED = '已完成',
  FAILED = '失败',
}

export interface Dataset {
  id: string;
  name: string;
  type: '地震数据' | '测井数据' | '图像数据' | '文本数据';
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
