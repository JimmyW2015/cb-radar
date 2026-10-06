import { useState } from "react";

// 記在 localStorage 的字串狀態；讀不到、值不合法、或瀏覽器不讓存（無痕模式）時都安靜退回預設值
export function usePersistedState<T extends string>(key: string, fallback: T, valid: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && valid.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  function set(next: T) {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* ignore */
    }
  }
  return [value, set] as const;
}
