// 井剖面对外容器：加载态/错误态 + 工具栏（深度区间/重置）+ [WellLogCanvas | 右侧曲线选择面板]。
// 状态：range(深度) + selected(道/主曲线显隐) + curveRanges(横轴范围编辑) + secondaries(每道副曲线) + menu(下拉)。
// 右侧面板只管道显隐；列头 ➕ 下拉管副曲线叠加。同道主+副共享主曲线量程。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Maximize2, MousePointerClick } from 'lucide-react';
import { useWellLogData } from '../useWellLogData';
import WellLogCanvas from './WellLogCanvas';
import CurveSelectionPanel from './CurveSelectionPanel';
import TrackHeaderDropdown from './TrackHeaderDropdown';
import CursorReadout from './CursorReadout';
import { DEFAULT_TRACKS, TRACK_WIDTH } from '../config';
import type { AnyTrackConfig, CurveData } from '../types';

interface Props {
  fileId: number;
  name: string;
}

interface MenuState {
  primary: string;
  anchor: DOMRect;
}

const WellLogViewer: React.FC<Props> = ({ fileId, name }) => {
  const { data, loading, error } = useWellLogData(fileId, name);
  const [range, setRange] = useState<[number, number]>([0, 100]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [curveRanges, setCurveRanges] = useState<Record<string, [number, number]>>({});
  const [secondaries, setSecondaries] = useState<Record<string, Set<string>>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [cursor, setCursor] = useState<{ depth: number; x: number; y: number } | null>(null);

  // 数据切换：重置深度区间 + 默认全选曲线 + curveRanges + secondaries + 关菜单
  useEffect(() => {
    if (data) {
      setRange([data.topDepth, data.bottomDepth]);
      setSelected(new Set(data.curves.map((c) => c.name)));
      const entries: Record<string, [number, number]> = {};
      for (const c of data.curves) entries[c.name] = c.displayRange ?? [0, 100];
      setCurveRanges(entries);
      setSecondaries({});
      setMenu(null);
      setCursor(null);
    }
  }, [data]);

  // 深度区间输入：本地字符串，blur/回车提交
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

  // 动态内容轨道：选中主曲线各一道（curveNames=[主,...副]）+ DEFAULT_TRACKS（组/岩性等，不含 depth）
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

  // 当前可见曲线 = 右侧主曲线 ∪ 各列副曲线（去重，按出现顺序）—— 供光标数值读出框
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

  // 右侧面板：切换道显隐；取消勾选同时清该道副曲线（重勾选仅主曲线）
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

  // 副曲线增删清（key=主曲线名）
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
    <div className="flex-1 flex flex-col min-h-0">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white text-xs text-slate-600 flex-wrap">
        <span className="font-medium text-slate-700">{data.wellName}</span>
        <span className="text-slate-400">
          深度 {data.topDepth.toFixed(1)}–{data.bottomDepth.toFixed(1)} m · 曲线 {data.curves.length} 条 · 岩性 {data.lithology.length} 段
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={topStr}
            onChange={(e) => setTopStr(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs"
            inputMode="decimal"
          />
          <span>–</span>
          <input
            value={botStr}
            onChange={(e) => setBotStr(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            className="w-20 px-2 py-1 border border-slate-300 rounded text-xs"
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
          <MousePointerClick size={12} /> 滚轮 平移 · Ctrl+滚轮 缩放 · 列头 ➕ 叠加曲线
        </span>
      </div>

      {/* 主体：画布 + 右侧曲线面板 */}
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

      {/* 列头副曲线下拉（HTML 浮层） */}
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

      {/* 鼠标十字线数值读出框（跟随光标） */}
      {cursor && <CursorReadout cursor={cursor} curves={visibleCurves} />}
    </div>
  );
};

export default WellLogViewer;
