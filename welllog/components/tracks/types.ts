// 各 track 组件的统一 props。Canvas 用 <g transform="translate(x,0)"> 包裹每个 track，
// 故 track 内部 x ∈ [0, width]；y（contentY / headerBandY）为 svg 绝对坐标。
import type { AnyTrackConfig, IntervalSource, WellLogData } from '../../types';
import type { IntervalKind } from '../../intervalEdits';

export interface IntervalBlockClickPayload {
  kind: IntervalKind;
  top: number;
  bottom: number;
  name: string;
  source?: IntervalSource;
}

export interface TrackProps {
  cfg: AnyTrackConfig;
  data: WellLogData;
  width: number; // 缩放后的像素宽
  depthTop: number;
  depthBottom: number;
  headerBandY: number; // 单道表头带的顶部 y
  headerH: number; // 单道表头高度
  contentY: number; // 内容区顶部 y
  contentH: number; // 内容区高度
  curveRange?: [number, number]; // 该道（单曲线）有效横轴范围，覆盖 curve.displayRange
  onOpenCurveMenu?: (primary: string, anchor: DOMRect) => void; // 列头 ➕：打开副曲线下拉
  /**
   * 区间编辑模式下，同一岩性/微相块两次右键后的编辑回调。
   * 未开启时为 undefined，track 不绑定块级右键交互，不影响框选/滚轮/光标。
   */
  onIntervalBlockRightDoubleClick?: (payload: IntervalBlockClickPayload) => void;
}
