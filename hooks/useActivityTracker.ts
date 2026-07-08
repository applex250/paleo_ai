import { useCallback, useEffect, useRef, useState } from 'react';

const MOVE_THRESHOLD = 50; // 鼠标位移阈值（像素），超过才视为活跃

// 活动检测引擎：keydown / scroll 立即置活跃；mousemove 用 50px 欧氏距离阈值。
// 暴露 isActive（渲染用）、isActiveRef（计时器回调里读最新值，避免闭包旧值）、resetActive（接口调用之后重置）。
export const useActivityTracker = (enabled: boolean) => {
  const [isActive, setIsActive] = useState(false);
  const isActiveRef = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const mark = useCallback(() => {
    isActiveRef.current = true;
    setIsActive(true);
  }, []);

  const resetActive = useCallback(() => {
    isActiveRef.current = false;
    setIsActive(false);
    lastPos.current = null; // 重置基准点，下一次 mousemove 重新初始化
  }, []);

  useEffect(() => {
    if (!enabled) {
      // 禁用时清状态（进入/退出编辑界面的边界）
      isActiveRef.current = false;
      setIsActive(false);
      lastPos.current = null;
      return;
    }
    const onKeyDown = () => mark();
    const onScroll = () => mark();
    const onMouseMove = (e: MouseEvent) => {
      if (lastPos.current == null) {
        // 进入编辑界面时初始化基准点为当前鼠标位置
        lastPos.current = { x: e.clientX, y: e.clientY };
        return;
      }
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) >= MOVE_THRESHOLD) {
        lastPos.current = { x: e.clientX, y: e.clientY };
        mark();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [enabled, mark]);

  return { isActive, isActiveRef, resetActive };
};
