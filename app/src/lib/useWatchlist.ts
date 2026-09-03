import { useCallback, useEffect, useState } from "react";

const KEY = "cb-radar:watchlist";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function useWatchlist() {
  const [set, setSet] = useState<Set<string>>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...set]));
    } catch {
      // ignore quota / private-mode errors
    }
  }, [set]);

  const toggle = useCallback((code: string) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const has = useCallback((code: string) => set.has(code), [set]);

  return { watchSet: set, toggle, has };
}
