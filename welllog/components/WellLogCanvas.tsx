// 井剖面 SVG 画布：固定左列深度尺 + 曲线层（左）+ 右侧六列固定层。
//
// ⚡ 深度尺固定左侧；组、段、岩性、微相/亚相/相固定右侧；其余轨道在曲线层。
// ⚡ 双层自动拉伸：scale≥1 仅放大不压缩；曲线层 SVG=max(可用宽,逻辑总宽)，超出则横向滚动。
// ⚡ 固定层占用宽≥逻辑总宽（分界下限同）；分配更大时向左等比拉伸。列头/分界拖拽行为见下。
// ⚡ 列头右边界 col-resize 拖拽改当前列逻辑宽；固定层最左边界为唯一层间分界手柄。
// ⚡ 列头拖拽不触发十字线/框选/曲线菜单；滚轮导航、Ctrl 深度缩放、Shift 横移、区间框选、右键双击编辑不变。
// ⚡ activeTracks 全空 → 中间空态占位（不除零）。
// ⚡ 十字光标：水平线在曲线层+固定层内容区，深度读数徽标在固定深度列。
// ⚡ range 受控；滚轮用 getScreenCTM().inverse() 反算本地 Y → depth；RAF 合并。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MIN_DEPTH_SPAN, THEME, TRACK_WIDTH } from '../config';
import { hasTrackData } from '../transform';
import type { AnyTrackConfig, WellLogData } from '../types';
import { isDragTooSmall, normalizeDepthRange } from '../intervalEdits';
import { PATTERNS } from '../patterns';
import { yToDepth } from '../geo';
import DepthTrack from './tracks/DepthTrack';
import CurveTrack from './tracks/CurveTrack';
import IntervalTrack from './tracks/IntervalTrack';
import LithologyTrack from './tracks/LithologyTrack';
import SystemsTractTrack from './tracks/SystemsTractTrack';
import TextTrack from './tracks/TextTrack';
import type { IntervalBlockClickPayload, TrackProps } from './tracks/types';

interface Props {
  data: WellLogData;
  tracks: AnyTrackConfig[]; // 内容区轨道（不含 depth；depth 由本组件常驻渲染）
  range: [number, number];
  onRangeChange: (r: [number, number]) => void;
  curveRanges?: Record<string, [number, number]>; // 每条曲线的有效横轴范围（右侧面板编辑）
  onOpenCurveMenu?: (primary: string, anchor: DOMRect) => void; // 列头 ➕ 打开副曲线下拉
  onCursor?: (depth: number, clientX: number, clientY: number) => void; // 鼠标在内容区的深度+屏幕坐标（数值读出框）
  onCursorLeave?: () => void; // 鼠标离开内容区
  /** 开启后左键在图体区域框选深度区间（不平移视图）。 */
  intervalSelectMode?: boolean;
  /** 框选超过 4px 后回调已规范化 (top, bottom)。 */
  onIntervalSelect?: (top: number, bottom: number) => void;
  /**
   * 区间编辑模式下同一块两次右键；未传则不启用块编辑。
   * 不影响框选、滚轮缩放/平移与十字光标。
   */
  onIntervalBlockRightDoubleClick?: (payload: IntervalBlockClickPayload) => void;
}

const DEPTH_CFG = { type: 'depth' as const, width: TRACK_WIDTH.depth, label: '深度', label2: '(m)' };

/** 列头右边界 / 层间分界拖拽热区半宽（px）。 */
const COL_RESIZE_HANDLE_PX = 5;
/** 曲线层至少保留的可用像素，避免固定层拖满后曲线层塌缩。 */
const MIN_SCROLL_PANE_PX = 40;

/** 右侧固定轨道：组 / 段 / 岩性 / 微相 / 亚相 / 相。 */
function isRightFixedTrack(cfg: AnyTrackConfig): boolean {
  if (cfg.type !== 'interval') return false;
  if (cfg.dataKey === 'formation' || cfg.dataKey === 'member' || cfg.dataKey === 'lithology') {
    return true;
  }
  if (cfg.dataKey === 'facies') {
    const lv = cfg.faciesLevel;
    return lv === 'microPhase' || lv === 'subPhase' || lv === 'phase';
  }
  return false;
}

/** 轨道稳定键（会话内逻辑列宽 Map 用；不改数据保存接口）。 */
function trackKey(cfg: AnyTrackConfig): string {
  if (cfg.type === 'curves') {
    return `curves:${cfg.curveNames[0] ?? cfg.label}`;
  }
  if (cfg.type === 'interval') {
    return `interval:${cfg.dataKey}:${cfg.faciesLevel ?? ''}:${cfg.label}`;
  }
  if (cfg.type === 'text') {
    return `text:${'dataKey' in cfg ? cfg.dataKey : ''}:${cfg.label}`;
  }
  if (cfg.type === 'systems_tract') {
    return `systems_tract:${cfg.label}`;
  }
  return `${cfg.type}:${cfg.label}`;
}

/** 配置宽度即逻辑最小宽度。 */
function minLogicalWidth(cfg: AnyTrackConfig): number {
  return cfg.width;
}

type LayoutItem = { cfg: AnyTrackConfig; x: number; width: number; key: string };
type PaneLayout = {
  items: LayoutItem[];
  naturalWidth: number;
  effectiveWidth: number;
  /** display = logical * scale；拖拽时 dLogical = dDisplay / scale */
  scale: number;
};

/**
 * 按逻辑宽度比例自动拉伸填满 availableW（仅放大、不压缩）。
 * naturalWidth = 逻辑宽之和；effectiveWidth = max(availableW, natural)；
 * scale = effective/natural ≥ 1（natural=0 时为 1）。逻辑总宽超出可用宽时 SVG 更宽，由滚动容器产生横向滚动。
 */
function buildStretchedLayout(
  tracks: AnyTrackConfig[],
  logicalByKey: Record<string, number>,
  availableW: number,
): PaneLayout {
  const keys = tracks.map(trackKey);
  const logicals = tracks.map((cfg, i) => {
    const min = minLogicalWidth(cfg);
    const stored = logicalByKey[keys[i]];
    return stored != null ? Math.max(min, stored) : min;
  });
  const naturalWidth = logicals.reduce((s, w) => s + w, 0);
  // 不得压缩到逻辑宽以下：scale 下限 1；超出可用宽时 effective 取逻辑总宽
  const effectiveWidth = Math.max(Math.max(0, availableW), naturalWidth);
  const scale = naturalWidth > 0 ? effectiveWidth / naturalWidth : 1;
  let x = 0;
  const items = tracks.map((cfg, i) => {
    const w = logicals[i] * scale;
    const sx = x;
    x += w;
    return { cfg, x: sx, width: w, key: keys[i] };
  });
  return { items, naturalWidth, effectiveWidth, scale };
}

function buildGroups(items: LayoutItem[]): { label: string; x: number; width: number }[] {
  const out: { label: string; x: number; width: number }[] = [];
  let i = 0;
  while (i < items.length) {
    const g = items[i].cfg.group;
    if (!g) {
      i++;
      continue;
    }
    let j = i;
    while (j < items.length && items[j].cfg.group === g) j++;
    const first = items[i];
    const last = items[j - 1];
    out.push({ label: g, x: first.x, width: last.x + last.width - first.x });
    i = j;
  }
  return out;
}

function clientToSvgY(svg: SVGSVGElement, clientY: number): number | null {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const pt = new DOMPoint(0, clientY).matrixTransform(m.inverse());
  return pt.y;
}

function renderTrack(p: TrackProps): React.ReactElement | null {
  const cfg = p.cfg;
  switch (cfg.type) {
    case 'depth':
      return <DepthTrack {...p} />;
    case 'curves':
      return <CurveTrack {...p} />;
    case 'interval':
      return cfg.dataKey === 'lithology' ? <LithologyTrack {...p} /> : <IntervalTrack {...p} />;
    case 'text':
      return <TextTrack {...p} />;
    case 'systems_tract':
      return <SystemsTractTrack {...p} />;
    default:
      return null;
  }
}

type ColResizeSession = {
  kind: 'col';
  key: string;
  minW: number;
  startClientX: number;
  startLogical: number;
  scale: number;
};

type DividerResizeSession = {
  kind: 'divider';
  startClientX: number;
  startFixedW: number;
  minFixedW: number;
  maxFixedW: number;
};

type ResizeSession = ColResizeSession | DividerResizeSession;

const WellLogCanvas: React.FC<Props> = ({
  data,
  tracks,
  range,
  onRangeChange,
  curveRanges,
  onOpenCurveMenu,
  onCursor,
  onCursorLeave,
  intervalSelectMode = false,
  onIntervalSelect,
  onIntervalBlockRightDoubleClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const contentSvgRef = useRef<SVGSVGElement>(null);
  const fixedSvgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursorY, setCursorY] = useState<number | null>(null);
  // 区间框选：记录 SVG 本地 Y；endY 同步写 ref，避免 pointerup 读到过期 state
  const selectRef = useRef<{ startY: number; endY: number; pointerId: number } | null>(null);
  const [selectBand, setSelectBand] = useState<{ y0: number; y1: number } | null>(null);

  // 会话级列宽：逻辑宽 Map + 固定层总占用（null=按配置最小宽之和）
  const [logicalWidths, setLogicalWidths] = useState<Record<string, number>>({});
  const [fixedPaneWidth, setFixedPaneWidth] = useState<number | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [resizing, setResizing] = useState(false);

  // 量中间+右侧交互层总宽与行高（曲线层可用宽 = 总宽 − 固定层分配宽）
  useEffect(() => {
    const el = interactionRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    });
    ro.observe(el);
    setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  const activeTracks = useMemo(
    () => tracks.filter((t) => t.alwaysVisible || hasTrackData(t, data)),
    [tracks, data],
  );

  const { scrollTracks, fixedTracks } = useMemo(() => {
    const scroll: AnyTrackConfig[] = [];
    const fixed: AnyTrackConfig[] = [];
    for (const t of activeTracks) {
      if (isRightFixedTrack(t)) fixed.push(t);
      else scroll.push(t);
    }
    return { scrollTracks: scroll, fixedTracks: fixed };
  }, [activeTracks]);

  const hasScrollTracks = scrollTracks.length > 0;
  const hasFixedTracks = fixedTracks.length > 0;

  /** 固定层当前逻辑总宽（各列逻辑宽之和，每列 ≥ 配置最小宽）。分界下限与占用宽下限。 */
  const fixedLogicalTotal = useMemo(
    () =>
      fixedTracks.reduce((s, t) => {
        const key = trackKey(t);
        const min = minLogicalWidth(t);
        const stored = logicalWidths[key];
        return s + (stored != null ? Math.max(min, stored) : min);
      }, 0),
    [fixedTracks, logicalWidths],
  );

  // 固定层分配宽：至少为逻辑总宽（不压缩列）；分配更大时等比向左拉伸；仅无曲线层时吃满整宽
  const allocatedFixedW = useMemo(() => {
    if (!hasFixedTracks) return 0;
    if (!hasScrollTracks) return size.w;
    // 逻辑总宽优先于 MIN_SCROLL_PANE：固定列不可被压到逻辑宽以下
    const maxFixed = Math.max(fixedLogicalTotal, size.w - MIN_SCROLL_PANE_PX);
    const desired = fixedPaneWidth != null ? fixedPaneWidth : fixedLogicalTotal;
    return Math.min(maxFixed, Math.max(fixedLogicalTotal, desired));
  }, [hasFixedTracks, hasScrollTracks, size.w, fixedLogicalTotal, fixedPaneWidth]);

  const scrollAvailableW = hasFixedTracks ? Math.max(0, size.w - allocatedFixedW) : size.w;

  const scrollLayout = useMemo(
    () => buildStretchedLayout(scrollTracks, logicalWidths, scrollAvailableW),
    [scrollTracks, logicalWidths, scrollAvailableW],
  );
  const fixedLayout = useMemo(
    () => buildStretchedLayout(fixedTracks, logicalWidths, allocatedFixedW),
    [fixedTracks, logicalWidths, allocatedFixedW],
  );

  const scrollGroups = useMemo(() => buildGroups(scrollLayout.items), [scrollLayout]);
  const fixedGroups = useMemo(() => buildGroups(fixedLayout.items), [fixedLayout]);

  // 共享几何
  const hasGroups = scrollGroups.length > 0 || fixedGroups.length > 0;
  const headerBandY = hasGroups ? THEME.groupHeaderH : 0;
  const headerH = THEME.trackHeaderH;
  const contentY = headerBandY + headerH;
  const contentH = Math.max(60, size.h - contentY);
  const [depthTop, depthBottom] = range;
  const hasScroll = scrollLayout.naturalWidth > 0;
  const hasFixed = fixedLayout.naturalWidth > 0;
  const empty = !hasScroll && !hasFixed;

  // 任一内容 SVG 均可反算本地 Y（两侧等高对齐）
  const pickSvg = (): SVGSVGElement | null =>
    contentSvgRef.current ?? fixedSvgRef.current;

  // RAF 合并 range；rangeRef 供滚轮同帧多次事件读最新值
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<[number, number] | null>(null);
  const rangeRef = useRef<[number, number]>(range);
  rangeRef.current = range;
  const scheduleRange = (r: [number, number]): void => {
    pendingRef.current = r;
    rangeRef.current = r;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pendingRef.current;
      if (p) onRangeChange(p);
    });
  };
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // 列宽 / 层间分界拖拽：document 级 move/up，避免指针离开热区中断
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent): void => {
      const sess = resizeSessionRef.current;
      if (!sess) return;
      if (sess.kind === 'col') {
        const dDisplay = e.clientX - sess.startClientX;
        const dLogical = sess.scale > 0 ? dDisplay / sess.scale : dDisplay;
        const next = Math.max(sess.minW, sess.startLogical + dLogical);
        setLogicalWidths((prev) => {
          if (prev[sess.key] === next) return prev;
          return { ...prev, [sess.key]: next };
        });
      } else {
        // 左拖扩大固定层（clientX↓ → 分配宽↑），右拖缩小
        const d = sess.startClientX - e.clientX;
        const next = Math.min(sess.maxFixedW, Math.max(sess.minFixedW, sess.startFixedW + d));
        setFixedPaneWidth(next);
      }
    };
    const onUp = (): void => {
      resizeSessionRef.current = null;
      setResizing(false);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [resizing]);

  const beginColResize = useCallback(
    (e: React.PointerEvent, item: LayoutItem, scale: number): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      // 中止进行中的框选，避免列头拖拽与图体交互重叠
      if (selectRef.current) {
        selectRef.current = null;
        setSelectBand(null);
      }
      setCursorY(null);
      onCursorLeave?.();
      const minW = minLogicalWidth(item.cfg);
      const startLogical = logicalWidths[item.key] != null
        ? Math.max(minW, logicalWidths[item.key])
        : minW;
      resizeSessionRef.current = {
        kind: 'col',
        key: item.key,
        minW,
        startClientX: e.clientX,
        startLogical,
        scale: scale > 0 ? scale : 1,
      };
      setResizing(true);
    },
    [logicalWidths, onCursorLeave],
  );

  const beginDividerResize = useCallback(
    (e: React.PointerEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0 || !hasFixedTracks || !hasScrollTracks) return;
      if (selectRef.current) {
        selectRef.current = null;
        setSelectBand(null);
      }
      setCursorY(null);
      onCursorLeave?.();
      // 分界向右缩小不得低于固定层当前逻辑总宽；上限仍保留曲线层最小可用宽（逻辑总宽优先）
      const maxFixedW = Math.max(fixedLogicalTotal, size.w - MIN_SCROLL_PANE_PX);
      resizeSessionRef.current = {
        kind: 'divider',
        startClientX: e.clientX,
        startFixedW: allocatedFixedW,
        minFixedW: fixedLogicalTotal,
        maxFixedW,
      };
      setResizing(true);
    },
    [
      hasFixedTracks,
      hasScrollTracks,
      fixedLogicalTotal,
      size.w,
      allocatedFixedW,
      onCursorLeave,
    ],
  );

  // 滚轮：挂在中间+右侧交互层，Shift 横移 → Ctrl 缩放 → 普通纵移（原生 non-passive）
  useEffect(() => {
    const el = interactionRef.current;
    if (!el || empty) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Shift+滚轮：横向平移可滚动轨道（优先于 Ctrl，不改 range）
      if (e.shiftKey) {
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        const sc = scrollRef.current;
        if (sc) sc.scrollLeft += dx;
        return;
      }
      const svg = pickSvg();
      if (!svg) return;
      const [top, bot] = rangeRef.current;
      const span = bot - top;
      if (e.ctrlKey) {
        // Ctrl+滚轮：以光标深度为锚缩放
        const localY = clientToSvgY(svg, e.clientY);
        if (localY == null || localY < contentY || localY > contentY + contentH) return;
        const c = yToDepth(localY, top, bot, contentY, contentH);
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const fullSpan = data.bottomDepth - data.topDepth;
        const newSpan = Math.max(MIN_DEPTH_SPAN, Math.min(fullSpan, span * factor));
        const frac = span > 0 ? (c - top) / span : 0.5;
        let nt = c - frac * newSpan;
        let nb = nt + newSpan;
        if (nt < data.topDepth) {
          nt = data.topDepth;
          nb = nt + newSpan;
        }
        if (nb > data.bottomDepth) {
          nb = data.bottomDepth;
          nt = nb - newSpan;
        }
        scheduleRange([nt, nb]);
      } else {
        // 普通滚轮：上下平移（deltaY>0 向下/更深）
        const dir = e.deltaY > 0 ? 1 : -1;
        const step = span * 0.1;
        let nt = top + dir * step;
        let nb = bot + dir * step;
        if (nt < data.topDepth) {
          nt = data.topDepth;
          nb = nt + span;
        }
        if (nb > data.bottomDepth) {
          nb = data.bottomDepth;
          nt = nb - span;
        }
        scheduleRange([nt, nb]);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [contentY, contentH, data, onRangeChange, empty]);

  // 十字光标 + 深度读数；区间模式下叠加框选带（中间与右侧同一交互层）
  // 列宽拖拽中跳过，避免与热区冲突
  const onPointerDown = (e: React.PointerEvent): void => {
    if (resizing || resizeSessionRef.current) return;
    if (!intervalSelectMode || e.button !== 0) return;
    const svg = pickSvg();
    const host = interactionRef.current;
    if (!svg || !host) return;
    const localY = clientToSvgY(svg, e.clientY);
    if (localY == null || localY < contentY || localY > contentY + contentH) return;
    selectRef.current = { startY: localY, endY: localY, pointerId: e.pointerId };
    setSelectBand({ y0: localY, y1: localY });
    host.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (resizing || resizeSessionRef.current) return;
    const svg = pickSvg();
    if (!svg) return;
    const localY = clientToSvgY(svg, e.clientY);
    if (localY == null) {
      setCursorY(null);
      onCursorLeave?.();
      return;
    }
    const clampedY = Math.max(contentY, Math.min(contentY + contentH, localY));
    const inContent = localY >= contentY && localY <= contentY + contentH;
    setCursorY(inContent || selectRef.current ? clampedY : null);
    if (inContent || selectRef.current) {
      const depth = yToDepth(clampedY, range[0], range[1], contentY, contentH);
      onCursor?.(depth, e.clientX, e.clientY);
    } else {
      onCursorLeave?.();
    }
    const sel = selectRef.current;
    if (sel) {
      sel.endY = clampedY;
      setSelectBand({ y0: sel.startY, y1: clampedY });
    }
  };

  const finishSelect = (): void => {
    const sel = selectRef.current;
    if (!sel) return;
    selectRef.current = null;
    interactionRef.current?.releasePointerCapture?.(sel.pointerId);
    setSelectBand(null);
    if (!onIntervalSelect) return;
    if (isDragTooSmall(sel.startY, sel.endY)) return;
    const d0 = yToDepth(sel.startY, range[0], range[1], contentY, contentH);
    const d1 = yToDepth(sel.endY, range[0], range[1], contentY, contentH);
    const [top, bottom] = normalizeDepthRange(d0, d1);
    onIntervalSelect(top, bottom);
  };

  const onPointerUp = (): void => {
    if (selectRef.current) finishSelect();
  };

  const onPointerCancel = (e: React.PointerEvent): void => {
    if (selectRef.current) {
      selectRef.current = null;
      setSelectBand(null);
      interactionRef.current?.releasePointerCapture?.(e.pointerId);
    }
  };

  const cursorDepth =
    cursorY != null ? yToDepth(cursorY, depthTop, depthBottom, contentY, contentH) : null;

  const makeTrackProps = (it: LayoutItem): TrackProps => ({
    cfg: it.cfg,
    data,
    width: it.width,
    depthTop,
    depthBottom,
    headerBandY,
    headerH,
    contentY,
    contentH,
    curveRange: it.cfg.type === 'curves' ? curveRanges?.[it.cfg.curveNames[0]] : undefined,
    // 列宽拖拽中不打开副曲线菜单
    onOpenCurveMenu: resizing ? undefined : onOpenCurveMenu,
    // 仅编辑模式透传右键双击；关闭时 undefined，块不响应右键编辑
    onIntervalBlockRightDoubleClick: intervalSelectMode
      ? onIntervalBlockRightDoubleClick
      : undefined,
  });

  const renderPaneSvg = (
    layout: PaneLayout,
    groups: { label: string; x: number; width: number }[],
    svgRef: React.Ref<SVGSVGElement>,
    includePatterns: boolean,
  ): React.ReactElement => (
    <svg
      ref={svgRef}
      width={layout.effectiveWidth}
      height={size.h}
      style={{ display: 'block', touchAction: 'none' }}
    >
      {includePatterns && (
        <defs>
          {Object.entries(PATTERNS).map(([id, p]) => (
            <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={p.w} height={p.h}>
              <image href={p.url} x={0} y={0} width={p.w} height={p.h} preserveAspectRatio="xMidYMid slice" />
            </pattern>
          ))}
        </defs>
      )}

      {hasGroups &&
        groups.map((g) => (
          <g key={g.label}>
            <rect
              x={g.x}
              y={0}
              width={g.width}
              height={THEME.groupHeaderH}
              fill={THEME.headerBg}
              stroke={THEME.border}
            />
            <text
              x={g.x + g.width / 2}
              y={THEME.groupHeaderH / 2}
              fontSize={15}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={THEME.text}
              fontFamily={THEME.fontFamily}
            >
              {g.label}
            </text>
          </g>
        ))}

      {layout.items.map((it, i) => (
        <g key={`${it.key}-${i}`} transform={`translate(${it.x},0)`}>
          {renderTrack(makeTrackProps(it))}
        </g>
      ))}

      {/* 列头右边界拖拽热区（仅表头高度；阻止冒泡以免触发框选/十字） */}
      {layout.items.map((it) => (
        <rect
          key={`resize-${it.key}`}
          x={it.x + it.width - COL_RESIZE_HANDLE_PX}
          y={headerBandY}
          width={COL_RESIZE_HANDLE_PX * 2}
          height={headerH}
          fill="transparent"
          style={{ cursor: 'col-resize' }}
          onPointerDown={(e) => beginColResize(e, it, layout.scale)}
        />
      ))}

      {selectBand && (
        <rect
          x={0}
          y={Math.min(selectBand.y0, selectBand.y1)}
          width={layout.effectiveWidth}
          height={Math.max(1, Math.abs(selectBand.y1 - selectBand.y0))}
          fill="rgba(37, 99, 235, 0.18)"
          stroke="#2563eb"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}

      {cursorY != null && (
        <line
          x1={0}
          y1={cursorY}
          x2={layout.effectiveWidth}
          y2={cursorY}
          stroke="#ef4444"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
    </svg>
  );

  const depthCol = (
    <svg width={TRACK_WIDTH.depth} height={size.h} style={{ display: 'block' }}>
      <DepthTrack
        cfg={DEPTH_CFG}
        data={data}
        width={TRACK_WIDTH.depth}
        depthTop={depthTop}
        depthBottom={depthBottom}
        headerBandY={headerBandY}
        headerH={headerH}
        contentY={contentY}
        contentH={contentH}
      />
      {cursorY != null && cursorDepth != null && (
        <g pointerEvents="none">
          <rect x={1} y={cursorY - 9} width={TRACK_WIDTH.depth - 2} height={18} rx={3} fill="#ef4444" />
          <text
            x={TRACK_WIDTH.depth / 2}
            y={cursorY}
            fontSize={11}
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#fff"
            fontFamily={THEME.fontFamily}
          >
            {cursorDepth.toFixed(1)}
          </text>
        </g>
      )}
    </svg>
  );

  const interactionCursor = resizing
    ? 'col-resize'
    : intervalSelectMode
      ? 'ns-resize'
      : 'crosshair';

  return (
    <div className="flex h-full w-full">
      {/* 固定左列：深度尺（不随横向滚动） */}
      <div className="flex-shrink-0">{depthCol}</div>

      {/* 曲线层 + 右侧固定层：共享指针/滚轮交互 */}
      <div
        ref={interactionRef}
        className="flex min-w-0 flex-1 h-full"
        style={{ cursor: interactionCursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          if (!selectRef.current && !resizeSessionRef.current) {
            setCursorY(null);
            onCursorLeave?.();
          }
        }}
      >
        {/* 曲线层：自动拉伸至固定层左边界 */}
        <div
          ref={scrollRef}
          className="min-w-0 overflow-x-auto overflow-y-hidden"
          style={{
            width: hasFixed ? scrollAvailableW : undefined,
            flex: hasFixed ? '0 0 auto' : '1 1 0%',
            minWidth: 0,
          }}
        >
          {empty || !hasScroll ? (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
              {empty ? '暂无轨道数据' : '暂无可滚动轨道（请在右侧勾选曲线）'}
            </div>
          ) : (
            renderPaneSvg(scrollLayout, scrollGroups, contentSvgRef, false)
          )}
        </div>

        {/* 右侧固定：组 / 段 / 岩性 / 微相 / 亚相 / 相（右贴齐，按分配宽向左拉伸） */}
        {hasFixed && (
          <div className="relative flex-shrink-0" style={{ width: allocatedFixedW }}>
            {/* SVG 内容裁剪；分界手柄放在外层，避免 overflow 裁掉左半热区 */}
            <div className="h-full w-full overflow-hidden border-l border-slate-300">
              {renderPaneSvg(fixedLayout, fixedGroups, fixedSvgRef, true)}
            </div>
            {/* 层间分界：仅固定层最左边界；10px 热区跨边界，有曲线层时才可拖 */}
            {hasScrollTracks && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="固定层宽度"
                className="absolute z-10"
                style={{
                  left: -COL_RESIZE_HANDLE_PX,
                  top: headerBandY,
                  width: COL_RESIZE_HANDLE_PX * 2,
                  height: headerH,
                  cursor: 'col-resize',
                }}
                onPointerDown={beginDividerResize}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WellLogCanvas;
