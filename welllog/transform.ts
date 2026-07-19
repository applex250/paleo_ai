// SheetJS 解析出的"表名 → 二维数组(首行表头)" → WellLogData。
// 输入：XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, defval:null}) 的聚合。
// 对齐 GeoViz load_well_log_converted：多测井/离散曲线 sheet + 区间道按道名分类。

import {
  CURVE_FALLBACK_PALETTE,
  CURVE_META,
  DISPLAY_RANGES,
  curveSemanticName,
  getDisplayRange,
} from './config';
import type {
  AnyTrackConfig,
  CurveData,
  IntervalItem,
  IntervalSource,
  LithologyInterval,
  WellIntervals,
  WellLogData,
} from './types';

type Matrix = unknown[][];

/** Worker 写入的幂等操作记录表；解析区间时必须跳过，避免污染轨道数据。 */
const INTERVAL_OPS_SHEET = '__interval_ops';

const NULL_TOKENS = new Set(['-9999', '-999', '-9999.0', '-999.25', 'null', 'nan', 'na', '']);

function isInternalSheetName(sn: string): boolean {
  return sn === INTERVAL_OPS_SHEET || sn.startsWith('__');
}

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

/** sheet 名是否为测井/离散曲线表。 */
function isCurveSheetName(name: string): boolean {
  return name.includes('测井曲线') || name.includes('离散曲线');
}

/**
 * 单 sheet 测井/离散曲线：枚举所有列（除深度列 + 精确名 井号/TVD/TVDSS/道名/道）。
 * CurveData.name = xlsx 原列名（绝不 DT→AC / MLR4C→RT / MLR1C→RXO）；
 * 色/线型/量程按语义键（DT→AC、MLR4C→RT、MLR1C→RXO）或 CURVE_META/DISPLAY_RANGES 命中。
 * 全缺测列跳过。深度按本 sheet 独立读取。
 */
function readCurvesFromSheet(matrix: Matrix): CurveData[] {
  if (matrix.length === 0) return [];
  const header = headerOf(matrix);
  const depthIdx = findDepthIdx(header);
  if (depthIdx < 0) return [];

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

    // name 保留原列名；视觉/量程走语义键
    const semantic = curveSemanticName(colName);
    const meta = CURVE_META[colName] ?? CURVE_META[semantic];
    const color = meta?.color ?? CURVE_FALLBACK_PALETTE[fallbackIdx++ % CURVE_FALLBACK_PALETTE.length];
    const lineStyle = meta?.style ?? 'solid';
    const displayRange =
      DISPLAY_RANGES[colName] ??
      DISPLAY_RANGES[semantic] ??
      getDisplayRange(colName, values);
    out.push({ name: colName, depth: depths, values, displayRange, color, lineStyle });
  }
  return out;
}

/**
 * 循环全部含「测井曲线」或「离散曲线」的 sheet，各自独立 depth；
 * 跨表同名曲线 first-wins（先出现的 sheet 保留）。
 */
function readAllCurves(sheets: Record<string, Matrix>): CurveData[] {
  const seen = new Set<string>();
  const out: CurveData[] = [];
  for (const sn of Object.keys(sheets)) {
    if (!isCurveSheetName(sn)) continue;
    for (const c of readCurvesFromSheet(sheets[sn] ?? [])) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  // 兼容：若 sheet 名未命中，回退单表「测井曲线」
  if (out.length === 0) {
    for (const c of readCurvesFromSheet(matrixOf(sheets, ['测井曲线']))) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}

/** 岩性道 → LithologyInterval[]（顶深/底深/岩性）；附带 sheet+行 作为稳定来源。 */
function readLithology(matrix: Matrix, sheetName: string): LithologyInterval[] {
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
    out.push({
      top,
      bottom,
      lithology: String(lith).trim(),
      source: { type: 'xlsx', sheet: sheetName, row: r },
    });
  }
  return out;
}

/** 在 header 中按精确名优先、再子串找列（跳过 TVD 列）。 */
function findCol(
  header: string[],
  exact: string[],
  includes: string[],
  opts?: { skipTvd?: boolean },
): number {
  for (const n of exact) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    const lower = h.toLowerCase();
    if (opts?.skipTvd !== false && (lower.includes('tvd') || h.includes('TVD'))) continue;
    if (includes.some((k) => h.includes(k) || lower.includes(k.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * 通用区间 sheet → 按道名分组的 IntervalItem。
 * 对齐 GeoViz read_child_sheet：顶/底深模糊匹配；名称列 文本/层号/层名/岩性…；
 * 仅单深度列时 top=bottom。
 */
function readChildSheetGrouped(
  matrix: Matrix,
  defaultTrackName: string,
  sheetName?: string,
): Record<string, IntervalItem[]> {
  if (matrix.length === 0) return {};
  const header = headerOf(matrix);
  const trackIdx = indexOf(header, ['道名']);

  let topIdx = findCol(header, ['顶深', '顶界', 'top'], ['顶', 'top'], { skipTvd: true });
  let botIdx = findCol(header, ['底深', '底界', 'bottom'], ['底', 'bot'], { skipTvd: true });

  // 仅「深度」单列（如标准层道）→ top=bot
  if (topIdx < 0 || botIdx < 0) {
    const dIdx = findCol(header, ['深度'], ['深', 'depth'], { skipTvd: true });
    if (dIdx >= 0) {
      if (topIdx < 0) topIdx = dIdx;
      if (botIdx < 0) botIdx = dIdx;
    }
  }
  if (topIdx < 0 && botIdx >= 0) topIdx = botIdx;
  if (botIdx < 0 && topIdx >= 0) botIdx = topIdx;
  if (topIdx < 0 || botIdx < 0) return {};

  const nameExact = ['文本', '层号', '层名', '岩性', '名称', 'name', '相类型', '说明', '取心', '符号'];
  let nameIdx = -1;
  for (const k of nameExact) {
    const i = header.indexOf(k);
    if (i >= 0 && i !== topIdx && i !== botIdx && i !== trackIdx) {
      nameIdx = i;
      break;
    }
  }
  if (nameIdx < 0) {
    for (let i = 0; i < header.length; i++) {
      if (i === topIdx || i === botIdx || i === trackIdx) continue;
      const h = header[i];
      if (h.includes('井号')) continue;
      if (['岩性', '文本', '层', '相', '名', '符号'].some((k) => h.includes(k)) || h.toLowerCase().includes('name')) {
        nameIdx = i;
        break;
      }
    }
  }
  if (nameIdx < 0) {
    for (let i = 0; i < header.length; i++) {
      if (i === topIdx || i === botIdx || i === trackIdx) continue;
      if (!header[i].includes('井号')) {
        nameIdx = i;
        break;
      }
    }
  }

  const out: Record<string, IntervalItem[]> = {};
  for (let r = 1; r < matrix.length; r++) {
    const top = parseNum(matrix[r]?.[topIdx]);
    const bottom = parseNum(matrix[r]?.[botIdx]);
    if (top == null || bottom == null) continue;
    const nmRaw = nameIdx >= 0 ? matrix[r]?.[nameIdx] : '';
    const name = nmRaw == null || nmRaw === '' ? '' : String(nmRaw).trim();
    let tn =
      trackIdx >= 0
        ? String(matrix[r]?.[trackIdx] ?? '').trim()
        : defaultTrackName;
    if (!tn) tn = defaultTrackName;
    if (!out[tn]) out[tn] = [];
    const item: IntervalItem = { top, bottom, name };
    if (sheetName) item.source = { type: 'xlsx', sheet: sheetName, row: r };
    out[tn].push(item);
  }
  return out;
}

/** 简单区间表（无道名分组）：顶/底 + 名称。 */
function readSimpleIntervals(matrix: Matrix, sheetName?: string): IntervalItem[] {
  const grouped = readChildSheetGrouped(matrix, '_', sheetName);
  const all: IntervalItem[] = [];
  for (const items of Object.values(grouped)) all.push(...items);
  return all;
}

/**
 * 层序块格式（老龙1 / 层序 sheet）：以「井号」表头行分段，
 * block1 → systemsTract，block2 → sequence。
 * 行布局：井号, 名称, 顶深, 底深, …, 层序名(可选 col5)。
 */
function readSequenceBlocks(matrix: Matrix): { systemsTract: IntervalItem[]; sequence: IntervalItem[] } {
  const systemsTract: IntervalItem[] = [];
  const sequence: IntervalItem[] = [];
  if (matrix.length === 0) return { systemsTract, sequence };

  let block = 0;
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    if (row.length < 4) continue;
    if (String(row[0] ?? '').trim() === '井号') {
      block += 1;
      continue;
    }
    if (block < 1) continue;
    const top = parseNum(row[2]);
    const bottom = parseNum(row[3]);
    if (top == null || bottom == null) continue;
    // 优先 col5 层序名，否则 col1 名称
    const nm = row[5] != null && String(row[5]).trim() !== '' ? row[5] : row[1];
    if (nm == null || nm === '') continue;
    const item: IntervalItem = { top, bottom, name: String(nm).trim() };
    if (block === 1) systemsTract.push(item);
    else if (block === 2) sequence.push(item);
  }
  return { systemsTract, sequence };
}

/** 是否像层序块格式（表头行含「井号」且重复出现或首行即井号布局）。 */
function looksLikeSequenceBlock(matrix: Matrix): boolean {
  if (matrix.length < 2) return false;
  let headers = 0;
  for (const row of matrix) {
    if (String(row?.[0] ?? '').trim() === '井号') headers++;
  }
  return headers >= 1 && !headerOf(matrix).includes('道名');
}

/**
 * 把道名/sheet 名映射到区间桶。对齐 GeoViz loaders.py:460-490 + 任务要求的
 * 系/统/组/段、明确命名微相/亚相/相/沉积相、体系域/Systems Tract、层序、岩性描述。
 */
function classifyTrackItems(
  trackName: string,
  sheetName: string,
  items: IntervalItem[],
  buckets: {
    series: IntervalItem[];
    system: IntervalItem[];
    formation: IntervalItem[];
    member: IntervalItem[];
    lithology: IntervalItem[];
    lithologyDesc: IntervalItem[];
    systemsTract: IntervalItem[];
    sequence: IntervalItem[];
    phase: IntervalItem[];
    subPhase: IntervalItem[];
    microPhase: IntervalItem[];
  },
  opts?: { fromTextSheet?: boolean },
): void {
  if (items.length === 0) return;
  const tn = trackName;
  const sn = sheetName;

  // 文本道：仅保留相/沉积相关
  if (opts?.fromTextSheet) {
    if (!tn.includes('相') && !tn.includes('沉积')) return;
  }

  if (tn.includes('岩性道') || tn === '岩性' || (sn.includes('岩性') && !sn.includes('描述') && !tn.includes('描述'))) {
    // 岩性主数据走 data.lithology；此处 intervals.lithology 仅作补充
    if (sn.includes('岩性道') || tn.includes('岩性')) {
      buckets.lithology.push(...items);
      return;
    }
  }
  if (tn.includes('岩性描述') || sn.includes('岩性描述') || tn.includes('描述')) {
    buckets.lithologyDesc.push(...items);
    return;
  }
  if (tn.includes('微相') || sn === '微相' || sn.includes('微相')) {
    buckets.microPhase.push(...items);
    return;
  }
  if (tn.includes('亚相') || sn === '亚相' || sn.includes('亚相')) {
    buckets.subPhase.push(...items);
    return;
  }
  // 「沉积相」或精确「相」→ phase（避免误伤「相类型」列名场景；道名侧已是分类键）
  if (
    tn.includes('沉积相') ||
    tn === '相' ||
    sn === '相' ||
    sn === '沉积相' ||
    (sn.includes('沉积相') && !sn.includes('亚') && !sn.includes('微'))
  ) {
    buckets.phase.push(...items);
    return;
  }
  if (tn.includes('相') && (tn.includes('沉积') || opts?.fromTextSheet)) {
    // 文本道里仅「相」且未命中微/亚时
    if (!tn.includes('微') && !tn.includes('亚')) {
      buckets.phase.push(...items);
      return;
    }
  }
  if (
    tn.includes('体系域') ||
    sn.includes('体系域') ||
    /systems\s*tract/i.test(tn) ||
    /systems\s*tract/i.test(sn)
  ) {
    buckets.systemsTract.push(...items);
    return;
  }
  // 仅当道名/sheet 名明确标识「层序」时归入 sequence；禁止 砂层组 自动映射
  if (tn.includes('层序') || sn.includes('层序')) {
    buckets.sequence.push(...items);
    return;
  }
  if (tn === '段' || (tn.includes('段') && !tn.includes('组'))) {
    buckets.member.push(...items);
    return;
  }
  if (tn === '系' || sn === '系' || (tn.includes('系') && !tn.includes('体') && !tn.includes('统'))) {
    // 避免「体系域」
    if (!tn.includes('体系') && !sn.includes('体系')) {
      buckets.system.push(...items);
      return;
    }
  }
  if (tn === '统' || sn === '统' || tn.includes('统')) {
    buckets.series.push(...items);
    return;
  }
  if (tn === '组' || sn.includes('地层单位') || (tn.includes('组') && !tn.includes('砂层'))) {
    buckets.formation.push(...items);
    return;
  }
  // 未明确映射到本井剖面轨道的辅助道（砂层组、标准层、取心等）不参与预览，
  // 不能兜底污染“岩性描述”道。
}

/** 聚合全部区间类 sheet。 */
function readAllIntervals(sheets: Record<string, Matrix>): {
  intervals: WellIntervals;
  lithology: LithologyInterval[];
} {
  const buckets = {
    series: [] as IntervalItem[],
    system: [] as IntervalItem[],
    formation: [] as IntervalItem[],
    member: [] as IntervalItem[],
    lithology: [] as IntervalItem[],
    lithologyDesc: [] as IntervalItem[],
    systemsTract: [] as IntervalItem[],
    sequence: [] as IntervalItem[],
    phase: [] as IntervalItem[],
    subPhase: [] as IntervalItem[],
    microPhase: [] as IntervalItem[],
  };

  let lithology: LithologyInterval[] = [];

  for (const sn of Object.keys(sheets)) {
    if (isInternalSheetName(sn)) continue;
    if (isCurveSheetName(sn) || sn.includes('坐标')) continue;
    // 本期仅渲染已明确支持的 GeoViz 轨道；辅助数据不应落入岩性描述兜底。
    if (['砂层', '标准层', '取心', '符号', '井身轨迹'].some((marker) => sn.includes(marker))) continue;
    const matrix = sheets[sn] ?? [];
    if (matrix.length === 0) continue;

    // 岩性道优先专读（LithologyInterval）
    if (sn.includes('岩性道') || sn === '岩性剖面') {
      const lit = readLithology(matrix, sn);
      if (lit.length > 0) {
        lithology = lithology.concat(lit);
        continue;
      }
    }

    // 层序块格式
    if ((sn.includes('层序') || /systems\s*tract/i.test(sn)) && looksLikeSequenceBlock(matrix)) {
      const blocks = readSequenceBlocks(matrix);
      buckets.systemsTract.push(...blocks.systemsTract);
      buckets.sequence.push(...blocks.sequence);
      // 若块解析为空，再走通用路径
      if (blocks.systemsTract.length + blocks.sequence.length > 0) continue;
    }

    // 明确命名的专用 sheet（无道名列时整表归一类）
    const explicit: Array<[boolean, (items: IntervalItem[]) => void]> = [
      [sn === '微相' || (sn.includes('微相') && !sn.includes('文本')), (items) => buckets.microPhase.push(...items)],
      [sn === '亚相' || (sn.includes('亚相') && !sn.includes('文本')), (items) => buckets.subPhase.push(...items)],
      [sn === '相' || sn === '沉积相', (items) => buckets.phase.push(...items)],
      [sn.includes('体系域') || /systems\s*tract/i.test(sn), (items) => buckets.systemsTract.push(...items)],
      [sn.includes('岩性描述'), (items) => buckets.lithologyDesc.push(...items)],
    ];
    let handled = false;
    for (const [match, assign] of explicit) {
      if (!match) continue;
      const items = readSimpleIntervals(matrix, sn);
      if (items.length > 0) assign(items);
      handled = true;
      break;
    }
    if (handled) continue;

    // 地层系统专用 sheet（老龙1 无道名时）
    if (sn.includes('地层系统')) {
      // 若带道名则走分组；否则整表当 formation
      const grouped = readChildSheetGrouped(matrix, '组', sn);
      if (Object.keys(grouped).length > 0) {
        for (const [tn, items] of Object.entries(grouped)) {
          classifyTrackItems(tn, sn, items, buckets);
        }
      }
      continue;
    }

    const fromText = sn.includes('文本');
    const grouped = readChildSheetGrouped(matrix, sn, sn);
    for (const [tn, items] of Object.entries(grouped)) {
      classifyTrackItems(tn, sn, items, buckets, { fromTextSheet: fromText });
    }
  }

  // 若岩性道未读到 LithologyInterval，但 intervals.lithology 有数据，则转换
  if (lithology.length === 0 && buckets.lithology.length > 0) {
    lithology = buckets.lithology.map((it) => ({
      top: it.top,
      bottom: it.bottom,
      lithology: it.name,
      source: it.source,
    }));
  }

  const intervals: WellIntervals = {
    series: buckets.series,
    system: buckets.system,
    formation: buckets.formation,
    member: buckets.member,
    lithology: buckets.lithology,
    lithologyDesc: buckets.lithologyDesc,
    systemsTract: buckets.systemsTract,
    sequence: buckets.sequence,
    facies: {
      phase: buckets.phase,
      subPhase: buckets.subPhase,
      microPhase: buckets.microPhase,
    },
  };

  return { intervals, lithology };
}

type OpsCreateHit = {
  operationId: string;
  kind: 'lithology' | 'microPhase' | '';
  top: number;
  bottom: number;
  name: string;
  writeSheet: string;
  writeRow: number;
};

/**
 * 从隐藏 `__interval_ops` 表解析仍有效的 create 记录（已被 delete 的 origin 排除）。
 * 用于把落盘行的 source 从 xlsx 行升级为 create:operationId，保证重载后精确删除。
 */
function parseActiveCreateOps(opsMatrix: Matrix): OpsCreateHit[] {
  if (opsMatrix.length < 2) return [];
  const h = headerOf(opsMatrix);
  const idx = (name: string, fallback = -1): number => {
    const i = h.indexOf(name);
    return i >= 0 ? i : fallback;
  };
  const idI = idx('operationId', 0);
  const actI = idx('action');
  const kindI = idx('kind');
  const topI = idx('top');
  const botI = idx('bottom');
  const nameI = idx('name');
  const wSheetI = idx('writeSheet');
  const wRowI = idx('writeRow');
  const oOpI = idx('originOperationId');

  const deletedOrigins = new Set<string>();
  const creates: OpsCreateHit[] = [];

  for (let r = 1; r < opsMatrix.length; r++) {
    const row = opsMatrix[r] ?? [];
    const id = row[idI] != null ? String(row[idI]).trim() : '';
    if (!id) continue;
    const action =
      actI >= 0 && row[actI] != null && String(row[actI]).trim()
        ? String(row[actI]).trim()
        : 'create';
    if (action === 'delete') {
      const origin =
        oOpI >= 0 && row[oOpI] != null ? String(row[oOpI]).trim() : '';
      if (origin) deletedOrigins.add(origin);
      continue;
    }
    if (action !== 'create') continue;
    const kindRaw = kindI >= 0 && row[kindI] != null ? String(row[kindI]).trim() : '';
    const kind: OpsCreateHit['kind'] =
      kindRaw === 'lithology' || kindRaw === 'microPhase' ? kindRaw : '';
    const top = parseNum(row[topI]);
    const bottom = parseNum(row[botI]);
    const name = nameI >= 0 && row[nameI] != null ? String(row[nameI]).trim() : '';
    const writeSheet =
      wSheetI >= 0 && row[wSheetI] != null ? String(row[wSheetI]).trim() : '';
    const writeRowRaw = wRowI >= 0 ? parseNum(row[wRowI]) : null;
    const writeRow = writeRowRaw != null ? Math.trunc(writeRowRaw) : -1;
    if (top == null || bottom == null || !name) continue;
    creates.push({
      operationId: id,
      kind,
      top,
      bottom,
      name,
      writeSheet,
      writeRow,
    });
  }

  // 同 operationId 以后出现的为准；已 delete 的 origin 剔除
  const byId = new Map<string, OpsCreateHit>();
  for (const c of creates) {
    if (deletedOrigins.has(c.operationId)) continue;
    byId.set(c.operationId, c);
  }
  return [...byId.values()];
}

const DEPTH_EPS = 1e-9;

function depthEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= DEPTH_EPS;
}

/**
 * 将岩性 / 微相区间的 source 升级为 create:operationId（优先 writeSheet+writeRow，
 * 回退 top/bottom/name）。xlsx 原行保持 sheet+row 不变。
 */
function rehydrateCreateSources(
  sheets: Record<string, Matrix>,
  lithology: LithologyInterval[],
  intervals: WellIntervals,
): void {
  const opsMatrix = sheets[INTERVAL_OPS_SHEET];
  if (!opsMatrix || opsMatrix.length < 2) return;
  const creates = parseActiveCreateOps(opsMatrix);
  if (creates.length === 0) return;

  const usedCreateIds = new Set<string>();

  const tryMatchItem = (
    item: { top: number; bottom: number; name: string; source?: IntervalSource },
    kind: 'lithology' | 'microPhase',
  ): IntervalSource | undefined => {
    const src = item.source;
    // 1) 精确：writeSheet + writeRow 对齐当前 xlsx source
    if (src?.type === 'xlsx') {
      for (const c of creates) {
        if (usedCreateIds.has(c.operationId)) continue;
        if (c.kind && c.kind !== kind) continue;
        if (
          c.writeSheet &&
          c.writeRow >= 1 &&
          c.writeSheet === src.sheet &&
          c.writeRow === src.row &&
          depthEq(c.top, item.top) &&
          depthEq(c.bottom, item.bottom) &&
          c.name === item.name
        ) {
          usedCreateIds.add(c.operationId);
          return { type: 'create', operationId: c.operationId };
        }
      }
    }
    // 2) 回退：同 kind + 顶底深 + 名称唯一匹配（行号漂移时）
    const candidates = creates.filter(
      (c) =>
        !usedCreateIds.has(c.operationId) &&
        (!c.kind || c.kind === kind) &&
        depthEq(c.top, item.top) &&
        depthEq(c.bottom, item.bottom) &&
        c.name === item.name,
    );
    if (candidates.length === 1) {
      usedCreateIds.add(candidates[0].operationId);
      return { type: 'create', operationId: candidates[0].operationId };
    }
    return undefined;
  };

  for (const lit of lithology) {
    const upgraded = tryMatchItem(
      { top: lit.top, bottom: lit.bottom, name: lit.lithology, source: lit.source },
      'lithology',
    );
    if (upgraded) lit.source = upgraded;
  }
  for (const it of intervals.lithology) {
    const upgraded = tryMatchItem(it, 'lithology');
    if (upgraded) it.source = upgraded;
  }
  for (const it of intervals.facies.microPhase) {
    const upgraded = tryMatchItem(it, 'microPhase');
    if (upgraded) it.source = upgraded;
  }
}

/** 把所有 sheet 聚合为 WellLogData。 */
export function transformWellLog(sheets: Record<string, Matrix>, wellName: string): WellLogData {
  const curves = readAllCurves(sheets);
  const { intervals, lithology } = readAllIntervals(sheets);
  // 重载后把已保存 create 的来源从 xlsx 行升级为 operationId，保证精确删除
  rehydrateCreateSources(sheets, lithology, intervals);

  // 深度域：全部保留曲线 depth 与全部区间/岩性端点的并集（非 curves-only 或 no-curves 回退）
  let topDepth = Infinity;
  let bottomDepth = -Infinity;
  const see = (d?: number | null): void => {
    if (d == null) return;
    if (d < topDepth) topDepth = d;
    if (d > bottomDepth) bottomDepth = d;
  };
  for (const c of curves) {
    for (const d of c.depth) see(d);
  }
  for (const it of lithology) {
    see(it.top);
    see(it.bottom);
  }
  for (const key of [
    'series',
    'system',
    'formation',
    'member',
    'sequence',
    'systemsTract',
    'lithology',
    'lithologyDesc',
  ] as const) {
    for (const it of intervals[key]) {
      see(it.top);
      see(it.bottom);
    }
  }
  for (const level of ['phase', 'subPhase', 'microPhase'] as const) {
    for (const it of intervals.facies[level]) {
      see(it.top);
      see(it.bottom);
    }
  }
  if (!Number.isFinite(topDepth) || !Number.isFinite(bottomDepth)) {
    topDepth = 0;
    bottomDepth = 100;
  }

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
