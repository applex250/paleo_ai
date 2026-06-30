# AI 中台服务平台（ai-ops-platform）

一个面向**油气勘探开发**场景的 AI 中台服务能力建设平台原型（Demo）。它用一套可视化界面把「数据 → 标注 → 训练 → 评估 → 模型管理 → 推理服务 → 监控」这条完整的机器学习流水线串了起来，业务背景设定在**惠州凹陷惠西南区块**（测井曲线、地震数据、岩心切片三类数据）。

> 说明：本项目是一个**纯前端原型**，所有数据来自 `services/mockApi.ts` 中的 Mock 数据，没有真实后端；标注、训练、推理等操作均为前端交互演示。

---

## 一、技术栈

| 类别 | 选型 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 路由 | React Router v6（`HashRouter`） |
| 图表 | Recharts |
| 图标 | lucide-react |
| 样式 | Tailwind CSS |

### 几点需要留意的配置细节

- **Tailwind 通过 CDN 引入**：`index.html` 里直接用 `<script src="https://cdn.tailwindcss.com">` 加载 Tailwind，虽然 `package.json` 的 devDependencies 里也列了 `tailwindcss / postcss / autoprefixer`，但实际样式走的是 CDN，并没有走本地构建链路。
- **importmap 与 package.json 的版本不一致**：`index.html` 的 importmap 指向 `aistudiocdn.com` 上的 React 19 / Vite 7 等版本（这是 Google AI Studio 在线运行用的），而 `package.json` 锁定的是 React 18.2 / Vite 5。本地 `npm run dev` 跑的是 `package.json` 的版本，importmap 仅在 AI Studio 环境生效。
- **TypeScript 严格模式**：`tsconfig.json` 开启了 `strict`，构建命令是 `tsc && vite build`，类型错误会直接导致构建失败。

---

## 二、目录结构

```text
AILabeling-main/
├── index.html              # HTML 入口，加载 Tailwind CDN、importmap、挂载点 #root
├── index.tsx               # JS 入口，ReactDOM.createRoot 渲染 <App />
├── App.tsx                 # 根组件，定义路由表（HashRouter + Routes）
├── types.ts                # 全局 TypeScript 类型定义（数据集、任务、模型等）
├── metadata.json           # AI Studio 应用元信息（名称、描述）
├── vite.config.ts          # Vite 配置（仅启用 @vitejs/plugin-react）
├── tsconfig.json           # TS 编译选项（strict、JSX、模块解析）
├── tsconfig.node.json      # 给 vite.config.ts 用的 TS 配置
├── package.json            # 依赖与脚本（dev / build / preview）
│
├── components/             # 通用布局组件
│   ├── Layout.tsx          # 整体页面骨架（侧边栏 + 顶部栏 + 内容区）
│   └── Sidebar.tsx         # 左侧导航菜单（8 个功能模块入口）
│
├── pages/                  # 各功能页面（每个文件对应一个路由模块）
│   ├── Dashboard.tsx       # 平台总览（指标卡片 + 资源趋势图）
│   ├── DataManager.tsx     # 数据与样本管理（接入 / 清洗 / 特征）
│   ├── Annotation.tsx      # 数据标注（任务列表 + 标注工作台）
│   ├── Training.tsx        # 模型训练实验室（任务管理 + 新建实验）
│   ├── Evaluation.tsx      # 模型评估（雷达图 + 混淆矩阵）
│   ├── ModelRegistry.tsx   # 模型注册与版本库
│   ├── Serving.tsx         # 推理服务（服务列表 + API 测试控制台）
│   └── Monitoring.tsx      # 监控与日志（QPS / 延迟 / 日志流）
│
└── services/
    └── mockApi.ts          # 所有 Mock 数据集中存放处
```

---

## 三、核心文件讲解

### 1. `index.html` 与 `index.tsx`（入口）

- `index.html` 设置 `lang="zh-CN"`、引入 Tailwind CDN、定义自定义滚动条样式、声明 importmap，并提供 `<div id="root">` 作为挂载点，最后通过 `<script type="module" src="/index.tsx">` 引导 Vite 入口。
- `index.tsx` 用 `ReactDOM.createRoot` 把 `<App />` 渲染进 `#root`，外层包了 `React.StrictMode`。

### 2. `App.tsx`（路由总控）

使用 `HashRouter`（URL 带 `#`，适合静态托管），所有页面都嵌在 `<Layout />` 下通过 `<Outlet />` 渲染：

| 路径 | 组件 | 对应功能 |
|------|------|----------|
| `/` | `Dashboard` | 平台总览（首页） |
| `/data` | `DataManager` | 数据与样本管理 |
| `/annotation` | `Annotation` | 数据标注 |
| `/training` | `Training` | 模型训练 |
| `/evaluation` | `Evaluation` | 模型评估 |
| `/models` | `ModelRegistry` | 模型注册与版本 |
| `/serving` | `Serving` | 推理服务 |
| `/monitoring` | `Monitoring` | 监控与日志 |

未匹配的路径会 `Navigate` 重定向回首页。文件里还留了一个 `Placeholder` 组件用于尚未实现的模块（当前所有路由都已接入真实页面）。

### 3. `components/`（布局）

- **`Layout.tsx`**：页面骨架。左侧是 `Sidebar`，右侧上方是顶部栏（搜索框、通知铃铛、用户信息「管理员 / 平台工程师」），下方 `<main>` 里用 `<Outlet />` 渲染当前路由页面。
- **`Sidebar.tsx`**：深色侧边栏，集中维护 8 个 `navItems`（图标 + 名称 + 路径），用 `NavLink` 的 `isActive` 高亮当前项，底部还有一个未接功能的「系统设置」按钮。

### 4. `types.ts`（类型定义）

定义了贯穿全项目的核心数据模型，是理解各页面的钥匙：

- `JobStatus`（枚举）：`等待中 / 运行中 / 已完成 / 失败`
- `Dataset`：数据集（地震/测井/图像/文本四类，状态：原始/已清洗/特征已提取）
- `AnnotationTask`：标注任务（进度、状态、标注类型如「测井曲线标注」「图像分割」）
- `TrainingJob`：训练任务（epoch、accuracy、loss、状态）
- `ModelVersion`：模型版本（版本号、F1、生命周期状态、是否已部署）

### 5. `services/mockApi.ts`（Mock 数据）

集中导出四份数组：`mockDatasets`、`mockAnnotationTasks`、`mockTrainingJobs`、`mockModels`，里面是带「惠州凹陷惠西南」业务背景的示例数据（如「惠西南-地震相推理训练 v3」「单井相推理模型v1」）。多个页面（DataManager、Annotation、Training、ModelRegistry）都直接 import 这些数组来渲染列表，**改这里的数据就能改变页面展示内容**。

---

## 四、八大功能模块（`pages/`）

1. **平台总览 `Dashboard`**：4 张指标卡片（活跃任务、数据总量、GPU 利用率、已上线模型）+ 两张 Recharts 图表（近 7 天资源趋势面积图、任务分布柱状图）。
2. **数据与样本管理 `DataManager`**：用 Tab 切换三步——①数据接入与存储（数据源连接：海油数据湖 / S3 / PostgreSQL，已有数据集表格）；②数据清洗（清洗向导占位）；③特征构造（测井归一化、地震属性 FFT 提取、岩心切片切 Patch 三张卡片）。
3. **数据标注 `Annotation`**（项目中最复杂的页面）：分「任务列表」和「标注工作台」两个视图。
   - 工作台支持**矩形框标注**（拖拽）、**多边形标注**（逐点点击、双击结束）、选择、橡皮擦四种工具；
   - 用 **SVG 叠加层**绘制标注图形和实时预览；
   - 右侧属性面板可编辑标签、选择行业预设标签（地震相 / 沉积相 / 岩相三类预设）、改颜色；
   - 内置「智能辅助建议 / 一键应用预标注」的 AI 辅助占位逻辑。
4. **模型训练实验室 `Training`**：训练任务卡片列表，展示 Epoch、准确率、Loss，带启动/暂停/终止按钮；点「新建实验任务」展开一个配置面板（实验名、模型架构如 3D U-Net / LSTM-Attention、数据集、GPU 资源）。
5. **模型评估 `Evaluation`**：雷达图对比两个模型版本的 6 项指标（准确率/召回率/精确率/F1/IoU/推理速度），以及一个手写的「砂岩/泥岩/石灰岩」混淆矩阵热力图。
6. **模型注册与版本库 `ModelRegistry`**：列出各模型版本、版本号、F1、生命周期阶段（开发中/预发布/已上线/已归档）和部署状态。
7. **推理服务 `Serving`**：两个推理服务卡片（单井相推理、地震相推理，含 QPS / 延迟）+ 一个 **API 测试控制台**：左侧编辑请求 JSON，点「发送请求」后用 `setTimeout` 模拟 800ms 延迟返回写死的预测结果 JSON。
8. **监控与日志 `Monitoring`**：系统状态横幅（99.99% 可用性）、QPS 与平均延迟两张折线图，以及一个终端风格的实时日志流（数据用 `Math.random` 现场生成）。

---

## 五、本地运行

**前置条件**：Node.js。

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 生产构建（会先跑 tsc 做类型检查）
npm run build

# 4. 本地预览构建产物
npm run preview
```

> 原 `README.md` 提到的 `GEMINI_API_KEY` 和 `.env.local` 是 Google AI Studio 模板留下的，本项目代码里并没有实际使用，可忽略。

---

## 六、阅读与二次开发建议

- **想看「页面长什么样」**：从 `App.tsx` 的路由表出发，再进 `pages/` 对应文件即可，每个页面都是自包含的。
- **想改数据**：直接改 `services/mockApi.ts`，列表类页面会自动跟着变。
- **想加新模块**：在 `pages/` 新建组件 → 在 `App.tsx` 加一条 `<Route>` → 在 `components/Sidebar.tsx` 的 `navItems` 里加一项导航。
- **目前没有的状态管理**：组件间共享数据靠各自局部 `useState` + Mock 数组，没有引入 Redux / Context，适合原型阶段的快速迭代。
