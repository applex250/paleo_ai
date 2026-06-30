
import { Dataset, AnnotationTask, TrainingJob, JobStatus, ModelVersion } from '../types';

export const mockDatasets: Dataset[] = [
  { id: '1', name: '惠州凹陷惠西南-地震数据A组', type: '地震数据', size: '4.5 TB', sampleCount: 12000, uploadedBy: '张三 (专家)', date: '2023-10-01', status: '已清洗' },
  { id: '2', name: '惠州凹陷惠西南-单井测井曲线', type: '测井数据', size: '500 MB', sampleCount: 450, uploadedBy: '李四', date: '2023-10-05', status: '原始' },
  { id: '3', name: '惠州凹陷惠西南-岩心切片库', type: '图像数据', size: '1.2 TB', sampleCount: 50000, uploadedBy: 'AI组', date: '2023-10-12', status: '特征已提取' },
];

export const mockAnnotationTasks: AnnotationTask[] = [
  { id: '101', datasetName: '惠州凹陷惠西南-岩心切片库', annotator: '标注组A', progress: 85, status: '进行中', type: '图像分割' },
  { id: '102', datasetName: '惠州凹陷惠西南-单井测井曲线', annotator: '标注组B', progress: 100, status: '待审核', type: '测井曲线标注' },
  { id: '103', datasetName: '惠州凹陷惠西南-地震数据A组', annotator: 'AI助手', progress: 45, status: '进行中', type: '地震曲线标注' },
];

export const mockTrainingJobs: TrainingJob[] = [
  { id: 'J-2938', name: '惠西南-地震相推理训练 v3', modelType: 'U-Net 3D', dataset: '惠州凹陷惠西南-地震数据A组', epoch: 45, maxEpoch: 100, accuracy: 0.88, loss: 0.12, status: JobStatus.RUNNING, startTime: '2小时前' },
  { id: 'J-2939', name: '惠西南-单井相推理训练 v1', modelType: 'LSTM-Attention', dataset: '惠州凹陷惠西南-单井测井曲线', epoch: 100, maxEpoch: 100, accuracy: 0.92, loss: 0.08, status: JobStatus.COMPLETED, startTime: '1天前' },
  { id: 'J-2940', name: '岩心分类 ResNet', modelType: 'ResNet50', dataset: '惠州凹陷惠西南-岩心切片库', epoch: 0, maxEpoch: 50, accuracy: 0, loss: 0, status: JobStatus.PENDING, startTime: '刚刚' },
];

export const mockModels: ModelVersion[] = [
  { id: 'M-001', name: '惠西南-地震相推理v1', version: 'v1.0.0', f1Score: 0.85, status: '已上线', deployed: true },
  { id: 'M-002', name: '惠西南-地震相推理v1', version: 'v1.1.0-beta', f1Score: 0.89, status: '预发布', deployed: false },
  { id: 'M-003', name: '惠西南-单井相推理模型v1', version: 'v1.0.0', f1Score: 0.91, status: '已上线', deployed: true },
];
