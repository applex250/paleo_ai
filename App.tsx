import React from 'react';
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
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
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
