import { useCallback, useEffect, useRef, useState } from 'react';
import { heartbeatAnnotation } from '../services/annotation';

const HEARTBEAT_MS = 5 * 60 * 1000; // 主计时器周期 5 分钟

export interface LockState {
  locked: boolean; // 是否正常持锁
  readOnly: boolean; // 锁失效/被抢 → 编辑器切只读
  message: string; // 提示（续期失败警告 / 抢占提示）
}

/** 心跳 tick 上挂载的自动保存钩子（懒取，避免闭包旧值）。 */
export interface AnnotationLockAutosave {
  /** 是否有未保存区间（有则强制 heartbeat active 续期） */
  hasUnsaved?: () => boolean;
  /** 一轮自动保存（内部可含失败重试）；心跳成功后调用 */
  requestAutosave?: () => Promise<boolean>;
  /** 退出/完成中等：跳过本拍自动保存 */
  isAutosaveBlocked?: () => boolean;
}

// 锁生命周期 + 5min 心跳调度。
// 每次 tick：
//   1) activeForRenew = 用户活跃 OR 有 pending → heartbeat
//   2) 心跳成功且未 block 且仍有 pending → requestAutosave（失败也会在下 tick 再试）
export const useAnnotationLock = (
  datasetId: number | null,
  isActiveRef: { current: boolean },
  resetActive: () => void,
  autosave?: AnnotationLockAutosave,
): LockState => {
  const [state, setState] = useState<LockState>({ locked: false, readOnly: false, message: '' });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idRef = useRef<number | null>(datasetId);
  const stoppedRef = useRef(false);
  const tickInFlightRef = useRef(false);
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(async () => {
    if (tickInFlightRef.current) return;
    const id = idRef.current;
    if (id == null || stoppedRef.current) return;

    tickInFlightRef.current = true;
    try {
      const hasUnsaved = autosaveRef.current?.hasUnsaved?.() ?? false;
      // 有待保存时强制续期，避免静置标注后锁过期导致无法保存
      const active = isActiveRef.current || hasUnsaved;
      const res = await heartbeatAnnotation(id, active);
      if (stoppedRef.current) return;

      if (!res || !res.ok) {
        // 423：锁被他人抢占或已过期失效 → 只读 + 停计时器（不再自动保存）
        setState({ locked: false, readOnly: true, message: res?.error || '编辑权限已失效' });
        stop();
        return;
      }

      // 成功：清掉之前的续期失败警告
      setState((s) => (s.message ? { ...s, message: '' } : s));
      resetActive(); // 接口调用之后重置活跃标记

      const blocked = autosaveRef.current?.isAutosaveBlocked?.() ?? false;
      const stillUnsaved = autosaveRef.current?.hasUnsaved?.() ?? false;
      if (!blocked && stillUnsaved && autosaveRef.current?.requestAutosave) {
        try {
          await autosaveRef.current.requestAutosave();
        } catch {
          // 自动保存异常不推翻锁状态；pending 保留，下次 tick 再试
        }
      }
    } finally {
      tickInFlightRef.current = false;
    }
  }, [isActiveRef, resetActive, stop]);

  useEffect(() => {
    idRef.current = datasetId;
    stoppedRef.current = false;
    if (datasetId == null) {
      stop();
      setState({ locked: false, readOnly: false, message: '' });
      return;
    }
    setState({ locked: true, readOnly: false, message: '' });
    timerRef.current = setInterval(tick, HEARTBEAT_MS);
    return () => {
      stoppedRef.current = true;
      stop();
    };
  }, [datasetId, tick, stop]);

  // beforeunload 兜底：用户直接关 tab/刷新（而非点「退出编辑」）时，
  // 用 sendBeacon 释放锁，避免锁残留至 10min 巡检才清理、阻塞他人编辑。
  // 占位期无内容，空 body 即可；cookie 同源自动携带。
  useEffect(() => {
    if (datasetId == null) return;
    const onBeforeUnload = () => {
      navigator.sendBeacon(`/api/annotation/${datasetId}/exit`);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [datasetId]);

  return state;
};
