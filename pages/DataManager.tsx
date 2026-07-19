
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  UploadCloud, Download, FileText, Activity, Waves, LayoutGrid,
  CheckCircle2, AlertCircle, Loader2, Trash2, RefreshCw,
  ChevronDown, ChevronRight, FolderOpen,
} from 'lucide-react';
import { DataType, DatasetFile, STATUS_STYLE } from '../types';
import { apiFetch } from '../services/http';

// 三类数据（互斥）→ 后端文件夹 key
const DATA_TYPES: DataType[] = ['单井数据', '地震数据', '切片数据'];
const TYPE_KEY: Record<DataType, string> = {
  '单井数据': 'danjing',
  '地震数据': 'dizhen',
  '切片数据': 'qiepian',
};
const TYPE_ICON: Record<DataType, React.FC<any>> = {
  '单井数据': Activity,
  '地震数据': Waves,
  '切片数据': LayoutGrid,
};
// 单井数据后端会统一转成 .xlsx 存储
const TO_XLSX: Record<DataType, boolean> = {
  '单井数据': true,
  '地震数据': false,
  '切片数据': false,
};

interface Msg {
  type: 'success' | 'error';
  text: string;
}

interface ProjectGroup {
  project: string;
  items: DatasetFile[];
}

// （导出改为直接下载真实文件，见 handleExportRow；不再生成 XML）

const DataManager: React.FC = () => {
  const [activeType, setActiveType] = useState<DataType>('单井数据');
  const [files, setFiles] = useState<DatasetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetFile | null>(null);

  // 单井导入：项目选择弹窗 + 本次上传共用的 project
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const [pendingProject, setPendingProject] = useState<string | null>(null);
  // 折叠组：默认全部折叠；key = 项目名，true=折叠
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  // 拉取当前类型的真实文件列表
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/datasets?key=${TYPE_KEY[activeType]}`);
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [activeType]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const flash = (m: Msg) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3500);
  };

  // 当前列表中已有的项目名（去重、按出现顺序）
  const existingProjects = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const f of files) {
      const p = (f.project ?? '').trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      list.push(p);
    }
    return list;
  }, [files]);

  // 单井：按 project 分组
  const projectGroups = useMemo((): ProjectGroup[] => {
    if (activeType !== '单井数据') return [];
    const map = new Map<string, DatasetFile[]>();
    for (const f of files) {
      const p = (f.project ?? '').trim() || '未分组';
      const arr = map.get(p);
      if (arr) arr.push(f);
      else map.set(p, [f]);
    }
    return Array.from(map.entries()).map(([project, items]) => ({ project, items }));
  }, [activeType, files]);

  // ---------- 导入：单井先选项目，再选文件；其他类型直接选文件 ----------
  const handleImportClick = () => {
    if (activeType === '单井数据') {
      setProjectDraft(existingProjects[0] ?? '');
      setProjectModalOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const confirmProjectAndPickFiles = () => {
    const project = projectDraft.trim();
    if (!project) {
      flash({ type: 'error', text: '请选择或输入项目名称后再继续。' });
      return;
    }
    setPendingProject(project);
    setProjectModalOpen(false);
    // 下一帧再打开文件选择器，避免弹窗关闭动画抢焦点
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) {
      setPendingProject(null);
      return;
    }
    const key = TYPE_KEY[activeType];
    const isDanjing = activeType === '单井数据';
    const project = isDanjing ? (pendingProject ?? '').trim() : '';
    if (isDanjing && !project) {
      e.target.value = '';
      setPendingProject(null);
      flash({ type: 'error', text: '缺少项目名称，请重新点击「数据导入」并选择项目。' });
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(list)) {
      try {
        const qs = new URLSearchParams({ filename: file.name });
        if (isDanjing) qs.set('project', project);
        const res = await apiFetch(`/api/datasets/${key}?${qs.toString()}`, {
          method: 'POST',
          body: file, // 直接把文件字节作为请求体
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    e.target.value = '';
    setPendingProject(null);
    await fetchFiles();
    const conv = TO_XLSX[activeType] ? '（统一存储为 .xlsx；.xlsx 原样入库、.xml 自动转换）' : '';
    const projHint = isDanjing && project ? `（项目：${project}）` : '';
    if (ok > 0) {
      flash({
        type: 'success',
        text: `已导入 ${ok} 个文件到「${activeType}」${projHint}${conv}${fail ? `，${fail} 个失败` : ''}`,
      });
    } else {
      flash({ type: 'error', text: '导入失败，请确认文件为 .xml 或 .xlsx 后重试。' });
    }
  };

  // ---------- 单行导出：下载该数据集对应的真实文件 ----------
  const handleExportRow = async (d: DatasetFile) => {
    const key = TYPE_KEY[activeType];
    const url =
      d.id != null
        ? `/api/datasets/${key}/file?id=${d.id}` // 单井：按 id 查库找 stored_file（<id>.xlsx）
        : `/api/datasets/${key}/file?name=${encodeURIComponent(d.filename)}`; // 地震/切片：按文件名
    try {
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('not ok');
      const blob = await res.blob();
      const ext = d.ext || (d.filename.includes('.') ? (d.filename.split('.').pop() as string) : '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ext ? `${d.name}.${ext}` : d.name; // 用友好名命名下载文件
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      flash({ type: 'success', text: `已导出原始文件「${d.name}.${ext}」` });
    } catch {
      flash({ type: 'error', text: '导出失败：文件不存在或读取出错。' });
    }
  };

  // ---------- 单行删除：确认后删除数据库记录 + 对应文件 ----------
  const handleDelete = async () => {
    const d = deleteTarget;
    if (!d) return;
    const key = TYPE_KEY[activeType];
    const url =
      d.id != null
        ? `/api/datasets/${key}?id=${d.id}` // 单井：按 id 删库记录 + 文件
        : `/api/datasets/${key}?name=${encodeURIComponent(d.filename)}`; // 地震/切片：按文件名删
    try {
      const res = await apiFetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('not ok');
      setDeleteTarget(null);
      await fetchFiles();
      flash({ type: 'success', text: `已删除「${d.name}.${d.ext}」` });
    } catch {
      flash({ type: 'error', text: '删除失败，请重试。' });
      setDeleteTarget(null);
    }
  };

  const toggleProject = (project: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [project]: !(prev[project] ?? true),
    }));
  };

  // 单井项目组表列宽（与 Annotation 单井组表一致，避免各组独立 table 列错位）
  const singleWellColgroup = (
    <colgroup>
      <col style={{ width: '26%' }} />
      <col style={{ width: '8%' }} />
      <col style={{ width: '10%' }} />
      <col style={{ width: '14%' }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '30%' }} />
    </colgroup>
  );

  // 单井项目组行：固定列宽下长名称截断、操作按钮不换行（与 Annotation 一致）
  const renderSingleWellFileRow = (d: DatasetFile) => (
    <tr key={d.id ?? d.filename} className="hover:bg-slate-50 transition-colors">
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
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLE[d.status] ?? STATUS_STYLE[0]}`}>
          {d.statusLabel ?? d.status}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-4 flex-nowrap">
          <button
            onClick={() => handleExportRow(d)}
            className="text-blue-600 hover:text-blue-900 font-medium flex items-center gap-1 shrink-0"
            title="导出该数据集文件"
          >
            <Download size={14} />
            数据导出
          </button>
          <button
            onClick={() => setDeleteTarget(d)}
            className="text-red-600 hover:text-red-700 font-medium flex items-center gap-1 shrink-0"
            title="删除该数据集"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      </td>
    </tr>
  );

  // 地震 / 切片列表：保持布局修复前的行结构与类名
  const renderFileRow = (d: DatasetFile) => (
    <tr key={d.id ?? d.filename} className="hover:bg-slate-50 transition-colors">
      <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2">
        <FileText size={16} className="text-slate-400" />
        {d.name}
      </td>
      <td className="px-6 py-4">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600 uppercase">
          {d.ext || '—'}
        </span>
      </td>
      <td className="px-6 py-4 text-slate-500">{d.sizeText}</td>
      <td className="px-6 py-4 text-slate-500">{d.date}</td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[d.status] ?? STATUS_STYLE[0]}`}>
          {d.statusLabel ?? d.status}
        </span>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => handleExportRow(d)}
            className="text-blue-600 hover:text-blue-900 font-medium flex items-center gap-1"
            title="导出该数据集文件"
          >
            <Download size={14} />
            数据导出
          </button>
          <button
            onClick={() => setDeleteTarget(d)}
            className="text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
            title="删除该数据集"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      </td>
    </tr>
  );

  const tableHeader = (
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
  );

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">数据与样本管理</h1>
          <p className="text-slate-500 mt-1">
            按数据类型管理已有数据集，数据来源于后端真实文件夹 data01/。
          </p>
        </div>
        <button
          onClick={fetchFiles}
          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {/* 互斥类型选择 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 gap-1">
          {DATA_TYPES.map((t) => {
            const Icon = TYPE_ICON[t];
            const active = activeType === t;
            return (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                  active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={16} />
                {t}
              </button>
            );
          })}
        </div>
        {TO_XLSX[activeType] && (
          <span className="text-xs text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full">
            本类数据后端统一存储为 .xlsx | 导出为 .xlsx
          </span>
        )}
      </div>

      {/* 数据集卡片：工具栏 + 表格 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {/* 工具栏 */}
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
          <div>
            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              {activeType} · 已有数据集
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              后端目录 data01/{TYPE_KEY[activeType]}/ · 共 {files.length} 个文件
              {activeType === '单井数据' && projectGroups.length > 0
                ? ` · ${projectGroups.length} 个项目`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.xlsx"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={handleImportClick}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-colors"
              title="支持 .xml 和 .xlsx 文件"
            >
              <UploadCloud size={16} />
              数据导入
            </button>
          </div>
        </div>

        {/* 提示消息 */}
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

        {/* 表格 / 项目分组 */}
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> 加载真实文件列表…
          </div>
        ) : files.length > 0 ? (
          activeType === '单井数据' ? (
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
                        {/* 固定列宽：各项目独立 table 时列坐标仍对齐（与 Annotation 一致） */}
                        <table className="table-fixed w-full min-w-[1100px] text-left text-sm">
                          {singleWellColgroup}
                          {tableHeader}
                          <tbody className="divide-y divide-slate-100">
                            {g.items.map(renderSingleWellFileRow)}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                {tableHeader}
                <tbody className="divide-y divide-slate-100">
                  {files.map(renderFileRow)}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="p-12 text-center text-slate-400">
            <FileText size={40} className="mx-auto mb-3 text-slate-300" />
            <p>data01/{TYPE_KEY[activeType]}/ 文件夹暂无数据集</p>
            <p className="text-xs mt-1">点击右上角「数据导入」上传本地 .xml / .xlsx 文件</p>
          </div>
        )}
      </div>

      {/* 单井：项目选择 / 新建弹窗 */}
      {projectModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setProjectModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 w-[460px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <FolderOpen size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-800">选择或新建项目</h3>
                <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                  本次导入的多个单井文件将归属同一项目。可从已有项目中选择，或输入新项目名称。
                </p>
              </div>
            </div>

            {existingProjects.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-500 mb-2">已有项目</p>
                <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                  {existingProjects.map((p) => {
                    const selected = projectDraft.trim() === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setProjectDraft(p)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          selected
                            ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500 block mb-1.5">
                项目名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={projectDraft}
                onChange={(e) => setProjectDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmProjectAndPickFiles();
                  }
                }}
                placeholder="输入新项目名，或点选上方已有项目"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setProjectModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmProjectAndPickFiles}
                disabled={!projectDraft.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <UploadCloud size={14} />
                确认并选择文件
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
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
                <h3 className="text-lg font-bold text-slate-800">确认删除该数据集？</h3>
                <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                  将删除「<span className="font-medium text-slate-700">
                    {deleteTarget.name}.{deleteTarget.ext}
                  </span>」对应的数据库记录与 xlsx 文件，<span className="text-red-600 font-medium">该操作不可恢复</span>。
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
                <Trash2 size={14} />
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataManager;
