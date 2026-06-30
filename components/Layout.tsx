import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { Bell, Search, UserCircle } from 'lucide-react';

const Layout: React.FC = () => {
  return (
    <div className="flex bg-slate-50 min-h-screen">
      <Sidebar />
      <div className="flex-1 ml-64 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 px-8 flex items-center justify-between shadow-sm">
          <div className="flex items-center bg-slate-100 rounded-full px-4 py-2 w-96">
            <Search size={18} className="text-slate-400 mr-2" />
            <input 
              type="text" 
              placeholder="搜索数据集、模型或任务..." 
              className="bg-transparent border-none outline-none text-sm w-full text-slate-700 placeholder:text-slate-400"
            />
          </div>
          
          <div className="flex items-center gap-6">
            <button className="relative text-slate-500 hover:text-slate-700">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="flex items-center gap-2 cursor-pointer">
              <UserCircle size={28} className="text-slate-400" />
              <div className="text-sm text-right hidden sm:block">
                <p className="font-medium text-slate-700">管理员</p>
                <p className="text-xs text-slate-400">平台工程师</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
