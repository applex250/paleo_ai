// 写入内存串行队列
// SQLite 是单写者模型：把所有写操作（导入/删除）串行化，天然避免并发写撞 SQLITE_BUSY。
// 接口仍同步等结果返回（前端零改动）；将来要"立即返回 + 后台处理"时，
// 把 `await enqueue(...)` 改成入队后返回 taskId 即可。

let chain: Promise<unknown> = Promise.resolve();

export function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  // 上一任务无论成败都继续执行本任务（不让一个坏任务卡死整条队列）
  const run = chain.then(task, task);
  // 链不断：失败时打日志便于排查，但调用方仍会收到 reject（由路由转成 5xx）
  chain = run.then(
    () => undefined,
    (e) => {
      console.error('[queue] task failed:', e);
      return undefined;
    },
  );
  return run;
}

// 等待队列排空（优雅关闭用）
export function flush(): Promise<unknown> {
  return chain;
}
