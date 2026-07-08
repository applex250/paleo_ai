# 单井数据 增删改查（CRUD）流程说明

> 本文档对应独立后端 `server/`（Express + node:sqlite）+ `pages/DataManager.tsx` 前端，描述「单井数据（danjing）」如何用 SQLite 管理元数据、如何按 id 定位记录、以及增/查/删的具体流程。
> 运行时：Node 内置 `node:sqlite`，数据库文件 `data01/metadata.db`，数据文件目录 `data01/danjing/`。后端用 `npm run server` 启动（:3000）；已与前端彻底分离（不再寄生在 vite.config.ts）。

---

## 一、数据模型与"id ↔ 文件"的对应关系

**一张表**（`data01/metadata.db` 内）：

```sql
CREATE TABLE IF NOT EXISTS danjing_dataset (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键，自增
  name        TEXT NOT NULL,        -- 数据集名称（给人看的友好名）
  format      TEXT,                 -- 格式：单井统一为 'xlsx'
  size_bytes  INTEGER,              -- 文件大小（字节）
  created_at  TEXT NOT NULL,        -- 创建日期 YYYY-MM-DD
  status      TEXT NOT NULL DEFAULT '原始',
  stored_file TEXT NOT NULL         -- 磁盘上的真实文件名，固定为 '<id>.xlsx'
);
```

**核心约定：文件名 = `<id>.xlsx`**

```
数据库一行               磁盘文件
┌─────────────────┐     data01/danjing/
│ id = 5          │ ──────────────────► 5.xlsx
│ name = 惠州…A组 │     （真实 xlsx 内容）
│ stored_file=5.xlsx│
└─────────────────┘
```

- **id 是唯一锚点**：所有"找到某一条"都靠 `WHERE id = ?`。
- 友好名只在库里（`name`），磁盘文件用纯 id 命名，靠 `stored_file`（= `<id>.xlsx`）关联。
- 列表接口会把 `id` 一起返回给前端，前端后续的导出/删除都用这个 `id` 去定位。

---

## 二、怎么"找到数据库里对应的一条"

**统一答案：按主键 `id` 查。** 流程是：

```
前端列表（GET /api/datasets?key=danjing）
   └─ 返回所有行，每行带 id
        └─ 用户在某行点【导出】或【删除】
             └─ 前端拿这一行的 id，发起请求
                  └─ 后端用 WHERE id = ? 定位到这一条记录
                       └─ 从该行读 stored_file，找到磁盘上 <id>.xlsx
```

定位用的 SQL（单条查询）：

```sql
SELECT stored_file AS f FROM danjing_dataset WHERE id = ?;
```

> 因为文件名就是 `<id>.xlsx`，**找到了 id 就等于找到了文件**，不需要额外的“文件名映射”。

### 补充：前端点击「删除」时，id 是怎么传过来的

id **不是从 DOM 里读的**（没有 `data-id` 之类属性），而是靠 React 状态一路携带。完整链路（`pages/DataManager.tsx`）：

```
① 后端列表把每条的 id 返回出来
   GET /api/datasets?key=danjing
     → files: [{ id: 5, name: '…', stored_file: '5.xlsx', … }, …]

② 存进 React 状态
   const [files, setFiles] = useState<DatasetFile[]>([]);
   fetchFiles() → setFiles(data.files);        // 每个元素都带 id

③ 渲染表格时，.map 的回调把“自己那行的对象 d”闭包住
   {files.map((d) => (
     <tr key={d.id}>
       …
       <button onClick={() => setDeleteTarget(d)}> 删除 </button>
                       //          ↑ 把整行对象 d（含 d.id）存进 deleteTarget
     </tr>
   ))}

④ 点「删除」→ 弹确认框（此时 deleteTarget 已是这一行的 d）
   点「确认删除」→ handleDelete()
   const d = deleteTarget;                          // 取出这一行
   const url = `/api/datasets/danjing?id=${d.id}`;  // 用 d.id 拼请求
   await fetch(url, { method: 'DELETE' });          // 后端按 WHERE id=? 删除
```

关键点：

- **id 在 `.map((d) => …)` 里随每行的 `d` 一起被“记住”（闭包）**，所以每个删除按钮天生知道自己那一行的 id，不用查 DOM、不用查表。
- 中转一下 `deleteTarget` 状态，是为了让**独立渲染的确认弹窗**也能拿到这条记录（弹窗在循环外，不能直接访问循环里的 `d`）。
- 最终 `d.id` 拼进 `DELETE /api/datasets/danjing?id=<id>`，后端据此 `WHERE id = ?` 精确命中一条。
- 「导出」按钮同理：`onClick={() => handleExportRow(d)}`，`d.id` 拼进下载请求 `?id=<id>`。

---

## 三、API 速查

| 操作 | 方法 & 路径 | 关键参数 | 作用 |
|------|-------------|----------|------|
| 查（列表） | `GET /api/datasets?key=danjing` | key | 返回全部记录（含 id） |
| 查（单条→文件） | `GET /api/datasets/danjing/file?id=<id>` | id | 按 id 找 stored_file，返回真实 xlsx |
| 增（导入） | `POST /api/datasets/danjing?filename=<原名>` | filename（body=文件字节） | 转换→入库→改名 |
| 删 | `DELETE /api/datasets/danjing?id=<id>` | id | 删记录 + 删文件 |
| 改 | —（暂未对外提供，见第六节） | — | — |

> 地震(dizhen)/切片(qiepian) 没有数据库，仍是文件夹扫描：增/查/删按 `filename` 操作文件本身。

---

## 四、增（Create / 导入）

**触发**：页面点【数据导入】选本地 `.xml`/`.xlsx` → 前端 `POST` 文件字节。

**后端流程**（`importDanjing`，包在一个事务里）：

```
1. 收到字节 buf，filename=原名
2. 格式判定：.xlsx → 原样；.xml → convertToXlsx(buf) 转 xlsx
3. BEGIN 事务
   3a. INSERT INTO danjing_dataset(name, format, size_bytes, created_at, status, stored_file)
       VALUES (?, 'xlsx', ?, ?, '原始', '')      -- 先插一条，stored_file 暂空
   3b. id = 上一步的 lastInsertRowid              -- 数据库分配的自增 id
   3c. storedFile = `<id>.xlsx`
   3d. 写文件：data01/danjing/<id>.xlsx <= buf
   3e. UPDATE danjing_dataset SET stored_file = '<id>.xlsx' WHERE id = ?
4. COMMIT（任一步失败 → ROLLBACK，不留孤儿记录）
```

**要点**：
- 先插库拿 id，再用 id 给文件命名、回写 `stored_file` —— 这就是"id ↔ 文件名"的建立过程。
- 事务保证"库里有记录"和"磁盘有文件"一致：写文件失败则整笔回滚。
- `.xlsx` 不做任何处理原样存；`.xml` 才转 xlsx。

---

## 五、查（Read）

### 5.1 列表（`listDanjing`）

```sql
SELECT id, name, format, size_bytes AS sizeBytes,
       created_at AS createdAt, status, stored_file AS storedFile
FROM danjing_dataset ORDER BY id DESC;
```

直接查库，**不扫文件夹、不解析 xlsx**，所以即使有几十 MB 的大文件也是毫秒级。前端拿到列表后渲染表格。

### 5.2 找单条 + 下载文件（导出）

前端用某行的 `id` 请求 `GET /api/datasets/danjing/file?id=<id>`，后端：

```sql
SELECT stored_file AS f FROM danjing_dataset WHERE id = ?;   -- 按 id 定位
```

→ 读 `data01/danjing/<stored_file>` → 以 xlsx 类型返回真实文件字节 → 前端用友好名 `<name>.xlsx` 保存到本地。

---

## 六、改（Update）—— 当前状态

**如实说明：目前没有对外的"修改"功能。** 现在写库的路径只有：

- 导入时的 `INSERT`（第四节）；
- 导入/迁移时回写 `stored_file` 的内部 `UPDATE`：
  ```sql
  UPDATE danjing_dataset SET stored_file = ? WHERE id = ?;
  ```

页面上没有"编辑"按钮，`status` 一直是 `'原始'`。

**如果以后要支持改**（例如改名、改状态），按同样的"id 定位"模式加一个接口即可：

```
PATCH /api/datasets/danjing?id=<id>   body: { name?, status? }
```
```sql
UPDATE danjing_dataset SET name = ?, status = ? WHERE id = ?;
```

---

## 七、删（Delete）

**触发**：页面某行点【删除】→ 弹确认框 → 点【确认删除】→ 前端 `DELETE /api/datasets/danjing?id=<id>`。

**后端流程**：

```
1. 校验 id（必须是数字）
2. SELECT stored_file FROM danjing_dataset WHERE id = ?   -- 先查出磁盘文件名
3. DELETE FROM danjing_dataset WHERE id = ?               -- 先删库记录（避免孤儿记录）
4. unlink data01/danjing/<stored_file>                    -- 再删文件（文件已不在则忽略）
```

**要点**：
- **先删记录再删文件**：万一删文件失败，也只会留下一个"不在列表里"的孤儿文件，而不会出现"列表里有、但文件已丢"的脏记录。
- 按 id 删除，精准命中一条，不会误删其它。
- 单井用自增 id，删除后 id 会有空缺（如 7、8、11），这是 `AUTOINCREMENT` 的正常行为。

---

## 八、关键设计点小结

1. **id 是唯一锚点**：增/查/删全靠 `WHERE id = ?`；前端从列表拿到 id 后处处携带。
2. **文件名 = `<id>.xlsx`**：找到 id 即找到文件，无需额外映射表。
3. **友好名只在库**：磁盘文件用纯 id 命名，界面显示用库里的 `name`。
4. **事务保一致性**：导入时插库+写文件绑在一个事务里。
5. **列表只查库**：不扫文件夹、不解析大文件 → 列表毫秒级。
6. **路径安全**：所有按文件名的操作都用 `path.basename` 拦截 `../`、`..\`；单井的文件名来自数据库本身（不可被前端控制），更安全。
7. **删除顺序**：先删库记录、再删文件，避免脏记录。

---

## 附：相关代码位置

| 职责 | 位置 |
|------|------|
| 建表 / 迁移 / WAL 调优 | `server/db.ts` → 建表 + PRAGMA + `migrateDanjingIfNeeded` |
| 增（导入） | `server/index.ts` POST 路由 + `server/db.ts` `importDanjing`（经 `server/queue.ts` 串行队列 + `server/convert.ts` worker 转换） |
| 查（列表） | `server/index.ts` GET `/api/datasets` + `server/db.ts` `listDanjing` / `server/util.ts` `listFiles` |
| 查（下载单条） | `server/index.ts` GET `/api/datasets/:key/file` + `server/db.ts` `getDanjingFile` |
| 删 | `server/index.ts` DELETE 路由 + `server/db.ts` `deleteDanjing`（经串行队列） |
| 前端按钮/弹窗 | `pages/DataManager.tsx` → `handleExportRow` / `handleDelete` / 删除确认弹窗 |
| 类型定义 | `types.ts` → `DatasetFile`（含可选 `id`）；后端 `server/types.ts` |
