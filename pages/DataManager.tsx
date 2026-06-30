
import React, { useState } from 'react';
import { UploadCloud, FileText, Database, Trash2, Sliders, Wand2, Server, Link } from 'lucide-react';
import { mockDatasets } from '../services/mockApi';

const DataManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'import' | 'clean' | 'feature'>('import');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">数据与样本管理</h1>
          <p className="text-slate-500 mt-1">导入数据、清洗样本以及特征工程处理。</p>
        </div>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
          <UploadCloud size={18} />
          <span>本地文件导入</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'import', name: '1. 数据接入与存储', icon: Database },
            { id: 'clean', name: '2. 数据清洗', icon: Trash2 },
            { id: 'feature', name: '3. 特征构造', icon: Sliders },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                flex items-center gap-2 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
              `}
            >
              <tab.icon size={16} />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {activeTab === 'import' && (
          <div className="min-w-full">
             <div className="p-5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
               <div>
                  <h3 className="font-bold text-slate-800 text-lg">数据源连接</h3>
                  <p className="text-xs text-slate-500 mt-1">配置并管理外部数据源连接通道</p>
               </div>
               
               <div className="flex flex-wrap items-center gap-3">
                 {/* Primary Button */}
                 <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-colors shadow-blue-200">
                    <Link size={16} />
                    连接海油数据湖
                 </button>
                 
                 <div className="h-6 w-px bg-slate-300 mx-2 hidden md:block"></div>

                 {/* Secondary Links */}
                 <button className="px-3 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-600 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                    <Server size={14} /> 连接 S3 对象存储
                 </button>
                 <button className="px-3 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-600 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                    <Database size={14} /> 连接 PostgreSQL
                 </button>
               </div>
             </div>
             
             <div className="p-4 border-b border-slate-100 bg-white">
                <h4 className="text-sm font-bold text-slate-700 mb-3">已有数据集列表</h4>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 font-medium">
                    <tr>
                      <th className="px-6 py-3">数据集名称</th>
                      <th className="px-6 py-3">类型</th>
                      <th className="px-6 py-3">大小</th>
                      <th className="px-6 py-3">创建日期</th>
                      <th className="px-6 py-3">状态</th>
                      <th className="px-6 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mockDatasets.map((ds) => (
                      <tr key={ds.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2">
                          <FileText size={16} className="text-slate-400" />
                          {ds.name}
                        </td>
                        <td className="px-6 py-4">{ds.type}</td>
                        <td className="px-6 py-4 text-slate-500">{ds.size}</td>
                        <td className="px-6 py-4 text-slate-500">{ds.date}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            ds.status === '已清洗' ? 'bg-green-100 text-green-800' : 
                            ds.status === '原始' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {ds.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button className="text-blue-600 hover:text-blue-900 font-medium">查看详情</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        )}

        {activeTab === 'clean' && (
          <div className="p-8 text-center space-y-4">
             <div className="mx-auto w-16 h-16 bg-yellow-50 rounded-full flex items-center justify-center mb-4">
                <Wand2 size={32} className="text-yellow-600" />
             </div>
             <h3 className="text-lg font-medium text-slate-900">自动化数据清洗流水线</h3>
             <p className="text-slate-500 max-w-md mx-auto">
               提供自动化的异常值检测、缺失值填补以及冲突解决功能。
               请选择一个数据集以启动清洗向导。
             </p>
             <button className="mt-4 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 font-medium">
               启动清洗向导
             </button>
          </div>
        )}

        {activeTab === 'feature' && (
          <div className="p-8">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="border border-slate-200 rounded-lg p-6 hover:border-blue-500 cursor-pointer transition-all shadow-sm hover:shadow-md">
                   <div className="mb-4 p-3 bg-blue-50 w-fit rounded-lg text-blue-600"><Sliders size={24}/></div>
                   <h4 className="font-bold text-slate-800 mb-2">测井曲线归一化</h4>
                   <p className="text-sm text-slate-500 mb-3">使用 Z-Score 或 Min-Max 对曲线数据进行标准化处理，消除量纲差异。</p>
                   <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">用于: 单井相推理</span>
                </div>
                <div className="border border-slate-200 rounded-lg p-6 hover:border-blue-500 cursor-pointer transition-all shadow-sm hover:shadow-md">
                   <div className="mb-4 p-3 bg-purple-50 w-fit rounded-lg text-purple-600"><Wand2 size={24}/></div>
                   <h4 className="font-bold text-slate-800 mb-2">地震属性提取</h4>
                   <p className="text-sm text-slate-500 mb-3">基于 FFT 提取瞬时振幅、频率、相位、相干体等物理属性，增强地质特征。</p>
                   <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">用于: 地震相/断层识别</span>
                </div>
                <div className="border border-slate-200 rounded-lg p-6 hover:border-blue-500 cursor-pointer transition-all shadow-sm hover:shadow-md">
                   <div className="mb-4 p-3 bg-emerald-50 w-fit rounded-lg text-emerald-600"><Database size={24}/></div>
                   <h4 className="font-bold text-slate-800 mb-2">图像切片处理</h4>
                   <p className="text-sm text-slate-500 mb-3">将岩心扫描大图 (10k+ px) 智能切割为 256x256/512x512 的标准训练样本 Patch。</p>
                   <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">用于: 岩心图像分割</span>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataManager;
