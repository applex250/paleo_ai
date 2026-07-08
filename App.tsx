import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import DataManager from './pages/DataManager';
import Annotation from './pages/Annotation';
import Training from './pages/Training';
import ModelRegistry from './pages/ModelRegistry';
import Evaluation from './pages/Evaluation';
import Serving from './pages/Serving';
import Monitoring from './pages/Monitoring';
import Login from './pages/Login';
import { apiFetch, setUnauthorizedHandler } from './services/http';
import type { AuthUser } from './types';

// Placeholder components for routes not yet fully implemented
const Placeholder: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex flex-col items-center justify-center h-96 text-center">
    <div className="bg-slate-100 p-6 rounded-full mb-4">
      <span className="text-4xl">🚧</span>
    </div>
    <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
    <p className="text-slate-500 mt-2">此模块正在开发中...</p>
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 全局 401 拦截：清登录态 + 跳登录页（保留来源路径）
    setUnauthorizedHandler(() => {
      setUser(null);
      const cur = window.location.hash.replace(/^#/, '').split('?')[0] || '/';
      if (cur !== '/login') {
        window.location.hash = '/login?from=' + encodeURIComponent(cur);
      }
    });
    // 启动探活
    apiFetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: AuthUser } | null) => setUser(d?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const handleLogout = async (): Promise<void> => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.hash = '/login';
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-slate-400 text-sm">加载中…</div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route
          path="/"
          element={user ? <Layout user={user} onLogout={handleLogout} /> : <Navigate to="/login" replace />}
        >
          <Route index element={<Dashboard />} />
          <Route path="data" element={<DataManager />} />
          <Route path="annotation" element={<Annotation />} />
          <Route path="training" element={<Training />} />
          <Route path="evaluation" element={<Evaluation />} />
          <Route path="models" element={<ModelRegistry />} />
          <Route path="serving" element={<Serving />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

export default App;
