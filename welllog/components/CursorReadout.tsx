// 鼠标十字线处的曲线数值读出框（仿 geoviz CrosshairOverlay 的 value panel）。
// 跟随光标定位（右上偏移，贴边翻转）；显示当前深度 + 各可见曲线在该深度的线性插值值。
// 内容曲线集 = 右侧主曲线 ∪ 各列副曲线（由 Viewer 去重后传入）。
// pointer-events:none —— 不拦截鼠标，滚轮/拖拽照常作用于画布。
import React from 'react';
import { interpAtDepth } from '../geo';
import type { CurveData } from '../types';

interface Props {
  cursor: { depth: number; x: number; y: number };
  curves: CurveData[];
}

const PANEL_W = 196;

const CursorReadout: React.FC<Props> = ({ cursor, curves }) => {
  const rows = curves
    .map((c) => ({ c, v: interpAtDepth(c.depth, c.values, cursor.depth) }))
    .filter((r) => r.v != null);

  // 估算高度用于贴边翻转
  const panelH = 28 + rows.length * 17 + 8;
  let left = cursor.x + 16;
  if (left + PANEL_W > window.innerWidth - 8) left = cursor.x - PANEL_W - 16;
  if (left < 8) left = 8;
  let top = cursor.y - panelH - 8;
  if (top < 8) top = cursor.y + 16;
  if (top + panelH > window.innerHeight - 8) top = window.innerHeight - panelH - 8;

  return (
    <div className="fixed z-50 pointer-events-none" style={{ left, top, width: PANEL_W }}>
      <div className="bg-white/95 backdrop-blur-sm border border-slate-300 rounded-md shadow-lg text-xs overflow-hidden">
        <div className="px-2.5 py-1 font-bold text-slate-800 border-b border-slate-200">
          深度: {cursor.depth.toFixed(1)} m
        </div>
        <div className="px-2.5 py-1">
          {rows.length === 0 && <div className="text-slate-400 py-0.5">（该深度无数据）</div>}
          {rows.map(({ c, v }) => (
            <div key={c.name} className="flex items-center gap-1.5 py-0.5 leading-none">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 border border-slate-300"
                style={{ background: c.color }}
              />
              <span className="text-slate-500 flex-1 truncate">{c.name}</span>
              <span className="font-semibold text-slate-800 tabular-nums">{(v as number).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CursorReadout;
