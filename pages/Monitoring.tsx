
import React from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { Activity, AlertTriangle, CheckCircle } from 'lucide-react';

const timeSeriesData = Array.from({ length: 20 }, (_, i) => ({
  time: `${10 + Math.floor(i / 2)}:${(i % 2) * 30 || '00'}`,
  qps: Math.floor(Math.random() * 50) + 100,
  latency: Math.floor(Math.random() * 20) + 10,
  errors: Math.random() > 0.8 ? Math.floor(Math.random() * 5) : 0
}));

const Monitoring: React.FC = () => {
  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">监控与日志</h1>
          <p className="text-slate-500 mt-1">系统健康状态、服务指标实时监控与报警日志。</p>
        </div>
      </div>

      {/* Status Banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
         <div className="flex items-center gap-4">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-full">
               <CheckCircle size={24} />
            </div>
            <div>
               <h3 className="font-bold text-emerald-900">系统运行正常</h3>
               <p className="text-sm text-emerald-700">所有节点响应正常，无积压报警。</p>
            </div>
         </div>
         <div className="text-right">
             <p className="text-xs text-emerald-600 font-medium uppercase">API 可用性</p>
             <p className="text-2xl font-bold text-emerald-800">99.99%</p>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         {/* QPS Chart */}
         <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
               <Activity size={18} className="text-blue-500" /> QPS (每秒请求数)
            </h3>
            <div className="h-64">
               <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeSeriesData}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis dataKey="time" tick={{fontSize: 12, fill: '#94a3b8'}} />
                     <YAxis tick={{fontSize: 12, fill: '#94a3b8'}} />
                     <Tooltip contentStyle={{borderRadius: '8px', border: 'none'}} />
                     <Line type="monotone" dataKey="qps" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
               </ResponsiveContainer>
            </div>
         </div>

         {/* Latency Chart */}
         <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
               <Activity size={18} className="text-orange-500" /> 平均延迟 (ms)
            </h3>
             <div className="h-64">
               <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeSeriesData}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                     <XAxis dataKey="time" tick={{fontSize: 12, fill: '#94a3b8'}} />
                     <YAxis tick={{fontSize: 12, fill: '#94a3b8'}} />
                     <Tooltip contentStyle={{borderRadius: '8px', border: 'none'}} />
                     <Line type="monotone" dataKey="latency" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
               </ResponsiveContainer>
            </div>
         </div>
      </div>

      {/* Logs */}
      <div className="bg-slate-900 rounded-xl overflow-hidden shadow-sm">
         <div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex justify-between items-center">
            <h3 className="font-bold text-white">系统日志流</h3>
            <span className="flex items-center gap-2 text-xs text-green-400">
               <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> 实时接收中
            </span>
         </div>
         <div className="p-4 font-mono text-xs text-slate-400 space-y-2 h-48 overflow-y-auto">
            <p><span className="text-slate-500">[2023-10-27 10:45:01]</span> <span className="text-blue-400">INFO</span> [Scheduler] Job #J-2941 assigned to Node-04</p>
            <p><span className="text-slate-500">[2023-10-27 10:45:05]</span> <span className="text-blue-400">INFO</span> [API] POST /v1/predict/lithology 200 OK - 12ms</p>
            {/* 修复了此处的 > 符号，改为 &gt; */}
            <p><span className="text-slate-500">[2023-10-27 10:45:12]</span> <span className="text-yellow-400">WARN</span> [Resource] GPU utilization &gt; 90% on Node-01</p>
            <p><span className="text-slate-500">[2023-10-27 10:45:18]</span> <span className="text-blue-400">INFO</span> [API] POST /v1/predict/lithology 200 OK - 15ms</p>
            <p><span className="text-slate-500">[2023-10-27 10:45:22]</span> <span className="text-blue-400">INFO</span> [Auth] User 'Admin' logged in successfully</p>
         </div>
      </div>
    </div>
  );
};

export default Monitoring;
