import { parentPort, threadId } from 'node:worker_threads';
import { convertCore } from './convertCore';

// worker 线程入口（由主线程 runConvert 每次请求 new 一个，跑完 terminate）
console.log('[worker] started tid', threadId);

parentPort?.on('message', (buf: Uint8Array) => {
  try {
    const out = convertCore(buf);
    parentPort?.postMessage(out, [out.buffer as ArrayBuffer]); // 转移 ArrayBuffer 回主线程（零拷贝）
  } catch (e) {
    console.error('[worker] convertCore threw:', e);
    throw e; // 重新抛出 → 触发主线程 'error' → 降级同步
  }
});
