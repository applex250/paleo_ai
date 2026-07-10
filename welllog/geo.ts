// 井剖面的纯几何数学 —— 移植自 geoviz_well_log/renderer/track_base.py + curve_track.py。
// 去 numpy、纯 JS。所有函数无副作用。

/** 深度 → Y（线性插值）。track_base.py:88-91 */
export function depthToY(depth: number, top: number, bottom: number, y0: number, h: number): number {
  const span = bottom - top;
  if (span <= 0) return y0;
  return y0 + ((depth - top) / span) * h;
}

/** Y → 深度（depthToY 的反函数；用于十字光标/滚轮锚点）。 */
export function yToDepth(y: number, top: number, bottom: number, y0: number, h: number): number {
  const span = bottom - top;
  if (span <= 0 || h <= 0) return top;
  return top + ((y - y0) / h) * span;
}

const GRID_CANDIDATES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** 选一个"刻度间距"，使相邻刻度像素距 >= minPx。track_base.py:111-118 */
export function niceGridInterval(span: number, height: number, minPx = 20): number {
  if (span <= 0 || height <= 0) return 10;
  for (const c of GRID_CANDIDATES) {
    const pxPerTick = height / (span / c);
    if (pxPerTick >= minPx) return c;
  }
  return GRID_CANDIDATES[GRID_CANDIDATES.length - 1];
}

/** 在 [top,bottom] 内按 nice 间距生成刻度深度数组（含端点对齐）。 */
export function gridTicks(top: number, bottom: number, height: number, minPx = 20): number[] {
  const interval = niceGridInterval(bottom - top, height, minPx);
  const out: number[] = [];
  const start = Math.ceil(top / interval) * interval;
  for (let d = start; d <= bottom + 1e-9; d += interval) out.push(d);
  return out;
}

/**
 * 曲线值 → X。curve_track.py:38-52。
 * ⚡ 对数道先判 value<=0 → 返回 x0（否则 Math.log10(0)=-Infinity，路径飞出画布）。
 * 调用方保证 value 为有效数值（-9999 已在数据层转 null，不会进这里）。
 */
export function valueToX(
  value: number,
  range: [number, number],
  x0: number,
  w: number,
  log: boolean,
): number {
  let [lo, hi] = range;
  if (log) {
    if (value <= 0) return x0;
    lo = Math.max(lo, 1e-10);
    hi = Math.max(hi, 1e-10);
    if (lo === hi) return x0 + 0.5 * w;
    const t = (Math.log10(value) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
    return x0 + t * w;
  }
  if (hi === lo) return x0 + 0.5 * w;
  const t = (value - lo) / (hi - lo);
  return x0 + t * w;
}

/**
 * min/max 降采样（每像素桶取最大最小，按深度序输出避免锯齿）。curve_track.py:64-87。
 * ⚡ 输入必须是纯数值数组（无 null）—— 调用方先用 buildCurveSegments 按 null 分段。
 */
export function downsampleMinMax(
  depths: number[],
  values: number[],
  pixelHeight: number,
): { depth: number; value: number }[] {
  const n = depths.length;
  if (n <= pixelHeight * 2) {
    const out: { depth: number; value: number }[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = { depth: depths[i], value: values[i] };
    return out;
  }
  const step = Math.max(1, Math.floor(n / pixelHeight));
  const out: { depth: number; value: number }[] = [];
  for (let i = 0; i < n; i += step) {
    const end = Math.min(i + step, n);
    let minV = Infinity;
    let maxV = -Infinity;
    let minI = i;
    let maxI = i;
    for (let j = i; j < end; j++) {
      const v = values[j];
      if (v < minV) {
        minV = v;
        minI = j;
      }
      if (v > maxV) {
        maxV = v;
        maxI = j;
      }
    }
    // 按深度序输出，避免 zigzag
    if (maxI <= minI) {
      out.push({ depth: depths[maxI], value: values[maxI] });
      if (minI !== maxI) out.push({ depth: depths[minI], value: values[minI] });
    } else {
      out.push({ depth: depths[minI], value: values[minI] });
      out.push({ depth: depths[maxI], value: values[maxI] });
    }
  }
  return out;
}

/**
 * 把一条曲线按 null 断点切成若干"纯数值段"，每段各自降采样。
 * ⚡ 先分段再降采样，杜绝空桶 NaN/undefined（评审陷阱 4）。
 */
export function buildCurveSegments(
  curve: { depth: number[]; values: (number | null)[] },
  pixelHeight: number,
): { depth: number; value: number }[][] {
  const segs: { depth: number; value: number }[][] = [];
  let dBuf: number[] = [];
  let vBuf: number[] = [];
  const flush = (): void => {
    if (dBuf.length > 0) {
      segs.push(downsampleMinMax(dBuf, vBuf, pixelHeight));
      dBuf = [];
      vBuf = [];
    }
  };
  for (let i = 0; i < curve.depth.length; i++) {
    const v = curve.values[i];
    if (v == null || Number.isNaN(v)) {
      flush();
    } else {
      dBuf.push(curve.depth[i]);
      vBuf.push(v);
    }
  }
  flush();
  return segs;
}

/** 把若干降采样段拼成 SVG path 的 `d` 字符串（每段 M 起，段内 L 连）。 */
export function segmentsToPath(
  segs: { depth: number; value: number }[][],
  toX: (v: number) => number,
  toY: (d: number) => number,
): string {
  let d = '';
  for (const seg of segs) {
    for (let i = 0; i < seg.length; i++) {
      const x = toX(seg[i].value);
      const y = toY(seg[i].depth);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    }
  }
  return d.trim();
}

/**
 * 子串最长匹配（key 按长度降序）。lithology_track._SORTED_COLOR_KEYS + pattern_engine 的中文模糊匹配。
 */
export function matchDict(text: string, dict: Record<string, string>): string | undefined {
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (text.includes(k)) return dict[k];
  }
  return undefined;
}

/**
 * 在已排序的 depth[]/values[] 上，对任意深度做**线性插值**取值。
 * 移植自 geoviz overlay._collect_values / web_dist index.js 的 formatter：
 * 二分找下界 bracket [o, o+1]，v0 + (d-d0)/(d1-d0)*(v1-v0)；任一端为 null 或越界 → null；<2 样本 → null。
 */
export function interpAtDepth(
  depths: number[],
  values: (number | null)[],
  depth: number,
): number | null {
  const n = depths.length;
  if (n < 2) return null;
  let lo = 0;
  let hi = n - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (depths[mid] === depth) {
      hit = mid;
      break;
    }
    depths[mid] < depth ? (lo = mid + 1) : (hi = mid - 1);
  }
  const o = hit === -1 ? (hi >= 0 ? hi : 0) : hit;
  if (o >= 0 && o < n - 1) {
    const d0 = depths[o];
    const d1 = depths[o + 1];
    const v0 = values[o];
    const v1 = values[o + 1];
    if (v0 != null && v1 != null && depth >= Math.min(d0, d1) && depth <= Math.max(d0, d1)) {
      return d1 - d0 === 0 ? v0 : v0 + ((depth - d0) / (d1 - d0)) * (v1 - v0);
    }
  }
  return null;
}
