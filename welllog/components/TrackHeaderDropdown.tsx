// 曲线道列头 ➕ 的副曲线管理下拉（HTML 浮层）。
// 全屏透明 backdrop 捕获点外 → onClose；面板 position 锚定 ➕ 按钮下方（夹紧视口）；Esc 关闭。
// 列出除主曲线外的所有曲线，勾选=加入副曲线、取消=移除；底部"清空副曲线"。
import React, { useEffect } from 'react';

export interface CurveOption {
  name: string;
  color: string;
}

interface Props {
  anchor: DOMRect;
  primary: string;
  allCurves: CurveOption[];
  secondaries: Set<string>;
  onAdd: (primary: string, curve: string) => void;
  onRemove: (primary: string, curve: string) => void;
  onClear: (primary: string) => void;
  onClose: () => void;
}

const PANEL_W = 208;

const TrackHeaderDropdown: React.FC<Props> = ({ anchor, primary, allCurves, secondaries, onAdd, onRemove, onClear, onClose }) => {
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PANEL_W - 8));
  const top = Math.min(anchor.bottom + 2, window.innerHeight - 48);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const options = allCurves.filter((c) => c.name !== primary);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bg-white border border-slate-200 rounded-lg shadow-xl"
        style={{ left, top, width: PANEL_W }}
      >
        <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700">
          叠加到「{primary}」道
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {options.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">无其他曲线</div>}
          {options.map((c) => {
            const on = secondaries.has(c.name);
            return (
              <label
                key={c.name}
                className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-slate-50 cursor-pointer"
                title={c.name}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => (on ? onRemove(primary, c.name) : onAdd(primary, c.name))}
                  className="accent-blue-600"
                />
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-slate-300 flex-shrink-0"
                  style={{ background: c.color }}
                />
                <span className="truncate text-slate-700">{c.name}</span>
              </label>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-slate-100 flex justify-between items-center">
          <span className="text-[10px] text-slate-400">已叠加 {secondaries.size}</span>
          <button
            onClick={() => {
              onClear(primary);
              onClose();
            }}
            disabled={secondaries.size === 0}
            className="text-xs text-red-600 hover:underline disabled:text-slate-300 disabled:no-underline"
          >
            清空副曲线
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrackHeaderDropdown;
