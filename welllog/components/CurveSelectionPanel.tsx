// 右侧曲线选择面板：勾选显隐 + 行内编辑每条曲线的横轴范围 [min,max]。
// ⚡ 双击"范围文本"span 才进编辑态（不绑整行，避免误触勾选框/色块/名称）。
// ⚡ Enter/失焦提交（校验 finite && max>min，否则红闪+恢复）；Esc 放弃；Enter/Esc 阻止冒泡。
// ⚡ 编辑只回调 onRangeChange → Viewer setCurveRanges(spread) → 仅该曲线重算（见 Canvas/CurveTrack memo 链）。
import React, { useRef, useState } from 'react';
import type { CurveData } from '../types';

interface PanelProps {
  curves: CurveData[];
  selected: Set<string>;
  curveRanges: Record<string, [number, number]>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onRangeChange: (name: string, range: [number, number]) => void;
}

const CurveSelectionPanel: React.FC<PanelProps> = ({
  curves,
  selected,
  curveRanges,
  onToggle,
  onSelectAll,
  onClear,
  onRangeChange,
}) => {
  return (
    <div className="w-56 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col max-h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <span className="text-xs font-semibold text-slate-700">
          曲线 {selected.size}/{curves.length}
        </span>
        <span className="flex gap-2 text-xs">
          <button onClick={onSelectAll} className="text-blue-600 hover:underline">
            全选
          </button>
          <button onClick={onClear} className="text-slate-500 hover:underline">
            清空
          </button>
        </span>
      </div>
      <div className="overflow-y-auto flex-1">
        {curves.map((c) => (
          <CurveRow
            key={c.name}
            curve={c}
            checked={selected.has(c.name)}
            range={curveRanges[c.name] ?? c.displayRange}
            onToggle={() => onToggle(c.name)}
            onRangeChange={(r) => onRangeChange(c.name, r)}
          />
        ))}
      </div>
    </div>
  );
};

interface RowProps {
  curve: CurveData;
  checked: boolean;
  range: [number, number];
  onToggle: () => void;
  onRangeChange: (r: [number, number]) => void;
}

const CurveRow: React.FC<RowProps> = ({ curve, checked, range, onToggle, onRangeChange }) => {
  const [editing, setEditing] = useState(false);
  const [minStr, setMinStr] = useState('');
  const [maxStr, setMaxStr] = useState('');
  const [flash, setFlash] = useState(false);
  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);

  const startEdit = (): void => {
    setMinStr(String(range[0]));
    setMaxStr(String(range[1]));
    setEditing(true);
  };

  const fail = (): void => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 500);
    setMinStr(String(range[0]));
    setMaxStr(String(range[1]));
  };

  const commit = (): void => {
    const mn = Number(minStr);
    const mx = Number(maxStr);
    if (Number.isFinite(mn) && Number.isFinite(mx) && mx > mn) {
      onRangeChange([mn, mx]);
      setEditing(false);
    } else {
      fail(); // 红闪 + 恢复，留在编辑态供重试
    }
  };

  const cancel = (): void => {
    setEditing(false);
    setMinStr(String(range[0]));
    setMaxStr(String(range[1]));
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  // 失焦提交，但 min↔max 之间切换不提交（relatedTarget 是兄弟输入框）
  const onMinBlur = (e: React.FocusEvent): void => {
    if (e.relatedTarget === maxRef.current) return;
    commit();
  };
  const onMaxBlur = (e: React.FocusEvent): void => {
    if (e.relatedTarget === minRef.current) return;
    commit();
  };

  const inputCls = `w-16 px-1 py-0.5 border rounded text-xs ${
    flash ? 'border-red-500 animate-pulse' : 'border-slate-300'
  }`;

  return (
    <div className="px-3 py-1 hover:bg-slate-50">
      <div className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={checked} onChange={onToggle} className="accent-blue-600" />
        <span
          className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-slate-300"
          style={{ background: curve.color }}
        />
        <span className="truncate text-slate-700 flex-1" title={curve.name}>
          {curve.name}
        </span>
      </div>
      {editing ? (
        <div className="flex items-center gap-1 mt-1">
          <input
            ref={minRef}
            value={minStr}
            onChange={(e) => setMinStr(e.target.value)}
            onKeyDown={onKey}
            onBlur={onMinBlur}
            className={inputCls}
            inputMode="decimal"
            autoFocus
          />
          <span className="text-slate-400">–</span>
          <input
            ref={maxRef}
            value={maxStr}
            onChange={(e) => setMaxStr(e.target.value)}
            onKeyDown={onKey}
            onBlur={onMaxBlur}
            className={inputCls}
            inputMode="decimal"
          />
        </div>
      ) : (
        <div
          onDoubleClick={startEdit}
          className="mt-0.5 text-[10px] text-slate-500 cursor-text select-none w-fit"
          title="双击编辑横轴范围"
        >
          [{range[0].toFixed(1)}, {range[1].toFixed(1)}]
        </div>
      )}
    </div>
  );
};

export default CurveSelectionPanel;
