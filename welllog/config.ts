// 井剖面轨道配置：曲线元信息、别名、量程、岩性/相映射表、默认轨道集。
// 移植自 qpainter_builder.py（CURVE_META/_MERGE_GROUPS/_LOG_SCALE_CURVES）、
// configs/laolong1.py（DEFAULT_TRACKS 顺序与宽度、LITHOLOGY_MAPPING）、pattern_map.py（FACIES_COLORS）。

import type { AnyTrackConfig, LineStyle, PatternMapping } from './types';

/** 曲线颜色/线型。qpainter_builder.CURVE_META。 */
export const CURVE_META: Record<string, { color: string; style: LineStyle }> = {
  AC: { color: '#1d4ed8', style: 'dashed' },
  GR: { color: '#15803d', style: 'solid' },
  RT: { color: '#b91c1c', style: 'solid' },
  RXO: { color: '#ea580c', style: 'dashed' },
};

/** geoviz 曲线名 → 我们的 xlsx 列名。 */
export const CURVE_ALIASES: Record<string, string> = {
  AC: 'DT',
  GR: 'GR',
  RT: 'MLR4C',
  RXO: 'MLR1C',
};

/** 各曲线显示量程（X 轴范围）。已知曲线优先用此；其余走 getDisplayRange 自动算。 */
export const DISPLAY_RANGES: Record<string, [number, number]> = {
  GR: [0, 150],
  AC: [40, 140],
  RT: [0.1, 2000],
  RXO: [0.1, 2000],
};

/** 对数刻度的曲线。 */
export const LOG_CURVES = new Set(['RT', 'RXO']);

/** 各道固定宽度（对齐 GeoViz QPainter 实际值）。 */
export const TRACK_WIDTH = {
  curve: 140,
  depth: 60,
  lithology: 80,
  formation: 50,
} as const;

/** 未知名曲线的轮转配色（CURVE_META 未覆盖时用）。 */
export const CURVE_FALLBACK_PALETTE = [
  '#6366f1', '#0891b2', '#db2777', '#9333ea', '#ca8a04', '#0d9488',
  '#dc2626', '#4f46e5', '#16a34a', '#ea580c', '#7c3aed', '#0e7490',
];

/**
 * 计算曲线显示量程。移植自 loaders.get_display_range (loaders.py:256-274)。
 * 子串查找已知曲线族；未知→数据原始 min/max（取1位小数）；min==max 各扩10；全 null→(0,100)。
 * ⚡ 循环显式跳过 null/NaN（parseNum 已把 -9999 转 null，不跳过会让 null→0 污染极值）。
 */
export function getDisplayRange(name: string, values: (number | null)[]): [number, number] {
  const c = name.toUpperCase();
  if (c.includes('GR')) return [0, 150];
  if (c.includes('AC') || c.includes('DT')) return [40, 140];
  if (c.includes('RT') || c.includes('RD') || c.includes('LLD')) return [0.1, 2000];
  if (c.includes('RXO') || c.includes('RS') || c.includes('LLS')) return [0.1, 2000];
  if (c.includes('SP')) return [-100, 50];
  if (c.includes('DEN') || c.includes('RHOB')) return [1.5, 3];
  if (c.includes('CNL') || c.includes('NPHI')) return [-15, 45];
  if (c.includes('CAL')) return [5, 15];
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return [0, 100];
  if (mn === mx) {
    mn -= 10;
    mx += 10;
  }
  return [Math.round(mn * 10) / 10, Math.round(mx * 10) / 10];
}

/** Azurite 设计系统配色 + 尺寸常量（移植 track_base.ECHARTS_*）。 */
export const THEME = {
  border: '#94a3b8',
  grid: '#cbd5e1',
  headerBg: '#e2e8f0',
  subHeaderBg: '#f8fafc',
  text: '#0f172a',
  muted: '#64748b',
  fontFamily: "'Microsoft YaHei','Segoe UI',sans-serif",
  groupHeaderH: 32,
  trackHeaderH: 112,
  bodyTopGap: 8,
  strokeWidth: 1.5,
} as const;

/** 滚轮缩放的最小深度跨度（m），避免无限放大。 */
export const MIN_DEPTH_SPAN = 5;

/** 岩性 → 纹样 id + 颜色。laolong1.LITHOLOGY_MAPPING（key 按长度降序子串匹配）。 */
export const LITHOLOGY_MAPPING: PatternMapping = {
  patterns: {
    白云岩: 'dolomite',
    白云质: 'dolomite',
    砂岩: 'sandstone',
    粗砂岩: 'sandstone',
    细砂岩: 'sandstone',
    中砂岩: 'sandstone',
    钙质砂岩: 'sandstone',
    粉砂岩: 'siltstone',
    粉砂质: 'siltstone',
    泥岩: 'mudstone',
    泥质: 'mudstone',
    页岩: 'shale',
    灰岩: 'limestone',
    石灰岩: 'limestone',
    煤: 'shale', // TODO: 补 coal.svg（GB/T 附录M）
  },
  colors: {
    白云岩: '#dbeafe',
    白云质: '#bfdbfe',
    砂岩: '#fef08a',
    粗砂岩: '#fef08a',
    细砂岩: '#fef9c3',
    中砂岩: '#fef08a',
    钙质砂岩: '#fde68a',
    粉砂岩: '#f3f4f6',
    粉砂质泥岩: '#e2e8f0',
    泥岩: '#d1d5db',
    泥质粉砂岩: '#e2e8f0',
    页岩: '#9ca3af',
    灰岩: '#e0e7ff',
    石灰岩: '#c7d2fe',
    煤: '#4a5568',
    紫红色: '#fecaca',
    灰绿色: '#bbf7d0',
    灰黑色: '#6b7280',
    深灰色: '#9ca3af',
    浅灰色: '#f3f4f6',
    灰色: '#e5e7eb',
  },
};

/**
 * 相/岩性颜色 fallback（lithology_track._fallback_color 用）。
 * 移植自 pattern_map.FACIES_COLORS；lithology_track 在纹样缺失时按子串匹配这里取色。
 */
export const FACIES_COLORS: Record<string, string> = {
  砂岩: '#f0d9b5',
  泥岩: '#d4c5a9',
  灰岩: '#b5d4c1',
  白云岩: '#a8cdb8',
  页岩: '#c9bfa0',
  粉砂岩: '#e6c9a8',
  紫红色: '#fecaca',
  灰绿色: '#bbf7d0',
  灰黑色: '#6b7280',
  深灰色: '#9ca3af',
  浅灰色: '#f3f4f6',
  灰色: '#e5e7eb',
};

export const DEFAULT_LITHOLOGY_COLOR = '#e0e0e0';

/** pastel 轮转色（无 mapping 的区间道用）。interval_track._PASTEL_PALETTE。 */
export const PASTEL_PALETTE = [
  '#d4e6f1',
  '#d5f5e3',
  '#fdebd0',
  '#e8daef',
  '#fcf3cf',
  '#fadbd8',
  '#d1f2eb',
  '#ebdef0',
];

/** 地层系统分组道默认色。 */
const STRATA_COLOR_MAPPING: PatternMapping = { patterns: {}, colors: { default: '#e5e7eb' } };

/** 层序颜色。 */
const SEQUENCE_COLOR_MAPPING: PatternMapping = {
  patterns: {},
  colors: { SQ1: '#bfdbfe', SQ2: '#fef9c3', default: '#e5e7eb' },
};

/**
 * 内容区非曲线道（不含 depth 与曲线道）—— 对齐 GeoViz build_qpainter_tracks 的顺序与宽度。
 * depth 由 WellLogCanvas 作固定左列常驻；曲线道由 WellLogViewer 按选择动态生成后拼到本数组前。
 * 数据缺失的道在渲染前由 hasTrackData 过滤掉（不会占位留白）。
 */
export const DEFAULT_TRACKS: AnyTrackConfig[] = [
  // 地层系统 — 系/统/组
  { type: 'interval', width: 50, label: '系', group: '地层系统', dataKey: 'system', rotateText: true, colorMapping: STRATA_COLOR_MAPPING },
  { type: 'interval', width: 50, label: '统', group: '地层系统', dataKey: 'series', rotateText: true, colorMapping: STRATA_COLOR_MAPPING },
  { type: 'interval', width: TRACK_WIDTH.formation, label: '组', group: '地层系统', dataKey: 'formation', rotateText: true, colorMapping: STRATA_COLOR_MAPPING },
  // 岩性（纹样）
  { type: 'interval', width: TRACK_WIDTH.lithology, label: '岩性', dataKey: 'lithology', colorMapping: LITHOLOGY_MAPPING },
  // 沉积相 — 微相/亚相/相
  { type: 'interval', width: 80, label: '微相', group: '沉积相', dataKey: 'facies', faciesLevel: 'microPhase', colorMapping: LITHOLOGY_MAPPING },
  { type: 'interval', width: 80, label: '亚相', group: '沉积相', dataKey: 'facies', faciesLevel: 'subPhase', colorMapping: LITHOLOGY_MAPPING },
  { type: 'interval', width: 80, label: '相', group: '沉积相', dataKey: 'facies', faciesLevel: 'phase', colorMapping: LITHOLOGY_MAPPING },
  // 体系域
  { type: 'systems_tract', width: 60, label: '体系域' },
  // 层序
  { type: 'interval', width: 50, label: '层序', dataKey: 'sequence', rotateText: true, colorMapping: SEQUENCE_COLOR_MAPPING },
  // 岩性描述
  { type: 'text', width: 150, label: '岩性描述', dataKey: 'lithologyDesc' },
];
