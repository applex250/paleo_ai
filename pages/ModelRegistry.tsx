
import React from 'react';
import { GitBranch, Globe, Archive, MoreHorizontal, Check, Tag } from 'lucide-react';
import { mockModels } from '../services/mockApi';

const ModelRegistry: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">模型注册与版本库</h1>
          <p className="text-slate-500 mt-1">管理模型版本、生命周期状态以及部署发布。</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
         <div className="grid grid-cols-1 divide-y divide-slate-100">
            {mockModels.map((model) => (
               <div key={model.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-4">
                     <div className="mt-1 p-2 bg-slate-100 rounded-lg text-slate-500">
                        <GitBranch size={24} />
                     </div>
                     <div>
                        <div className="flex items-center gap-3">
                           <h3 className="text-lg font-bold text-slate-800">{model.name}</h3>
                           <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-mono font-medium border border-slate-200">
                              <Tag size={12} /> {model.version}
                           </span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                           <span className="flex items-center gap-1">F1 Score: <strong className="text-slate-700">{model.f1Score}</strong></span>
                           <span>•</span>
                           <span>更新于 2 天前</span>
                           <span>•</span>
                           <span>作者: 管理员</span>
                        </div>
                     </div>
                  </div>

                  <div className="flex items-center gap-6">
                     <div className="flex flex-col items-end">
                        <span className="text-xs uppercase text-slate-400 tracking-wider font-semibold mb-1">阶段</span>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                           model.status === '已上线' ? 'bg-green-100 text-green-700 border-green-200' :
                           model.status === '预发布' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                           'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                           {model.status}
                        </span>
                     </div>
                     
                     {model.deployed ? (
                        <div className="flex items-center gap-1 text-emerald-600 text-sm font-medium bg-emerald-50 px-3 py-1.5 rounded-lg">
                           <Globe size={16} /> 在线服务中
                        </div>
                     ) : (
                        <div className="flex items-center gap-1 text-slate-400 text-sm font-medium bg-slate-50 px-3 py-1.5 rounded-lg">
                           <Archive size={16} /> 未部署
                        </div>
                     )}

                     <button className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100">
                        <MoreHorizontal size={20} />
                     </button>
                  </div>
               </div>
            ))}
         </div>
      </div>
    </div>
  );
};

export default ModelRegistry;
