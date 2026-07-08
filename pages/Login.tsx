import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../services/http';
import type { AuthUser } from '../types';

const Login: React.FC<{ onLogin: (u: AuthUser) => void }> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登录失败');
        return;
      }
      onLogin(data.user as AuthUser);
      const from =
        new URLSearchParams(window.location.hash.split('?')[1] || '').get('from') || '/';
      navigate(from, { replace: true });
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
      <div className="bg-white rounded-xl shadow-xl border border-slate-100 p-8 w-[400px] max-w-[90vw]">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-blue-600 rounded-lg text-white">
            <LogIn size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">AI Ops 平台</h1>
            <p className="text-xs text-slate-500">请登录后使用</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-blue-500 outline-none text-sm"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-blue-500 outline-none text-sm"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-4 text-center">
          默认账号 admin / changeme123（可用 SEED_USER 环境变量配置）
        </p>
      </div>
    </div>
  );
};

export default Login;
