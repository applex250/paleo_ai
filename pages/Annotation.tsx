import React, { useCallback, useEffect, useState } from 'react';
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
  RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../services/http';
import { lockAnnotation, saveAnnotation, finishAnnotation, exitAnnotation } from '../services/annotation';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { useAnnotationLock } from '../hooks/useAnnotationLock';
import { DatasetFile, STATUS_LABEL, STATUS_STYLE } from '../types';

interface Msg {
  type: 'success' | 'error';
  text: string;
}

const Annotation: React.FC = () => {
  const [files, setFiles] = useState<DatasetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetFile | null>(null);
  const [editing, setEditing] = useState<DatasetFile | null>(null);
  const [exiting, setExiting] = useState(false);

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

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const flash = (m: Msg) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3500);
  };

  // 活动检测 + 锁心跳（editing 为 null 时不启用）
  const { isActive, isActiveRef, resetActive } = useActivityTracker(!!editing);
  const lock = useAnnotationLock(editing?.id ?? null, isActiveRef, resetActive);

  // 进入编辑：加锁
  const handleEdit = async (d: DatasetFile) => {
    if (d.id == null) return;
    const res = await lockAnnotation(d.id);
    if (!res.ok) {
      flash({ type: 'error', text: res.error || '无法进入编辑' });
      return;
    }
    setEditing(d);
  };

  // 退出编辑：保存 + 释放锁(status:2→1) + 关闭页面 + 刷新列表
  // setEditing(null) 会触发 hooks 清理（停 5min 计时器、移除 keydown/scroll/mousemove 监听）
  const handleExit = async () => {
    if (editing?.id == null) return;
    setExiting(true);
    const res = await exitAnnotation(editing.id); // 占位期无 content
    setExiting(false);
    if (!res.ok) {
      flash({ type: 'error', text: '退出时保存失败：' + (res.error || '未知错误') + '，页面仍将关闭' });
    }
    setEditing(null); // 关闭编辑页面 → hooks 自动清理计时器与事件监听
    fetchFiles(); // 刷新标注列表（显示最新状态）
  };

  // 保存：占位期不传 content（编辑器就绪后再传）
  const handleSave = async () => {
    if (editing?.id == null) return;
    const res = await saveAnnotation(editing.id);
    if (!res.ok) {
      flash({ type: 'error', text: res.error || '保存失败' });
      return;
    }
    flash({ type: 'success', text: '已保存（占位期未写入文件内容）' });
  };

  // 完成：status→3，释放锁
  const handleFinish = async () => {
    if (editing?.id == null) return;
    const res = await finishAnnotation(editing.id);
    if (!res.ok) {
      flash({ type: 'error', text: res.error || '完成失败' });
      return;
    }
    setEditing(null);
    flash({ type: 'success', text: '已完成' });
    fetchFiles();
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

  // ---------- 编辑抽屉 ----------
  if (editing) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
        <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleExit}
              disabled={exiting}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              <ArrowLeft size={16} /> 退出编辑
            </button>
            <div className="h-6 w-px bg-slate-200" />
            <h2 className="font-medium text-slate-800">编辑：{editing.name}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[2]}`}>
              {STATUS_LABEL[2]}
            </span>
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

        <div className="flex-1 overflow-auto p-8">
          {lock.readOnly ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              <AlertCircle size={20} className="mr-2" />
              文档已被他人抢占编辑权限，当前内容只读
            </div>
          ) : (
            <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center text-slate-400">
              {/* TODO: xlsx 解析表格组件（下一期填入） */}
              <FileText size={48} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium text-slate-500">编辑器主体（占位）</p>
              <p className="text-sm mt-1">
                此处后续填入 xlsx 解析表格组件。当前编辑锁与自动续期引擎已生效。
              </p>
              <p className="text-xs mt-3">
                活动检测：{isActive ? '活跃' : '空闲'} · 锁：{lock.locked ? '持有中' : '—'}
              </p>
            </div>
          )}
        </div>

        <div className="h-16 bg-white border-t border-slate-200 px-6 flex items-center justify-end gap-3">
          <button
            onClick={handleSave}
            disabled={lock.readOnly}
            className="px-5 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
          >
            保存
          </button>
          <button
            onClick={handleFinish}
            disabled={lock.readOnly}
            className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <CheckCircle2 size={14} /> 完成
          </button>
        </div>
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
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <Activity size={18} className="text-blue-600" /> 单井数据 · 标注列表
          </h3>
          <p className="text-xs text-slate-500 mt-1">共 {files.length} 个数据集</p>
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
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
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
                {files.map((d) => (
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
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_STYLE[d.status] ?? STATUS_STYLE[0]
                        }`}
                      >
                        {d.statusLabel ?? STATUS_LABEL[d.status] ?? '原始'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handleEdit(d)}
                          className="text-blue-600 hover:text-blue-900 font-medium flex items-center gap-1"
                          title="进入编辑（加锁）"
                        >
                          <Edit3 size={14} /> 数据编辑
                        </button>
                        <button
                          onClick={() => handleExportRow(d)}
                          className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1"
                        >
                          <Download size={14} /> 导出
                        </button>
                        <button
                          onClick={() => setDeleteTarget(d)}
                          className="text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
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
                  将删除「{deleteTarget.name}」的记录与文件，<span className="text-red-600">不可恢复</span>。
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
