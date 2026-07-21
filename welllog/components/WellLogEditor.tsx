// 可编辑井剖面工作区：复用 WellLogCanvas 渲染/导航；区间编辑 + 待保存 JSON 增量队列。
// save() 仅 POST create/delete JSON，绝不上传 XLSX / base64。岩性与沉积微相完全同规则。
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, Edit3, Loader2, Maximize2, MousePointerClick } from 'lucide-react';
import { useWellLogData, invalidateWellLogCache } from '../useWellLogData';
import WellLogCanvas from './WellLogCanvas';
import CurveSelectionPanel from './CurveSelectionPanel';
import TrackHeaderDropdown from './TrackHeaderDropdown';
import CursorReadout from './CursorReadout';
import IntervalEditDialog, { type IntervalEditResult } from './IntervalEditDialog';
import IntervalBlockEditDialog from './IntervalBlockEditDialog';
import { DEFAULT_TRACKS, TRACK_WIDTH } from '../config';
import type { AnyTrackConfig, CurveData, IntervalItem } from '../types';
import {
  applyCreateToData,
  applyDeleteToData,
  buildCreateOperationsForSegments,
  buildDeleteOperation,
  existingForKind,
  pendingCreateIdSet,
  revokeLocalCreate,
  resolveCreateIntervals,
  sameIntervalIdentity,
  type CreateResolveOk,
  type IntervalKind,
  type IntervalOperation,
} from '../intervalEdits';
import type { IntervalBlockClickPayload } from './tracks/types';
import {
  resolveFaciesColors,
  saveAnnotationIntervals,
  type IntervalOpPayload,
  type MicroPhaseRuleGroup,
} from '../../services/annotation';

/** 单次 save 选项；auto 失败文案由 autosaveRound 统一处理。 */
export type SaveOptions = {
  source?: 'auto' | 'manual';
};

/** 一轮自动保存：最多 3 次请求（初次 + 失败后再试 2 次）。 */
const AUTOSAVE_MAX_ATTEMPTS = 3;
const AUTOSAVE_BACKOFF_MS = [0, 1000, 2000] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

export interface WellLogEditorHandle {
  /** 提交当前 pending；手动/完成/退出请用默认 source。 */
  save(opts?: SaveOptions): Promise<boolean>;
  /**
   * 心跳触发的一轮自动保存：有 pending 时最多尝试 3 次（失败再试 2 次）。
   * 成功/锁失效即停；3 次仍失败则 pending 保留，等下次心跳。
   */
  autosaveRound(): Promise<boolean>;
  hasUnsavedChanges(): boolean;
  pendingCount(): number;
}

interface Props {
  fileId: number;
  name: string;
  /** 锁失效后：保留显示但禁用新增/保存 */
  readOnly?: boolean;
  /** 亚相→微相规则组；弹窗按区间中心深度定向推荐微相 */
  microPhaseRuleGroups?: MicroPhaseRuleGroup[];
  onPendingChange?: (count: number) => void;
  onSaveStateChange?: (saving: boolean) => void;
}

interface MenuState {
  primary: string;
  anchor: DOMRect;
}

interface DialogState {
  top: number;
  bottom: number;
}

/** 右键双击打开的既有区间修改目标。 */
interface BlockEditState {
  kind: IntervalKind;
  top: number;
  bottom: number;
  name: string;
  source?: IntervalItem['source'];
}

/** 评估本批增量保存 results（纯函数，供 doSave 与最小验证复用）。 */
export function evaluateBatchSaveResults(
  attemptedIds: readonly string[],
  results: { operationId: string; status: string; error?: string }[] | undefined | null,
): {
  successIds: Set<string>;
  failed: { operationId: string; reason: string }[];
  allOk: boolean;
} {
  if (attemptedIds.length === 0) {
    return { successIds: new Set(), failed: [], allOk: true };
  }
  const list = Array.isArray(results) ? results : [];
  // HTTP ok 但 results 异常/空：整批视为失败（本批非空时）
  if (list.length === 0) {
    return {
      successIds: new Set(),
      failed: attemptedIds.map((id) => ({ operationId: id, reason: '缺少结果' })),
      allOk: false,
    };
  }
  const byId = new Map(list.map((r) => [r.operationId, r]));
  const successIds = new Set<string>();
  const failed: { operationId: string; reason: string }[] = [];
  for (const id of attemptedIds) {
    const r = byId.get(id);
    if (r && (r.status === 'applied' || r.status === 'duplicate')) {
      successIds.add(id);
    } else if (!r) {
      failed.push({ operationId: id, reason: '缺少结果' });
    } else if (r.status === 'error') {
      failed.push({ operationId: id, reason: r.error || 'error' });
    } else {
      failed.push({ operationId: id, reason: String(r.status) });
    }
  }
  return { successIds, failed, allOk: failed.length === 0 };
}

function toPayload(ops: IntervalOperation[]): IntervalOpPayload[] {
  return ops.map((op) => ({
    operationId: op.operationId,
    action: op.action,
    kind: op.kind,
    top: op.top,
    bottom: op.bottom,
    name: op.name,
    target: op.target,
  }));
}

const WellLogEditor = forwardRef<WellLogEditorHandle, Props>(function WellLogEditor(
  { fileId, name, readOnly = false, microPhaseRuleGroups, onPendingChange, onSaveStateChange },
  ref,
) {
  const { data: loaded, loading, error } = useWellLogData(fileId, name);
  const [data, setData] = useState(loaded);
  const [pending, setPending] = useState<IntervalOperation[]>([]);
  const [saving, setSaving] = useState(false);
  const [intervalMode, setIntervalMode] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [blockEdit, setBlockEdit] = useState<BlockEditState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const dataRef = useRef(data);
  dataRef.current = data;
  const savingRef = useRef(false);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  /** 防止心跳叠两次 autosaveRound */
  const autosaveRoundInFlightRef = useRef(false);

  // 首次/重载：以 loaded 为基线；若本地有未保存操作，不覆盖（避免心跳重挂载丢改）
  useEffect(() => {
    if (!loaded) return;
    if (pendingRef.current.length > 0 && data) return;
    setData(loaded);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onPendingChange?.(pending.length);
  }, [pending.length, onPendingChange]);

  useEffect(() => {
    onSaveStateChange?.(saving);
  }, [saving, onSaveStateChange]);

  // 锁失效：关闭区间模式与新增/修改弹窗
  useEffect(() => {
    if (readOnly) {
      setIntervalMode(false);
      setDialog(null);
      setBlockEdit(null);
    }
  }, [readOnly]);

  const [range, setRange] = useState<[number, number]>([0, 100]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [curveRanges, setCurveRanges] = useState<Record<string, [number, number]>>({});
  const [secondaries, setSecondaries] = useState<Record<string, Set<string>>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [cursor, setCursor] = useState<{ depth: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!data) return;
    setRange([data.topDepth, data.bottomDepth]);
    setSelected(new Set(data.curves.map((c) => c.name)));
    const entries: Record<string, [number, number]> = {};
    for (const c of data.curves) entries[c.name] = c.displayRange ?? [0, 100];
    setCurveRanges(entries);
    setSecondaries({});
    setMenu(null);
    setCursor(null);
  }, [data?.wellName, data?.topDepth, data?.bottomDepth, data?.curves.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [topStr, setTopStr] = useState('0');
  const [botStr, setBotStr] = useState('100');
  useEffect(() => {
    setTopStr(String(Math.round(range[0])));
  }, [range[0]]);
  useEffect(() => {
    setBotStr(String(Math.round(range[1])));
  }, [range[1]]);
  const commit = (): void => {
    if (!data) return;
    const t = Number(topStr);
    const b = Number(botStr);
    if (Number.isFinite(t) && Number.isFinite(b) && b > t) {
      setRange([Math.max(data.topDepth, t), Math.min(data.bottomDepth, b)]);
    }
  };
  const reset = (): void => {
    if (data) setRange([data.topDepth, data.bottomDepth]);
  };

  const tracks = useMemo<AnyTrackConfig[]>(() => {
    if (!data) return DEFAULT_TRACKS;
    const curveTracks: AnyTrackConfig[] = data.curves
      .filter((c) => selected.has(c.name))
      .map((c) => ({
        type: 'curves',
        width: TRACK_WIDTH.curve,
        label: c.name,
        curveNames: [c.name, ...(secondaries[c.name] ?? [])],
      }));
    return [...curveTracks, ...DEFAULT_TRACKS];
  }, [data, selected, secondaries]);

  const visibleCurves = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const t of tracks) {
      if (t.type === 'curves') {
        for (const n of t.curveNames) {
          if (!seen.has(n)) {
            seen.add(n);
            names.push(n);
          }
        }
      }
    }
    return names
      .map((n) => data.curves.find((c) => c.name === n))
      .filter((c): c is CurveData => !!c);
  }, [data, tracks]);

  const toggle = (n: string): void => {
    if (selected.has(n)) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(n);
        return next;
      });
      setSecondaries((prev) => {
        const np = { ...prev };
        delete np[n];
        return np;
      });
    } else {
      setSelected((prev) => new Set(prev).add(n));
    }
  };

  const updateCurveRange = (n: string, r: [number, number]): void => {
    setCurveRanges((prev) => ({ ...prev, [n]: r }));
  };

  const addSecondary = useCallback((p: string, c: string): void => {
    setSecondaries((prev) => {
      const cur = new Set(prev[p] ?? []);
      cur.add(c);
      return { ...prev, [p]: cur };
    });
  }, []);
  const removeSecondary = useCallback((p: string, c: string): void => {
    setSecondaries((prev) => {
      const cur = new Set(prev[p] ?? []);
      cur.delete(c);
      return { ...prev, [p]: cur };
    });
  }, []);
  const clearSecondary = useCallback((p: string): void => {
    setSecondaries((prev) => ({ ...prev, [p]: new Set() }));
  }, []);

  const onOpenCurveMenu = useCallback((primary: string, anchor: DOMRect): void => {
    setMenu({ primary, anchor });
  }, []);
  const onCursor = useCallback((depth: number, x: number, y: number): void => {
    setCursor({ depth, x, y });
  }, []);
  const onCursorLeave = useCallback((): void => {
    setCursor(null);
  }, []);

  const getExisting = useCallback(
    (kind: IntervalKind) => (data ? existingForKind(data, kind) : []),
    [data],
  );

  /** 本井亚相区间：供微相编辑按中心深度定向推荐。 */
  const subPhaseIntervals = useMemo((): IntervalItem[] => {
    if (!data) return [];
    return (
      data.intervals?.facies?.subPhase ??
      data.facies?.subPhase ??
      []
    );
  }, [data]);

  const onIntervalSelect = useCallback(
    (top: number, bottom: number) => {
      if (readOnly || !data) return;
      setDialog({ top, bottom });
    },
    [readOnly, data],
  );

  /**
   * 微相名称在写入本地 data / pending 之前必须先拿到注册色；
   * 失败则不应用编辑。岩性不走颜色注册。
   */
  const ensureMicroPhaseColor = useCallback(
    async (
      name: string,
      base: NonNullable<typeof data>,
    ): Promise<{ ok: true; colors: Record<string, string> } | { ok: false; error: string }> => {
      const key = String(name ?? '')
        .normalize('NFC')
        .trim();
      if (!key) return { ok: false, error: '微相名称无效' };
      const existing = base.faciesColors?.[key];
      if (typeof existing === 'string' && /^#[0-9a-fA-F]{6}$/.test(existing)) {
        return { ok: true, colors: { [key]: existing.toLowerCase() } };
      }
      const res = await resolveFaciesColors([key]);
      if (!res.ok || !res.colors || typeof res.colors[key] !== 'string') {
        return {
          ok: false,
          error: res.error || '无法分配沉积微相颜色，编辑未应用',
        };
      }
      return { ok: true, colors: res.colors };
    },
    [],
  );

  const confirmInterval = useCallback(
    async (result: IntervalEditResult) => {
      if (!data || readOnly) return;
      // 用原始选择范围重跑多段解析，与弹窗规则一致
      const multi = resolveCreateIntervals(result.selectionTop, result.selectionBottom, result.name, {
        wellTop: data.topDepth,
        wellBottom: data.bottomDepth,
        existing: existingForKind(data, result.kind),
      });
      if (!multi.ok) {
        setFlash(multi.error);
        window.setTimeout(() => setFlash(null), 3000);
        return;
      }

      // 微相：先确保颜色，失败不写入 pending / data
      let colorPatch: Record<string, string> = {};
      if (result.kind === 'microPhase') {
        const ensured = await ensureMicroPhaseColor(result.name, data);
        if (!ensured.ok) {
          setFlash(ensured.error);
          window.setTimeout(() => setFlash(null), 3500);
          return;
        }
        colorPatch = ensured.colors;
      }

      const resolvedSegs: CreateResolveOk[] = multi.segments;
      const localIds = pendingCreateIdSet(pendingRef.current);

      // 融合目标里未保存的本地 create：从 pending 撤销，并从 data 中随 mergeOf 一并移除
      let nextPending = [...pendingRef.current];
      for (const seg of resolvedSegs) {
        for (const iv of seg.mergeOf) {
          if (iv.source?.type === 'create' && localIds.has(iv.source.operationId)) {
            nextPending = revokeLocalCreate(nextPending, iv.source.operationId);
          }
        }
      }

      const ops = buildCreateOperationsForSegments(result.kind, resolvedSegs, result.name, localIds);
      const createOps = ops.filter((o) => o.action === 'create');
      if (createOps.length === 0) return;

      // 本地应用：逐段去掉 mergeOf 再写入 create（一次确认渲染全部空白段）
      let nextData = data;
      if (Object.keys(colorPatch).length > 0) {
        nextData = {
          ...nextData,
          faciesColors: { ...nextData.faciesColors, ...colorPatch },
        };
      }
      for (let i = 0; i < createOps.length; i++) {
        nextData = applyCreateToData(nextData, createOps[i], resolvedSegs[i]?.mergeOf ?? []);
      }

      nextPending = [...nextPending, ...ops];
      setData(nextData);
      setPending(nextPending);
      setDialog(null);

      const label = result.kind === 'lithology' ? '岩性' : '沉积微相';
      const mergeCount = resolvedSegs.reduce((n, s) => n + s.mergeOf.length, 0);
      const mergeHint = mergeCount > 0 ? `（融合 ${mergeCount} 段同名）` : '';
      const rangeHint =
        resolvedSegs.length === 1
          ? `${resolvedSegs[0].top.toFixed(1)}–${resolvedSegs[0].bottom.toFixed(1)} m`
          : `${resolvedSegs.length} 段空白`;
      const adjNote = resolvedSegs.find((s) => s.adjustNote)?.adjustNote;
      const adjHint = adjNote ? `；${adjNote}` : '';
      setFlash(`已加入待保存：${label} ${rangeHint}${mergeHint}${adjHint}`);
      window.setTimeout(() => setFlash(null), 3000);
    },
    [data, readOnly, ensureMicroPhaseColor],
  );

  /** 同一块右键双击 → 打开修改弹窗（仅 intervalMode && !readOnly 时由 Canvas 透传）。 */
  const onIntervalBlockRightDoubleClick = useCallback(
    (payload: IntervalBlockClickPayload) => {
      if (readOnlyRef.current || !dataRef.current) return;
      if (!intervalMode) return;
      setBlockEdit({
        kind: payload.kind,
        top: payload.top,
        bottom: payload.bottom,
        name: payload.name,
        source: payload.source,
      });
    },
    [intervalMode],
  );

  /** 直接删除：未保存本地 create 仅撤销 pending；否则加入精准 delete op，立即更新视觉。 */
  const deleteBlock = useCallback(() => {
    const target = blockEdit;
    if (!target || readOnlyRef.current || !dataRef.current) {
      setBlockEdit(null);
      return;
    }
    const label = target.kind === 'lithology' ? '岩性' : '沉积微相';
    const item: IntervalItem = {
      top: target.top,
      bottom: target.bottom,
      name: target.name,
      source: target.source,
    };
    const localIds = pendingCreateIdSet(pendingRef.current);
    const delOp = buildDeleteOperation(target.kind, item, localIds);

    // 本地 data 立即移除
    setData(applyDeleteToData(dataRef.current, target.kind, item));
    setBlockEdit(null);

    if (!delOp) {
      // 未保存 create：撤销 pending 中的 create，不发服务端
      const src = target.source;
      if (src?.type === 'create') {
        setPending((prev) => revokeLocalCreate(prev, src.operationId));
        setFlash(`已撤销未保存的${label}区间（未发往服务端）`);
      } else {
        setFlash('无法定位区间来源，未加入删除队列');
      }
      window.setTimeout(() => setFlash(null), 2500);
      return;
    }

    setPending((prev) => [...prev, delOp]);
    setFlash(
      `已加入待保存删除：${label} ${target.name} ${target.top.toFixed(1)}–${target.bottom.toFixed(1)} m`,
    );
    window.setTimeout(() => setFlash(null), 2500);
  }, [blockEdit]);

  const cancelBlockEdit = useCallback(() => {
    setBlockEdit(null);
  }, []);

  /**
   * 修改既有块：当前块从冲突集合排除；精准删除旧块后再按空白段 create（可多段）。
   * 未保存本地 create 仅撤销 pending，不发 delete。
   */
  const confirmBlockEdit = useCallback(
    async (result: IntervalEditResult) => {
      const target = blockEdit;
      const current = dataRef.current;
      if (!target || !current || readOnlyRef.current) return;

      const targetItem: IntervalItem = {
        top: target.top,
        bottom: target.bottom,
        name: target.name,
        source: target.source,
      };
      const others = existingForKind(current, target.kind).filter(
        (item) => !sameIntervalIdentity(item, targetItem),
      );
      // 弹窗已先校验；用原始选择范围重跑多段解析，防止 data 在弹窗打开期间变化。
      const resolved = resolveCreateIntervals(
        result.selectionTop,
        result.selectionBottom,
        result.name,
        {
          wellTop: current.topDepth,
          wellBottom: current.bottomDepth,
          existing: others,
        },
      );
      if (!resolved.ok) {
        setFlash(resolved.error);
        window.setTimeout(() => setFlash(null), 3000);
        return;
      }

      // 微相改名：先确保颜色，失败不写入 pending / data
      let colorPatch: Record<string, string> = {};
      if (target.kind === 'microPhase') {
        const ensured = await ensureMicroPhaseColor(result.name, current);
        if (!ensured.ok) {
          setFlash(ensured.error);
          window.setTimeout(() => setFlash(null), 3500);
          return;
        }
        colorPatch = ensured.colors;
      }

      const resolvedSegs = resolved.segments;
      const localIds = pendingCreateIdSet(pendingRef.current);
      let nextPending = [...pendingRef.current];
      const targetDelete = buildDeleteOperation(target.kind, targetItem, localIds);
      if (!targetDelete && target.source?.type === 'create') {
        nextPending = revokeLocalCreate(nextPending, target.source.operationId);
      }
      for (const seg of resolvedSegs) {
        for (const item of seg.mergeOf) {
          if (item.source?.type === 'create' && localIds.has(item.source.operationId)) {
            nextPending = revokeLocalCreate(nextPending, item.source.operationId);
          }
        }
      }

      const createOpsBatch = buildCreateOperationsForSegments(
        target.kind,
        resolvedSegs,
        result.name,
        localIds,
      );
      const createOps = createOpsBatch.filter((op) => op.action === 'create');
      if (createOps.length === 0) return;

      let nextData = applyDeleteToData(current, target.kind, targetItem);
      if (Object.keys(colorPatch).length > 0) {
        nextData = {
          ...nextData,
          faciesColors: { ...nextData.faciesColors, ...colorPatch },
        };
      }
      for (let i = 0; i < createOps.length; i++) {
        nextData = applyCreateToData(nextData, createOps[i], resolvedSegs[i]?.mergeOf ?? []);
      }
      setData(nextData);
      setPending([...nextPending, ...(targetDelete ? [targetDelete] : []), ...createOpsBatch]);
      setBlockEdit(null);

      const label = target.kind === 'lithology' ? '岩性' : '沉积微相';
      const mergeCount = resolvedSegs.reduce((n, s) => n + s.mergeOf.length, 0);
      const mergeHint = mergeCount > 0 ? `（融合 ${mergeCount} 段同名区间）` : '';
      const rangeHint =
        resolvedSegs.length === 1
          ? `${resolvedSegs[0].top.toFixed(1)}–${resolvedSegs[0].bottom.toFixed(1)} m`
          : `${resolvedSegs.length} 段空白`;
      const adjNote = resolvedSegs.find((s) => s.adjustNote)?.adjustNote;
      const adjustHint = adjNote ? `；${adjNote}` : '';
      setFlash(`已加入待保存修改：${label} ${rangeHint}${mergeHint}${adjustHint}`);
      window.setTimeout(() => setFlash(null), 3000);
    },
    [blockEdit, ensureMicroPhaseColor],
  );

  const getOtherExisting = useCallback(
    (kind: IntervalKind) => {
      const target = blockEdit;
      if (!data || !target || target.kind !== kind) return data ? existingForKind(data, kind) : [];
      const item: IntervalItem = {
        top: target.top,
        bottom: target.bottom,
        name: target.name,
        source: target.source,
      };
      return existingForKind(data, kind).filter((candidate) => !sameIntervalIdentity(candidate, item));
    },
    [data, blockEdit],
  );

  const doSave = useCallback(async (opts?: SaveOptions): Promise<boolean> => {
    if (readOnlyRef.current) return false;
    if (savingRef.current) return false;
    const batch = pendingRef.current;
    if (batch.length === 0) return true;
    const source = opts?.source ?? 'manual';
    savingRef.current = true;
    setSaving(true);
    try {
      const wellName = dataRef.current?.wellName || name;
      // 本批尝试保存的 operationId；仅从 pending 移除 applied/duplicate 的本批项
      const attemptedIds = new Set(batch.map((op) => op.operationId));
      const res = await saveAnnotationIntervals(fileId, wellName, toPayload(batch));
      if (!res.ok) {
        if (source !== 'auto') {
          setFlash(res.error || '保存失败，待保存项已保留');
          window.setTimeout(() => setFlash(null), 4000);
        }
        return false;
      }

      const evalResult = evaluateBatchSaveResults([...attemptedIds], res.results);
      // 仅移除本批次 applied/duplicate；失败与缺失结果的操作保留在队列
      if (evalResult.successIds.size > 0) {
        setPending((prev) =>
          prev.filter((op) => {
            if (!attemptedIds.has(op.operationId)) return true;
            return !evalResult.successIds.has(op.operationId);
          }),
        );
      }

      if (!evalResult.allOk) {
        if (source !== 'auto') {
          const detail = evalResult.failed
            .slice(0, 3)
            .map((f) => `${f.operationId.slice(0, 8)}…: ${f.reason}`)
            .join('；');
          const msg =
            evalResult.failed.length === attemptedIds.size
              ? `保存失败，待保存项已保留${detail ? `（${detail}）` : ''}`
              : `部分保存失败（${evalResult.failed.length}/${attemptedIds.size}），失败项已保留${detail ? `：${detail}` : ''}`;
          setFlash(msg);
          window.setTimeout(() => setFlash(null), 5000);
        }
        return false;
      }

      invalidateWellLogCache(fileId);
      setFlash(
        source === 'auto'
          ? `已自动保存 ${evalResult.successIds.size} 条区间增量`
          : `已保存 ${evalResult.successIds.size} 条区间增量`,
      );
      window.setTimeout(() => setFlash(null), 2500);
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [fileId, name]);

  /**
   * 一轮自动保存：最多 AUTOSAVE_MAX_ATTEMPTS 次。
   * 不因失败关闭自动保存；3 次用尽后 pending 保留，等下次心跳。
   */
  const autosaveRound = useCallback(async (): Promise<boolean> => {
    if (readOnlyRef.current) return false;
    if (autosaveRoundInFlightRef.current) return false;
    if (savingRef.current) return false;
    if (pendingRef.current.length === 0) return true;

    autosaveRoundInFlightRef.current = true;
    try {
      for (let attempt = 1; attempt <= AUTOSAVE_MAX_ATTEMPTS; attempt++) {
        if (readOnlyRef.current) return false;
        if (pendingRef.current.length === 0) return true;

        if (attempt > 1) {
          const waitMs = AUTOSAVE_BACKOFF_MS[attempt - 1] ?? 1000;
          setFlash(`自动保存重试中（${attempt}/${AUTOSAVE_MAX_ATTEMPTS}）…`);
          await sleep(waitMs);
          if (readOnlyRef.current) return false;
          if (pendingRef.current.length === 0) {
            setFlash(null);
            return true;
          }
          if (savingRef.current) {
            setFlash('自动保存顺延：手动保存进行中');
            window.setTimeout(() => setFlash(null), 3000);
            return false;
          }
        } else {
          setFlash('自动保存中…');
        }

        const ok = await doSave({ source: 'auto' });
        if (ok) return true;
        if (readOnlyRef.current) return false;
        if (pendingRef.current.length === 0) return true;
      }

      const n = pendingRef.current.length;
      setFlash(
        `自动保存失败（已重试 ${AUTOSAVE_MAX_ATTEMPTS - 1} 次），待保存 ${n} 条将在下次心跳再试`,
      );
      window.setTimeout(() => setFlash(null), 5000);
      return false;
    } finally {
      autosaveRoundInFlightRef.current = false;
    }
  }, [doSave]);

  useImperativeHandle(
    ref,
    () => ({
      save: doSave,
      autosaveRound,
      hasUnsavedChanges: () => pendingRef.current.length > 0,
      pendingCount: () => pendingRef.current.length,
    }),
    [doSave, autosaveRound],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
        <Loader2 size={20} className="animate-spin" /> 解析单井数据…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500 gap-2">
        <AlertCircle size={20} /> 加载失败：{error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div
      className="flex-1 flex flex-col min-h-0 select-none"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white text-xs text-slate-600 flex-wrap">
        <span className="font-medium text-slate-700">{data.wellName}</span>
        <span className="text-slate-400">
          深度 {data.topDepth.toFixed(1)}–{data.bottomDepth.toFixed(1)} m · 曲线 {data.curves.length} 条 · 岩性{' '}
          {data.lithology.length} 段
          {pending.length > 0 && (
            <span className="ml-2 text-amber-600 font-medium">· 待保存 {pending.length}</span>
          )}
        </span>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => {
            setIntervalMode((v) => !v);
            // 关闭编辑模式时收起修改弹窗，避免残留弹窗
            setBlockEdit(null);
          }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-50 ${
            intervalMode
              ? 'bg-blue-50 border-blue-400 text-blue-700'
              : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
          title="开启后左键拖拽框选新增；右键双击岩性/微相块修改（均为 JSON 增量）"
        >
          <Edit3 size={12} /> 区间编辑
        </button>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={topStr}
            onChange={(e) => setTopStr(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs select-text"
            inputMode="decimal"
          />
          <span>–</span>
          <input
            value={botStr}
            onChange={(e) => setBotStr(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs select-text"
            inputMode="decimal"
          />
          <span>m</span>
          <button
            onClick={reset}
            className="ml-2 flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-600"
            title="重置为全井段"
          >
            <Maximize2 size={12} /> 全井段
          </button>
        </div>
        <span className="hidden md:flex items-center gap-1 text-slate-400">
          <MousePointerClick size={12} />
          {intervalMode
            ? '左键框选新增 · 右键双击岩性/微相修改 · 滚轮平移 · Ctrl+滚轮缩放'
            : '滚轮平移 · Ctrl+滚轮缩放 · Shift+滚轮横移 · 列头 ➕ 叠加曲线'}
        </span>
      </div>

      <div
        className={`h-7 px-4 flex items-center text-xs border-b ${
          flash
            ? 'bg-amber-50 text-amber-800 border-amber-100'
            : 'bg-transparent text-transparent border-transparent'
        }`}
        aria-live="polite"
      >
        {flash || '\u00a0'}
      </div>
      {readOnly && (
        <div className="px-4 py-1.5 text-xs bg-red-50 text-red-600 border-b border-red-100 flex items-center gap-1">
          <AlertCircle size={12} /> 编辑权限已失效：井剖面只读，无法新增/删除/保存区间
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 bg-white">
            <WellLogCanvas
              data={data}
              tracks={tracks}
              range={range}
              onRangeChange={setRange}
              curveRanges={curveRanges}
              onOpenCurveMenu={onOpenCurveMenu}
              onCursor={onCursor}
              onCursorLeave={onCursorLeave}
              intervalSelectMode={intervalMode && !readOnly}
              onIntervalSelect={onIntervalSelect}
              onIntervalBlockRightDoubleClick={
                intervalMode && !readOnly ? onIntervalBlockRightDoubleClick : undefined
              }
            />
          </div>
        </div>

        <CurveSelectionPanel
          curves={data.curves}
          selected={selected}
          curveRanges={curveRanges}
          onToggle={toggle}
          onSelectAll={() => setSelected(new Set(data.curves.map((c) => c.name)))}
          onClear={() => setSelected(new Set())}
          onRangeChange={updateCurveRange}
        />
      </div>

      {menu && (
        <TrackHeaderDropdown
          anchor={menu.anchor}
          primary={menu.primary}
          allCurves={data.curves.map((c) => ({ name: c.name, color: c.color }))}
          secondaries={secondaries[menu.primary] ?? new Set()}
          onAdd={addSecondary}
          onRemove={removeSecondary}
          onClear={clearSecondary}
          onClose={() => setMenu(null)}
        />
      )}

      {cursor && <CursorReadout cursor={cursor} curves={visibleCurves} />}

      {dialog && (
        <IntervalEditDialog
          open
          initialTop={dialog.top}
          initialBottom={dialog.bottom}
          wellTop={data.topDepth}
          wellBottom={data.bottomDepth}
          getExisting={getExisting}
          microPhaseRuleGroups={microPhaseRuleGroups}
          subPhaseIntervals={subPhaseIntervals}
          onConfirm={confirmInterval}
          onCancel={() => setDialog(null)}
        />
      )}

      {blockEdit && (
        <IntervalBlockEditDialog
          target={blockEdit}
          wellTop={data.topDepth}
          wellBottom={data.bottomDepth}
          getOtherExisting={getOtherExisting}
          microPhaseRuleGroups={microPhaseRuleGroups}
          subPhaseIntervals={subPhaseIntervals}
          onConfirm={confirmBlockEdit}
          onDelete={deleteBlock}
          onCancel={cancelBlockEdit}
        />
      )}
    </div>
  );
});

export default WellLogEditor;
