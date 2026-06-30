
import React, { useState } from 'react';
import { Play, Pause, Square, RefreshCcw, Plus, Terminal } from 'lucide-react';
import { mockTrainingJobs } from '../services/mockApi';
import { JobStatus } from '../types';

const Training: React.FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">模型训练实验室</h1>
          <p className="text-slate-500 mt-1">配置实验参数、管理 GPU 算力资源并追踪 Loss 曲线。</p>
        </div>
        <button onClick={() => setShowCreateModal(!showCreateModal)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-indigo-200">
          <Plus size={18} />
          <span>新建实验任务</span>
        </button>
      </div>

      {showCreateModal && (
        <div className="bg-white p-6 rounded-xl border border-indigo-100 shadow-xl mb-6 animate-fade-in-down">
           <div className="flex justify-between mb-4">
             <h3 className="font-bold text-lg text-slate-800">配置训练任务</h3>
             <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
           </div>
           <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">实验名称</label>
                <input type="text" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="例如: 惠西南-单井相推理-实验v2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">基础模型架构</label>
                <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option>3D U-Net (地震相推理)</option>
                  <option>LSTM-Attention (单井相沉积相)</option>
                  <option>Transformer (单井相岩相)</option>
                  <option>ResNet101 (岩心图像分类)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">训练数据集</label>
                <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                   <option>惠州凹陷惠西南-地震数据A组</option>
                   <option>惠州凹陷惠西南-单井测井曲线</option>
                   <option>惠州凹陷惠西南-岩心切片库</option>
                </select>
              </div>
               <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">资源分配</label>
                <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                   <option>1x A100 GPU</option>
                   <option>4x A100 分布式集群</option>
                </select>
              </div>
           </div>
           <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-medium">取消</button>
              <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium shadow-md">提交任务</button>
           </div>
        </div>
      )}

      {/* Active Jobs Grid */}
      <div className="grid grid-cols-1 gap-4">
        {mockTrainingJobs.map((job) => (
          <div key={job.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between group hover:border-indigo-200 transition-all">
             <div className="flex items-start gap-4">
                <div className={`mt-1 w-10 h-10 rounded-lg flex items-center justify-center ${
                  job.status === JobStatus.RUNNING ? 'bg-indigo-100 text-indigo-600' : 
                  job.status === JobStatus.COMPLETED ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'
                }`}>
                  {job.status === JobStatus.RUNNING ? <RefreshCcw size={20} className="animate-spin" /> : <Terminal size={20} />}
                </div>
                <div>
                   <h4 className="font-bold text-slate-800 flex items-center gap-2">
                     {job.name} 
                     <span className="text-xs font-normal text-slate-400 px-2 py-0.5 bg-slate-50 rounded border border-slate-200">{job.id}</span>
                   </h4>
                   <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                      <span>{job.modelType}</span>
                      <span>•</span>
                      <span>{job.dataset}</span>
                      <span>•</span>
                      <span>{job.startTime}</span>
                   </div>
                </div>
             </div>

             <div className="flex items-center gap-8">
                {/* Stats */}
                <div className="text-right hidden md:block">
                   <p className="text-xs text-slate-400 uppercase tracking-wider">Epoch</p>
                   <p className="font-mono font-medium">{job.epoch}/{job.maxEpoch}</p>
                </div>
                <div className="text-right hidden md:block">
                   <p className="text-xs text-slate-400 uppercase tracking-wider">准确率</p>
                   <p className="font-mono font-medium text-emerald-600">{(job.accuracy * 100).toFixed(1)}%</p>
                </div>
                <div className="text-right hidden md:block">
                   <p className="text-xs text-slate-400 uppercase tracking-wider">Loss</p>
                   <p className="font-mono font-medium text-rose-500">{job.loss.toFixed(4)}</p>
                </div>

                {/* Controls */}
                <div className="flex gap-2">
                   {job.status === JobStatus.RUNNING ? (
                     <>
                       <button className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded" title="暂停"><Pause size={18} /></button>
                       <button className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="终止"><Square size={18} /></button>
                     </>
                   ) : (
                      <button className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded" title="恢复/启动"><Play size={18} /></button>
                   )}
                </div>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Training;
