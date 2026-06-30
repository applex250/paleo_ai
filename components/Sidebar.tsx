import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Database, 
  PenTool, 
  BrainCircuit, 
  BarChart2, 
  Box, 
  Server, 
  Activity, 
  Settings
} from 'lucide-react';

const Sidebar: React.FC = () => {
  const navItems = [
    { name: '平台总览', path: '/', icon: LayoutDashboard },
    { name: '数据与样本管理', path: '/data', icon: Database },
    { name: '数据标注', path: '/annotation', icon: PenTool },
    { name: '模型训练', path: '/training', icon: BrainCircuit },
    { name: '模型评估', path: '/evaluation', icon: BarChart2 },
    { name: '模型注册与版本', path: '/models', icon: Box },
    { name: '推理服务', path: '/serving', icon: Server },
    { name: '监控与日志', path: '/monitoring', icon: Activity },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white h-screen flex flex-col fixed left-0 top-0 overflow-y-auto z-10">
      <div className="p-6 flex items-center gap-3 border-b border-slate-800">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-xl">AI</div>
        <span className="font-semibold text-lg tracking-tight">AI 中台服务</span>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <item.icon size={20} />
            <span className="text-sm font-medium">{item.name}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <button className="flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg w-full transition-colors">
          <Settings size={20} />
          <span className="text-sm font-medium">系统设置</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
