// SheetJS 解析出的"表名 → 二维数组(首行表头)" → WellLogData。
// 输入：XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, defval:null}) 的聚合。
// 仅取 geoviz 轨道需要的 3 个 sheet：测井曲线 / 岩性道 / 地层单位道（其余忽略）。

import { CURVE_ALIASES, CURVE_FALLBACK_PALETTE, CURVE_META, DISPLAY_RANGES, getDisplayRange } from './config';
import type {
  AnyTrackConfig,
  CurveData,
  IntervalItem,
  LithologyInterval,
  WellIntervals,
  WellLogData,
} from './types';

type Matrix = unknown[][];

const NULL_TOKENS = new Set(['-9999', '-999', '-9999.0', '-999.25', 'null', 'nan', 'na', '']);

/** 解析数值；"-9999/-999.25"/空/非数 → null（缺测断点）。对齐 GeoViz _SENTINEL_VALUES。 */
function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (v === -9999 || v === -999 || v === -999.25) return null;
    return v;
  }
  const s = String(v).trim();
  if (NULL_TOKENS.has(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const headerOf = (m: Matrix): string[] => (m[0] ?? []).map((h) => String(h ?? '').trim());

function indexOf(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** 按表名取二维数组（精确优先，其次包含匹配）；缺失返回 []。 */
function matrixOf(sheets: Record<string, Matrix>, names: string[]): Matrix {
  for (const n of names) if (sheets[n]) return sheets[n];
  for (const k of Object.keys(sheets)) {
    if (names.some((n) => k.includes(n))) return sheets[k];
  }
  return [];
}

/** 反向别名：xlsx 列名 → geoviz 曲线名（DT→AC 等）。 */
const COL_TO_GEONAME: Record<string, string> = Object.entries(CURVE_ALIASES).reduce(
  (acc, [geo, col]) => {
    acc[col] = geo;
    return acc;
  },
  {} as Record<string, string>,
);

/** 非曲线列：精确名命中则跳过（对齐 GeoViz loaders.py:336）。 */
const SKIP_COLUMNS = new Set(['井号', 'TVD', 'TVDSS', '道名', '道']);

/** 深度列：精确"深度"优先，其次含"深度"/"depth"。 */
function findDepthIdx(header: string[]): number {
  const exact = header.indexOf('深度');
  if (exact >= 0) return exact;
  for (let i = 0; i < header.length; i++) {
    if (header[i].includes('深度') || header[i].toLowerCase().includes('depth')) return i;
  }
  return -1;
}

/**
 * 测井曲线：枚举所有列（除深度列 + 精确名 井号/TVD/TVDSS/道名/道）——对齐 GeoViz generic 路径。
 * 已知列走别名 + CURVE_META（色/线型）+ DISPLAY_RANGES；其余列保留原名，CURVE_FALLBACK_PALETTE 轮转配色，
 * displayRange 用 getDisplayRange（子串查找，未知→数据 min/max）。全缺测列跳过。
 */
function readCurves(matrix: Matrix): CurveData[] {
  if (matrix.length === 0) return [];
  const header = headerOf(matrix);
  const depthIdx = findDepthIdx(header);
  if (depthIdx < 0) return [];

  // 收集 depth 可解析的行（对齐）
  const depths: number[] = [];
  const rows: number[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const d = parseNum(matrix[r]?.[depthIdx]);
    if (d == null) continue;
    depths.push(d);
    rows.push(r);
  }
  if (depths.length === 0) return [];

  const out: CurveData[] = [];
  let fallbackIdx = 0;
  for (let col = 0; col < header.length; col++) {
    if (col === depthIdx) continue;
    const colName = header[col];
    if (!colName || SKIP_COLUMNS.has(colName)) continue;
    const values: (number | null)[] = depths.map((_, i) => parseNum(matrix[rows[i]]?.[col]));
    if (!values.some((v) => v != null)) continue; // 全缺测列跳过
    const geoName = COL_TO_GEONAME[colName] ?? colName;
    const meta = CURVE_META[geoName];
    const color = meta?.color ?? CURVE_FALLBACK_PALETTE[fallbackIdx++ % CURVE_FALLBACK_PALETTE.length];
    const lineStyle = meta?.style ?? 'solid';
    const displayRange = DISPLAY_RANGES[geoName] ?? getDisplayRange(geoName, values);
    out.push({ name: geoName, depth: depths, values, displayRange, color, lineStyle });
  }
  return out;
}

/** 岩性道 → LithologyInterval[]（顶深/底深/岩性）。 */
function readLithology(matrix: Matrix): LithologyInterval[] {
  if (matrix.length === 0) return [];
  const header = headerOf(matrix);
  const tIdx = indexOf(header, ['顶深']);
  const bIdx = indexOf(header, ['底深']);
  const lIdx = indexOf(header, ['岩性']);
  if (tIdx < 0 || bIdx < 0 || lIdx < 0) return [];
  const out: LithologyInterval[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const top = parseNum(matrix[r]?.[tIdx]);
    const bottom = parseNum(matrix[r]?.[bIdx]);
    const lith = matrix[r]?.[lIdx];
    if (top == null || bottom == null || lith == null || lith === '') continue;
    out.push({ top, bottom, lithology: String(lith).trim() });
  }
  return out;
}

/** 地层单位道（道名="组"）→ IntervalItem[]（顶深/底深/层号）。 */
function readFormation(matrix: Matrix): IntervalItem[] {
  if (matrix.length === 0) return [];
  const header = headerOf(matrix);
  const daoIdx = indexOf(header, ['道名']);
  const tIdx = indexOf(header, ['顶深']);
  const bIdx = indexOf(header, ['底深']);
  const layerIdx = indexOf(header, ['层号']);
  if (daoIdx < 0 || tIdx < 0 || bIdx < 0 || layerIdx < 0) return [];
  const out: IntervalItem[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const dao = String(matrix[r]?.[daoIdx] ?? '').trim();
    if (dao !== '组') continue;
    const top = parseNum(matrix[r]?.[tIdx]);
    const bottom = parseNum(matrix[r]?.[bIdx]);
    const nm = matrix[r]?.[layerIdx];
    if (top == null || bottom == null || nm == null || nm === '') continue;
    out.push({ top, bottom, name: String(nm).trim() });
  }
  return out;
}

/** 把所有 sheet 聚合为 WellLogData。 */
export function transformWellLog(sheets: Record<string, Matrix>, wellName: string): WellLogData {
  const curves = readCurves(matrixOf(sheets, ['测井曲线']));
  const lithology = readLithology(matrixOf(sheets, ['岩性道']));
  const formation = readFormation(matrixOf(sheets, ['地层单位道']));

  // 深度域：优先取曲线 depth，否则回退到岩性/地层区间
  let topDepth = Infinity;
  let bottomDepth = -Infinity;
  const see = (d?: number | null): void => {
    if (d == null) return;
    if (d < topDepth) topDepth = d;
    if (d > bottomDepth) bottomDepth = d;
  };
  if (curves.length > 0) {
    for (const d of curves[0].depth) see(d);
  } else {
    for (const it of lithology) {
      see(it.top);
      see(it.bottom);
    }
    for (const it of formation) {
      see(it.top);
      see(it.bottom);
    }
  }
  if (!Number.isFinite(topDepth) || !Number.isFinite(bottomDepth)) {
    topDepth = 0;
    bottomDepth = 100;
  }

  const intervals: WellIntervals = {
    series: [],
    system: [],
    formation,
    member: [],
    lithology: [],
    lithologyDesc: [],
    systemsTract: [],
    sequence: [],
    facies: { phase: [], subPhase: [], microPhase: [] },
  };

  return { wellName, topDepth, bottomDepth, curves, lithology, intervals };
}

/**
 * 按 TrackConfig 解析该道的区间数据；无数据返回 null（供 hasData 过滤与渲染共用）。
 * - dataKey='lithology' → data.lithology（LithologyInterval[]，带纹样）
 * - dataKey='facies' + faciesLevel → intervals.facies[level]
 * - 其余 dataKey → intervals[dataKey]
 */
export function resolveTrackItems(
  cfg: AnyTrackConfig,
  data: WellLogData,
): IntervalItem[] | LithologyInterval[] | null {
  if (cfg.type === 'interval') {
    if (cfg.dataKey === 'lithology') {
      return data.lithology.length > 0 ? data.lithology : null;
    }
    if (cfg.dataKey === 'facies') {
      const f = data.intervals?.facies;
      const arr = f && cfg.faciesLevel ? f[cfg.faciesLevel] : [];
      return arr && arr.length > 0 ? arr : null;
    }
    const arr = data.intervals
      ? (data.intervals as unknown as Record<string, IntervalItem[]>)[cfg.dataKey]
      : undefined;
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  }
  if (cfg.type === 'text') {
    const arr = data.intervals
      ? (data.intervals as unknown as Record<string, IntervalItem[]>)[cfg.dataKey]
      : undefined;
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  }
  if (cfg.type === 'systems_tract') {
    const arr = data.intervals?.systemsTract;
    return arr && arr.length > 0 ? arr : null;
  }
  return null;
}

/** 该道是否有数据可渲染（决定是否进入 activeTracks）。 */
export function hasTrackData(cfg: AnyTrackConfig, data: WellLogData): boolean {
  if (cfg.type === 'depth') return true;
  if (cfg.type === 'curves') {
    const names = cfg.curveNames;
    return data.curves.some((c) => names.includes(c.name));
  }
  return resolveTrackItems(cfg, data) != null;
}
