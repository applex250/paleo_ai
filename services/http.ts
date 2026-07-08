// 统一的 fetch 封装：带 cookie（credentials:'include'）+ 401 全局拦截跳登录页。
// 同源下 fetch 默认也会带 cookie，这里显式 include 以兼容将来跨域部署。
let onUnauthorized: (() => void) | null = null;

// 注册 401 处理（App 顶层注册：清 user 状态 + 跳 /login）
export const setUnauthorizedHandler = (fn: (() => void) | null): void => {
  onUnauthorized = fn;
};

export const apiFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (res.status === 401 && onUnauthorized) {
    onUnauthorized();
  }
  return res;
};
