// 井剖面轨道配置：曲线元信息、别名、量程、岩性/相映射表、默认轨道集。
// 移植自 qpainter_builder.py（CURVE_META/_MERGE_GROUPS/_LOG_SCALE_CURVES）、
// configs/laolong1.py（DEFAULT_TRACKS 顺序与宽度、LITHOLOGY_MAPPING）、pattern_map.py（FACIES_COLORS）。

import type { AnyTrackConfig, LineStyle, PatternMapping } from './types';

/**
 * 曲线颜色/线型。qpainter_builder.CURVE_META。
 * 同时注册 GeoViz 语义名（AC/RT/RXO）与 xlsx 原列名（DT/MLR4C/MLR1C），
 * 保证 CurveData.name 保留原列名时仍命中相同视觉。
 */
export const CURVE_META: Record<string, { color: string; style: LineStyle }> = {
  AC: { color: '#1d4ed8', style: 'dashed' },
  DT: { color: '#1d4ed8', style: 'dashed' },
  GR: { color: '#15803d', style: 'solid' },
  RT: { color: '#b91c1c', style: 'solid' },
  MLR4C: { color: '#b91c1c', style: 'solid' },
  RXO: { color: '#ea580c', style: 'dashed' },
  MLR1C: { color: '#ea580c', style: 'dashed' },
};

/**
 * GeoViz 语义名 → 常见 xlsx 原列名（文档/兼容；解析时 name 不改写为语义名）。
 * DT↔AC、MLR4C↔RT、MLR1C↔RXO 仅共享视觉与对数语义。
 */
export const CURVE_ALIASES: Record<string, string> = {
  AC: 'DT',
  GR: 'GR',
  RT: 'MLR4C',
  RXO: 'MLR1C',
};

/**
 * xlsx 原列名 → GeoViz 视觉/对数语义键。
 * 仅用于查 META/量程/LOG；CurveData.name 必须仍是原列名。
 */
export const CURVE_SEMANTIC_OF: Record<string, string> = {
  DT: 'AC',
  MLR4C: 'RT',
  MLR1C: 'RXO',
};

/** 解析曲线的视觉/对数语义键（未映射则返回自身）。 */
export function curveSemanticName(colName: string): string {
  return CURVE_SEMANTIC_OF[colName] ?? colName;
}

/** 各曲线显示量程（X 轴范围）。已知曲线优先用此；其余走 getDisplayRange 自动算。 */
export const DISPLAY_RANGES: Record<string, [number, number]> = {
  GR: [0, 150],
  AC: [40, 140],
  DT: [40, 140],
  RT: [0.1, 2000],
  MLR4C: [0.1, 2000],
  RXO: [0.1, 2000],
  MLR1C: [0.1, 2000],
};

/**
 * 对数刻度的曲线。含语义名与 xlsx 原列名，
 * 因 CurveTrack 用 LOG_CURVES.has(curve.name) 且 name 保留原列名。
 */
export const LOG_CURVES = new Set(['RT', 'RXO', 'MLR4C', 'MLR1C']);

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
  // MLR4C≈RT、MLR1C≈RXO：原列名不含 RT/RXO 子串，需显式命中
  if (c === 'MLR4C' || c.includes('RT') || c.includes('RD') || c.includes('LLD')) return [0.1, 2000];
  if (c === 'MLR1C' || c.includes('RXO') || c.includes('RS') || c.includes('LLS')) return [0.1, 2000];
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

/**
 * 沉积相（微相/亚相/相）未能从全局注册表取到色时的稳定安全灰。
 * 不依赖区间下标，不做 pastel 轮换。
 */
export const SAFE_FACIES_COLOR = '#c8c8c8';

/** pastel 轮转色（非沉积相区间道、无 mapping 时用）。interval_track._PASTEL_PALETTE。 */
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

/**
 * 沉积相轨道取色：完整名称精确匹配 faciesColors；无映射 → 安全灰。
 * 不使用 FACIES_COLORS / pastel 下标轮换。
 */
export function resolveFaciesIntervalColor(
  name: string,
  faciesColors: Record<string, string> | undefined | null,
): string {
  const key = String(name ?? '')
    .normalize('NFC')
    .trim();
  if (!key) return SAFE_FACIES_COLOR;
  const hex = faciesColors?.[key];
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    return hex.toLowerCase();
  }
  return SAFE_FACIES_COLOR;
}

/** 从 WellLogData 收集微相/亚相/相全部非空名称（规范化去重，保序）。 */
export function collectFaciesNames(data: {
  facies?: { phase?: { name: string }[]; subPhase?: { name: string }[]; microPhase?: { name: string }[] };
  intervals?: {
    facies?: { phase?: { name: string }[]; subPhase?: { name: string }[]; microPhase?: { name: string }[] };
  };
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    const n = String(raw ?? '')
      .normalize('NFC')
      .trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  const f = data.intervals?.facies ?? data.facies;
  if (!f) return out;
  for (const level of ['microPhase', 'subPhase', 'phase'] as const) {
    const arr = f[level];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) push(it?.name);
  }
  return out;
}

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
 * 数据缺失的道会被过滤；标记 alwaysVisible 的基础轨道例外，保留空白内容区。
 */
export const DEFAULT_TRACKS: AnyTrackConfig[] = [
  // 地层系统 — 系/统按数据展示；组/段始终保留
  { type: 'interval', width: 50, label: '系', group: '地层系统', dataKey: 'system', rotateText: true, colorMapping: STRATA_COLOR_MAPPING },
  { type: 'interval', width: 50, label: '统', group: '地层系统', dataKey: 'series', rotateText: true, colorMapping: STRATA_COLOR_MAPPING },
  { type: 'interval', width: TRACK_WIDTH.formation, label: '组', group: '地层系统', dataKey: 'formation', rotateText: true, colorMapping: STRATA_COLOR_MAPPING, alwaysVisible: true },
  { type: 'interval', width: TRACK_WIDTH.formation, label: '段', group: '地层系统', dataKey: 'member', rotateText: true, colorMapping: STRATA_COLOR_MAPPING, alwaysVisible: true },
  // 岩性（纹样）
  { type: 'interval', width: TRACK_WIDTH.lithology, label: '岩性', dataKey: 'lithology', colorMapping: LITHOLOGY_MAPPING, alwaysVisible: true },
  // 沉积相 — 微相/亚相/相始终保留；取色仅用 WellLogData.faciesColors（全局注册表），无 colorMapping
  { type: 'interval', width: 80, label: '微相', group: '沉积相', dataKey: 'facies', faciesLevel: 'microPhase', alwaysVisible: true },
  { type: 'interval', width: 80, label: '亚相', group: '沉积相', dataKey: 'facies', faciesLevel: 'subPhase', alwaysVisible: true },
  { type: 'interval', width: 80, label: '相', group: '沉积相', dataKey: 'facies', faciesLevel: 'phase', alwaysVisible: true },
  // 体系域
  { type: 'systems_tract', width: 60, label: '体系域' },
  // 层序
  { type: 'interval', width: 50, label: '层序', dataKey: 'sequence', rotateText: true, colorMapping: SEQUENCE_COLOR_MAPPING },
  // 岩性描述
  { type: 'text', width: 150, label: '岩性描述', dataKey: 'lithologyDesc' },
];
