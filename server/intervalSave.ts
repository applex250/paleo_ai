// 主线程：在 enqueue + 持锁上下文中启动 Worker，对 <id>.xlsx 做 JSON 增量区间写入。
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type {
  IntervalOpIn,
  IntervalSaveWorkerIn,
  IntervalSaveWorkerOut,
  OpResult,
} from './intervalSave.worker';

const workerPath = fileURLToPath(new URL('./intervalSave.worker.ts', import.meta.url));

const WORKER_TIMEOUT_MS = 60_000;

export type { IntervalOpIn, OpResult };

export async function runIntervalSave(
  filePath: string,
  wellName: string,
  operations: IntervalOpIn[],
): Promise<IntervalSaveWorkerOut> {
  const payload: IntervalSaveWorkerIn = { filePath, wellName, operations };

  return new Promise<IntervalSaveWorkerOut>((resolve) => {
    let settled = false;
    const finish = (out: IntervalSaveWorkerOut, w: Worker | null) => {
      if (settled) return;
      settled = true;
      if (w) {
        w.removeAllListeners();
        w.terminate().catch(() => {});
      }
      resolve(out);
    };

    let w: Worker;
    try {
      w = new Worker(workerPath, { execArgv: ['--import', 'tsx'] });
    } catch (e) {
      return finish(
        { ok: false, error: `worker spawn 失败: ${(e as Error)?.message ?? e}` },
        null,
      );
    }

    const t = setTimeout(() => {
      finish({ ok: false, error: 'interval save worker 超时' }, w);
    }, WORKER_TIMEOUT_MS);

    w.once('message', (out: IntervalSaveWorkerOut) => {
      clearTimeout(t);
      finish(out ?? { ok: false, error: 'empty worker response' }, w);
    });
    w.once('error', (e: Error) => {
      clearTimeout(t);
      finish({ ok: false, error: `worker error: ${e?.message ?? e}` }, w);
    });
    w.once('messageerror', (e: Error) => {
      clearTimeout(t);
      finish({ ok: false, error: `messageerror: ${e?.message ?? e}` }, w);
    });
    w.postMessage(payload);
  });
}
