# 部署指南（生产）

面向 300–400 人并发使用的内部部署。架构：**Nginx 托管前端静态资源 + 反代 /api 到 Express 后端 + 限流**。

## 一、构建

```bash
npm install
npm run build          # 产出 dist/（前端静态资源）
# 后端用 tsx 直跑，无需编译（dev/生产代码一致，省去 worker 编译坑）
```

## 二、后端启动（生产）

```bash
# 推荐：PM2 守护（支持优雅重启）
pm2 start "tsx server/index.ts" --name ai-ops-api
pm2 save

# 或裸跑
npm start
```

- 默认端口 3000，可用 `PORT=xxxx` 改。
- 生产**不要**设 `SERVE_STATIC`（静态交给 Nginx，职责清晰，能享受 Nginx 的 gzip/缓存）。

## 三、Nginx 配置（反代 + 限流）

```nginx
# 限流区：每 IP 10 req/s，突发 20
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    listen 80;
    server_name your.domain;

    root /path/to/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # 用 HashRouter 其实非必需，留作兜底
    }

    location /api/ {
        limit_req zone=api burst=20 nodelay; # 限流：挡恶意刷接口
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 200m;           # 与后端 express.raw limit 一致
    }
}
```

## 四、硬件建议

- **CPU**：2 核够用，推荐 4 核（应对突发计算，如多人同时导入大 XML）。
- **内存**：4GB 足够（SQLite 极轻量，常驻 < 100MB）。
- **磁盘**：**必须 SSD**。机械盘随机 IO 会让并发写入排队明显变长。
- 这个量级（300–400 人，实际 RPS 通常 30–80）是 Express + SQLite 的甜点区，无需 MySQL/Redis。

## 五、SQLite 调优（已在代码里生效）

`server/db.ts` 启动时执行：

```sql
PRAGMA journal_mode=WAL;     -- 读写不互锁
PRAGMA synchronous=NORMAL;   -- WAL 下安全且快
PRAGMA cache_size=-64000;    -- 64MB 页缓存
PRAGMA temp_store=MEMORY;
```

- WAL 会多出 `metadata.db-wal`、`metadata.db-shm` 两个辅助文件，正常，**不要手动删**。
- 备份时连同 `.db-wal` 一起拷，或先 `PRAGMA wal_checkpoint(TRUNCATE)`。

## 六、优雅关闭

`server/index.ts` 监听 `SIGTERM`/`SIGINT`：停 HTTP → 等写入队列排空（`flush`）→ 关 SQLite → 退出。

- **PM2**：`pm2 reload ai-ops-api` 发 SIGINT，优雅重启，不丢进行中的写入。
- ⚠ Windows 下信号支持有限（SIGTERM 不一定触发 handler，且 Git Bash 的 `kill` 不识别原生 PID）；生产请部署在 Linux。

## 七、后续演进路径（按需）

- **写入异步化**：当前写入经内存串行队列、接口同步等结果（前端零改动）。若将来要"提交成功、后台处理中"体验，把 `await enqueue(...)` 改成入队返回 taskId + 加任务状态查询接口即可，队列已就绪。
- **持久化队列**：若并发写入远超 SQLite 单写者上限（>200 TPS），可引入 BullMQ + Redis 做持久化/重试队列（会引入 Redis 依赖）。
- **CPU 密集任务**：XML→xlsx 已在 worker 线程；若新增更重计算（如大批量导出），同样丢 worker，避免阻塞主线程。
