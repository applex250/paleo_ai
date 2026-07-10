// 井剖面 SVG 画布：固定左列深度尺 + 内容区固定列宽/横向滚动 + 深度滚轮缩放/拖拽/十字光标。
//
// ⚡ 深度尺剥离出横向滚动区，固定左侧常驻（对齐 GeoViz DepthRuler）；与内容区共享几何 → 纵向对齐。
// ⚡ 内容区 GeoViz 横向规则：effectiveWidth=max(naturalWidth, viewport)，scale≥1 只拉伸不压缩；超出横向滚动。
// ⚡ activeTracks 空 / naturalWidth≤0 → 内容区空态占位（不除零）。
// ⚡ 十字光标：水平线在内容区，深度读数徽标在固定深度列（滚动时常驻）。
// ⚡ range 受控（由 WellLogViewer 持有）；滚轮用 getScreenCTM().inverse() 反算本地 Y → depth；RAF 合并。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MIN_DEPTH_SPAN, THEME, TRACK_WIDTH } from '../config';
import { hasTrackData } from '../transform';
import type { AnyTrackConfig, WellLogData } from '../types';
import { PATTERNS } from '../patterns';
import { yToDepth } from '../geo';
import DepthTrack from './tracks/DepthTrack';
import CurveTrack from './tracks/CurveTrack';
import IntervalTrack from './tracks/IntervalTrack';
import LithologyTrack from './tracks/LithologyTrack';
import SystemsTractTrack from './tracks/SystemsTractTrack';
import TextTrack from './tracks/TextTrack';
import type { TrackProps } from './tracks/types';

interface Props {
  data: WellLogData;
  tracks: AnyTrackConfig[]; // 内容区轨道（不含 depth；depth 由本组件常驻渲染）
  range: [number, number];
  onRangeChange: (r: [number, number]) => void;
  curveRanges?: Record<string, [number, number]>; // 每条曲线的有效横轴范围（右侧面板编辑）
  onOpenCurveMenu?: (primary: string, anchor: DOMRect) => void; // 列头 ➕ 打开副曲线下拉
  onCursor?: (depth: number, clientX: number, clientY: number) => void; // 鼠标在内容区的深度+屏幕坐标（数值读出框）
  onCursorLeave?: () => void; // 鼠标离开内容区
}

const DEPTH_CFG = { type: 'depth' as const, width: TRACK_WIDTH.depth, label: '深度', label2: '(m)' };

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

const WellLogCanvas: React.FC<Props> = ({ data, tracks, range, onRangeChange, curveRanges, onOpenCurveMenu, onCursor, onCursorLeave }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentSvgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursorY, setCursorY] = useState<number | null>(null);

  // 量滚动容器视口宽 + 行高
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    });
    ro.observe(el);
    setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  const activeTracks = useMemo(() => tracks.filter((t) => hasTrackData(t, data)), [tracks, data]);

  // 内容区布局：固定宽，effectiveWidth=max(natural,viewport)，scale≥1
  const layout = useMemo(() => {
    const naturalWidth = activeTracks.reduce((s, t) => s + t.width, 0);
    const effectiveWidth = naturalWidth > 0 ? Math.max(naturalWidth, size.w) : size.w;
    const scale = naturalWidth > 0 ? effectiveWidth / naturalWidth : 1;
    let x = 0;
    const items = activeTracks.map((cfg) => {
      const w = cfg.width * scale;
      const sx = x;
      x += w;
      return { cfg, x: sx, width: w };
    });
    return { items, naturalWidth, effectiveWidth };
  }, [activeTracks, size.w]);

  // 分组表头（连续同 group）
  const groups = useMemo(() => {
    const out: { label: string; x: number; width: number }[] = [];
    const items = layout.items;
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
  }, [layout]);

  // 共享几何
  const hasGroups = groups.length > 0;
  const headerBandY = hasGroups ? THEME.groupHeaderH : 0;
  const headerH = THEME.trackHeaderH;
  const contentY = headerBandY + headerH;
  const contentH = Math.max(60, size.h - contentY);
  const [depthTop, depthBottom] = range;
  const empty = activeTracks.length === 0 || layout.naturalWidth <= 0;

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

  // 滚轮缩放（原生 non-passive）
  useEffect(() => {
    const svg = contentSvgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
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
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [contentY, contentH, data, onRangeChange, empty]);

  // 拖拽平移 + 十字光标
  const dragRef = useRef<{ startLocalY: number; startTop: number; startBot: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent): void => {
    const svg = contentSvgRef.current;
    if (!svg) return;
    const localY = clientToSvgY(svg, e.clientY);
    if (localY == null) return;
    dragRef.current = { startLocalY: localY, startTop: range[0], startBot: range[1] };
    svg.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const svg = contentSvgRef.current;
    if (!svg) return;
    const localY = clientToSvgY(svg, e.clientY);
    if (localY == null) {
      setCursorY(null);
      onCursorLeave?.();
      return;
    }
    const inContent = localY >= contentY && localY <= contentY + contentH;
    setCursorY(inContent ? localY : null);
    if (inContent) {
      const depth = yToDepth(localY, range[0], range[1], contentY, contentH);
      onCursor?.(depth, e.clientX, e.clientY);
    } else {
      onCursorLeave?.();
    }
    const d = dragRef.current;
    if (!d) return;
    const span = d.startBot - d.startTop;
    const depthDelta = ((localY - d.startLocalY) / contentH) * span;
    let nt = d.startTop - depthDelta;
    let nb = d.startBot - depthDelta;
    if (nt < data.topDepth) {
      nb += data.topDepth - nt;
      nt = data.topDepth;
    }
    if (nb > data.bottomDepth) {
      nt -= nb - data.bottomDepth;
      nb = data.bottomDepth;
    }
    scheduleRange([nt, nb]);
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    dragRef.current = null;
    contentSvgRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const cursorDepth =
    cursorY != null ? yToDepth(cursorY, depthTop, depthBottom, contentY, contentH) : null;

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

  return (
    <div className="flex h-full w-full">
      {/* 固定左列：深度尺（不随横向滚动） */}
      <div className="flex-shrink-0">{depthCol}</div>

      {/* 右侧：横向滚动内容区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden"
        style={{ cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
      >
        {empty ? (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            暂无可滚动轨道（请在右侧勾选曲线）
          </div>
        ) : (
          <svg
            ref={contentSvgRef}
            width={layout.effectiveWidth}
            height={size.h}
            style={{ display: 'block', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              setCursorY(null);
              onCursorLeave?.();
            }}
          >
            <defs>
              {Object.entries(PATTERNS).map(([id, p]) => (
                <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={p.w} height={p.h}>
                  <image href={p.url} x={0} y={0} width={p.w} height={p.h} preserveAspectRatio="xMidYMid slice" />
                </pattern>
              ))}
            </defs>

            {hasGroups &&
              groups.map((g) => (
                <g key={g.label}>
                  <rect x={g.x} y={0} width={g.width} height={THEME.groupHeaderH} fill={THEME.headerBg} stroke={THEME.border} />
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

            {layout.items.map((it, i) => {
              const p: TrackProps = {
                cfg: it.cfg,
                data,
                width: it.width,
                depthTop,
                depthBottom,
                headerBandY,
                headerH,
                contentY,
                contentH,
                curveRange:
                  it.cfg.type === 'curves' ? curveRanges?.[it.cfg.curveNames[0]] : undefined,
                onOpenCurveMenu,
              };
              return (
                <g key={`${it.cfg.type}-${it.cfg.label}-${i}`} transform={`translate(${it.x},0)`}>
                  {renderTrack(p)}
                </g>
              );
            })}

            {cursorY != null && (
              <line x1={0} y1={cursorY} x2={layout.effectiveWidth} y2={cursorY} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
            )}
          </svg>
        )}
      </div>
    </div>
  );
};

export default WellLogCanvas;
