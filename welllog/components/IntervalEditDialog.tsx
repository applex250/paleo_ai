// 两步区间编辑弹窗：① 选沉积微相/岩性 ② 编辑顶深/底深/名称。
// 岩性与微相同规则：不同名占用块从选择中扣除，空白段各自创建；同名融合；完全占满拒绝。
// 微相名称候选：名称为空按中心深度唯一亚相推荐；输入任意字符后全局搜索全部导入微相；岩性仍为井内已有名。
import React, { useEffect, useMemo, useState } from 'react';
import type { IntervalItem } from '../types';
import type { IntervalKind } from '../intervalEdits';
import {
  collectExistingNames,
  normalizeDepthRange,
  resolveCreateIntervals,
} from '../intervalEdits';
import {
  recommendMicroPhasesFromInput,
  type MicroPhaseRuleGroup,
} from '../microPhaseRecommendations';

/** 单段解析结果（可能一次确认产生多段）。 */
export interface IntervalEditSegment {
  top: number;
  bottom: number;
  /** 将被融合吸收的同名区间（Editor 用于本地移除 + 发 delete）。 */
  mergeOf: IntervalItem[];
  adjusted: boolean;
  adjustNote?: string;
}

export interface IntervalEditResult {
  kind: IntervalKind;
  name: string;
  /** 用户输入/选择的原始深度范围（归一化），供 Editor 竞态重校验。 */
  selectionTop: number;
  selectionBottom: number;
  segments: IntervalEditSegment[];
}

interface Props {
  open: boolean;
  initialTop: number;
  initialBottom: number;
  wellTop: number;
  wellBottom: number;
  /** 按 kind 取现有区间（用于重叠校验与名称建议） */
  getExisting: (kind: IntervalKind) => IntervalItem[];
  /** 亚相→微相规则组；仅 microPhase 时供空名亚相推荐 / 非空名全局搜索 */
  microPhaseRuleGroups?: MicroPhaseRuleGroup[];
  /** 本井亚相区间；名称空时与规则组一起决定微相 datalist */
  subPhaseIntervals?: IntervalItem[];
  onConfirm: (result: IntervalEditResult) => void;
  onCancel: () => void;
}

const KIND_LABEL: Record<IntervalKind, string> = {
  lithology: '岩性',
  microPhase: '沉积微相',
};

const IntervalEditDialog: React.FC<Props> = ({
  open,
  initialTop,
  initialBottom,
  wellTop,
  wellBottom,
  getExisting,
  microPhaseRuleGroups,
  subPhaseIntervals,
  onConfirm,
  onCancel,
}) => {
  const [step, setStep] = useState<'kind' | 'detail'>('kind');
  const [kind, setKind] = useState<IntervalKind | null>(null);
  const [topStr, setTopStr] = useState(String(initialTop));
  const [botStr, setBotStr] = useState(String(initialBottom));
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const [t, b] = normalizeDepthRange(initialTop, initialBottom);
    setStep('kind');
    setKind(null);
    setTopStr(String(Number(t.toFixed(3))));
    setBotStr(String(Number(b.toFixed(3))));
    setName('');
    setError('');
  }, [open, initialTop, initialBottom]);

  const existing = useMemo(() => (kind ? getExisting(kind) : []), [kind, getExisting]);

  // 岩性：仅当前井已有名称；沉积微相：空名→唯一亚相组，非空→全部导入微相包含过滤（仍可手输）
  const nameSuggestions = useMemo(() => {
    if (kind === 'lithology') {
      return collectExistingNames(existing);
    }
    if (kind === 'microPhase') {
      return recommendMicroPhasesFromInput(
        topStr,
        botStr,
        subPhaseIntervals ?? [],
        microPhaseRuleGroups ?? [],
        name,
      );
    }
    return [];
  }, [kind, existing, topStr, botStr, name, subPhaseIntervals, microPhaseRuleGroups]);

  if (!open) return null;

  const pickKind = (k: IntervalKind) => {
    setKind(k);
    setStep('detail');
    setError('');
  };

  const submitDetail = () => {
    if (!kind) return;
    let top = Number(topStr);
    let bottom = Number(botStr);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      setError('顶深/底深必须是有效数字。');
      return;
    }
    [top, bottom] = normalizeDepthRange(top, bottom);
    const v = resolveCreateIntervals(top, bottom, name, {
      wellTop,
      wellBottom,
      existing,
    });
    if (!v.ok) {
      setError(v.error);
      return;
    }
    // 单段且发生单侧贴齐时，同步显示最终深度
    if (v.segments.length === 1 && v.segments[0].adjusted) {
      setTopStr(String(Number(v.segments[0].top.toFixed(3))));
      setBotStr(String(Number(v.segments[0].bottom.toFixed(3))));
    }
    onConfirm({
      kind,
      name: name.trim(),
      selectionTop: v.selectionTop,
      selectionBottom: v.selectionBottom,
      segments: v.segments.map((s) => ({
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
      >
        {step === 'kind' ? (
          <>
            <h3 className="text-lg font-bold text-slate-800">选择区间类型</h3>
            <p className="text-sm text-slate-500 mt-2">
              已选择深度区间：{Number(initialTop).toFixed(2)} – {Number(initialBottom).toFixed(2)} m
              <br />
              请选择写入目标列：
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => pickKind('microPhase')}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                沉积微相
              </button>
              <button
                type="button"
                onClick={() => pickKind('lithology')}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                岩性
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50"
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-800">
              编辑{kind ? KIND_LABEL[kind] : ''}区间
            </h3>
            <div className="mt-4 space-y-3">
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
                  value={botStr}
                  onChange={(e) => setBotStr(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm select-text"
                />
              </label>
              <label className="block text-sm text-slate-600">
                名称
                <input
                  list="interval-name-suggestions"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    kind === 'microPhase'
                      ? '空=按亚相推荐；输入则搜索全部微相'
                      : `输入或选择${kind ? KIND_LABEL[kind] : ''}名称`
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm select-text"
                  autoFocus
                />
                <datalist id="interval-name-suggestions">
                  {nameSuggestions.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
            </div>
            {error && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              若范围内有不同名区间，将仅为空白段创建新块并保留占用块。
              {kind === 'microPhase'
                ? ' 微相：名称为空时按区间中心唯一亚相推荐；输入任意字符后搜索全部导入微相（可手输）。'
                : ''}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('kind');
                  setError('');
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={submitDetail}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                确认
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default IntervalEditDialog;
