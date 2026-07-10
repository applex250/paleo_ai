# 光标数值读出框：可见曲线集合与性能

> 数据标注 → 单井数据「预览」里，鼠标在画布上移动时跟随光标的小框，显示当前深度下各可见曲线的数值。本文说明「可见曲线集合如何确定」以及性能表现。

## 1. 目标回顾

鼠标在画布上移动时，跟随光标的小框要显示 **当前画布上所有可见曲线** 在该深度的数值：

- **右侧面板勾选的主曲线**（每个主曲线 = 一条道）
- **每列 ➕ 下拉勾选的副曲线**（叠加进该道）
- 同一条曲线若既是某列主、又是另一列副 → **只显示一行**（去重）

来源是 `welllog/components/WellLogViewer.tsx` 里的 `visibleCurves`。

---

## 2. 单一真相源：`tracks`

所有"可见性"都先汇聚进一个 `tracks` 数组（`useMemo`，依赖 `[data, selected, secondaries]`）：

```tsx
const curveTracks = data.curves
  .filter((c) => selected.has(c.name))          // 右侧勾选的主曲线 → 一道
  .map((c) => ({
    type: 'curves',
    width: TRACK_WIDTH.curve,
    label: c.name,
    curveNames: [c.name, ...(secondaries[c.name] ?? [])], // 主 + 该道副曲线
  }));
return [...curveTracks, ...DEFAULT_TRACKS];
```

每个曲线道的 `curveNames = [主曲线, ...该道的副曲线]`。
所以 **遍历所有曲线道的 `curveNames`，就等价于「右侧主曲线 ∪ 各列副曲线」** —— 不需要单独维护"哪些曲线可见"。

---

## 3. 去重得到 `visibleCurves`

```tsx
const visibleCurves = useMemo(() => {
  if (!data) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const t of tracks) {
    if (t.type !== 'curves') continue;
    for (const n of t.curveNames) {
      if (!seen.has(n)) { seen.add(n); names.push(n); }   // 首次出现才收
    }
  }
  return names
    .map((n) => data.curves.find((c) => c.name === n))
    .filter((c): c is CurveData => !!c);
}, [data, tracks]);
```

- 用 `Set` 去重 → **同曲线只出现一次**（首次出现的位置决定顺序）。
- 末尾 `name → CurveData` 解析出带 `depth/values/color` 的对象，供插值与渲染。
- 依赖 `[data, tracks]` → **只在换文件 / 改勾选 / 改副曲线时重算**，鼠标移动 **不触发** 它。

---

## 4. 鼠标移动：取值 + 渲染

数据流（每次 mousemove）：

```
Canvas.onPointerMove(y 在内容区)
   → yToDepth(y) 得到 depth
   → onCursor(depth, clientX, clientY)
   → Viewer setCursor(...)  → 重渲染
   → <CursorReadout cursor curves={visibleCurves} />
        rows = visibleCurves.map(c => ({ c, v: interpAtDepth(c.depth, c.values, depth) }))
                                  .filter(r => r.v != null)
        渲染：深度行 + 每条曲线「色点 + 名 + 值(2位小数)」
```

`CursorReadout`（`welllog/components/CursorReadout.tsx`）是 `position:fixed`、`pointer-events:none` 的浮层（不挡鼠标），位置跟随 `clientX/clientY` 并贴边翻转。

---

## 5. 插值算法（`welllog/geo.ts → interpAtDepth`）

照搬 geoviz `overlay._collect_values` / ECharts formatter 的逻辑：**二分找下界 bracket `[o, o+1]` → 线性插值**。

```ts
// depth[] 升序；values[] 含 null（-9999 缺测）
二分定位 o = 最后一个 depth[o] <= 目标深度 的下标
取 d0=depth[o], d1=depth[o+1], v0=values[o], v1=values[o+1]
若 v0、v1 都非 null 且目标深度落在 [d0,d1]：
    return v0 + (d-d0)/(d1-d0) * (v1-v0)      // 线性插值
否则返回 null（该曲线此深度缺测 → 这一行不显示）
<2 个样本 → null
```

- 复杂度：每条曲线 **O(log N)**，N = 采样点数（本井 34820）。
- 缺测处理：bracket 任一端为 null → 返回 null → 读出框里该曲线不出现（与 geoviz 一致）。

---

## 6. 性能分析

记号：`N` = 单条曲线采样点数（≈34820），`C` = 总曲线数（≈21），`V` = 可见曲线数（≤C）。

| 环节 | 触发时机 | 复杂度 | 说明 |
|---|---|---|---|
| `tracks` 构建 | 改勾选/副曲线/换文件 | O(C) | useMemo 缓存 |
| `visibleCurves`（去重+解析） | `tracks`/`data` 变 | O(扫描名 · C) ≈ O(C²) 但 C≈21 → ~400 次 | useMemo 缓存；含 `name→CurveData` 的 `.find` |
| 鼠标移动 → `interpAtDepth` × V | **每次 mousemove** | **O(V·log N)** ≈ 21·15 ≈ **315 次比较** | 读出框唯一的"热路径" |
| 读出框 DOM | 每次 mousemove | O(V) 行 | 轻量 |
| **曲线 `<path>` 重算** | mousemove | **0**（不触发） | 见下 |

### 为什么鼠标移动很流畅（关键）

mousemove 只改 Viewer 的 `cursor` 状态。重渲染链路：

- Viewer 重渲染 → `tracks` / `visibleCurves` 的 `useMemo` 依赖未变 → **直接返回缓存**（不重建数组、不重建 cfg）。
- `WellLogCanvas` 虽然也重渲染（未 memo），但：
  - 内部 `activeTracks / layout / groups` 都是 `useMemo`，依赖未变 → 缓存命中。
  - **每条 `CurveTrack` 是 `React.memo`**：它的 props（`cfg/data/width/depthTop/depthBottom/contentY/contentH/curveRange/onOpenCurveMenu`）在一次纯鼠标移动里 **全部引用不变**（深度区间 `range` 没变、`curveRanges` 没变）→ **整条道跳过重渲染**。
  - `CurvePath`（`React.memo` + `useMemo(d, [curve,range,...])`）同理跳过 → **不重算 SVG path**（这是最贵的部分：降采样是 O(N)）。
- 真正干活的只有 `CursorReadout`：V 次 `O(log N)` 插值 + V 行 DOM。

> 一句话：**移动鼠标只重算"读数小框"，34820 点的曲线 path 一根都不重画。**

### 量级感

- 单次 mousemove 的 CPU：约 **300 次比较 + 20 行 DOM diff**，远低于一帧预算（16ms 可做数百万次操作）。
- 即便可见曲线翻倍到 ~40 条，仍是 ~600 次比较，无压力。

---

## 7. 边界与可优化点

- **`.find` 解析曲线**：`visibleCurves` 末尾 `names.map(n => data.curves.find(...))` 是 O(C) 每次 → 总 O(C²)。C≈21 无感；若曲线上百，可换成 `new Map(data.curves.map(c => [c.name, c]))` 做 O(1) 查找。
- **depth[] 必须升序**：插值用二分，依赖采样按深度递增（本数据 0.125m 等距，成立）。若未来接入乱序数据，需先排序。
- **去重的"首现优先"**：同曲线在 A 道为主、B 道为副时，按 `tracks` 里先出现的道收（通常主曲线道在前），顺序稳定、只一行。
- **读出框高度**：V 行无上限；曲线很多时小框会变长，但已做贴边翻转避免溢出视口。
- **`CursorReadout` 未 memo**：它每次 mousemove 都重渲染，但内部只有 V 次插值，无需 memo；若 V 极大可加 `React.memo` + 仅依赖 `cursor.depth`（但 x/y 也要变），收益有限。

---

## 附：相关文件

- `welllog/components/WellLogViewer.tsx` — `tracks`、`visibleCurves`、`cursor` 状态、渲染 `CursorReadout`
- `welllog/components/WellLogCanvas.tsx` — `onCursor/onCursorLeave` 上报（`yToDepth` 反算深度 + `clientX/Y`）
- `welllog/components/CursorReadout.tsx` — 跟随光标的数值浮层
- `welllog/geo.ts` — `interpAtDepth`（二分 + 线性插值）
