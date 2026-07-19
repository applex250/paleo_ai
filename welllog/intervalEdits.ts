// 区间编辑：校验、边界贴齐、同名融合、内存应用、待保存队列。
// 岩性与沉积微相共用同一套规则。浏览器仅持有 JSON 增量（create/delete），绝不序列化/上传 XLSX。

import type { IntervalItem, IntervalSource, LithologyInterval, WellLogData } from './types';

export type IntervalKind = 'lithology' | 'microPhase';
export type IntervalOpAction = 'create' | 'delete';

/** 删除目标：原 XLSX 行 或 已保存 create 的 originOperationId。 */
export interface IntervalDeleteTarget {
  sheet?: string;
  row?: number;
  originOperationId?: string;
}

/** 单条区间操作（与 POST /intervals 请求体元素一致）。 */
export interface IntervalOperation {
  operationId: string;
  action: IntervalOpAction;
  kind: IntervalKind;
  top: number;
  bottom: number;
  name: string;
  /** delete 时必填其一：xlsx 行 或 originOperationId。 */
  target?: IntervalDeleteTarget;
}

export const MIN_DRAG_PIXELS = 4;
export const MIN_DEPTH_SPAN = 1e-6;
/** 端点相等/相邻判定容差（米）。 */
export const DEPTH_EPS = 1e-9;

export function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 支持反向拖选：返回 (top, bottom) 且 top <= bottom。 */
export function normalizeDepthRange(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

export function isDragTooSmall(startY: number, endY: number, minPx = MIN_DRAG_PIXELS): boolean {
  return Math.abs(endY - startY) < minPx;
}

/** 开区间严格重叠；相邻端点（a.bottom === b.top）不算重叠。 */
export function intervalsStrictlyOverlap(
  aTop: number,
  aBottom: number,
  bTop: number,
  bBottom: number,
): boolean {
  return aTop < bBottom - DEPTH_EPS && bTop < aBottom - DEPTH_EPS;
}

/** 相邻（共享端点）或严格重叠。 */
export function intervalsOverlapOrAdjacent(
  aTop: number,
  aBottom: number,
  bTop: number,
  bBottom: number,
): boolean {
  if (intervalsStrictlyOverlap(aTop, aBottom, bTop, bBottom)) return true;
  return Math.abs(aBottom - bTop) <= DEPTH_EPS || Math.abs(bBottom - aTop) <= DEPTH_EPS;
}

export function findOverlapping(
  top: number,
  bottom: number,
  existing: readonly IntervalItem[],
): IntervalItem[] {
  return existing.filter((iv) => intervalsStrictlyOverlap(top, bottom, iv.top, iv.bottom));
}

export function sortByTop(items: IntervalItem[]): IntervalItem[] {
  return [...items].sort(
    (a, b) => a.top - b.top || a.bottom - b.bottom || a.name.localeCompare(b.name),
  );
}

function namesEqual(a: string, b: string): boolean {
  return (a || '').trim() === (b || '').trim();
}

function sourceKey(src: IntervalSource | undefined): string {
  if (!src) return '';
  if (src.type === 'xlsx') return `xlsx:${src.sheet}:${src.row}`;
  return `create:${src.operationId}`;
}

/** 比较两条区间是否为同一物理行（优先 source，否则 top/bottom/name）。 */
export function sameIntervalIdentity(a: IntervalItem, b: IntervalItem): boolean {
  if (a.source && b.source) return sourceKey(a.source) === sourceKey(b.source);
  return (
    Math.abs(a.top - b.top) <= DEPTH_EPS &&
    Math.abs(a.bottom - b.bottom) <= DEPTH_EPS &&
    namesEqual(a.name, b.name)
  );
}

/** 岩性重叠检查：合并 data.lithology 与 intervals.lithology（保留 source）。 */
export function collectLithologyExisting(data: WellLogData): IntervalItem[] {
  const items: IntervalItem[] = [];
  const seen = new Set<string>();
  const push = (top: number, bottom: number, name: string, source?: IntervalSource) => {
    const key = source
      ? sourceKey(source)
      : `v:${top}|${bottom}|${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ top, bottom, name, source });
  };
  for (const it of data.intervals?.lithology ?? []) {
    push(it.top, it.bottom, (it.name || '').trim(), it.source);
  }
  for (const lit of data.lithology) {
    push(lit.top, lit.bottom, (lit.lithology || '').trim(), lit.source);
  }
  return items;
}

export function collectMicroPhaseExisting(data: WellLogData): IntervalItem[] {
  return (data.intervals?.facies?.microPhase ?? []).map((it) => ({
    top: it.top,
    bottom: it.bottom,
    name: it.name,
    source: it.source,
  }));
}

export function existingForKind(data: WellLogData, kind: IntervalKind): IntervalItem[] {
  return kind === 'lithology' ? collectLithologyExisting(data) : collectMicroPhaseExisting(data);
}

export function collectExistingNames(items: readonly IntervalItem[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const iv of items) {
    const n = (iv.name || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 同名连通分量：与 seed [top,bottom] 经相邻/重叠传递闭包合并的同名区间。
 */
export function findSameNameMergeGroup(
  top: number,
  bottom: number,
  name: string,
  existing: readonly IntervalItem[],
): IntervalItem[] {
  const nm = name.trim();
  const same = existing.filter((iv) => namesEqual(iv.name, nm));
  const group: IntervalItem[] = [];
  let uTop = top;
  let uBot = bottom;
  let changed = true;
  const used = new Set<number>();
  while (changed) {
    changed = false;
    for (let i = 0; i < same.length; i++) {
      if (used.has(i)) continue;
      const iv = same[i];
      if (!intervalsOverlapOrAdjacent(uTop, uBot, iv.top, iv.bottom)) continue;
      used.add(i);
      group.push(iv);
      uTop = Math.min(uTop, iv.top);
      uBot = Math.max(uBot, iv.bottom);
      changed = true;
    }
  }
  return group;
}

export type CreateResolveOk = {
  ok: true;
  top: number;
  bottom: number;
  /** 将被融合吸收的同名已有区间（需 delete + 新 create 并集）。 */
  mergeOf: IntervalItem[];
  /** 是否因单侧不同名贴齐而调整了端点。 */
  adjusted: boolean;
  adjustNote?: string;
};

export type CreateResolveResult = CreateResolveOk | { ok: false; error: string };

/** 多段空白解析成功：每个空白段各一条 CreateResolveOk。 */
export type MultiCreateResolveOk = {
  ok: true;
  segments: CreateResolveOk[];
  /** 用户选择的原始深度范围（归一化后）。 */
  selectionTop: number;
  selectionBottom: number;
};

export type MultiCreateResolveResult = MultiCreateResolveOk | { ok: false; error: string };

/** 合并有序/无序深度区间（闭区间几何并集）。 */
export function mergeDepthRanges(
  ranges: readonly { top: number; bottom: number }[],
): { top: number; bottom: number }[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const out: { top: number; bottom: number }[] = [
    { top: sorted[0].top, bottom: sorted[0].bottom },
  ];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    // 重叠或相邻（含端点相接）均并入
    if (cur.top <= last.bottom + DEPTH_EPS) {
      last.bottom = Math.max(last.bottom, cur.bottom);
    } else {
      out.push({ top: cur.top, bottom: cur.bottom });
    }
  }
  return out;
}

/**
 * 从选择范围 [selTop, selBot] 扣除占用块，得到连续空白段。
 * 占用块先裁剪到选择范围再并集；仅输出跨度 ≥ MIN_DEPTH_SPAN 的空白。
 */
export function freeSegmentsInRange(
  selTop: number,
  selBot: number,
  blockers: readonly { top: number; bottom: number }[],
): { top: number; bottom: number }[] {
  const clipped: { top: number; bottom: number }[] = [];
  for (const b of blockers) {
    const t = Math.max(b.top, selTop);
    const bot = Math.min(b.bottom, selBot);
    if (bot - t > DEPTH_EPS) {
      clipped.push({ top: t, bottom: bot });
    }
  }
  const occupied = mergeDepthRanges(clipped);
  const gaps: { top: number; bottom: number }[] = [];
  let cursor = selTop;
  for (const m of occupied) {
    if (m.top - cursor >= MIN_DEPTH_SPAN) {
      gaps.push({ top: cursor, bottom: m.top });
    }
    cursor = Math.max(cursor, m.bottom);
  }
  if (selBot - cursor >= MIN_DEPTH_SPAN) {
    gaps.push({ top: cursor, bottom: selBot });
  }
  return gaps;
}

/**
 * 纯区间解析（岩性/微相同规则）：
 * - 无冲突 → 直接新增
 * - 同名相邻/重叠 → 并集融合
 * - 仅穿入一个不同名区间的一端 → 该端贴齐
 * - 双侧冲突 / 包含/被包含 / 多个不同名 → 拒绝
 * - 融合（及贴齐）后仍与不同名冲突 → 拒绝
 *
 * 多段空白填充请用 resolveCreateIntervals（内部对每个空白段调用本函数）。
 */
export function resolveCreateInterval(
  top: number,
  bottom: number,
  name: string,
  opts: {
    wellTop: number;
    wellBottom: number;
    existing: readonly IntervalItem[];
  },
): CreateResolveResult {
  if (!(Number.isFinite(top) && Number.isFinite(bottom))) {
    return { ok: false, error: '顶深/底深必须是有效数字。' };
  }
  let t = top;
  let b = bottom;
  if (t > b) [t, b] = [b, t];
  if (t >= b) {
    return { ok: false, error: `顶深必须小于底深（当前 ${t.toFixed(3)} ≥ ${b.toFixed(3)}）。` };
  }
  if (b - t < MIN_DEPTH_SPAN) {
    return { ok: false, error: '区间深度跨度过小，请重新选择。' };
  }
  if (t < opts.wellTop - DEPTH_EPS || b > opts.wellBottom + DEPTH_EPS) {
    return {
      ok: false,
      error: `区间必须位于井完整深度范围内 [${opts.wellTop.toFixed(3)}, ${opts.wellBottom.toFixed(3)}] m；当前 [${t.toFixed(3)}, ${b.toFixed(3)}] m。`,
    };
  }
  const nm = (name ?? '').trim();
  if (!nm) {
    return { ok: false, error: '名称不能为空。' };
  }

  const mergeOf = findSameNameMergeGroup(t, b, nm, opts.existing);
  let uTop = t;
  let uBot = b;
  for (const iv of mergeOf) {
    uTop = Math.min(uTop, iv.top);
    uBot = Math.max(uBot, iv.bottom);
  }

  // 不同名且与并集严格重叠的区间
  const diffConflicts = opts.existing.filter(
    (iv) => !namesEqual(iv.name, nm) && intervalsStrictlyOverlap(uTop, uBot, iv.top, iv.bottom),
  );

  let adjusted = false;
  let adjustNote: string | undefined;

  if (diffConflicts.length > 1) {
    const details = diffConflicts
      .slice(0, 6)
      .map((c) => `${c.name || '(未命名)'} [${c.top.toFixed(3)}, ${c.bottom.toFixed(3)}]`)
      .join('; ');
    return {
      ok: false,
      error: `与多个不同名区间冲突，禁止跨段：${details}${diffConflicts.length > 6 ? ` 等共 ${diffConflicts.length} 段` : ''}。`,
    };
  }

  if (diffConflicts.length === 1) {
    const d = diffConflicts[0];
    const penTop = uTop > d.top + DEPTH_EPS && uTop < d.bottom - DEPTH_EPS;
    const penBot = uBot > d.top + DEPTH_EPS && uBot < d.bottom - DEPTH_EPS;
    const spansBoth = uTop < d.top + DEPTH_EPS && uBot > d.bottom - DEPTH_EPS;
    const contained = penTop && penBot;
    const contains = spansBoth;

    if (contains || contained || (penTop && penBot)) {
      return {
        ok: false,
        error: `与不同名区间 ${d.name || '(未命名)'} [${d.top.toFixed(3)}, ${d.bottom.toFixed(3)}] 存在包含/被包含或双侧冲突，无法新增。`,
      };
    }
    if (penTop && !penBot) {
      // 新区间顶穿入 d，底在 d 外（更深）→ 顶贴齐 d.bottom
      const snapped = d.bottom;
      if (snapped >= uBot - DEPTH_EPS) {
        return {
          ok: false,
          error: `贴齐后区间无效（与 ${d.name || '(未命名)'} 冲突）。`,
        };
      }
      adjustNote = `顶深已贴齐至 ${snapped.toFixed(3)} m（避免与 ${d.name || '(未命名)'} 重叠）`;
      uTop = snapped;
      adjusted = true;
    } else if (penBot && !penTop) {
      // 新区间底穿入 d，顶在 d 外（更浅）→ 底贴齐 d.top
      const snapped = d.top;
      if (uTop >= snapped - DEPTH_EPS) {
        return {
          ok: false,
          error: `贴齐后区间无效（与 ${d.name || '(未命名)'} 冲突）。`,
        };
      }
      adjustNote = `底深已贴齐至 ${snapped.toFixed(3)} m（避免与 ${d.name || '(未命名)'} 重叠）`;
      uBot = snapped;
      adjusted = true;
    } else {
      // 边界擦边等残余：仍算冲突
      return {
        ok: false,
        error: `与不同名区间 ${d.name || '(未命名)'} [${d.top.toFixed(3)}, ${d.bottom.toFixed(3)}] 冲突。`,
      };
    }
  }

  // 贴齐后再次检查不同名
  const remain = opts.existing.filter(
    (iv) => !namesEqual(iv.name, nm) && intervalsStrictlyOverlap(uTop, uBot, iv.top, iv.bottom),
  );
  if (remain.length > 0) {
    const c = remain[0];
    return {
      ok: false,
      error: `贴齐/融合后仍与不同名区间 ${c.name || '(未命名)'} [${c.top.toFixed(3)}, ${c.bottom.toFixed(3)}] 冲突。`,
    };
  }

  if (uBot - uTop < MIN_DEPTH_SPAN) {
    return { ok: false, error: '贴齐后区间深度跨度过小。' };
  }
  if (uTop < opts.wellTop - DEPTH_EPS || uBot > opts.wellBottom + DEPTH_EPS) {
    return { ok: false, error: '贴齐/融合后区间超出井深范围。' };
  }

  return { ok: true, top: uTop, bottom: uBot, mergeOf, adjusted, adjustNote };
}

/**
 * 多段空白解析：不同名区间视为占用块，从选择范围扣除后为每个有效空白段各解析一条创建结果。
 * - 同名区间不是占用；各空白段再按 resolveCreateInterval 规则与同名块融合 / 单侧贴齐
 * - 选择范围被不同名完全占满 → 失败，不做部分修改
 * - 任一段解析失败 → 整体失败，避免半成功
 */
export function resolveCreateIntervals(
  top: number,
  bottom: number,
  name: string,
  opts: {
    wellTop: number;
    wellBottom: number;
    existing: readonly IntervalItem[];
  },
): MultiCreateResolveResult {
  if (!(Number.isFinite(top) && Number.isFinite(bottom))) {
    return { ok: false, error: '顶深/底深必须是有效数字。' };
  }
  let t = top;
  let b = bottom;
  if (t > b) [t, b] = [b, t];
  if (t >= b) {
    return { ok: false, error: `顶深必须小于底深（当前 ${t.toFixed(3)} ≥ ${b.toFixed(3)}）。` };
  }
  if (b - t < MIN_DEPTH_SPAN) {
    return { ok: false, error: '区间深度跨度过小，请重新选择。' };
  }
  if (t < opts.wellTop - DEPTH_EPS || b > opts.wellBottom + DEPTH_EPS) {
    return {
      ok: false,
      error: `区间必须位于井完整深度范围内 [${opts.wellTop.toFixed(3)}, ${opts.wellBottom.toFixed(3)}] m；当前 [${t.toFixed(3)}, ${b.toFixed(3)}] m。`,
    };
  }
  const nm = (name ?? '').trim();
  if (!nm) {
    return { ok: false, error: '名称不能为空。' };
  }

  // 不同名且与选择范围严格重叠 → 占用块（保留不改；从选择中扣除）
  const occupiers = opts.existing.filter(
    (iv) => !namesEqual(iv.name, nm) && intervalsStrictlyOverlap(t, b, iv.top, iv.bottom),
  );
  const gaps = freeSegmentsInRange(t, b, occupiers);

  if (gaps.length === 0) {
    if (occupiers.length === 0) {
      return { ok: false, error: '区间深度跨度过小，请重新选择。' };
    }
    const details = occupiers
      .slice(0, 6)
      .map((c) => `${c.name || '(未命名)'} [${c.top.toFixed(3)}, ${c.bottom.toFixed(3)}]`)
      .join('; ');
    return {
      ok: false,
      error: `所选范围已被不同名区间完全占用，无可用空白段：${details}${occupiers.length > 6 ? ` 等共 ${occupiers.length} 段` : ''}。`,
    };
  }

  const segments: CreateResolveOk[] = [];
  for (const gap of gaps) {
    const r = resolveCreateInterval(gap.top, gap.bottom, nm, opts);
    if (!r.ok) {
      return {
        ok: false,
        error: `空白段 [${gap.top.toFixed(3)}, ${gap.bottom.toFixed(3)}] 无法创建：${r.error}`,
      };
    }
    segments.push(r);
  }

  return {
    ok: true,
    segments,
    selectionTop: t,
    selectionBottom: b,
  };
}

/** 兼容旧调用：仅校验能否新增（内部走 resolveCreateInterval）。 */
export function validateInterval(
  top: number,
  bottom: number,
  opts: {
    wellTop: number;
    wellBottom: number;
    existing: readonly IntervalItem[];
    name?: string;
  },
): { ok: true; top?: number; bottom?: number; mergeOf?: IntervalItem[]; adjusted?: boolean; adjustNote?: string } | { ok: false; error: string } {
  const r = resolveCreateInterval(top, bottom, opts.name ?? '', opts);
  if (!r.ok) return r;
  return {
    ok: true,
    top: r.top,
    bottom: r.bottom,
    mergeOf: r.mergeOf,
    adjusted: r.adjusted,
    adjustNote: r.adjustNote,
  };
}

/** 由 resolved create 生成 pending 操作列表：先 delete 需融合的已落盘块，再 create。 */
export function buildCreateOperations(
  kind: IntervalKind,
  resolved: CreateResolveOk,
  name: string,
  /** 仅仍在 pending 中、尚未落盘的 create operationId 集合 */
  localPendingCreateIds: ReadonlySet<string>,
): IntervalOperation[] {
  const ops: IntervalOperation[] = [];
  const nm = name.trim();

  for (const iv of resolved.mergeOf) {
    const src = iv.source;
    if (src?.type === 'create' && localPendingCreateIds.has(src.operationId)) {
      // 未保存的本地 create：由调用方直接从 pending 撤销，不发 delete
      continue;
    }
    if (src?.type === 'xlsx') {
      ops.push({
        operationId: newOperationId(),
        action: 'delete',
        kind,
        top: iv.top,
        bottom: iv.bottom,
        name: (iv.name || '').trim(),
        target: { sheet: src.sheet, row: src.row },
      });
    } else if (src?.type === 'create') {
      ops.push({
        operationId: newOperationId(),
        action: 'delete',
        kind,
        top: iv.top,
        bottom: iv.bottom,
        name: (iv.name || '').trim(),
        target: { originOperationId: src.operationId },
      });
    } else {
      // 无 source 时仍发 delete，靠 top/bottom/name 匹配（Worker 回退）
      ops.push({
        operationId: newOperationId(),
        action: 'delete',
        kind,
        top: iv.top,
        bottom: iv.bottom,
        name: (iv.name || '').trim(),
      });
    }
  }

  ops.push({
    operationId: newOperationId(),
    action: 'create',
    kind,
    top: resolved.top,
    bottom: resolved.bottom,
    name: nm,
  });
  return ops;
}

function deleteOpDedupeKey(op: IntervalOperation): string {
  if (op.target?.originOperationId) return `c:${op.target.originOperationId}`;
  if (op.target?.sheet != null && op.target?.row != null) {
    return `x:${op.target.sheet}:${op.target.row}`;
  }
  return `v:${op.top}|${op.bottom}|${op.name}`;
}

/**
 * 多空白段各自生成 create/delete 增量；重复的 merge 删除目标只发一次。
 */
export function buildCreateOperationsForSegments(
  kind: IntervalKind,
  segments: readonly CreateResolveOk[],
  name: string,
  localPendingCreateIds: ReadonlySet<string>,
): IntervalOperation[] {
  const ops: IntervalOperation[] = [];
  const seenDeletes = new Set<string>();
  for (const seg of segments) {
    for (const op of buildCreateOperations(kind, seg, name, localPendingCreateIds)) {
      if (op.action === 'delete') {
        const key = deleteOpDedupeKey(op);
        if (seenDeletes.has(key)) continue;
        seenDeletes.add(key);
      }
      ops.push(op);
    }
  }
  return ops;
}

/** 构建删除单块操作；若块为未保存本地 create，返回 null（调用方本地撤销）。 */
export function buildDeleteOperation(
  kind: IntervalKind,
  item: IntervalItem,
  localPendingCreateIds: ReadonlySet<string>,
): IntervalOperation | null {
  const nm = (item.name || '').trim();
  const src = item.source;
  if (src?.type === 'create' && localPendingCreateIds.has(src.operationId)) {
    return null;
  }
  if (src?.type === 'xlsx') {
    return {
      operationId: newOperationId(),
      action: 'delete',
      kind,
      top: item.top,
      bottom: item.bottom,
      name: nm,
      target: { sheet: src.sheet, row: src.row },
    };
  }
  if (src?.type === 'create') {
    return {
      operationId: newOperationId(),
      action: 'delete',
      kind,
      top: item.top,
      bottom: item.bottom,
      name: nm,
      target: { originOperationId: src.operationId },
    };
  }
  return {
    operationId: newOperationId(),
    action: 'delete',
    kind,
    top: item.top,
    bottom: item.bottom,
    name: nm,
  };
}

function lithToItem(lit: LithologyInterval): IntervalItem {
  return { top: lit.top, bottom: lit.bottom, name: lit.lithology, source: lit.source };
}

function itemToLith(it: IntervalItem): LithologyInterval {
  return { top: it.top, bottom: it.bottom, lithology: it.name, source: it.source };
}

function removeMatching(
  list: IntervalItem[],
  targets: readonly IntervalItem[],
): IntervalItem[] {
  if (targets.length === 0) return list;
  const rest = [...list];
  for (const t of targets) {
    const idx = rest.findIndex((x) => sameIntervalIdentity(x, t));
    if (idx >= 0) rest.splice(idx, 1);
  }
  return rest;
}

function removeMatchingLith(
  list: LithologyInterval[],
  targets: readonly IntervalItem[],
): LithologyInterval[] {
  if (targets.length === 0) return list;
  const rest = [...list];
  for (const t of targets) {
    const idx = rest.findIndex((x) => sameIntervalIdentity(lithToItem(x), t));
    if (idx >= 0) rest.splice(idx, 1);
  }
  return rest;
}

/** 不可变地应用 create（含融合：先移除 mergeOf 再追加并集）。 */
export function applyCreateToData(
  data: WellLogData,
  op: IntervalOperation,
  mergeOf: readonly IntervalItem[] = [],
): WellLogData {
  const name = op.name.trim();
  const source: IntervalSource = { type: 'create', operationId: op.operationId };
  const item: IntervalItem = { top: op.top, bottom: op.bottom, name, source };

  if (op.kind === 'lithology') {
    let nextLith = removeMatchingLith(data.lithology, mergeOf);
    nextLith = [...nextLith, itemToLith(item)].sort(
      (a, b) => a.top - b.top || a.bottom - b.bottom || a.lithology.localeCompare(b.lithology),
    );
    const prevIv = data.intervals;
    let nextIvLith = removeMatching(prevIv?.lithology ?? [], mergeOf);
    nextIvLith = sortByTop([...nextIvLith, item]);
    return {
      ...data,
      lithology: nextLith,
      intervals: prevIv
        ? { ...prevIv, lithology: nextIvLith }
        : {
            series: [],
            system: [],
            formation: [],
            member: [],
            lithology: nextIvLith,
            lithologyDesc: [],
            systemsTract: [],
            sequence: [],
            facies: { phase: [], subPhase: [], microPhase: [] },
          },
    };
  }

  const prevIv = data.intervals;
  const prevFacies = prevIv?.facies ?? { phase: [], subPhase: [], microPhase: [] };
  let nextMicro = removeMatching(prevFacies.microPhase ?? [], mergeOf);
  nextMicro = sortByTop([...nextMicro, item]);
  return {
    ...data,
    intervals: prevIv
      ? { ...prevIv, facies: { ...prevFacies, microPhase: nextMicro } }
      : {
          series: [],
          system: [],
          formation: [],
          member: [],
          lithology: [],
          lithologyDesc: [],
          systemsTract: [],
          sequence: [],
          facies: { phase: [], subPhase: [], microPhase: nextMicro },
        },
  };
}

/** 不可变删除一条区间（按 source / 深度名匹配，精确一条）。 */
export function applyDeleteToData(
  data: WellLogData,
  kind: IntervalKind,
  item: IntervalItem,
): WellLogData {
  const targets = [item];
  if (kind === 'lithology') {
    const nextLith = removeMatchingLith(data.lithology, targets);
    const prevIv = data.intervals;
    const nextIvLith = removeMatching(prevIv?.lithology ?? [], targets);
    return {
      ...data,
      lithology: nextLith,
      intervals: prevIv ? { ...prevIv, lithology: nextIvLith } : prevIv,
    };
  }
  const prevIv = data.intervals;
  if (!prevIv) return data;
  const prevFacies = prevIv.facies ?? { phase: [], subPhase: [], microPhase: [] };
  const nextMicro = removeMatching(prevFacies.microPhase ?? [], targets);
  return {
    ...data,
    intervals: { ...prevIv, facies: { ...prevFacies, microPhase: nextMicro } },
  };
}

/** 兼容：无融合的单条 create。 */
export function applyIntervalToData(data: WellLogData, op: IntervalOperation): WellLogData {
  if (op.action === 'delete') {
    return applyDeleteToData(data, op.kind, {
      top: op.top,
      bottom: op.bottom,
      name: op.name,
      source: op.target?.originOperationId
        ? { type: 'create', operationId: op.target.originOperationId }
        : op.target?.sheet != null && op.target?.row != null
          ? { type: 'xlsx', sheet: op.target.sheet, row: op.target.row }
          : undefined,
    });
  }
  return applyCreateToData(data, op, []);
}

/** 从 pending 中撤销尚未保存的 create（及依赖它的本地状态由调用方处理 data）。 */
export function revokeLocalCreate(
  pending: IntervalOperation[],
  createOperationId: string,
): IntervalOperation[] {
  return pending.filter(
    (op) => !(op.action === 'create' && op.operationId === createOperationId),
  );
}

/** 收集 pending 中未保存 create 的 operationId。 */
export function pendingCreateIdSet(pending: readonly IntervalOperation[]): Set<string> {
  const s = new Set<string>();
  for (const op of pending) {
    if (op.action === 'create') s.add(op.operationId);
  }
  return s;
}

/** 双击目标载荷（Canvas / Track → Editor）。 */
export interface IntervalClickTarget {
  kind: IntervalKind;
  top: number;
  bottom: number;
  name: string;
  source?: IntervalSource;
}
