import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { convertCore } from './convertCore';

const workerPath = fileURLToPath(new URL('./convert.worker.ts', import.meta.url));

// XML → xlsx：在 worker 线程做（CPU 密集，不阻塞主线程），worker 异常时三道降级到同步 convertCore。
// 每次请求 new 一个 worker 并在结束时 terminate（无状态、无并发竞态）。
// 注意：降级同步若也失败（如数据本身损坏），则 reject 让路由返回 500，绝不抛未捕获异常崩进程。
export async function runConvert(buf: Uint8Array): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;

    const syncFallback = (reason: string, w: Worker | null) => {
      if (settled) return;
      settled = true;
      if (w) {
        w.removeAllListeners();
        w.terminate().catch(() => {});
      }
      console.warn(`[convert] ${reason}，降级同步`);
      try {
        resolve(convertCore(buf));
      } catch (e) {
        reject(e as Error); // 转换本身失败 → 路由转 500，不崩进程
      }
    };

    let w: Worker;
    try {
      // execArgv 让子线程也走 tsx 加载器（否则 Node 原生 worker 不认 .ts）
      w = new Worker(workerPath, { execArgv: ['--import', 'tsx'] });
    } catch (e) {
      return syncFallback(`worker spawn 失败: ${(e as Error)?.message ?? e}`, null); // 降级①spawn 抛错
    }
    const t = setTimeout(() => syncFallback('worker 超时 30s', w), 30000); // 降级③超时
    w.once('message', (out: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      w.removeAllListeners();
      w.terminate().catch(() => {});
      resolve(out);
    });
    w.once('error', (e: Error) => syncFallback(`worker error: ${e?.message ?? e}`, w)); // 降级②运行错
    w.once('messageerror', (e: Error) => syncFallback(`messageerror: ${e?.message ?? e}`, w));
    // 不 transfer：保留主线程 buf 供 fallback 使用（克隆副本开销可忽略）
    w.postMessage(buf);
  });
}
