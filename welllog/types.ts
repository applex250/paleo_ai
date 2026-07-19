// 井剖面可视化的数据模型与轨道配置 —— 移植自 geoviz_well_log 的 models.py + config.py。
// 仅前端、纯类型，零运行时依赖。

export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** 测井曲线（values 允许 null，用于表达缺测 "-9999" 的断点）。对应 models.CurveData。 */
export interface CurveData {
  name: string; // xlsx 原列名（如 DT/MLR4C/MLR1C/GR）；不改写为 AC/RT/RXO
  unit?: string;
  depth: number[];
  values: (number | null)[];
  displayRange: [number, number];
  color: string;
  lineStyle: LineStyle;
}

/**
 * 区间稳定来源：原 XLSX 行 或 本会话/已保存的 create operationId。
 * 用于精确删除同名同深度重复行（JSON 增量 delete，不回传整表）。
 */
export type IntervalSource =
  | { type: 'xlsx'; sheet: string; row: number }
  | { type: 'create'; operationId: string };

/** 通用深度区间项（地层/层序/岩性描述等）。对应 models.IntervalItem。 */
export interface IntervalItem {
  top: number;
  bottom: number;
  name: string;
  /** 岩性/微相等可编辑区间的来源；删除时按此精确定位。 */
  source?: IntervalSource;
}

/** 岩性区间（带纹样填充）。对应 models.LithologyInterval。 */
export interface LithologyInterval {
  top: number;
  bottom: number;
  lithology: string;
  description?: string;
  source?: IntervalSource;
}

export interface FaciesData {
  phase: IntervalItem[];
  subPhase: IntervalItem[];
  microPhase: IntervalItem[];
}

/** 全部区间类数据的聚合。对应 models.WellIntervals。 */
export interface WellIntervals {
  series: IntervalItem[]; // 统
  system: IntervalItem[]; // 系
  formation: IntervalItem[]; // 组
  member: IntervalItem[]; // 段
  lithology: IntervalItem[];
  lithologyDesc: IntervalItem[];
  systemsTract: IntervalItem[];
  sequence: IntervalItem[];
  facies: FaciesData;
}

/** 单井数据聚合根。对应 models.WellLogData。 */
export interface WellLogData {
  wellName: string;
  topDepth: number;
  bottomDepth: number;
  datumElevation?: number;
  curves: CurveData[];
  lithology: LithologyInterval[];
  facies?: FaciesData;
  intervals?: WellIntervals;
  /**
   * 全局相名称 → 唯一 HEX（微相/亚相/相同名同色）。
   * 由加载时 POST /facies-colors 填充；轨道按完整名称精确取色。
   */
  faciesColors?: Record<string, string>;
}

// ---- 轨道配置（移植 config.py）----

export type TrackType = 'depth' | 'curves' | 'interval' | 'text' | 'systems_tract';

/** 岩性/相 → 纹样 id + 颜色 的映射表。对应 config.PatternMapping。 */
export interface PatternMapping {
  patterns: Record<string, string>;
  colors: Record<string, string>;
}

export interface TrackConfig {
  type: TrackType;
  width: number;
  label: string;
  label2?: string;
  group?: string; // 分组表头名（如 "地层系统"/"沉积相"）
  /** 没有对应数据时仍显示表头、网格和空白内容区。 */
  alwaysVisible?: boolean;
}

export interface DepthTrackConfig extends TrackConfig {
  type: 'depth';
}

export interface CurveTrackConfig extends TrackConfig {
  type: 'curves';
  curveNames: string[]; // geoviz 名（AC/GR/RT/RXO）
  altShading?: boolean;
}

export interface IntervalTrackConfig extends TrackConfig {
  type: 'interval';
  /** 解析键：series/system/formation/member/lithologyDesc/systemsTract/sequence/facies；'lithology' 特指 data.lithology */
  dataKey: string;
  faciesLevel?: 'phase' | 'subPhase' | 'microPhase';
  colorMapping?: PatternMapping;
  patternDir?: string;
  rotateText?: boolean;
}

export interface TextTrackConfig extends TrackConfig {
  type: 'text';
  dataKey: string;
  editable?: boolean;
}

export interface SystemsTractTrackConfig extends TrackConfig {
  type: 'systems_tract';
  dataKey?: string;
}

export type AnyTrackConfig =
  | DepthTrackConfig
  | CurveTrackConfig
  | IntervalTrackConfig
  | TextTrackConfig
  | SystemsTractTrackConfig;

export interface ChartConfig {
  tracks: AnyTrackConfig[];
  pixelRatio: number;
  gridInterval: number;
  headerHeight: number;
}
