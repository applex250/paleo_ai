// 已有岩性/沉积微相块的右键双击编辑弹窗：固定类型，支持直接删除。
import React, { useEffect, useMemo, useState } from 'react';
import type { IntervalItem } from '../types';
import type { IntervalKind } from '../intervalEdits';
import { collectExistingNames, normalizeDepthRange, resolveCreateIntervals } from '../intervalEdits';
import type { IntervalEditResult } from './IntervalEditDialog';

interface Target extends IntervalItem {
  kind: IntervalKind;
}

interface Props {
  target: Target;
  wellTop: number;
  wellBottom: number;
  /** 已排除 target 本身，用于验证修改后的边界与同名融合。 */
  getOtherExisting: (kind: IntervalKind) => IntervalItem[];
  microPhaseRules?: string[];
  onConfirm: (result: IntervalEditResult) => void;
  onDelete: () => void;
  onCancel: () => void;
}

const KIND_LABEL: Record<IntervalKind, string> = {
  lithology: '岩性',
  microPhase: '沉积微相',
};

function suggestionNames(rules: readonly string[] | undefined, existing: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of rules ?? []) {
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  for (const raw of existing) {
    const name = raw.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

const IntervalBlockEditDialog: React.FC<Props> = ({
  target,
  wellTop,
  wellBottom,
  getOtherExisting,
  microPhaseRules,
  onConfirm,
  onDelete,
  onCancel,
}) => {
  const [topStr, setTopStr] = useState('');
  const [bottomStr, setBottomStr] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setTopStr(String(Number(target.top.toFixed(3))));
    setBottomStr(String(Number(target.bottom.toFixed(3))));
    setName(target.name);
    setError('');
  }, [target]);

  const existing = useMemo(
    () => getOtherExisting(target.kind),
    [getOtherExisting, target.kind],
  );
  const names = useMemo(() => {
    const current = collectExistingNames(existing);
    return target.kind === 'microPhase' ? suggestionNames(microPhaseRules, current) : current;
  }, [existing, microPhaseRules, target.kind]);
  const datalistId = `interval-block-${target.kind}-names`;

  const submit = (): void => {
    let top = Number(topStr);
    let bottom = Number(bottomStr);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      setError('顶深和底深必须是有效数字。');
      return;
    }
    [top, bottom] = normalizeDepthRange(top, bottom);
    const resolved = resolveCreateIntervals(top, bottom, name, {
      wellTop,
      wellBottom,
      existing,
    });
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    if (resolved.segments.length === 1 && resolved.segments[0].adjusted) {
      setTopStr(String(Number(resolved.segments[0].top.toFixed(3))));
      setBottomStr(String(Number(resolved.segments[0].bottom.toFixed(3))));
    }
    onConfirm({
      kind: target.kind,
      name: name.trim(),
      selectionTop: resolved.selectionTop,
      selectionBottom: resolved.selectionBottom,
      segments: resolved.segments.map((s) => ({
        top: s.top,
        bottom: s.bottom,
        mergeOf: s.mergeOf,
        adjusted: s.adjusted,
        adjustNote: s.adjustNote,
      })),
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-2xl p-5 w-[420px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="interval-block-edit-title"
      >
        <h3 id="interval-block-edit-title" className="text-lg font-bold text-slate-800">
          修改{KIND_LABEL[target.kind]}区间
        </h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-slate-600">
            名称
            <input
              list={datalistId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm select-text"
              autoFocus
            />
            <datalist id={datalistId}>
              {names.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          <label className="block text-sm text-slate-600">
            顶深 (m)
            <input
              type="number"
              step="any"
              value={topStr}
              onChange={(e) => setTopStr(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm select-text"
            />
          </label>
          <label className="block text-sm text-slate-600">
            底深 (m)
            <input
              type="number"
              step="any"
              value={bottomStr}
              onChange={(e) => setBottomStr(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm select-text"
            />
          </label>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          修改和删除均仅加入 JSON 增量操作，不会上传完整 XLSX。范围内不同名块将保留，仅填充空白段。
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
          >
            删除
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntervalBlockEditDialog;
