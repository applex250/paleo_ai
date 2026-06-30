
import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  MoreVertical, 
  Brain, 
  PenTool, 
  MousePointer2, 
  Eraser, 
  ZoomIn,
  ImagePlus,
  Square,
  Move,
  Trash2,
  Edit3,
  Palette,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { mockAnnotationTasks } from '../services/mockApi';

type ToolType = 'select' | 'box' | 'polygon' | 'eraser';

interface BaseAnnotation {
  id: number;
  label: string;
  type: 'box' | 'polygon';
  color: string; // Add color property
}

interface BoxAnnotation extends BaseAnnotation {
  type: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PolygonAnnotation extends BaseAnnotation {
  type: 'polygon';
  points: {x: number, y: number}[];
}

type AnnotationItem = BoxAnnotation | PolygonAnnotation;

// Domain specific presets
const DOMAIN_PRESETS = {
  '地震相': ['平行反射', '前积反射', '杂乱反射', '空白反射', '丘状反射', '断层带'],
  '沉积相': ['三角洲前缘', '水下分流河道', '滨浅湖', '深湖浊积扇', '滑塌沉积', '决口扇'],
  '岩相': ['细砂岩', '粉砂岩', '泥岩', '生物灰岩', '砾岩', '油页岩']
};

const COLORS = [
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

const Annotation: React.FC = () => {
  const [view, setView] = useState<'list' | 'workspace'>('list');
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolType>('select');
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [activeColor, setActiveColor] = useState<string>(COLORS[0]); // Current drawing color
  
  // Drawing states
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStartPos, setBoxStartPos] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState<BoxAnnotation | null>(null);
  
  const [currentPolygonPoints, setCurrentPolygonPoints] = useState<{x: number, y: number}[]>([]);

  // Selection
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string>('地震相'); // For accordion
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset selection when changing tools
    setSelectedId(null);
    setCurrentPolygonPoints([]);
    setCurrentBox(null);
  }, [tool]);

  // When selection changes, update active color to match selection
  useEffect(() => {
    if (selectedId) {
      const ann = annotations.find(a => a.id === selectedId);
      if (ann) setActiveColor(ann.color);
    }
  }, [selectedId, annotations]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const url = URL.createObjectURL(e.target.files[0]);
      setCurrentImage(url);
      setAnnotations([]);
    }
  };

  const getMousePos = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // --- Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!currentImage) return;
    const pos = getMousePos(e);

    if (tool === 'box') {
      setIsDrawingBox(true);
      setBoxStartPos(pos);
      setCurrentBox({
        id: Date.now(),
        type: 'box',
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        label: '标注区域',
        color: activeColor
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    if (tool === 'box' && isDrawingBox && currentBox) {
      setCurrentBox({
        ...currentBox,
        width: pos.x - boxStartPos.x,
        height: pos.y - boxStartPos.y
      });
    }
  };

  const handleMouseUp = () => {
    if (tool === 'box' && isDrawingBox && currentBox) {
      setIsDrawingBox(false);
      // Normalize box
      const normalizedBox: BoxAnnotation = {
        ...currentBox,
        x: currentBox.width < 0 ? currentBox.x + currentBox.width : currentBox.x,
        y: currentBox.height < 0 ? currentBox.y + currentBox.height : currentBox.y,
        width: Math.abs(currentBox.width),
        height: Math.abs(currentBox.height),
      };
      
      if (normalizedBox.width > 5 && normalizedBox.height > 5) {
        setAnnotations([...annotations, normalizedBox]);
        setSelectedId(normalizedBox.id);
      }
      setCurrentBox(null);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!currentImage) return;
    const pos = getMousePos(e);

    if (tool === 'polygon') {
      setCurrentPolygonPoints([...currentPolygonPoints, pos]);
    } else if (tool === 'select') {
      setSelectedId(null); 
    }
  };

  const handlePolygonDoubleClick = () => {
    if (tool === 'polygon' && currentPolygonPoints.length > 2) {
      const newPoly: PolygonAnnotation = {
        id: Date.now(),
        type: 'polygon',
        label: '多边形区域',
        points: [...currentPolygonPoints],
        color: activeColor
      };
      setAnnotations([...annotations, newPoly]);
      setSelectedId(newPoly.id);
      setCurrentPolygonPoints([]);
    }
  };

  const handleAnnotationClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (tool === 'eraser') {
      deleteAnnotation(id);
    } else if (tool === 'select') {
      setSelectedId(id);
    }
  };

  const deleteAnnotation = (id: number) => {
    setAnnotations(annotations.filter(a => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const updateLabel = (id: number, newLabel: string) => {
    setAnnotations(annotations.map(a => a.id === id ? { ...a, label: newLabel } : a));
  };

  const updateColor = (id: number, newColor: string) => {
    setAnnotations(annotations.map(a => a.id === id ? { ...a, color: newColor } : a));
    setActiveColor(newColor);
  };

  // --- Render Helpers ---

  const renderPolygonPoints = (points: {x: number, y: number}[]) => {
    return points.map(p => `${p.x},${p.y}`).join(' ');
  };

  const selectedAnnotation = annotations.find(a => a.id === selectedId);

  // Helper to convert hex to rgba
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  if (view === 'workspace') {
    return (
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-slate-900 rounded-xl overflow-hidden text-slate-300">
        <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
          <div className="flex items-center gap-4">
             <button onClick={() => setView('list')} className="text-sm hover:text-white flex items-center gap-1">← 返回任务列表</button>
             <h2 className="text-white font-medium pl-4 border-l border-slate-600">任务: 惠州凹陷惠西南-单井测井曲线 #1024</h2>
          </div>
          <div className="flex items-center gap-3">
             <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                className="hidden" 
                accept="image/*"
             />
             <button 
                onClick={() => fileInputRef.current?.click()}
                className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-600 flex items-center gap-2"
             >
                <ImagePlus size={14} /> 上传切片/图件
             </button>
             <span className="text-xs px-2 py-1 bg-purple-900 text-purple-200 rounded border border-purple-700 flex items-center gap-1">
               <Brain size={12} /> 智能辅助开启
             </span>
             <button className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm font-medium">提交保存</button>
          </div>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
           {/* Toolbar */}
           <div className="w-14 bg-slate-800 border-r border-slate-700 flex flex-col items-center py-4 gap-4 z-10">
              <button 
                onClick={() => setTool('select')}
                className={`p-2 rounded transition-colors ${tool === 'select' ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-400'}`}
                title="选择 (V)"
              >
                <Move size={20} />
              </button>
              <button 
                onClick={() => setTool('box')}
                className={`p-2 rounded transition-colors ${tool === 'box' ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-400'}`}
                title="矩形标注 (R)"
              >
                <Square size={20} />
              </button>
              <button 
                onClick={() => setTool('polygon')}
                className={`p-2 rounded transition-colors ${tool === 'polygon' ? 'bg-blue-600 text-white' : 'hover:bg-slate-700 text-slate-400'}`}
                title="钢笔/多边形 (P) - 双击结束"
              >
                <PenTool size={20} />
              </button>
              <button 
                onClick={() => setTool('eraser')}
                className={`p-2 rounded transition-colors ${tool === 'eraser' ? 'bg-red-600 text-white' : 'hover:bg-slate-700 text-slate-400'}`}
                title="橡皮擦 (E) - 点击删除"
              >
                <Eraser size={20} />
              </button>
              
              <div className="w-8 h-px bg-slate-700 my-2"></div>
              
              {/* Color Picker in Toolbar */}
              <div className="flex flex-col gap-2 items-center">
                 <Palette size={16} className="text-slate-500" />
                 {COLORS.map(c => (
                   <button
                     key={c}
                     onClick={() => {
                        setActiveColor(c);
                        if (selectedAnnotation) updateColor(selectedAnnotation.id, c);
                     }}
                     className={`w-4 h-4 rounded-full transition-all ${activeColor === c ? 'scale-125 ring-2 ring-white' : 'hover:scale-110'}`}
                     style={{ backgroundColor: c }}
                   />
                 ))}
              </div>

              <div className="flex-1"></div>
              <button className="p-2 hover:bg-slate-700 text-slate-400 rounded"><ZoomIn size={20} /></button>
           </div>
           
           {/* Canvas Area */}
           <div className="flex-1 bg-black relative flex items-center justify-center overflow-auto bg-grid-slate-800">
              <div 
                ref={containerRef}
                className={`relative shadow-2xl ${tool === 'eraser' ? 'cursor-not-allowed' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleCanvasClick}
                onDoubleClick={handlePolygonDoubleClick}
              >
                {currentImage ? (
                  <img src={currentImage} alt="Work" className="max-h-[80vh] max-w-full select-none" draggable={false} />
                ) : (
                  <div className="w-[800px] h-[600px] bg-slate-800 flex flex-col items-center justify-center border-2 border-dashed border-slate-600 rounded-lg">
                    <ImagePlus size={64} className="text-slate-600 mb-4" />
                    <p className="text-slate-400">请上传地震剖面图或测井曲线图</p>
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium"
                    >
                        选择本地文件
                    </button>
                  </div>
                )}

                {/* SVG Overlay for Annotations */}
                {(currentImage || annotations.length > 0) && (
                   <svg className="absolute inset-0 w-full h-full">
                      {/* Existing Annotations */}
                      {annotations.map((ann) => {
                        const isSelected = selectedId === ann.id;
                        const fillColor = hexToRgba(ann.color, isSelected ? 0.35 : 0.15);
                        const strokeColor = ann.color;
                        const strokeWidth = isSelected ? 3 : 2;

                        return (
                          <g key={ann.id} onClick={(e) => handleAnnotationClick(e, ann.id)}>
                            {ann.type === 'box' ? (
                                <rect 
                                  x={ann.x} y={ann.y} width={ann.width} height={ann.height}
                                  fill={fillColor}
                                  stroke={strokeColor}
                                  strokeWidth={strokeWidth}
                                  className="hover:opacity-80 transition-opacity"
                                />
                            ) : (
                                <polygon
                                  points={renderPolygonPoints(ann.points)}
                                  fill={fillColor}
                                  stroke={strokeColor}
                                  strokeWidth={strokeWidth}
                                  className="hover:opacity-80 transition-opacity"
                                />
                            )}
                            {/* Text Label */}
                            <text 
                                x={ann.type === 'box' ? ann.x : ann.points[0].x} 
                                y={(ann.type === 'box' ? ann.y : ann.points[0].y) - 5} 
                                fill={ann.color}
                                fontSize="14" 
                                fontWeight="bold"
                                style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}
                                className="select-none pointer-events-none"
                            >
                                {ann.label}
                            </text>
                          </g>
                        );
                      })}

                      {/* Drawing Box Preview */}
                      {currentBox && (
                         <rect 
                           x={currentBox.width < 0 ? currentBox.x + currentBox.width : currentBox.x} 
                           y={currentBox.height < 0 ? currentBox.y + currentBox.height : currentBox.y}
                           width={Math.abs(currentBox.width)} 
                           height={Math.abs(currentBox.height)}
                           fill={hexToRgba(activeColor, 0.1)}
                           stroke={activeColor}
                           strokeWidth="2"
                           strokeDasharray="4"
                           pointerEvents="none"
                         />
                      )}

                      {/* Drawing Polygon Preview */}
                      {currentPolygonPoints.length > 0 && (
                          <g pointerEvents="none">
                              <polyline
                                points={renderPolygonPoints(currentPolygonPoints)}
                                fill="none"
                                stroke={activeColor}
                                strokeWidth="2"
                                strokeDasharray="4"
                              />
                              {currentPolygonPoints.map((p, i) => (
                                  <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke={activeColor} />
                              ))}
                          </g>
                      )}
                   </svg>
                )}
              </div>
           </div>

           {/* Right Panel */}
           <div className="w-72 bg-slate-800 border-l border-slate-700 flex flex-col">
              <div className="p-4 border-b border-slate-700">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">属性面板</h3>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                 {/* Selection Editor */}
                 {selectedAnnotation ? (
                     <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600 animate-fade-in">
                        <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                           <Edit3 size={14} /> 编辑属性
                        </h4>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">标签名称</label>
                                <input 
                                    type="text" 
                                    value={selectedAnnotation.label}
                                    onChange={(e) => updateLabel(selectedAnnotation.id, e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 focus:border-blue-500 outline-none"
                                />
                            </div>

                            {/* Accordion for Presets */}
                            <div>
                                <label className="text-xs text-slate-400 block mb-2">行业预设标签</label>
                                <div className="space-y-1">
                                    {Object.entries(DOMAIN_PRESETS).map(([category, tags]) => (
                                        <div key={category} className="border border-slate-600 rounded overflow-hidden">
                                            <button 
                                                onClick={() => setExpandedCategory(expandedCategory === category ? '' : category)}
                                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-700/50 hover:bg-slate-600 text-xs font-medium text-slate-300"
                                            >
                                                {category}
                                                {expandedCategory === category ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                                            </button>
                                            
                                            {expandedCategory === category && (
                                                <div className="p-2 bg-slate-800 grid grid-cols-2 gap-2">
                                                    {tags.map(tag => (
                                                        <button 
                                                            key={tag}
                                                            onClick={() => updateLabel(selectedAnnotation.id, tag)}
                                                            className={`px-2 py-1 text-xs truncate rounded transition-colors text-left ${selectedAnnotation.label === tag ? 'bg-blue-900 text-blue-200 border border-blue-700' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                                                            title={tag}
                                                        >
                                                            {tag}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-2 border-t border-slate-600">
                                <label className="text-xs text-slate-400 block mb-2">标注颜色</label>
                                <div className="flex gap-2">
                                    {COLORS.map(c => (
                                        <button 
                                            key={c}
                                            onClick={() => updateColor(selectedAnnotation.id, c)}
                                            className={`w-6 h-6 rounded-full border-2 ${selectedAnnotation.color === c ? 'border-white' : 'border-transparent'}`}
                                            style={{backgroundColor: c}}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="pt-2 border-t border-slate-600">
                                <button 
                                    onClick={() => deleteAnnotation(selectedAnnotation.id)}
                                    className="w-full text-xs text-red-400 hover:text-red-300 py-1 flex items-center justify-center gap-1"
                                >
                                    <Trash2 size={12} /> 删除此标注
                                </button>
                            </div>
                        </div>
                     </div>
                 ) : (
                     <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-700 rounded-lg">
                        请在画布中选择一个标注以编辑属性，<br/>或在左侧选择工具开始绘制。
                     </div>
                 )}

                 {/* List */}
                 <div>
                     <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">标注列表 ({annotations.length})</h4>
                     <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                        {annotations.map((ann, idx) => (
                            <div 
                                key={ann.id} 
                                onClick={() => { setSelectedId(ann.id); setTool('select'); }}
                                className={`flex items-center justify-between p-2 rounded text-sm cursor-pointer transition-colors border-l-4 ${selectedId === ann.id ? 'bg-slate-700' : 'bg-slate-800 hover:bg-slate-700'}`}
                                style={{ borderLeftColor: ann.color }}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-200 truncate max-w-[120px]">{ann.label}</span>
                                </div>
                                <span className="text-xs text-slate-500 font-mono">#{idx + 1}</span>
                            </div>
                        ))}
                     </div>
                 </div>
              </div>

              <div className="p-4 bg-slate-700/30 border-t border-slate-700">
                 <h4 className="text-sm font-medium text-emerald-400 mb-2 flex items-center gap-2">
                    <Brain size={14} /> 智能辅助建议
                 </h4>
                 <p className="text-xs text-slate-400 mb-2">
                    系统在右侧区域识别出【三角洲前缘】沉积特征 (置信度 89%)。
                 </p>
                 <button className="w-full text-xs py-1.5 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-200 border border-emerald-800 rounded transition-colors">
                    一键应用预标注
                 </button>
              </div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">数据标注平台</h1>
          <p className="text-slate-500 mt-1">惠州凹陷惠西南区块 - 测井/地震/切片综合标注任务管理。</p>
        </div>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors shadow-sm" onClick={() => setView('workspace')}>
          进入标注工作台
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white shadow-lg shadow-blue-200">
          <h3 className="font-semibold text-blue-100">待处理任务</h3>
          <p className="text-3xl font-bold mt-2">128</p>
          <p className="text-xs text-blue-200 mt-1">主要集中在：地震曲线标注</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
           <h3 className="font-semibold text-slate-500">标注准确率</h3>
           <p className="text-3xl font-bold mt-2 text-slate-800">98.5%</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
           <h3 className="font-semibold text-slate-500">团队效率</h3>
           <p className="text-3xl font-bold mt-2 text-slate-800">4.2k <span className="text-sm text-slate-400 font-normal">样本/天</span></p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-200">
           <h3 className="font-bold text-slate-700">任务队列</h3>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-medium">
            <tr>
              <th className="px-6 py-3">任务ID</th>
              <th className="px-6 py-3">所属数据集</th>
              <th className="px-6 py-3">标注类型</th>
              <th className="px-6 py-3">负责人</th>
              <th className="px-6 py-3">进度</th>
              <th className="px-6 py-3">状态</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mockAnnotationTasks.map((task) => (
              <tr key={task.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setView('workspace')}>
                <td className="px-6 py-4 font-mono text-slate-500">#{task.id}</td>
                <td className="px-6 py-4 font-medium text-slate-900">{task.datasetName}</td>
                <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                        {task.type}
                    </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                      {task.annotator.charAt(0)}
                    </div>
                    {task.annotator}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="w-24 bg-slate-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${task.progress}%` }}></div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    task.status === '待审核' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {task.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-400">
                   <MoreVertical size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Annotation;
