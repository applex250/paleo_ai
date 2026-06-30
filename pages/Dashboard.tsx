import React from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { Activity, Layers, Cpu, Database } from 'lucide-react';

const data = [
  { name: '周一', tasks: 40, gpu: 24, models: 24 },
  { name: '周二', tasks: 30, gpu: 13, models: 22 },
  { name: '周三', tasks: 20, gpu: 98, models: 22 },
  { name: '周四', tasks: 27, gpu: 39, models: 20 },
  { name: '周五', tasks: 18, gpu: 48, models: 21 },
  { name: '周六', tasks: 23, gpu: 38, models: 25 },
  { name: '周日', tasks: 34, gpu: 43, models: 21 },
];

const StatCard: React.FC<{ title: string; value: string; sub: string; icon: any; color: string }> = ({ title, value, sub, icon: Icon, color }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-shadow">
    <div>
      <p className="text-slate-500 text-sm font-medium mb-1">{title}</p>
      <h3 className="text-3xl font-bold text-slate-800 mb-1">{value}</h3>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
    <div className={`p-3 rounded-lg ${color} bg-opacity-10`}>
      <Icon size={24} className={color.replace('bg-', 'text-')} />
    </div>
  </div>
);

const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">平台总览</h1>
          <p className="text-slate-500 mt-1">实时监控平台指标与资源使用情况。</p>
        </div>
        <span className="text-sm text-slate-400">上次更新: 刚刚</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="活跃任务" value="12" sub="较昨日 +2" icon={Activity} color="bg-blue-500" />
        <StatCard title="数据总量" value="45 TB" sub="共 128 个数据集" icon={Database} color="bg-indigo-500" />
        <StatCard title="GPU 利用率" value="87%" sub="14/16 节点在线" icon={Cpu} color="bg-emerald-500" />
        <StatCard title="已上线模型" value="8" sub="日均推理 120万次" icon={Layers} color="bg-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-700 mb-6">集群资源使用趋势 (近7天)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorGpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Area type="monotone" dataKey="gpu" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorGpu)" name="GPU使用率" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-700 mb-6">任务分布</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none'}} />
                <Legend iconType="circle" />
                <Bar dataKey="tasks" name="训练任务" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="models" name="推理服务" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
