import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';

const evalData = [
  { subject: '准确率 (Accuracy)', A: 0.88, B: 0.92, fullMark: 1 },
  { subject: '召回率 (Recall)', A: 0.82, B: 0.89, fullMark: 1 },
  { subject: '精确率 (Precision)', A: 0.85, B: 0.90, fullMark: 1 },
  { subject: 'F1 Score', A: 0.83, B: 0.89, fullMark: 1 },
  { subject: 'IoU', A: 0.76, B: 0.81, fullMark: 1 },
  { subject: '推理速度', A: 0.65, B: 0.85, fullMark: 1 },
];

const matrixData = [
    [45, 2, 3],
    [5, 38, 7],
    [1, 4, 45]
];

const classes = ['砂岩', '泥岩', '石灰岩'];

const Evaluation: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">模型评估</h1>
          <p className="text-slate-500 mt-1">对比不同模型版本的性能指标，分析混淆矩阵。</p>
        </div>
        <select className="bg-white border border-slate-300 rounded-lg px-4 py-2 text-sm text-slate-700 shadow-sm">
            <option>对比: v1.2 vs v2.0 (当前)</option>
            <option>对比: ResNet vs Transformer</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
           <h3 className="font-bold text-slate-700 mb-4">综合指标对比</h3>
           <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={evalData}>
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 1]} tick={false} axisLine={false} />
                  <Radar name="模型 v1.2 (基线)" dataKey="A" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.3} />
                  <Radar name="模型 v2.0 (新)" dataKey="B" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.5} />
                  <Legend />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Confusion Matrix Visualization */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
           <div className="flex justify-between mb-6">
             <h3 className="font-bold text-slate-700">混淆矩阵 (Confusion Matrix)</h3>
             <span className="text-sm text-slate-400">模型 v2.0</span>
           </div>
           
           <div className="flex flex-col items-center justify-center h-80">
              <div className="grid grid-cols-4 gap-1">
                 {/* Header Row */}
                 <div className="w-20 h-10"></div>
                 {classes.map(c => (
                     <div key={c} className="w-24 h-10 flex items-center justify-center font-bold text-slate-600 text-sm bg-slate-50">{c} (预测)</div>
                 ))}
                 
                 {/* Matrix Rows */}
                 {matrixData.map((row, i) => (
                    <React.Fragment key={i}>
                        <div className="w-20 h-24 flex items-center justify-end pr-4 font-bold text-slate-600 text-sm bg-slate-50">{classes[i]}<br/>(真实)</div>
                        {row.map((val, j) => {
                            // Simple heatmap logic
                            const max = 50; 
                            const intensity = val / max;
                            return (
                                <div 
                                    key={`${i}-${j}`} 
                                    className="w-24 h-24 flex items-center justify-center text-slate-800 font-medium relative border border-white"
                                    style={{ backgroundColor: i === j ? `rgba(59, 130, 246, ${Math.max(0.1, intensity)})` : `rgba(244, 63, 94, ${Math.max(0.05, intensity)})` }}
                                >
                                    {val}
                                </div>
                            )
                        })}
                    </React.Fragment>
                 ))}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Evaluation;
