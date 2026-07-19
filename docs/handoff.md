# 交接文档：单井井剖面可视化（数据标注 · 预览）

> 接手者（Codex 等）请先读本文，再读 `docs/welllog-cursor-readout.md`（光标读出框的可见曲线集合与性能）。
> 本期工作已提交并推送：`fcc611e feat(welllog): 单井井剖面可视化（预览）` + `3cea2e3 feat(auth): 预置 user1~user5`。

---

## 1. 项目背景

- **仓库**：`applex250/paleo_ai`（main 直推，个人项目）；本地 `F:\paleo_work\AILabeling-main`。
- **定位**：古生物 AI 标注 Web 平台。已有「数据与样本管理」+「数据标注/编辑」流程（**登录 + 编辑锁 + 四级状态机 + 自动续期**，提交 `639b06f` / `a52a6a6`）。
- **本期新增**：在「数据标注 → 单井数据 → **预览**」抽屉里，做一个 **井剖面（单井柱状图）可视化**，把隔壁桌面工具 `geo-viz-engine`（PySide6/Qt）的井剖面图搬到 web 端。

## 2. 技术栈与硬约束

| 项 | 值 / 说明 |
|---|---|
| 前端 | React 18（package.json）/ 实际 importmap CDN 为 React 19；TypeScript（strict）；Vite 5；Tailwind 3 |
| 后端 | Express :3000；`node:sqlite`（`DatabaseSync`）；写串行队列 `server/queue.ts` 的 `enqueue` |
| 依赖 | **零新前端依赖**——用项目已有的 `xlsx`(SheetJS)、`lucide-react`；**不引入 ECharts/D3**，渲染用纯 React + SVG |
| importmap | `index.html` 的 importmap 锁了 react19/react-router7/recharts3（与 package.json 的 18/6/2 不一致，已知问题）；`xlsx` 不在 importmap，靠 Vite 从 node_modules 打包 |
| **安全** | `data01/` **已 gitignore**（内含 `metadata.db` 密码哈希 + 大 xlsx + sessions），**绝勿提交**；预置密码 `changeme123`/`12345` 仅占位 |

## 3. 功能点（预览抽屉现状）

入口：`pages/Annotation.tsx` 的 `previewing` 分支 → `<WellLogViewer fileId name />`（全屏只读层，无锁/无心跳/不写后端）。

- **全曲线解析**：读 `测井曲线` sheet 的**所有数值列**（除深度 + `井号/TVD/TVDSS/道名/道`）；`-9999/-999.25` → null。
- **右侧曲线选择面板**：勾选主曲线显隐；**横轴范围 `[min,max]` 行内双击编辑**（校验/红闪/Esc）。
- **固定列宽 + 横向滚动**：track 永不被压缩（`effectiveWidth = max(naturalWidth, viewport)`，scale≥1）；**深度尺固定左侧**不随横向滚动。
- **深度交互**：滚轮 = 上下平移；**Ctrl+滚轮 = 缩放**（以光标深度为锚）；拖拽平移；十字光标读深度。
- **列头 ➕ 多曲线叠加**：每道可叠任意副曲线（无独占，同曲线可重复），**同道主+副共享主曲线量程**。
- **列头×2（112px）+ 线型示意**（实/虚/点）。
- **光标数值读出框**：跟随光标，线性插值显示各可见曲线在该深度的值。
- **轨道集照搬 GeoViz `laolong1`/`build_qpainter_tracks`**：系/统/组（地层系统）·曲线·深度·岩性(纹样)·岩性描述·沉积相·体系域·层序；缺数据的道自动过滤不占位。

## 4. 模块结构（`welllog/`，自包含）

```
welllog/
├── types.ts                 # TS 类型：CurveData/WellLogData/TrackConfig…（移植 models.py+config.py）
├── geo.ts                   # 纯几何：depthToY/yToDepth/niceGridInterval/valueToX(含对数)/
│                            #   downsampleMinMax(先按 null 分段)/buildCurveSegments/segmentsToPath/
│                            #   matchDict/interpAtDepth(二分+线性插值)
├── config.ts                # CURVE_META/CURVE_ALIASES/DISPLAY_RANGES/LOG_CURVES/
│                            #   getDisplayRange(子串查找+min/max)/TRACK_WIDTH/CURVE_FALLBACK_PALETTE/
│                            #   THEME(含 trackHeaderH=112)/DEFAULT_TRACKS/PATTERN 映射表
├── transform.ts             # SheetJS 矩阵→WellLogData；readCurves 枚举全部列+别名；readLithology/readFormation；
│                            #   hasTrackData/resolveTrackItems
├── useWellLogData.ts        # hook：apiFetch→XLSX.read→transform；按 fileId 模块级缓存
├── patterns.ts              # import.meta.glob('?raw') 取 18 个 SVG→dataURL（<image> 注入，规避命名空间）
├── patterns/*.svg           # 18 个岩性纹样（复制自 geo-viz-engine）
└── components/
    ├── WellLogViewer.tsx        # 对外容器 + 工具栏；持有 range/selected/curveRanges/secondaries/menu/cursor
    ├── WellLogCanvas.tsx        # 布局(固定深度列+横向滚动)+交互(滚轮/拖拽/十字光标/onCursor)
    ├── CurveSelectionPanel.tsx  # 右侧面板：勾选 + 范围行内编辑
    ├── TrackHeaderDropdown.tsx  # 列头 ➕ 的副曲线下拉（HTML 浮层）
    ├── CursorReadout.tsx        # 光标数值读出框
    └── tracks/
        ├── types.ts             # TrackProps（含 curveRange?/onOpenCurveMenu?）
        ├── DepthTrack / CurveTrack / IntervalTrack / LithologyTrack /
        ├── SystemsTractTrack / TextTrack.tsx
```

### 状态与数据流（`WellLogViewer` 为总枢）

```
右侧面板 selected      ┐
列头 ➕ secondaries    ├→ tracks(useMemo) → activeTracks(filter hasTrackData) → Canvas 布局
曲线范围 curveRanges   ┘                        ↓
                                          CurveTrack(共享 curveRange) → CurvePath(React.memo+useMemo)
鼠标移动 → Canvas.onCursor(depth,x,y) → Viewer.cursor → CursorReadout(interpAtDepth × 可见曲线)
```

- **可见曲线集合** = 所有曲线道 `curveNames` 去重 = 右侧主曲线 ∪ 各列副曲线（见 `docs/welllog-cursor-readout.md`）。
- **性能关键**：mousemove 只重算读出框；曲线 `<path>` 因 `React.memo`+`useMemo` 全部跳过（深度区间不变）。

## 5. GeoViz 对齐（参考源 `F:\paleo_work\geo-viz-engine-main`）

GeoViz 是 **Python/PySide6 桌面应用**，其 web 渲染器（ECharts）**源码已丢**（只剩压缩 `web_dist/assets/index.js`）。所以"移植"= **重写渲染器**，但照搬以下（都在 Python 侧，可读）：

| 关注点 | 照搬来源 | 我们的落点 |
|---|---|---|
| 数据模型 | `models.py` | `welllog/types.ts` |
| 几何数学 | `renderer/track_base.py`（depth↔Y、nice 网格）、`curve_track.py`（min/max 降采样、对数 valueToX） | `welllog/geo.ts` |
| display_range | `src/data/loaders.py:256-274`（子串查找 GR/AC/RT/…/CAL，未知→min/max） | `config.getDisplayRange` |
| track 宽度 | `qpainter_builder.py`（曲线 140/深度 60/岩性 80/地层 50；非废弃的 laolong1 ECharts 120） | `config.TRACK_WIDTH` |
| 横向布局 | `qpainter_widget.py`（QScrollArea，min宽=max(natural,viewport)） | `WellLogCanvas` |
| 纹样/颜色 | `pattern_map.py`、`configs/laolong1.py`（LITHOLOGY_MAPPING） | `config.ts` + `patterns/*.svg` |
| 光标读出 | `renderer/overlay.py:_collect_values`（二分+线性插值） | `geo.interpAtDepth` + `CursorReadout` |

## 6. ⚠️ 待完善 / 已知问题（**接手重点**）

按优先级：

1. **编辑抽屉仍是占位**：`pages/Annotation.tsx` 的 `editing` 分支主体是 `TODO: xlsx 解析表格组件`（预览已接 `WellLogViewer`，编辑未接）。→ 可把 `WellLogViewer` 复用成**可编辑版**（双向改曲线值 + 经编辑锁 `lock/save/finish/exit` 回写 `<id>.xlsx`）。这是最大的一块未完成。
2. **跨类型曲线叠加的量纲冲突**：同道共享主曲线量程时，把 RT(对数,0.1–2000) 叠进 GR(0–150) 道会让 RT 贴边/出界。→ 可加「每曲线独立量程」或「按曲线自身量程分道」选项。
3. **display_range 用原始 min/max**（与 GeoViz 一致），气体曲线 TG/C1… 带异常负下限（接近 -999 的脏值）。→ 可加「分位稳健量程（5–95%）」开关。
4. **列头 chip 是 SVG 行式**（非 flex-wrap）：副曲线多时截断 `+N`，下拉里看全量。→ 想要更丰富布局可换 `foreignObject`（注意命名空间/裁剪）。
5. **下拉锚点不跟随横向滚动**：`TrackHeaderDropdown` 打开时若横向滚动画布，位置不更新（v1 未处理，关后重开即可）。
6. **CurveSelectionPanel 仍是「色块+名」**：列头已加线型示意，右侧面板未加（可统一）。
7. **未做**：合并/拆分曲线道、track 拖拽排序（GeoViz 有）、SVG 矢量导出（`export_svg`）、多井同步对比（`SyncManager`/`ConnectionOverlay`）。
8. **小优化**：`visibleCurves` 的 `name→CurveData` 用 `.find`（O(C²)，C≈21 无感；曲线上百换 `Map`）；`WellLogCanvas` 未 `React.memo`（mousemove 时其 memo'd 子组件已跳过，影响很小）。
9. **无自动化测试**：仅 `tsc` + `vite build` + 一次性 smoke（读真实 xlsx 打印解析结果，已删）。可补 vitest 对 `geo.ts`/`transform.ts` 的单测。

## 7. 运行与验证

```bash
npm install              # 首次
npm run dev:all          # web :5173 + api :3000（concurrently）
npm run build            # tsc + vite build（验证编译）
npm run typecheck:server # 后端 tsc
```

- 登录：`admin / changeme123` 或 `user1~user5 / 12345`。
- 路径：数据标注 → 单井数据 → 某行「预览」。
- **端口占用**（常见坑）：`netstat -ano | grep -E ':3000|:5173' | grep LISTENING` → `taskkill //PID <pid> //F`。
- 数据在 `data01/danjing/*.xlsx`（样本井 HZ19-1-1A，4 份相同副本）。

## 8. 单井 xlsx 数据格式（9 sheet）

- `测井曲线`：`井号,深度,TVD,TVDSS,CAL,BS,GR,MLR1C,MLR4C,DT,CNCF,ZDEN,PE,TG,C1…CO2,孔隙度,渗透率,SUWI`；步长 0.125m；缺测 `-9999`。
- `岩性道`：`顶深/底深/岩性`（自由中文，如「深灰色粉砂质泥岩」）。
- `地层单位道`：`道名="组"` + `层号`(组名) + 顶/底深（**只有组级**，无系/统）。
- 其余：`砂层组道/标准层道/取心数据道/文本道/坐标`（**GeoViz 轨道集没有，本期不渲染**）。
- **曲线别名**（GeoViz 名 ↔ 我们的列）：`AC↔DT`、`GR↔GR`、`RT↔MLR4C`、`RXO↔MLR1C`。

## 9. 给 Codex 的切入建议

1. **先跑起来**：`dev:all` → 登录 → 预览，对照本文第 3 节逐项体验。
2. **读代码顺序**：`WellLogViewer.tsx`（状态总枢）→ `WellLogCanvas.tsx`（布局+交互）→ `tracks/CurveTrack.tsx`（多曲线叠加+共享量程+列头➕）→ `transform.ts`（解析）→ `geo.ts`（数学）。
3. **参考文档**：`docs/welllog-cursor-readout.md`（可见曲线集合+性能）、本文件。
4. **GeoViz 只读参考**：`F:\paleo_work\geo-viz-engine-main`（别改它，只对照逻辑；其 web 渲染器是压缩 JS，看 `renderer/*.py` 的 QPainter 实现更清晰）。
5. **最该做的**：第 6 节第 1 项（编辑抽屉接入可编辑版），能把"预览"升级为完整"标注/编辑"闭环。

## 10. 提交历史（baseline）

```
fcc611e feat(welllog): 单井井剖面可视化（预览）     ← 本期
3cea2e3 feat(auth): 预置 user1~user5 账号
a52a6a6 feat: 数据预览（只读）+ 同账号编辑互斥
639b06f feat: 前后端分离 + 数据编辑/标注（编辑锁 + 状态机 + 登录）
bc1be01 Initial commit
```
