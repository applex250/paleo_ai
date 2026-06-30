
import React, { useState } from 'react';
import { Play, Code, Copy, Check, Server, Zap } from 'lucide-react';

const Serving: React.FC = () => {
  const [inputJson, setInputJson] = useState('{\n  "well_id": "HZ-26-1",\n  "depth_interval": [2450, 2460],\n  "curves": {\n    "GR": [45.2, 46.1, 48.3],\n    "RT": [12.5, 12.8, 13.0]\n  }\n}');
  const [outputJson, setOutputJson] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePredict = () => {
    setLoading(true);
    setTimeout(() => {
        setOutputJson('{\n  "result": [\n    {\n      "depth": 2450.0,\n      "facies": "三角洲前缘滑塌浊积岩",\n      "lithology": "细砂岩",\n      "confidence": 0.94\n    }\n  ],\n  "model_version": "v1.0.0"\n}');
        setLoading(false);
    }, 800);
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">推理服务</h1>
          <p className="text-slate-500 mt-1">惠州凹陷惠西南 - 在线服务列表、API 调用测试。</p>
        </div>
      </div>

      {/* Service List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between">
            <div className="flex justify-between items-start">
               <div className="flex gap-4">
                  <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg">
                     <Zap size={24} />
                  </div>
                  <div>
                     <h3 className="font-bold text-slate-800 text-lg">惠西南-单井相推理服务</h3>
                     <p className="text-sm text-slate-500 mt-1">Endpoint: /v1/predict/single-well-facies</p>
                     <div className="flex gap-2 mt-2">
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded font-mono">v1.0.0</span>
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> 运行中
                        </span>
                     </div>
                  </div>
               </div>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center text-sm text-slate-500">
               <span>QPS: 145</span>
               <span>Avg Latency: 45ms</span>
               <button className="text-blue-600 font-medium hover:underline">监控详情</button>
            </div>
         </div>
         
         <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between">
            <div className="flex justify-between items-start">
               <div className="flex gap-4">
                  <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
                     <Server size={24} />
                  </div>
                  <div>
                     <h3 className="font-bold text-slate-800 text-lg">惠西南-地震相推理服务</h3>
                     <p className="text-sm text-slate-500 mt-1">Endpoint: /v1/predict/seismic-facies-3d</p>
                     <div className="flex gap-2 mt-2">
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded font-mono">v1.0.0</span>
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded flex items-center gap-1">
                             <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> 运行中
                        </span>
                     </div>
                  </div>
               </div>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center text-sm text-slate-500">
               <span>QPS: 32</span>
               <span>Avg Latency: 240ms</span>
               <button className="text-blue-600 font-medium hover:underline">监控详情</button>
            </div>
         </div>
      </div>

      {/* Playground */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
         <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
               <Code size={18} /> API 测试控制台
            </h3>
            <div className="flex gap-2">
               <select className="bg-white border border-slate-300 text-sm rounded px-2 py-1">
                  <option>惠西南-单井相推理服务 (v1.0.0)</option>
                  <option>惠西南-地震相推理服务 (v1.0.0)</option>
               </select>
               <button 
                  onClick={handlePredict}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1 rounded text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {loading ? '请求中...' : <><Play size={14} /> 发送请求</>}
               </button>
            </div>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-2 h-96 divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="flex flex-col">
               <div className="p-2 bg-slate-100 text-xs text-slate-500 font-medium uppercase tracking-wider">Request Body (JSON)</div>
               <textarea 
                  className="flex-1 w-full p-4 font-mono text-sm resize-none outline-none text-slate-700"
                  value={inputJson}
                  onChange={(e) => setInputJson(e.target.value)}
                  spellCheck={false}
               />
            </div>
            <div className="flex flex-col bg-slate-50">
               <div className="p-2 bg-slate-100 text-xs text-slate-500 font-medium uppercase tracking-wider flex justify-between">
                  <span>Response</span>
                  {outputJson && <span className="text-green-600">200 OK</span>}
               </div>
               <div className="flex-1 w-full p-4 font-mono text-sm relative">
                  {outputJson ? (
                     <pre className="text-slate-800 whitespace-pre-wrap">{outputJson}</pre>
                  ) : (
                     <span className="text-slate-400 italic">等待请求结果...</span>
                  )}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Serving;
