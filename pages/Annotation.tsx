import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import {
  Download,
  FileText,
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  ArrowLeft,
  Edit3,
  Eye,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';
import { apiFetch } from '../services/http';
import {
  lockAnnotation,
  finishAnnotation,
  exitAnnotation,
  fetchMicroPhaseRules,
  importMicroPhaseRules,
  type MicroPhaseRuleGroup,
} from '../services/annotation';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { useAnnotationLock } from '../hooks/useAnnotationLock';
import { DatasetFile, STATUS_LABEL, STATUS_STYLE } from '../types';
import WellLogViewer from '../welllog/components/WellLogViewer';
import WellLogEditor, { type WellLogEditorHandle } from '../welllog/components/WellLogEditor';

interface Msg {
  type: 'success' | 'error';
  text: string;
}

interface ProjectGroup {
  project: string;
  items: DatasetFile[];
}

type ExitDialogMode = null | 'unsaved';

const Annotation: React.FC = () => {
  const [files, setFiles] = useState<DatasetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetFile | null>(null);
  const [editing, setEditing] = useState<DatasetFile | null>(null);
  const [exiting, setExiting] = useState(false);
  const [previewing, setPreviewing] = useState<DatasetFile | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [exitDialog, setExitDialog] = useState<ExitDialogMode>(null);
  // 折叠组：默认全部折叠；key = 项目名，true=折叠
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  // 全局亚相→微相规则组（列序）；传给编辑器作深度定向微相推荐
  const [microPhaseRuleGroups, setMicroPhaseRuleGroups] = useState<MicroPhaseRuleGroup[]>([]);
  const [ruleSubPhaseCount, setRuleSubPhaseCount] = useState(0);
  const [ruleMicroPhaseCount, setRuleMicroPhaseCount] = useState(0);
  const [importingRules, setImportingRules] = useState(false);
  const rulesFileInputRef = useRef<HTMLInputElement>(null);

  const editorRef = useRef<WellLogEditorHandle>(null);
  const exitingRef = useRef(false);
  const finishingRef = useRef(false);
  exitingRef.current = exiting;
  finishingRef.current = finishing;

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/datasets?key=danjing');
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyRuleGroups = useCallback((groups: MicroPhaseRuleGroup[] | undefined, subCount?: number, microCount?: number) => {
    const list = Array.isArray(groups) ? groups : [];
    setMicroPhaseRuleGroups(list);
    const sub =
      typeof subCount === 'number' && Number.isFinite(subCount)
        ? subCount
        : list.length;
    let micro =
      typeof microCount === 'number' && Number.isFinite(microCount)
        ? microCount
        : 0;
    if (typeof microCount !== 'number' || !Number.isFinite(microCount)) {
      for (const g of list) micro += g.microPhases?.length ?? 0;
    }
    setRuleSubPhaseCount(sub);
    setRuleMicroPhaseCount(micro);
  }, []);

  const loadMicroPhaseRules = useCallback(async () => {
    const res = await fetchMicroPhaseRules();
    if (res.ok && Array.isArray(res.groups)) {
      applyRuleGroups(res.groups, res.subPhaseCount, res.microPhaseCount);
    }
  }, [applyRuleGroups]);

  useEffect(() => {
    fetchFiles();
    void loadMicroPhaseRules();
  }, [fetchFiles, loadMicroPhaseRules]);

  const flash = (m: Msg) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3500);
  };

  // 按 project 分组；无项目名时归入「未分组」
  const projectGroups = useMemo((): ProjectGroup[] => {
    const map = new Map<string, DatasetFile[]>();
    for (const f of files) {
      const p = (f.project ?? '').trim() || '未分组';
      const arr = map.get(p);
      if (arr) arr.push(f);
      else map.set(p, [f]);
    }
    return Array.from(map.entries()).map(([project, items]) => ({ project, items }));
  }, [files]);

  const toggleProject = (project: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [project]: !(prev[project] ?? true),
    }));
  };

  // 活动检测 + 锁心跳（editing 为 null 时不启用）
  // 心跳成功后：有 pending 则触发一轮自动保存（失败最多再试 2 次，由 editor.autosaveRound 负责）
  const { isActive, isActiveRef, resetActive } = useActivityTracker(!!editing);
  const lock = useAnnotationLock(editing?.id ?? null, isActiveRef, resetActive, {
    hasUnsaved: () => editorRef.current?.hasUnsavedChanges() ?? false,
    requestAutosave: () =>
      editorRef.current?.autosaveRound() ?? Promise.resolve(true),
    isAutosaveBlocked: () => exitingRef.current || finishingRef.current,
  });

  // 进入编辑：加锁
  const handleEdit = async (d: DatasetFile) => {
    if (d.id == null) return;
    const res = await lockAnnotation(d.id);
    if (!res.ok) {
      flash({ type: 'error', text: res.error || '无法进入编辑' });
      return;
    }
    setPendingCount(0);
    setSaving(false);
    setExitDialog(null);
    setEditing(d);
  };

  /** 释放锁并关闭编辑页（不经 editor 保存）。 */
  const closeEditing = async (opts?: { discard?: boolean }) => {
    if (editing?.id == null) return;
    setExiting(true);
    const res = await exitAnnotation(editing.id);
    setExiting(false);
    if (!res.ok) {
      flash({
        type: 'error',
        text:
          (opts?.discard ? '放弃修改后退出失败：' : '退出失败：') +
          (res.error || '未知错误') +
          '，页面仍将关闭',
      });
    }
    setExitDialog(null);
    setEditing(null);
    setPendingCount(0);
    fetchFiles();
  };

  // 退出：有待保存时弹出 保存并退出 / 放弃修改 / 取消
  const handleExitClick = () => {
    if (editing?.id == null || exiting || saving || finishing) return;
    if (lock.readOnly) {
      // 只读时无法再保存增量，直接退出释放（锁可能已失效）
      void closeEditing();
      return;
    }
    const unsaved = editorRef.current?.hasUnsavedChanges() ?? pendingCount > 0;
    if (unsaved) {
      setExitDialog('unsaved');
      return;
    }
    void closeEditing();
  };

  const handleExitSaveAndLeave = async () => {
    if (editing?.id == null) return;
    setExiting(true);
    const ok = (await editorRef.current?.save()) ?? false;
    if (!ok) {
      setExiting(false);
      flash({ type: 'error', text: '保存失败，未退出；待保存项已保留' });
      return;
    }
    await closeEditing();
  };

  const handleExitDiscard = async () => {
    await closeEditing({ discard: true });
  };

  // 底部保存：仅提交区间 JSON 增量
  const handleSave = async () => {
    if (editing?.id == null || lock.readOnly || saving || finishing) return;
    const ok = (await editorRef.current?.save()) ?? false;
    if (!ok) {
      flash({ type: 'error', text: '保存失败，待保存项已保留' });
      return;
    }
    flash({ type: 'success', text: '区间增量已保存' });
  };

  // 完成：先 save 再 finish（status→3）
  const handleFinish = async () => {
    if (editing?.id == null || lock.readOnly || saving || finishing || exiting) return;
    setFinishing(true);
    try {
      const unsaved = editorRef.current?.hasUnsavedChanges() ?? pendingCount > 0;
      if (unsaved) {
        const ok = (await editorRef.current?.save()) ?? false;
        if (!ok) {
          flash({ type: 'error', text: '保存失败，未完成；请重试' });
          return;
        }
      }
      const res = await finishAnnotation(editing.id);
      if (!res.ok) {
        flash({ type: 'error', text: res.error || '完成失败' });
        return;
      }
      setEditing(null);
      setPendingCount(0);
      flash({ type: 'success', text: '已完成' });
      fetchFiles();
    } finally {
      setFinishing(false);
    }
  };

  // 导出
  const handleExportRow = async (d: DatasetFile) => {
    if (d.id == null) return;
    try {
      const res = await apiFetch(`/api/datasets/danjing/file?id=${d.id}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${d.name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      flash({ type: 'error', text: '导出失败' });
    }
  };

  // 删除
  const handleDelete = async () => {
    const d = deleteTarget;
    if (!d || d.id == null) return;
    try {
      const res = await apiFetch(`/api/datasets/danjing?id=${d.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setDeleteTarget(null);
      fetchFiles();
      flash({ type: 'success', text: `已删除「${d.name}」` });
    } catch {
      flash({ type: 'error', text: '删除失败' });
      setDeleteTarget(null);
    }
  };

  // 单井标注规则导入：列式 .xlsx（首行亚相，第二行起为该列微相）→ 服务端原子替换 → 刷新规则组
  const handleRulesFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      flash({ type: 'error', text: '仅支持 .xlsx 文件' });
      return;
    }
    setImportingRules(true);
    try {
      const res = await importMicroPhaseRules(file);
      if (!res.ok) {
        flash({ type: 'error', text: res.error || '规则导入失败' });
        return;
      }
      const groups = Array.isArray(res.groups) ? res.groups : [];
      applyRuleGroups(groups, res.subPhaseCount, res.microPhaseCount);
      const subN =
        typeof res.subPhaseCount === 'number' ? res.subPhaseCount : groups.length;
      let microN =
        typeof res.microPhaseCount === 'number' ? res.microPhaseCount : 0;
      if (typeof res.microPhaseCount !== 'number') {
        for (const g of groups) microN += g.microPhases?.length ?? 0;
      }
      flash({
        type: 'success',
        text: `已导入 ${subN} 个亚相、${microN} 条微相规则`,
      });
    } finally {
      setImportingRules(false);
    }
  };

  // ---------- 编辑抽屉 ----------
  if (editing) {
    const busy = exiting || saving || finishing;
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
        <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={handleExitClick}
              disabled={busy}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              <ArrowLeft size={16} /> 退出编辑
            </button>
            <div className="h-6 w-px bg-slate-200" />
            <h2 className="font-medium text-slate-800">编辑：{editing.name}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[2]}`}>
              {STATUS_LABEL[2]}
            </span>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                待保存 {pendingCount}
              </span>
            )}
          </div>
          {lock.message && (
            <div
              className={`text-xs px-3 py-1 rounded ${
                lock.readOnly ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {lock.message}
            </div>
          )}
        </div>

        {/* 锁失效仍显示只读 editor，不换成占位文案 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {editing.id != null ? (
            <WellLogEditor
              ref={editorRef}
              key={editing.id}
              fileId={editing.id}
              name={editing.name}
              readOnly={lock.readOnly}
              microPhaseRuleGroups={microPhaseRuleGroups}
              onPendingChange={setPendingCount}
              onSaveStateChange={setSaving}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              该记录无关联文件，无法编辑
            </div>
          )}
        </div>

        <div className="h-16 bg-white border-t border-slate-200 px-6 flex items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-slate-400">
            活动：{isActive ? '活跃' : '空闲'} · 锁：{lock.locked ? '持有中' : '—'}
            {lock.readOnly ? ' · 只读' : ''}
            {' · 自动保存：每 5 分钟（失败最多重试 2 次）'}
            {saving ? ' · 保存中…' : ''}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={lock.readOnly || busy || pendingCount === 0}
              className="px-5 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              保存
            </button>
            <button
              onClick={handleFinish}
              disabled={lock.readOnly || busy}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {finishing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              完成
            </button>
          </div>
        </div>

        {/* 退出确认：保存并退出 / 放弃修改 / 取消 */}
        {exitDialog === 'unsaved' && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
            onClick={() => !exiting && setExitDialog(null)}
          >
            <div
              className="bg-white rounded-xl shadow-2xl p-6 w-[440px] max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
                  <AlertCircle size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">有未保存的区间修改</h3>
                  <p className="text-sm text-slate-500 mt-1.5">
                    当前有 {pendingCount || '若干'} 条待保存区间增量。请选择：
                  </p>
                </div>
              </div>
              <div className="mt-6 flex flex-col sm:flex-row justify-end gap-2">
                <button
                  type="button"
                  disabled={exiting}
                  onClick={() => setExitDialog(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={exiting}
                  onClick={handleExitDiscard}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                >
                  放弃修改
                </button>
                <button
                  type="button"
                  disabled={exiting}
                  onClick={handleExitSaveAndLeave}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {exiting ? <Loader2 size={14} className="animate-spin" /> : null}
                  保存并退出
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- 预览抽屉（只读：无锁、无计时器、无活动检测、不调后端）----------
  if (previewing) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
        <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPreviewing(null)}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={16} /> 退出预览
            </button>
            <div className="h-6 w-px bg-slate-200" />
            <h2 className="font-medium text-slate-800">预览：{previewing.name}</h2>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[previewing.status] ?? STATUS_STYLE[0]}`}
            >
              {previewing.statusLabel ?? STATUS_LABEL[previewing.status] ?? '原始'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">
              只读
            </span>
          </div>
        </div>

        {previewing.id != null ? (
          <WellLogViewer fileId={previewing.id} name={previewing.name} key={previewing.id} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            该记录无关联文件，无法预览
          </div>
        )}
      </div>
    );
  }

  // ---------- 列表 ----------
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">数据标注</h1>
          <p className="text-slate-500 mt-1">
            对单井数据进行编辑标注，支持四级状态流转与并发编辑锁。
          </p>
        </div>
        <button
          onClick={fetchFiles}
          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2 min-w-0">
              <Activity size={18} className="text-blue-600 shrink-0" /> 单井数据 · 标注列表
              {projectGroups.length > 0 && (
                <span className="text-sm font-normal text-slate-500">
                  · {projectGroups.length} 个项目
                </span>
              )}
            </h3>
            <div className="ml-auto shrink-0">
            <button
              type="button"
              disabled={importingRules}
              onClick={() => rulesFileInputRef.current?.click()}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50"
              title="上传 .xlsx：首个工作表每列第 1 行=亚相，第 2 行起=该亚相微相"
            >
              {importingRules ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FileText size={14} />
              )}
              单井标注规则导入
            </button>
            <input
              ref={rulesFileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleRulesFileChange}
            />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            共 {files.length} 个数据集
            {ruleSubPhaseCount > 0 || ruleMicroPhaseCount > 0
              ? ` · 已加载 ${ruleSubPhaseCount} 个亚相、${ruleMicroPhaseCount} 条微相规则`
              : ''}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            规则表：首个工作表按列导入；每列第 1 行亚相名，第 2 行起为该亚相微相。编辑微相时按区间中心深度所在亚相推荐。
          </p>
        </div>

        {msg && (
          <div
            className={`px-4 py-2.5 text-sm flex items-center gap-2 border-b ${
              msg.type === 'success'
                ? 'bg-green-50 text-green-700 border-green-100'
                : 'bg-red-50 text-red-700 border-red-100'
            }`}
          >
            {msg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> 加载列表…
          </div>
        ) : files.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {projectGroups.map((g) => {
              const collapsed = collapsedProjects[g.project] ?? true;
              return (
                <div key={g.project}>
                  <button
                    type="button"
                    onClick={() => toggleProject(g.project)}
                    className="w-full flex items-center gap-2 px-5 py-3 bg-slate-50 hover:bg-slate-100/80 text-left transition-colors"
                  >
                    {collapsed ? (
                      <ChevronRight size={16} className="text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="text-slate-400 shrink-0" />
                    )}
                    <FolderOpen size={16} className="text-blue-500 shrink-0" />
                    <span className="font-semibold text-slate-800">{g.project}</span>
                    <span className="text-xs text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                      {g.items.length} 条
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="overflow-x-auto">
                      {/* 固定列宽：各项目独立 table 时列坐标仍对齐 */}
                      <table className="table-fixed w-full min-w-[1100px] text-left text-sm">
                        <colgroup>
                          <col style={{ width: '26%' }} />
                          <col style={{ width: '8%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '12%' }} />
                          <col style={{ width: '30%' }} />
                        </colgroup>
                        <thead className="bg-slate-50 text-slate-500 font-medium">
                          <tr>
                            <th className="px-6 py-3">数据集名称</th>
                            <th className="px-6 py-3">格式</th>
                            <th className="px-6 py-3">大小</th>
                            <th className="px-6 py-3">创建日期</th>
                            <th className="px-6 py-3">状态</th>
                            <th className="px-6 py-3">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {g.items.map((d) => (
                            <tr
                              key={d.id ?? d.filename}
                              className="hover:bg-slate-50 transition-colors"
                            >
                              <td className="px-6 py-4 font-medium text-slate-900">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText size={16} className="text-slate-400 shrink-0" />
                                  <span className="truncate" title={d.name}>{d.name}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600 uppercase">
                                  {d.ext || '—'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{d.sizeText}</td>
                              <td className="px-6 py-4 text-slate-500 whitespace-nowrap">{d.date}</td>
                              <td className="px-6 py-4">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                                    STATUS_STYLE[d.status] ?? STATUS_STYLE[0]
                                  }`}
                                >
                                  {d.statusLabel ?? STATUS_LABEL[d.status] ?? '原始'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-4 flex-nowrap">
                                  <button
                                    onClick={() => setPreviewing(d)}
                                    className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1 shrink-0"
                                    title="只读预览（不加锁）"
                                  >
                                    <Eye size={14} /> 预览
                                  </button>
                                  <button
                                    onClick={() => handleEdit(d)}
                                    className="text-blue-600 hover:text-blue-900 font-medium flex items-center gap-1 shrink-0"
                                    title="进入编辑（加锁）"
                                  >
                                    <Edit3 size={14} /> 数据编辑
                                  </button>
                                  <button
                                    onClick={() => handleExportRow(d)}
                                    className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1 shrink-0"
                                  >
                                    <Download size={14} /> 导出
                                  </button>
                                  <button
                                    onClick={() => setDeleteTarget(d)}
                                    className="text-red-600 hover:text-red-700 font-medium flex items-center gap-1 shrink-0"
                                  >
                                    <Trash2 size={14} /> 删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <FileText size={40} className="mx-auto mb-3 text-slate-300" />
            <p>暂无可标注的单井数据</p>
            <p className="text-xs mt-1">请先在「数据与样本管理」导入单井数据</p>
          </div>
        )}
      </div>

      {/* 删除确认 */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 w-[440px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-50 rounded-lg text-red-600">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">确认删除？</h3>
                <p className="text-sm text-slate-500 mt-1.5">
                  将删除「{deleteTarget.name}」的记录与文件，
                  <span className="text-red-600">不可恢复</span>。
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center gap-1.5"
              >
                <Trash2 size={14} /> 确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Annotation;
